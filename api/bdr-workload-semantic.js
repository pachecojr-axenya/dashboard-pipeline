'use strict';

const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');
const bq = require('../lib/bigquery');
const wh = require('../lib/hubspot-warehouse');
const { _service: workloadService } = require('./bdr-workload');
const { BDR_TEAM, canonicalizeBdrName, bdrOwnerIds, bdrOwnerIdClause, exitedCutClause, isActiveBdrOn, activeTeam } = require('../lib/bdr-team');

const PROJECT = 'gen-lang-client-0423905839';
const GOLD = 'axenya_sales_hubspot_bdr_prd_sae1_gold';
const TABLE = `${PROJECT}.${GOLD}.bdr_workload_daily_dimension_v2`;
const REACTIVITY_TABLE = `${PROJECT}.${GOLD}.bdr_workload_reactivity_v2`;

// ---------------------------------------------------------------------------
// FONTE DO BLOCO DE RITMO | armazém canônico (default desde 13/08/2026)
//
// O Workload nasceu lendo o medallion (`axenya_sales_hubspot_bdr_prd_sae1_gold`,
// Cloud Run Job `bdr-etl-job`, 20:00 em dia útil). O ritmo agora vem do armazém
// da fonte única (`axenya_hubspot_prd_*`, reconcile 06:30 + botão Atualizar, 83
// checks). `?fonte=medallion` continua vivo e é como se compara.
//
// MEDIDO CONTRA O MART JÁ DEPLOYADO em 13/08/2026 | 30 dias, roster de 13 BDRs,
// sem hoje (`node scripts/compare-workload-sources.js --adc`):
//   ligações  7.378 = 7.378     e-mails   5.801 = 5.801
//   LinkedIn    871 =   871     reuniões    163 =   163
//   conectadas  567 =   567     sem resposta 3.765 = 3.765
//   ocupado   2.577 = 2.577     nº errado      58 =    58
//   sem desfecho 128 =   128
//   WhatsApp MANUAL 2.755 = 2.755  <- a linha que autorizou a troca
//
// O que muda de valor é só automação: WhatsApp total 3.706 -> 2.755 e atividades
// 17.919 -> 16.968, os dois pelos mesmos 951 disparos do Treble, que o armazém
// mede à parte (decisão de 10/08 | automação não é esforço do BDR, ninguém
// digitou). Não é cobertura menor, é régua declarada | ver `premissas`.
//
// E o armazém enxerga HOJE: 13/08 às 15h ele tinha 273 atividades do roster
// contra 8 do medallion, que só roda às 20:00. Os 3 pares dia x dono que
// existem só no medallion em 30 dias têm `activities_total = 0` | linha vazia,
// não dado perdido.
//
// O QUE NÃO MIGRA AINDA, e por isso o endpoint é HÍBRIDO em vez de trocar de
// tabela: inserção (empresas/contatos criados), movimento de CRM
// (tentativa/conectado/qualificado/desqualificado), SQL e Penetração não têm
// mart no armazém. Esses blocos seguem no medallion e o payload DIZ isso em
// `source.camadas`, para quem desconfiar de um número saber a procedência sem
// ler código.
const WAREHOUSE_TABLE = wh.t('gold', 'mart_bdr_workload_dimension_daily');
const FONTES = ['medallion', 'armazem'];
// Colunas que o armazém passa a mandar. O resto da linha continua vindo do
// medallion | é esta lista, e só ela, que define a fronteira do híbrido.
const CAMPOS_RITMO_ARMAZEM = ['calls', 'calls_conversation', 'calls_dial', 'calls_voicemail', 'calls_no_answer', 'calls_busy', 'calls_wrong_number', 'calls_no_outcome', 'calls_talk_time_s', 'emails', 'whatsapp', 'whatsapp_manual', 'whatsapp_treble', 'linkedin', 'meetings', 'activities_total', 'companies_touched', 'contacts_touched'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const CHANNELS = ['calls', 'emails', 'whatsapp', 'linkedin', 'meetings'];
const CHANNEL_SQL = { calls: 'calls_total', emails: 'emails_sent_total', whatsapp: 'whatsapp_total', linkedin: 'linkedin_total', meetings: 'meetings_total' };
const PORTE_VALUES = ['enterprise', 'grande', 'media', 'pme', 'desconhecido'];
const LIVE_TTL_MS = 90 * 1000;
let l1 = new Map();
// filterOptions faz DISTINCT na tabela inteira e muda raramente: cache longo.
const FILTER_OPTIONS_TTL_MS = 10 * 60 * 1000;
let filterOptionsCache = { at: 0, val: null };
async function cachedFilterOptions() { if (filterOptionsCache.val && Date.now() - filterOptionsCache.at < FILTER_OPTIONS_TTL_MS) return filterOptionsCache.val; const val = await queryFilterOptions(); filterOptionsCache = { at: Date.now(), val }; return val; }

// ---------------------------------------------------------------------------
// FRESCOR DA METADE QUE NÃO MIGROU
//
// O selo da tela (`/api/freshness` + o botão Atualizar) fala do ARMAZÉM: é ele
// que o `hubspot-platform-reconcile` atualiza, agora 6x por dia útil. Só que
// inserção, CRM, SQL e Penetração continuam no medallion, que é carregado pelo
// `bdr-etl-job` (us-central1) UMA vez por dia, ~20:15 BRT — e o botão Atualizar
// NÃO o dispara.
//
// Sem este carimbo o usuário clica em Atualizar, o selo diz "agora mesmo", e
// metade da tela segue sendo de ontem à noite. Selo verde em cima de número
// velho é pior que não ter selo: o mesmo motivo pelo qual o selo foi criado.
const MEDALLION_SILVER = `${PROJECT}.axenya_sales_hubspot_bdr_prd_sae1_silver.activities`;
const FRESCOR_MEDALLION_TTL_MS = 10 * 60 * 1000;
let frescorMedallionCache = { at: 0, val: null };
async function frescorMedallion() {
  if (frescorMedallionCache.val && Date.now() - frescorMedallionCache.at < FRESCOR_MEDALLION_TTL_MS) return frescorMedallionCache.val;
  try {
    // `activity_date` é a coluna de partição e o BQ exige filtro nela (a tabela
    // é require_partition_filter). 3 dias cobrem fim de semana e feriado.
    const sql = `SELECT MAX(ingested_at) AS carregado_em FROM \`${MEDALLION_SILVER}\` WHERE activity_date >= DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 3 DAY)`;
    const { rows } = await bq.query(sql, []);
    const carregadoEm = normalizeTimestamp(rows[0] && rows[0].carregado_em);
    const val = { carregadoEm, idadeHoras: carregadoEm ? (Date.now() - Date.parse(carregadoEm)) / 3600000 : null, erro: null };
    frescorMedallionCache = { at: Date.now(), val };
    return val;
  } catch (error) {
    // Frescor indisponível não pode derrubar a tela — mesma regra do selo.
    return { carregadoEm: null, idadeHoras: null, erro: String(error.message || error).slice(0, 200) };
  }
}
// Cache curto do payload completo: Pulso/Canais/Gestão batem no mesmo endpoint;
// evita refazer as queries a cada troca de aba/recarga. refresh=1 ignora o cache.
const PAYLOAD_TTL_MS = 45 * 1000;
let payloadCache = new Map();
// `f` (fonte) ENTRA NA CHAVE: sem ela, um pedido com `?fonte=medallion` receberia
// o payload do armazém que ficou em cache 45s antes, e a comparação entre as duas
// fontes compararia uma fonte com ela mesma | o jeito mais rápido de "provar"
// paridade perfeita e não estar provando nada.
function payloadKey(r) { return JSON.stringify({ s: r.since, u: r.until, b: r.bdr || '', c: (r.channels || []).join(','), bd: r.businessDays, p: (r.portes || []).join(','), sg: (r.segmentos || []).join(','), pe: (r.personas || []).join(','), f: r.fonte || '' }); }

const LIVE_RHYTHM_FIELDS = ['calls', 'callsConversation', 'callsDial', 'callsVoicemail', 'callsNoAnswer', 'callsBusy', 'callsWrongNumber', 'callsNoOutcome', 'callsTalkTimeS', 'emails', 'whatsapp', 'whatsappManual', 'whatsappTreble', 'linkedin', 'meetings', 'activities', 'total'];
const LIVE_CRM_FIELDS = ['attempted', 'crmMovements', 'connected', 'qualified', 'disqualified'];
const LIVE_OVERRIDE_FIELDS = LIVE_RHYTHM_FIELDS.concat(LIVE_CRM_FIELDS);
const LIVE_TRANSITION_MAP = { ATTEMPTED: 'attempted', ATTEMPTED_TO_CONTACT: 'attempted', OPEN: 'attempted', IN_PROGRESS: 'attempted', CONNECTED: 'connected', OPEN_DEAL: 'qualified', UNQUALIFIED: 'disqualified', BAD_TIMING: 'disqualified' };
// Desfecho de ligacao no caminho LIVE. A chave CANONICA e o GUID do disposition
// (`activity.desfechoId`), o MESMO que a view gold usa -- assim "conectada" tem
// uma definicao unica entre hoje (live) e o historico (BQ). O mapa por label
// existe apenas como fallback defensivo para payload antigo/cacheado que ainda
// nao traga o GUID; label depende do idioma e da customizacao do portal, entao
// nao serve como fonte primaria. Politica: sucesso = 'connected' apenas;
// voicemail (recado de voz ou ativo) e bucket proprio.
const CALL_DISPOSITION_GUID = { 'f240bbac-87c9-4f6e-bf70-924b57d47db7': 'connected', '73a0d17f-1163-4015-bdd5-ec830791da20': 'no_answer', '9d9162e7-6cf3-4944-bf63-4dff82258764': 'busy', '17b47fee-58de-441e-a44c-c6300d46f273': 'wrong_number', 'b2cf5968-551e-4856-9783-52b3da59a7d0': 'voicemail', 'a4c4c377-d246-4b32-a13b-75a56a4cd0ff': 'voicemail' };
const LIVE_CALL_OUTCOME = { 'conectado': 'connected', 'connected': 'connected', 'sem resposta': 'no_answer', 'no answer': 'no_answer', 'ocupado': 'busy', 'busy': 'busy', 'numero errado': 'wrong_number', 'número errado': 'wrong_number', 'wrong number': 'wrong_number', 'deixou mensagem de voz': 'voicemail', 'left voicemail': 'voicemail', 'deixou mensagem ativa': 'voicemail', 'left live message': 'voicemail' };
// Diagnostico: desfechos que nao resolveram para bucket algum. Exposto em
// quality.checks para que label/GUID novo apareca como warn em vez de virar
// silenciosamente "sem conexao" e derrubar a taxa do dia sem ninguem notar.
function normalizeDispositionLabel(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase(); }
function callOutcomeOf(activity, unknown) { const guid = String(activity && activity.desfechoId || '').trim().toLowerCase(); if (guid) { const byGuid = CALL_DISPOSITION_GUID[guid]; if (byGuid) return byGuid; } const label = normalizeDispositionLabel(activity && activity.desfecho); if (label) { const byLabel = LIVE_CALL_OUTCOME[label] || LIVE_CALL_OUTCOME[String(activity.desfecho || '').trim().toLowerCase()]; if (byLabel) return byLabel; } if ((guid || label) && unknown) unknown.add(guid || label); return null; }
function idOf(value) { return value == null || value === '' ? null : String(value); }
function transitionBucket(value) { return LIVE_TRANSITION_MAP[String(value || '').toUpperCase()] || null; }
function associationsAvailable(payload) { const d = payload && payload.diagnostics && payload.diagnostics.activityAssociations; if (d) return d.available === true; return (payload.activities || []).some((a) => idOf(a.company_id || a.companyId || a.empresa_id || a.associatedcompanyid || a.contact_id || a.contactId || a.contato_id)); }
function liveSets(row) { if (!row._sets) row._sets = { companiesTouched: new Set(), contactsTouched: new Set() }; return row._sets; }
function stripPrivate(row) { delete row._sets; return row; }
function addTouched(row, activity) { const sets = liveSets(row); const companyId = idOf(activity.company_id || activity.companyId || activity.empresa_id || activity.associatedcompanyid); const contactId = idOf(activity.contact_id || activity.contactId || activity.contato_id); if (companyId) sets.companiesTouched.add(companyId); if (contactId) sets.contactsTouched.add(contactId); }
function hasLiveCoverage(live) { return !!(live && live.used && Array.isArray(live.rows) && live.rows.length); }
function liveRowMap(live) { const map = {}; if (!hasLiveCoverage(live)) return map; live.rows.forEach((row) => { map[`${String(row.date || row.metric_date).slice(0, 10)}|${canonicalizeBdrName(row.bdr || row.owner_name)}`] = row; }); return map; }
function mergeLiveRow(target, liveRow) { LIVE_OVERRIDE_FIELDS.forEach((field) => { if (Object.prototype.hasOwnProperty.call(liveRow, field)) target[field] = num(liveRow[field]); }); if (Object.prototype.hasOwnProperty.call(liveRow, 'companiesTouched')) target.companiesTouched = num(liveRow.companiesTouched); if (Object.prototype.hasOwnProperty.call(liveRow, 'contactsTouched')) target.contactsTouched = num(liveRow.contactsTouched); return target; }
function mergeCumulativeLiveRow(base, liveRow, requested) {
  const merged = Object.assign({}, base);
  const liveRhythmTotal = selectedTotal(liveRow, requested.channels);
  if (liveRhythmTotal >= base.total) LIVE_RHYTHM_FIELDS.forEach((field) => { if (Object.prototype.hasOwnProperty.call(liveRow, field)) merged[field] = num(liveRow[field]); });
  if (num(liveRow.crmMovements) >= base.crmMovements) LIVE_CRM_FIELDS.forEach((field) => { if (Object.prototype.hasOwnProperty.call(liveRow, field)) merged[field] = num(liveRow[field]); });
  if (Object.prototype.hasOwnProperty.call(liveRow, 'companiesTouched')) merged.companiesTouched = Math.max(base.companiesTouched, num(liveRow.companiesTouched));
  if (Object.prototype.hasOwnProperty.call(liveRow, 'contactsTouched')) merged.contactsTouched = Math.max(base.contactsTouched, num(liveRow.contactsTouched));
  merged.source = 'bq_or_live_cumulative';
  return merged;
}
function liveLineage(live) { const liveUsed = hasLiveCoverage(live); const bq = 'bq_daily_dimension_v2'; const hybrid = liveUsed ? 'bq_or_live_cumulative' : bq; const touchedSrc = liveUsed && live.rows.some((r) => Object.prototype.hasOwnProperty.call(r, 'companiesTouched') || Object.prototype.hasOwnProperty.call(r, 'contactsTouched')) ? 'bq_or_live_cumulative' : bq; return { calls: hybrid, callsConversation: hybrid, callsDial: hybrid, callsVoicemail: hybrid, callsNoAnswer: hybrid, callsBusy: hybrid, callsWrongNumber: hybrid, callsNoOutcome: hybrid, callsTalkTimeS: hybrid, emails: hybrid, whatsapp: hybrid, linkedin: hybrid, meetings: hybrid, activities: hybrid, total: hybrid, companiesTouched: touchedSrc, contactsTouched: touchedSrc, companiesInserted: bq, contactsInserted: bq, attempted: hybrid, crmMovements: hybrid, connected: hybrid, qualified: hybrid, disqualified: hybrid, sqlDeals: bq, reactivity: 'bq_reactivity_v2' }; }

function bad(message) { const error = new Error(message); error.statusCode = 400; return error; }
function parseDate(value, name) { if (!ISO.test(String(value || ''))) throw bad(`${name} obrigatório (YYYY-MM-DD)`); return value; }
function parseList(value) { return String(value || '').split(',').map((v) => v.trim()).filter(Boolean); }
function parse(req) {
  const q = new URL(`http://x${req.url}`).searchParams;
  if (q.get('v') !== '2') throw bad('v=2 obrigatório');
  const bdr = q.get('bdr') ? canonicalizeBdrName(q.get('bdr')) : null;
  if (bdr && !BDR_TEAM.includes(bdr)) throw bad('BDR inválido');
  const channels = parseList(q.get('channels') || CHANNELS.join(','));
  if (channels.some((channel) => !CHANNELS.includes(channel))) throw bad('canal inválido');
  const portes = parseList(q.get('porte'));
  if (portes.some((p) => !PORTE_VALUES.includes(p))) throw bad('porte inválido');
  const segmentos = parseList(q.get('segmento'));
  const personas = parseList(q.get('persona'));
  const since = parseDate(q.get('since'), 'since');
  const until = parseDate(q.get('until'), 'until');
  if (since > until) throw bad('since > until');
  // DEFAULT VIRADO PARA O ARMAZÉM em 13/08/2026, depois da paridade medida
  // (`node scripts/compare-workload-sources.js --adc`): os 9 números de ritmo e
  // desfecho batem na unha e o WhatsApp manual bate em 2.755, então o que muda é
  // só automação. `?fonte=medallion` continua vivo e é como se compara | manter
  // a rota antiga foi o que achou 7 defeitos silenciosos na migração da F5, que
  // trocar e olhar a tela não acharia.
  const fonte = q.get('fonte') || 'armazem';
  if (!FONTES.includes(fonte)) throw bad('fonte inválida (medallion|armazem)');
  return { since, until, bdr, bdrIds: bdrOwnerIds(bdr), channels, businessDays: q.get('businessDays') !== 'false', portes, segmentos, personas, porte: portes[0] || null, segmento: segmentos[0] || null, persona: personas[0] || null, refresh: q.get('refresh') === '1', fonte };
}
function todayIso() { return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10); }
function includesToday(r) { const t = todayIso(); return r.since <= t && r.until >= t; }
function liveRangeMs(day) { return { sinceMs: Date.parse(`${day}T00:00:00.000-03:00`), untilMs: Date.parse(`${day}T23:59:59.999-03:00`) }; }
function isBusiness(date) { const day = new Date(`${date}T00:00:00Z`).getUTCDay(); return day !== 0 && day !== 6; }
function num(value) { return Number(value || 0); }
function normalizeTimestamp(value) { if (value == null || value === '') return null; const raw = String(value).trim(); if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(raw)) { const d = new Date(Math.round(Number(raw) * 1000)); return Number.isNaN(d.getTime()) ? null : d.toISOString(); } if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(raw)) { const d = new Date(raw.replace(' ', 'T') + 'Z'); return Number.isNaN(d.getTime()) ? null : d.toISOString(); } const d = new Date(raw); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
// Peneira do roster COM DATA. Sem a data a linha de julho de quem saiu em
// agosto sumiria junto com a de agosto, e o total de julho cairia sozinho.
// Todo chamador tem a data da linha em mãos — quem não passar responde por hoje.
function isTeamOwner(name, dateIso) { return isActiveBdrOn(name, dateIso); }
function selectedTotal(row, channels) { return channels.reduce((sum, channel) => sum + num(row[channel]), 0); }
// Diz na cara o que o corte de saída fez com a janela pedida. Corte que não se
// declara é o mesmo que número que cai sozinho entre dois prints.
function rosterMensagem(requested) {
  const doInicio = activeTeam(requested.since, requested.since);
  const doFim = activeTeam(requested.until, requested.until);
  const saiuNoMeio = doInicio.filter((n) => !doFim.includes(n));
  if (saiuNoMeio.length) return `Janela cruza saída de ${saiuNoMeio.join(', ')} — o que fizeram ANTES de sair conta; o que aparece com o nome deles depois, não.`;
  const fora = BDR_TEAM.filter((n) => !doFim.includes(n));
  return fora.length ? `Roster da janela: ${doFim.length} BDRs. Fora por saída do time: ${fora.join(', ')}.` : `Roster da janela: ${doFim.length} BDRs, nenhuma saída no período.`;
}
function emptyBdrRow(bdr) { return { bdr, calls: 0, callsConversation: 0, callsDial: 0, callsVoicemail: 0, callsNoAnswer: 0, callsBusy: 0, callsWrongNumber: 0, callsNoOutcome: 0, callsTalkTimeS: 0, emails: 0, whatsapp: 0, whatsappManual: 0, whatsappTreble: 0, linkedin: 0, meetings: 0, activities: 0, total: 0, companiesTouched: 0, contactsTouched: 0, companiesInserted: 0, contactsInserted: 0, attempted: 0, crmMovements: 0, connected: 0, qualified: 0, disqualified: 0, sqlDeals: 0, previousTotal: null, deltaHistorical: null }; }
function activityBucket(activity) { if (activity.tipo === 'calls') return 'calls'; if (activity.tipo === 'emails') return String(activity.direction || '').toUpperCase() === 'INCOMING_EMAIL' ? null : 'emails'; if (activity.tipo === 'communications' && activity.canal === 'WHATS_APP') return 'whatsapp'; if (activity.tipo === 'communications' && activity.canal === 'LINKEDIN_MESSAGE') return 'linkedin'; if (activity.tipo === 'meetings') return 'meetings'; return null; }
function aggregateLivePayload(payload, day, requested, unknownOut) { const unknownDisp = unknownOut || new Set(); const byBdr = {}; const includeTouched = associationsAvailable(payload); activeTeam(day, day).forEach((bdr) => { byBdr[bdr] = emptyBdrRow(bdr); }); function rowFor(rawBdr) { const bdr = canonicalizeBdrName(rawBdr); if (!isTeamOwner(bdr, day) || (requested.bdr && bdr !== requested.bdr)) return null; if (!byBdr[bdr]) byBdr[bdr] = emptyBdrRow(bdr); return byBdr[bdr]; } (payload.activities || []).forEach((activity) => { const row = rowFor(activity.bdr); if (!row) return; const bucket = activityBucket(activity); if (!bucket) return; row[bucket] += 1; if (bucket === 'whatsapp') { if (activity.treble) row.whatsappTreble += 1; else row.whatsappManual += 1; } if (bucket === 'calls') { const outcome = callOutcomeOf(activity, unknownDisp); if (outcome === 'connected') { row.callsConversation += 1; const duration = Number(activity.duracao_ms == null ? activity.duration_ms : activity.duracao_ms); if (Number.isFinite(duration) && duration > 0) row.callsTalkTimeS += Math.round(duration / 1000); } else if (outcome === 'voicemail') { row.callsVoicemail += 1; } else { row.callsDial += 1; if (outcome === 'no_answer') row.callsNoAnswer += 1; else if (outcome === 'busy') row.callsBusy += 1; else if (outcome === 'wrong_number') row.callsWrongNumber += 1; else row.callsNoOutcome += 1; } } if (includeTouched) addTouched(row, activity); }); (payload.companiesCreated || []).forEach((company) => { const row = rowFor(company.bdr); if (row) row.companiesInserted += 1; }); (payload.contactsCreated || []).forEach((contact) => { const row = rowFor(contact.bdr); if (!row) return; row.contactsInserted += 1;  }); (payload.transitions || []).forEach((transition) => { const row = rowFor(transition.bdr); if (!row) return; const bucket = transitionBucket(transition.para || transition.to || transition.status); if (bucket) { row.crmMovements += 1; row[bucket] += 1; } }); Object.values(byBdr).forEach((row) => { if (includeTouched) { const sets = liveSets(row); row.companiesTouched = sets.companiesTouched.size; row.contactsTouched = sets.contactsTouched.size; } else { delete row.companiesTouched; delete row.contactsTouched; } row.activities = row.calls + row.emails + row.whatsapp + row.linkedin + row.meetings; row.total = selectedTotal(row, requested.channels); }); return Object.values(byBdr).filter((row) => !requested.bdr || row.bdr === requested.bdr).map((row) => ({ date: day, source: 'live', ...stripPrivate(row) })); }
async function liveRowsForToday(requested) { const hasDimFilter = !!((requested.portes && requested.portes.length) || (requested.segmentos && requested.segmentos.length) || (requested.personas && requested.personas.length) || requested.porte || requested.segmento || requested.persona); if (!includesToday(requested) || hasDimFilter) return { rows: [], used: false, error: null, disabledByFilters: hasDimFilter }; const day = todayIso(); const key = `${day}|${requested.bdr || ''}|${requested.channels.join(',')}`; const cached = l1.get(key); if (!requested.refresh && cached && Date.now() - cached.at < LIVE_TTL_MS) return { rows: cached.rows, used: true, cached: true, error: null, generatedAt: cached.generatedAt, unknownDispositions: cached.unknownDispositions || [] }; try { const token = getHubspotToken(); const range = liveRangeMs(day); const payload = await workloadService.buildPayload(token, range.sinceMs, range.untilMs); const unknownDisp = new Set(); const rows = aggregateLivePayload(payload, day, requested, unknownDisp); const unknownDispositions = Array.from(unknownDisp).slice(0, 10); const generatedAt = normalizeTimestamp(payload.generatedAt || payload.source && payload.source.generatedAt || payload.refreshedAt) || new Date().toISOString(); l1.set(key, { at: Date.now(), rows, generatedAt, unknownDispositions }); return { rows, used: true, cached: false, error: null, generatedAt, unknownDispositions }; } catch (error) { return { rows: [], used: false, error: error.message }; } }
function previousRange(requested) { const days = Math.floor((new Date(`${requested.until}T00:00:00Z`) - new Date(`${requested.since}T00:00:00Z`)) / 86400000) + 1; const end = new Date(`${requested.since}T00:00:00Z`); end.setUTCDate(end.getUTCDate() - 1); const start = new Date(end); start.setUTCDate(start.getUTCDate() - days + 1); return { since: start.toISOString().slice(0, 10), until: end.toISOString().slice(0, 10) }; }
function inClause(alias, expr, name, values, params, type) { if (!values || !values.length) return null; const names = values.map((v, i) => { const pn = `${name}${i}`; params.push({ name: pn, type: type || 'STRING', value: v }); return `@${pn}`; }); return `${expr} IN (${names.join(',')})`; }
function filterSql(alias, requested, params) { const wh = [`${alias}.metric_date BETWEEN @since AND @until`]; const oc = bdrOwnerIdClause(alias, requested.bdrIds, requested.bdr); if (oc) wh.push(oc); const ex = exitedCutClause(alias, 'metric_date'); if (ex) wh.push(ex); const pc = inClause(alias, `COALESCE(NULLIF(${alias}.porte,''),'desconhecido')`, 'porte', requested.portes, params); if (pc) wh.push(pc); const sc = inClause(alias, `COALESCE(NULLIF(${alias}.segmento,''),'desconhecido')`, 'segmento', requested.segmentos, params); if (sc) wh.push(sc); const xc = inClause(alias, `COALESCE(NULLIF(${alias}.persona,''),'não classificada')`, 'persona', requested.personas, params); if (xc) wh.push(xc); if (requested.businessDays) wh.push(`EXTRACT(DAYOFWEEK FROM ${alias}.metric_date) NOT IN (1,7)`); return wh.join(' AND '); }
async function queryRows(since, until, requested) { const r = Object.assign({}, requested, { since, until }); const params = [{ name: 'since', type: 'DATE', value: since }, { name: 'until', type: 'DATE', value: until }]; const sql = `SELECT metric_date, owner_id, owner_name, SUM(calls_total) calls, SUM(calls_conversation_total) calls_conversation, SUM(calls_dial_total) calls_dial, SUM(calls_voicemail_total) calls_voicemail, SUM(calls_no_answer_total) calls_no_answer, SUM(calls_busy_total) calls_busy, SUM(calls_wrong_number_total) calls_wrong_number, SUM(calls_no_outcome_total) calls_no_outcome, SUM(calls_talk_time_s) calls_talk_time_s, SUM(emails_sent_total) emails, SUM(whatsapp_total) whatsapp, SUM(whatsapp_manual_total) whatsapp_manual, SUM(whatsapp_treble_total) whatsapp_treble, SUM(linkedin_total) linkedin, SUM(meetings_total) meetings, SUM(activities_total) activities_total, SUM(companies_touched) companies_touched, SUM(contacts_touched) contacts_touched, SUM(companies_inserted) companies_inserted, SUM(contacts_inserted) contacts_inserted, SUM(attempted_total) attempted, SUM(crm_movements) crm_movements, SUM(connected_total) connected, SUM(qualified_total) qualified, SUM(disqualified_total) disqualified, SUM(sql_deals) sql_deals, MAX(refreshed_at) refreshed_at FROM \`${TABLE}\` d WHERE ${filterSql('d', r, params)} GROUP BY metric_date, owner_id, owner_name ORDER BY metric_date, owner_name`; const { rows } = await bq.query(sql, params); return { sql, rows }; }
// Mesma janela, mesmos filtros, mesmo grão do `queryRows` | a diferença está só
// nos nomes de coluna e na régua de WhatsApp.
//
// O armazém chama de `whatsapp_total` o que o medallion chama de
// `whatsapp_manual_total`, e de `whatsapp_automacao_total` o que o medallion
// chama de `whatsapp_treble_total`. NÃO renomeei o armazém para caber no
// vocabulário do medallion: a régua decidida em 10/08 é a do armazém (automação
// medida à parte), e reescrever o mart para agradar o consumidor é como as duas
// pontas voltam a divergir. O de-para vive aqui, num lugar só.
async function queryWarehouseRows(since, until, requested) {
  const r = Object.assign({}, requested, { since, until });
  const params = [{ name: 'since', type: 'DATE', value: since }, { name: 'until', type: 'DATE', value: until }];
  const sql = `SELECT metric_date, owner_id, owner_name, SUM(calls_total) calls, SUM(calls_conversation_total) calls_conversation, SUM(calls_dial_total) calls_dial, SUM(calls_voicemail_total) calls_voicemail, SUM(calls_no_answer_total) calls_no_answer, SUM(calls_busy_total) calls_busy, SUM(calls_wrong_number_total) calls_wrong_number, SUM(calls_no_outcome_total) calls_no_outcome, SUM(calls_talk_time_s) calls_talk_time_s, SUM(emails_sent_total) emails, SUM(whatsapp_total) whatsapp, SUM(whatsapp_total) whatsapp_manual, SUM(whatsapp_automacao_total) whatsapp_treble, SUM(linkedin_total) linkedin, SUM(meetings_total) meetings, SUM(activities_total) activities_total, SUM(companies_touched) companies_touched, SUM(contacts_touched) contacts_touched FROM ${WAREHOUSE_TABLE} d WHERE ${filterSql('d', r, params)} GROUP BY metric_date, owner_id, owner_name ORDER BY metric_date, owner_name`;
  const { rows } = await bq.query(sql, params);
  return { sql, rows };
}
// ---------------------------------------------------------------------------
// QUALIDADE DO CARIMBO DE DESFECHO
//
// "Conectadas" NÃO é "quem atendeu": é o que o BDR escolheu no menu de desfecho
// do HubSpot. Duas coisas concretas escapam desse carimbo, e as duas mentem para
// baixo:
//
//   1. LIGAÇÃO LONGA SEM CONEXÃO — ligação de 60s+ que não foi marcada como
//      Conectado. Aferido em Allan Valença, 10-13/08/2026: a tela dizia 124
//      ligações e 2 conectadas, e havia 11 ligações de 60s+ marcadas "Sem
//      resposta", uma delas de 3min31. Telefone tocando não dura 3min31.
//
//   2. "REUNIÃO AGENDADA" (`2e7360c1-…`) — desfecho que existe no portal
//      (`dim_call_disposition`) e que NENHUMA das duas camadas mapeia: cai em
//      "sem desfecho", ou seja, o MELHOR desfecho possível é contado como o
//      pior. O `call_outcome` já vem mapeado nos marts dos dois lados, então a
//      única forma de enxergá-lo sem rebuildar a imagem do ETL é voltar ao
//      `fact_engagement`, que guarda o `disposition_id` cru — é o que o JOIN
//      abaixo faz.
//
// Isto NÃO reclassifica nada: `conectadas` continua sendo só o carimbo
// "Conectado". Estes números existem para serem AUDITADOS (o card leva ao drill
// `outcome:longa_sem_conexao`), não somados — dizer se "Reunião agendada" conta
// como conectada é decisão de régua, e régua se decide, não se deduz.
//
// 60s é o mesmo piso de conversa que `api/bdr-workload-calls.js` já usa
// (MIN_CONVERSA); não é limiar novo.
const REUNIAO_AGENDADA_GUID = '2e7360c1-6b71-40e9-ab2b-30ae98a4678c';
const TOUCH_MART = wh.t('gold', 'mart_bdr_touch');
const FACT_ENGAGEMENT = wh.t('silver', 'fact_engagement');
const CONVERSA_MIN_S = 60;
async function queryQualidadeCarimbo(requested) {
  const params = [{ name: 'since', type: 'DATE', value: requested.since }, { name: 'until', type: 'DATE', value: requested.until }];
  try {
    const sql = `SELECT COUNT(*) ligacoes, COUNTIF(t.call_duration_s >= ${CONVERSA_MIN_S} AND COALESCE(t.call_outcome,'') != 'connected') longa_sem_conexao, COUNTIF(e.disposition_id = '${REUNIAO_AGENDADA_GUID}') reuniao_agendada, COUNTIF(COALESCE(t.call_outcome,'') = '' AND COALESCE(e.disposition_id,'') != '') desfecho_nao_mapeado FROM ${TOUCH_MART} t LEFT JOIN ${FACT_ENGAGEMENT} e USING (engagement_id) WHERE t.channel = 'call' AND ${filterSql('t', requested, params)}`;
    const { rows } = await bq.query(sql, params);
    const r = rows[0] || {};
    return { ligacoes: num(r.ligacoes), longaSemConexao: num(r.longa_sem_conexao), reuniaoAgendada: num(r.reuniao_agendada), desfechoNaoMapeado: num(r.desfecho_nao_mapeado), pisoConversaS: CONVERSA_MIN_S, erro: null };
  } catch (error) {
    // Auditoria indisponível não pode derrubar a tela nem virar zero calado:
    // zero aqui significaria "carimbo perfeito", que é a conclusão errada.
    return { ligacoes: null, longaSemConexao: null, reuniaoAgendada: null, desfechoNaoMapeado: null, pisoConversaS: CONVERSA_MIN_S, erro: String(error.message || error).slice(0, 200) };
  }
}
// Costura por dia x dono. Por que NÃO um JOIN em SQL entre as duas tabelas:
// porte, segmento e persona são calculados por réguas DIFERENTES nos dois lados
// (o armazém tira de `dim_company`/`dim_contact`, o medallion tirava do CI, que
// congelou em 25/06). Casar linha por dimensão perderia linha dos dois lados em
// silêncio. Dia e dono são a única chave que significa a mesma coisa nas duas.
//
// União das chaves, não interseção: dia que só o armazém tem (hoje, antes das
// 20:00) precisa aparecer, e dia que só o medallion tem não pode sumir.
//
// `linhasSoNoArmazem` fica na casa das centenas e ISSO É ESPERADO, não perda nem
// ganho de dado: o SQL não filtra por dono quando ninguém pede um BDR (a peneira
// do roster é `isTeamOwner`, por nome, depois), e o armazém tem os 127 donos do
// portal enquanto o medallion só ingere os 13 do roster. Medido em 30 dias: 263
// linhas casadas, 258 só no armazém (não-roster, descartadas adiante) e 3 só no
// medallion, todas com `activities_total = 0`.
function mergeRitmoDoArmazem(medallionRows, warehouseRows) {
  const chave = (row) => `${String(row.metric_date).slice(0, 10)}|${String(row.owner_id || '')}`;
  const porChave = new Map();
  (medallionRows || []).forEach((row) => porChave.set(chave(row), Object.assign({}, row)));
  let substituidas = 0;
  let novas = 0;
  (warehouseRows || []).forEach((row) => {
    const k = chave(row);
    const alvo = porChave.get(k);
    if (alvo) { substituidas += 1; CAMPOS_RITMO_ARMAZEM.forEach((campo) => { alvo[campo] = row[campo]; }); return; }
    novas += 1;
    // Linha que só existe no armazém: o bloco de CRM dela é ZERO de verdade
    // (o medallion não a produziu), e zero explícito é melhor que ausência,
    // que sumiria do gráfico sem ninguém notar.
    porChave.set(k, Object.assign({ companies_inserted: 0, contacts_inserted: 0, attempted: 0, crm_movements: 0, connected: 0, qualified: 0, disqualified: 0, sql_deals: 0, refreshed_at: null }, row));
  });
  const rows = Array.from(porChave.values()).sort((a, b) => String(a.metric_date).localeCompare(String(b.metric_date)) || String(a.owner_name || '').localeCompare(String(b.owner_name || '')));
  return { rows, substituidas, novas, somenteMedallion: (medallionRows || []).length - substituidas };
}
function bqItem(row, source, requested) {
  return {
    date: String(row.metric_date || row.date).slice(0, 10),
    bdr: canonicalizeBdrName(row.owner_name || row.bdr),
    source,
    calls: num(row.calls),
    callsConversation: num(row.calls_conversation),
    callsDial: num(row.calls_dial),
    callsVoicemail: num(row.calls_voicemail),
    callsNoAnswer: num(row.calls_no_answer),
    callsBusy: num(row.calls_busy),
    callsWrongNumber: num(row.calls_wrong_number),
    callsNoOutcome: num(row.calls_no_outcome),
    callsTalkTimeS: num(row.calls_talk_time_s),
    emails: num(row.emails),
    whatsapp: num(row.whatsapp),
    whatsappManual: num(row.whatsapp_manual),
    whatsappTreble: num(row.whatsapp_treble),
    linkedin: num(row.linkedin),
    meetings: num(row.meetings),
    activities: num(row.activities_total),
    total: selectedTotal({ calls: row.calls, emails: row.emails, whatsapp: row.whatsapp, linkedin: row.linkedin, meetings: row.meetings }, requested.channels),
    companiesTouched: num(row.companies_touched),
    contactsTouched: num(row.contacts_touched),
    companiesInserted: num(row.companies_inserted),
    contactsInserted: num(row.contacts_inserted),
    attempted: num(row.attempted),
    crmMovements: num(row.crm_movements),
    connected: num(row.connected),
    qualified: num(row.qualified),
    disqualified: num(row.disqualified),
    sqlDeals: num(row.sql_deals),
  };
}
function liveItem(row, source) {
  const item = { date: String(row.date || row.metric_date).slice(0, 10), bdr: canonicalizeBdrName(row.bdr || row.owner_name), source, sqlDeals: num(row.sqlDeals || row.sql_deals) };
  if (Object.prototype.hasOwnProperty.call(row, 'companiesTouched')) item.companiesTouched = num(row.companiesTouched);
  if (Object.prototype.hasOwnProperty.call(row, 'contactsTouched')) item.contactsTouched = num(row.contactsTouched);
  return mergeLiveRow(item, row);
}
function rowsToAggregates(rows, requested, live) {
  const today = todayIso();
  const byBdr = {};
  const series = [];
  let refreshedAt = null;
  const liveByKey = liveRowMap(live);
  const seenKeys = new Set();
  function addItem(item) {
    if (!isTeamOwner(item.bdr, item.date) || (requested.bdr && item.bdr !== requested.bdr)) return;
    if (!byBdr[item.bdr]) byBdr[item.bdr] = emptyBdrRow(item.bdr);
    const target = byBdr[item.bdr];
    Object.keys(target).forEach((key) => { if (typeof target[key] === 'number' && typeof item[key] === 'number') target[key] += item[key]; });
    series.push(item);
  }
  rows.forEach((row) => {
    const base = bqItem(row, 'bq', requested);
    const key = `${base.date}|${base.bdr}`;
    seenKeys.add(key);
    const liveRow = base.date === today ? liveByKey[key] : null;
    if (liveRow) {
      addItem(mergeCumulativeLiveRow(base, liveRow, requested));
    } else {
      addItem(base);
    }
    const ts = normalizeTimestamp(row.refreshed_at);
    if (ts && (!refreshedAt || ts > refreshedAt)) refreshedAt = ts;
  });
  if (hasLiveCoverage(live)) {
    live.rows.forEach((row) => {
      const item = liveItem(row, 'live');
      const key = `${item.date}|${item.bdr}`;
      if (!seenKeys.has(key)) addItem(item);
    });
  }
  return { byBdr, series, refreshedAt };
}
function addBaseline(current, previous) { Object.keys(current.byBdr).forEach((bdr) => { const prev = previous.byBdr[bdr] ? previous.byBdr[bdr].total : 0; current.byBdr[bdr].previousTotal = prev || null; current.byBdr[bdr].deltaHistorical = prev ? current.byBdr[bdr].total - prev : null; }); }
function percentile(values, p) { const xs = values.map(Number).filter((x) => Number.isFinite(x)).sort((a, b) => a - b); if (!xs.length) return null; const idx = (xs.length - 1) * p; const lo = Math.floor(idx); const hi = Math.ceil(idx); if (lo === hi) return xs[lo]; return xs[lo] + (xs[hi] - xs[lo]) * (idx - lo); }
function bucketHours(h) { if (h == null || !Number.isFinite(Number(h))) return 'sem_toque'; const x = Number(h); if (x < 1) return 'lt_1h'; if (x < 4) return '1_4h'; if (x < 24) return '4_24h'; if (x < 72) return '24_72h'; return '72h_plus'; }
function reactivityFromRows(rows) { const touched = rows.filter((r) => String(r.has_touch) === 'true' || r.has_touch === true || Number(r.has_touch) === 1); const hours = touched.map((r) => Number(r.hours_to_first_touch)).filter((x) => Number.isFinite(x)); const buckets = { lt_1h: 0, '1_4h': 0, '4_24h': 0, '24_72h': 0, '72h_plus': 0, sem_toque: 0 }; rows.forEach((r) => { buckets[bucketHours((String(r.has_touch) === 'true' || r.has_touch === true || Number(r.has_touch) === 1) ? Number(r.hours_to_first_touch) : null)] += 1; }); return { p50Hours: percentile(hours, 0.5), p75Hours: percentile(hours, 0.75), withoutFirstTouch: buckets.sem_toque, eligible: rows.length, touched: touched.length, coverage: rows.length ? touched.length / rows.length : 0, buckets }; }
async function queryReactivity(requested) { const params = [{ name: 'since', type: 'DATE', value: requested.since }, { name: 'until', type: 'DATE', value: requested.until }]; const wh = ['eligible_date BETWEEN @since AND @until']; const oc = bdrOwnerIdClause('', requested.bdrIds, requested.bdr); if (oc) wh.push(oc); const ex = exitedCutClause('', 'eligible_date'); if (ex) wh.push(ex); const pc = inClause('', "COALESCE(NULLIF(porte,''),'desconhecido')", 'porte', requested.portes, params); if (pc) wh.push(pc); const sc = inClause('', "COALESCE(NULLIF(segmento,''),'desconhecido')", 'segmento', requested.segmentos, params); if (sc) wh.push(sc); const xc = inClause('', "COALESCE(NULLIF(persona,''),'não classificada')", 'persona', requested.personas, params); if (xc) wh.push(xc); const sql = `SELECT owner_name, eligible_date, hours_to_first_touch, has_touch, porte, segmento, persona FROM \`${REACTIVITY_TABLE}\` WHERE ${wh.join(' AND ')}`; const { rows } = await bq.query(sql, params); return reactivityFromRows(rows.filter((r) => isTeamOwner(r.owner_name, String(r.eligible_date || '').slice(0, 10)))); }
async function queryFilterOptions() { const sql = `SELECT ARRAY_AGG(DISTINCT COALESCE(NULLIF(porte,''),'desconhecido') IGNORE NULLS ORDER BY COALESCE(NULLIF(porte,''),'desconhecido')) portes, ARRAY_AGG(DISTINCT COALESCE(NULLIF(segmento,''),'desconhecido') IGNORE NULLS ORDER BY COALESCE(NULLIF(segmento,''),'desconhecido')) segmentos, ARRAY_AGG(DISTINCT COALESCE(NULLIF(persona,''),'não classificada') IGNORE NULLS ORDER BY COALESCE(NULLIF(persona,''),'não classificada')) personas FROM \`${TABLE}\``; const { rows } = await bq.query(sql, []); const row = rows[0] || {}; return { bdr: BDR_TEAM, porte: row.portes || PORTE_VALUES, segmento: row.segmentos || [], persona: row.personas || [] }; }
// Carrega a janela na fonte pedida. Com `fonte=armazem`, o bloco de ritmo vem do
// armazém e o resto continua no medallion.
//
// A QUEDA PARA O MEDALLION É DE PROPÓSITO, e não é preguiça de tratar erro: as 5
// colunas de desfecho de ligação do mart do armazém dependem de um rebuild da
// imagem do ETL que pode não ter acontecido ainda (o SQL é assado na imagem do
// Cloud Run | mexer no BQ à mão é revertido no próximo run). Se elas não
// existirem, o BigQuery devolve "Unrecognized name" e a alternativa a cair de
// volta seria a página inteira em 500. Cair e DIZER que caiu preserva a tela e
// deixa o defeito visível no selo, em vez de trocar um número por zero calado.
async function carregarRows(since, until, requested) {
  const medallion = await queryRows(since, until, requested);
  if (requested.fonte !== 'armazem') return { rows: medallion.rows, mescla: null, erro: null };
  try {
    const armazem = await queryWarehouseRows(since, until, requested);
    const mescla = mergeRitmoDoArmazem(medallion.rows, armazem.rows);
    return { rows: mescla.rows, mescla, erro: null };
  } catch (error) {
    return { rows: medallion.rows, mescla: null, erro: error.message || String(error) };
  }
}
async function build(requested) { if (!bq.isConfigured()) throw Object.assign(new Error('BigQuery não configurado'), { statusCode: 503 }); const prevRange = previousRange(requested); const [currentRows, previousRows, reactivity, filterOptionsBase, live, medallionFrescor, qualidadeCarimbo] = await Promise.all([carregarRows(requested.since, requested.until, requested), carregarRows(prevRange.since, prevRange.until, requested), queryReactivity(requested), cachedFilterOptions(), liveRowsForToday(requested), frescorMedallion(), queryQualidadeCarimbo(requested)]);
  // O seletor de BDR é da JANELA, não do cadastro: janela inteiramente depois
  // da saída não oferece quem saiu. O cache de 10 min de `cachedFilterOptions`
  // é de porte/segmento/persona (DISTINCT na tabela inteira) e não pode carregar
  // o roster junto — roster depende do período pedido.
  const filterOptions = Object.assign({}, filterOptionsBase, { bdr: activeTeam(requested.since, requested.until) });
  const armazemAtivo = requested.fonte === 'armazem' && !currentRows.erro; const current = rowsToAggregates(currentRows.rows, requested, live.used ? live : null); const previous = rowsToAggregates(previousRows.rows, requested, null); addBaseline(current, previous); const totals = Object.values(current.byBdr).reduce((acc, row) => { Object.keys(acc).forEach((k) => { if (typeof acc[k] === 'number') acc[k] += num(row[k]); }); return acc; }, { calls: 0, callsConversation: 0, callsDial: 0, callsVoicemail: 0, callsNoAnswer: 0, callsBusy: 0, callsWrongNumber: 0, callsNoOutcome: 0, callsTalkTimeS: 0, emails: 0, whatsapp: 0, whatsappManual: 0, whatsappTreble: 0, linkedin: 0, meetings: 0, activities: 0, total: 0, companiesTouched: 0, contactsTouched: 0, companiesInserted: 0, contactsInserted: 0, attempted: 0, crmMovements: 0, connected: 0, qualified: 0, disqualified: 0, sqlDeals: 0 }); const selectedSum = requested.channels.reduce((sum, channel) => sum + totals[channel], 0); const refreshedAt = live.used && live.generatedAt && (!current.refreshedAt || live.generatedAt > current.refreshedAt) ? live.generatedAt : current.refreshedAt; return { success: true, contractVersion: '2.1', requestedRange: { since: requested.since, until: requested.until }, resolvedRange: { since: requested.since, until: requested.until }, baselineRange: prevRange, filtersApplied: { bdr: requested.bdr, channels: requested.channels, businessDays: requested.businessDays, porte: requested.porte, segmento: requested.segmento, persona: requested.persona }, filtersIgnored: [], filterOptions, supportedFilters: { pulse: ['bdr', 'channels', 'businessDays', 'porte', 'segmento', 'persona'], channels: ['bdr', 'channels', 'businessDays', 'porte', 'segmento', 'persona'], management: ['bdr', 'channels', 'businessDays', 'porte', 'segmento', 'persona'], penetration: ['bdr', 'porte', 'segmento', 'persona'], evolution: ['bdr', 'channels', 'businessDays', 'porte', 'segmento', 'persona'] }, source: { kind: live.used ? 'hybrid' : 'bq-operational', table: armazemAtivo ? WAREHOUSE_TABLE.replace(/`/g, '') : TABLE, refreshedAt, liveToday: live.used, liveCached: !!live.cached, liveOverlay: live.used ? 'HubSpot live usado apenas sem filtros porte/segmento/persona.' : (live.disabledByFilters ? 'HubSpot live desativado porque há filtro porte/segmento/persona; somente Gold v2.' : 'Fonte BQ operacional'), fonte: requested.fonte, fonteEfetiva: armazemAtivo ? 'armazem' : 'medallion',
  // Camada POR BLOCO. Existe para quem desconfiar de um número saber de onde
  // ele veio sem abrir o código | migração pela metade que não se declara é
  // como a tela mostra parte do funil como se fosse o todo.
  camadas: { ritmo: armazemAtivo ? 'armazem-gold' : 'medallion-gold', desfechoLigacao: armazemAtivo ? 'armazem-gold' : 'medallion-gold', insercao: 'medallion-gold', crm: 'medallion-gold', sql: 'medallion-gold', penetracao: 'medallion-gold' },
  // Idade POR CAMADA. O selo verde do topo é do armazém; esta linha é a única
  // que diz há quanto tempo a outra metade da tela não é recarregada.
  frescorCamadas: { armazem: { refreshedAt, atualizadoPeloBotao: true, cadencia: 'reconcile 06:30 + intraday 10/13/16/19h + close 20:30 (dia útil)' }, medallion: { carregadoEm: medallionFrescor.carregadoEm, idadeHoras: medallionFrescor.idadeHoras == null ? null : Math.round(medallionFrescor.idadeHoras * 10) / 10, atualizadoPeloBotao: false, cadencia: 'bdr-etl-job (us-central1), 1x/dia ~20:15 BRT', erro: medallionFrescor.erro } },
  premissas: armazemAtivo ? [
    'WhatsApp digitado por gente bate na unha | 2.755 nas duas fontes em 30 dias no roster, zero de diferença. É esta linha que autoriza a troca: nenhuma mensagem de esforço real se perde.',
    'WhatsApp total CAI de 3.706 para 2.755 e atividades de 17.920 para 16.969 | os dois deltas são os mesmos 951 disparos automáticos do Treble, que o armazém mede à parte pela régua de 10/08/2026 (automação não é esforço do BDR, ninguém digitou). Quem comparar com um print antigo vai ver o número cair sem o time ter trabalhado menos.',
    'Automação por BDR NÃO é comparável entre as fontes | o medallion credita 951 disparos ao roster e o armazém 454. O Treble grava sem dono, então os dois INFEREM: o armazém pelo dono no instante do toque, o medallion pelo dono atual. Não muda esforço em nenhuma das réguas, mas invalida ler "automação por BDR" como se fosse um número só.',
    'Contatos tocados 1,6% e empresas tocadas 4,5% de diferença ainda em aberto | é o WARN `parity_workload_v2` da suíte do armazém.',
    'Inserção, CRM, SQL e Penetração seguem no medallion | não há mart desses blocos no armazém.',
  ] : [],
  mescla: currentRows.mescla ? { linhasComRitmoDoArmazem: currentRows.mescla.substituidas, linhasSoNoArmazem: currentRows.mescla.novas, linhasSoNoMedallion: currentRows.mescla.somenteMedallion } : null,
  fallbackErro: currentRows.erro || null }, quality: { status: (live.error || currentRows.erro) ? 'warn' : 'pass', checks: [{ key: 'mece_total', status: totals.total === selectedSum ? 'pass' : 'fail', message: 'ritmo real = soma dos canais selecionados' }, { key: 'fonte_ritmo', status: currentRows.erro ? 'warn' : 'pass', message: currentRows.erro ? `Pedido fonte=armazem e o mart não respondeu (${currentRows.erro}) | ritmo caiu de volta no medallion. Se o erro fala em coluna desconhecida, falta rebuildar a imagem do ETL.` : (armazemAtivo ? 'Ritmo e desfecho de ligação vêm do armazém canônico; inserção, CRM, SQL e Penetração seguem no medallion.' : 'Ritmo vem do medallion (default).') },{ key: 'reactivity', status: 'pass', message: 'Reatividade vem de bdr_workload_reactivity_v2.' }, { key: 'roster_saidas', status: 'pass', message: rosterMensagem(requested) }, { key: 'carimbo_desfecho', status: qualidadeCarimbo.erro ? 'warn' : ((qualidadeCarimbo.longaSemConexao || qualidadeCarimbo.reuniaoAgendada) ? 'warn' : 'pass'), message: qualidadeCarimbo.erro ? `Auditoria do carimbo indisponível (${qualidadeCarimbo.erro}) | "conectadas" segue sendo só o carimbo do BDR.` : ((qualidadeCarimbo.longaSemConexao || qualidadeCarimbo.reuniaoAgendada) ? `"Conectadas" é o CARIMBO do BDR, não quem atendeu: ${qualidadeCarimbo.longaSemConexao} ligação(ões) de ${CONVERSA_MIN_S}s+ NÃO marcadas como Conectado e ${qualidadeCarimbo.reuniaoAgendada} com desfecho "Reunião agendada", que nenhuma camada mapeia e cai em "sem desfecho". Nada foi reclassificado | clique em "Longas sem conexão" para auditar.` : 'Nenhuma ligação longa fora do carimbo de conectada no período.')}, { key: 'frescor_medallion', status: (medallionFrescor.idadeHoras != null && medallionFrescor.idadeHoras > 28) ? 'warn' : (medallionFrescor.erro ? 'warn' : 'pass'), message: medallionFrescor.erro ? `Não foi possível ler a idade do medallion (${medallionFrescor.erro}).` : (medallionFrescor.carregadoEm ? `Inserção, CRM, SQL e Penetração vêm do medallion, carregado há ${Math.round(medallionFrescor.idadeHoras)}h (1x/dia, ~20:15 BRT). O botão Atualizar NÃO recarrega esses quatro blocos — ele dispara o reconcile do armazém, que é de onde vêm ritmo e desfecho.` : 'Idade do medallion desconhecida.') }, { key: 'call_outcome', status: (live.unknownDispositions && live.unknownDispositions.length) ? 'warn' : 'pass', message: (live.unknownDispositions && live.unknownDispositions.length) ? `Desfecho de ligação não reconhecido no live (cai em sem conexão): ${live.unknownDispositions.join(' | ')}. Atualizar CALL_DISPOSITION_GUID.` : 'Desfecho de ligação resolvido por GUID do HubSpot; conectada = disposition Conectado.' }, { key: 'live_merge', status: live.used ? 'pass' : (includesToday(requested) ? 'warn' : 'pass'), message: live.used ? 'Hoje agregado do HubSpot live no servidor.' : (live.disabledByFilters ? 'Live omitido por filtro ICP.' : (live.error || 'Janela sem hoje.')) }] }, coverage: { reactivity: { status: 'available', eligible: reactivity.eligible, touched: reactivity.touched, coverage: reactivity.coverage } }, data: { callQuality: qualidadeCarimbo, rhythm: { totals, series: current.series.sort((a, b) => a.date.localeCompare(b.date) || a.bdr.localeCompare(b.bdr)), byBdr: Object.values(current.byBdr).sort((a, b) => a.bdr.localeCompare(b.bdr)) }, reactivity, management: Object.values(current.byBdr).sort((a, b) => a.bdr.localeCompare(b.bdr)) } };
}

module.exports = async function handler(req, res) { setCORSHeaders(req, res); if (!methodCheck(req, res, ['GET'])) return; const user = requireAuth(req, res); if (!user) return; try { const requested = parse(req); if (requested.refresh) return res.status(200).json(await build(requested)); const key = payloadKey(requested); const hit = payloadCache.get(key); if (hit && Date.now() - hit.at < PAYLOAD_TTL_MS) return res.status(200).json(hit.val); const val = await build(requested); if (payloadCache.size > 200) payloadCache.clear(); payloadCache.set(key, { at: Date.now(), val }); return res.status(200).json(val); } catch (error) { return res.status(error.statusCode || 500).json({ success: false, error: error.message }); } };
module.exports._service = { liveRowsForToday };
module.exports._test = { parse, payloadKey, CHANNELS, CHANNEL_SQL, isBusiness, build, TABLE, REACTIVITY_TABLE, normalizeTimestamp, aggregateLivePayload, liveRowsForToday, previousRange, activityBucket, percentile, bucketHours, reactivityFromRows, rowsToAggregates, liveLineage, todayIso, WAREHOUSE_TABLE, FONTES, CAMPOS_RITMO_ARMAZEM, mergeRitmoDoArmazem, carregarRows };
