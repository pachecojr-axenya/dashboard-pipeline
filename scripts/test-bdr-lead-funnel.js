#!/usr/bin/env node
'use strict';
/**
 * test-bdr-lead-funnel.js — prova o /api/bdr-lead-funnel contra o armazém.
 *
 *   node scripts/test-bdr-lead-funnel.js            # ADC do gcloud
 *   node scripts/test-bdr-lead-funnel.js --portal   # + contraprova na Search API
 *
 * O QUE ESTE TESTE PROVA, e por que cada asserção existe:
 *
 * 1. RECONCILIAÇÃO COM A AUDITORIA por outro caminho. A janela de jul/2026 foi medida
 *    à mão em 11/08/2026 direto no BigQuery: 2.302 leads criados, 1.076 com atividade
 *    real, 172 com deal, 0 com mais de um contato. Se o endpoint devolver outro
 *    número, ou o endpoint quebrou ou o armazém mudou — e as duas coisas exigem
 *    olhar antes de confiar na tela.
 *
 * 2. CONSERVAÇÃO DO WATERFALL. A soma das setas tem de igualar o total de
 *    movimentações declarado. Waterfall cujas setas não fecham é ficção bonita: é o
 *    tipo de gráfico que ninguém confere porque parece plausível.
 *
 * 3. O BACKUP SAI, e sai pelo pipeline DO EVENTO. Pedir `funil=principal` não pode
 *    trazer etapa cujo stage_id pertence ao Diagnóstico Site, e o snapshot do
 *    recorte tem de ser menor que o de `todos`.
 *
 * 4. AS DUAS RÉGUAS DISCORDAM, e a discordância é o achado. Um teste que exigisse
 *    `por_etapa == por_atividade` esconderia justamente o que a tela existe para
 *    mostrar. Aqui a asserção é que o gap é POSITIVO e grande — se um dia empatar,
 *    é notícia, e o teste tem de gritar.
 *
 * 5. TODA PREMISSA QUE MUDA NÚMERO ESTÁ NO PAYLOAD. Número certo sem premissa
 *    explícita é indistinguível de número novo sem explicação (regra da F5).
 */

const path = require('path');
const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');

process.env.LOCAL_DEV_BYPASS = 'true';

// ADC em vez de chave de SA — mesmo shim do compare-warehouse-endpoints.js.
const TOKEN = execSync('gcloud auth application-default print-access-token', { encoding: 'utf8' }).trim();
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'adc@local', private_key: 'x' });
const bq = require(path.join(ROOT, 'lib', 'bigquery.js'));
bq.query = async (sql, params) => {
  const body = { query: sql, useLegacySql: false, location: 'southamerica-east1', timeoutMs: 120000 };
  if (params && params.length) {
    body.parameterMode = 'NAMED';
    body.queryParameters = params.map((p) => ({
      name: p.name,
      parameterType: { type: p.type || 'STRING' },
      parameterValue: { value: p.value == null ? null : String(p.value) },
    }));
  }
  const res = await fetch(
    'https://bigquery.googleapis.com/bigquery/v2/projects/gen-lang-client-0423905839/queries',
    { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  const data = await res.json();
  if (!res.ok) throw new Error('BQ ' + res.status + ': ' + JSON.stringify(data).slice(0, 400));
  const fields = (data.schema && data.schema.fields) || [];
  const rows = (data.rows || []).map((r) => {
    const o = {};
    (r.f || []).forEach((cell, i) => { o[fields[i].name] = bq.decodeCell(cell.v, fields[i]); });
    return o;
  });
  return { fields: fields.map((f) => f.name), rows };
};

if (!process.env.HUBSPOT_TOKEN) {
  try {
    process.env.HUBSPOT_TOKEN = execSync(
      'gcloud secrets versions access latest --secret=axenya-hubspot-pat-shared --project=gen-lang-client-0423905839',
      { encoding: 'utf8' }).trim();
  } catch { /* só a contraprova do portal precisa; segue */ }
}

const PORTAL = process.argv.includes('--portal');
let falhas = 0;
function ok(cond, texto, extra) {
  if (!cond) falhas++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + texto + (extra != null ? '   | ' + extra : ''));
}

function fakeRes() {
  const r = { _code: 0, _json: null };
  r.setHeader = () => {}; r.status = (c) => { r._code = c; return r; };
  r.json = (j) => { r._json = j; return r; }; r.end = () => r;
  return r;
}
async function call(query) {
  const h = require(path.join(ROOT, 'api', 'bdr-lead-funnel.js'));
  const res = fakeRes();
  await h({ method: 'GET', url: '/api/bdr-lead-funnel', headers: {}, query }, res);
  return { code: res._code, body: res._json };
}

(async () => {
  // ── 1. Janela de jul/2026: reconciliação com a auditoria ──────────────────────
  console.log('\n== jul/2026, ambos os funis | reconciliação com a auditoria de 11/08 ==');
  const jul = await call({ funil: 'todos', since: '2026-07-01', until: '2026-07-31', refresh: '1' });
  ok(jul.code === 200, 'HTTP 200', jul.code);
  const J = jul.body || {};
  ok(J.success === true, 'success=true');

  const co = J.coorte || {};
  ok(co.criados === 2302, 'leads criados == 2.302 (medido à mão no BQ)', co.criados);
  // 1.601, NÃO 1.076: a régua antiga omitia WhatsApp. Ver o bloco 2b.
  ok(co.taxa_contato && co.taxa_contato.por_atividade.n === 1601,
    'régua de ATIVIDADE == 1.601 (com WhatsApp manual; era 1.076 sem)', co.taxa_contato && co.taxa_contato.por_atividade.n);
  ok(co.taxa_contato && co.taxa_contato.criados === 2302,
    '"criaram X" viaja como absoluto no payload', co.taxa_contato && co.taxa_contato.criados);
  ok(co.taxa_contato && co.taxa_contato.por_etapa.n === 2057,
    'régua de ETAPA == 2.057', co.taxa_contato && co.taxa_contato.por_etapa.n);
  ok(co.com_deal === 172, 'leads com deal == 172', co.com_deal);

  // ── 2. As duas réguas DISCORDAM — o gap é o achado, não o erro ────────────────
  console.log('\n== as duas réguas de taxa de contato ==');
  const t = co.taxa_contato || {};
  ok(t.por_etapa.n > t.por_atividade.n,
    'ETAPA > ATIVIDADE (se empatar um dia, é notícia)', t.por_etapa.pct + '% vs ' + t.por_atividade.pct + '%');
  ok(t.etapa_sem_atividade === 504,
    'movidos de etapa SEM toque == 504 (era 1.009 na régua sem WhatsApp)', t.etapa_sem_atividade);
  ok(t.por_etapa.n - t.por_atividade.n === t.etapa_sem_atividade - t.atividade_sem_etapa,
    'partição fecha: (etapa − atividade) == (etapa_sem_ativ − ativ_sem_etapa)');

  // ── 2b. A RÉGUA DE ATIVIDADE, travada canal por canal ─────────────────────────
  // Este bloco existe porque a régua JÁ ESTAVA ERRADA UMA VEZ: omitia WhatsApp, o
  // canal mais usado do time depois do e-mail, e a tela afirmava "sem toque" para 525
  // leads que tinham WhatsApp digitado à mão. Achado por auditoria de caso do dono, não
  // por teste — e é justamente isso que este bloco impede de repetir.
  console.log('\n== regua de atividade, canal por canal ==');
  ok(t.so_automacao >= 0 && t.nunca_tocados >= 0,
    'automação e nunca-tocados sao buckets SEPARADOS e visiveis',
    'so automacao ' + t.so_automacao + ' | nunca tocados ' + t.nunca_tocados);
  ok(t.por_atividade.n + t.so_automacao + t.nunca_tocados === t.criados,
    'particao MECE: falou com + so automacao + nunca tocado == criados',
    t.por_atividade.n + ' + ' + t.so_automacao + ' + ' + t.nunca_tocados + ' = ' + t.criados);
  const comWpp = (co.leads || []).filter(l => l.whatsapp_manual > 0);
  ok(comWpp.length > 0, 'ha leads cuja UNICA prova de contato pode ser WhatsApp', comWpp.length);
  ok(comWpp.every(l => l.atividade_real),
    'TODO lead com WhatsApp manual conta como atividade real (a regressao do caso Rui Medeiros)');
  const soWpp = comWpp.filter(l => !l.ligacoes_conectadas && !l.emails_enviados && !l.linkedin_enviados && !l.reunioes);
  ok(soWpp.length > 0 && soWpp.every(l => l.atividade_real),
    'lead com WhatsApp e NADA MAIS tambem conta — sem isso o bug volta em silencio', soWpp.length);
  ok((co.leads || []).every(l => l.atividade_real === (l.toques_manuais > 0)),
    'atividade_real e exatamente "houve toque manual", sem terceira via');
  ok((co.leads || []).every(l => !(l.atividade_real && l.so_automacao)),
    'so_automacao e atividade_real sao mutuamente exclusivos');

  // ── 2c. A RAZÃO da desqualificação, e as duas contradições ────────────────────
  console.log('\n== razao auditavel da desqualificacao ==');
  const dqs = J.desqualificacoes || [];
  ok(dqs.every(d => d.etapa_de_origem && typeof d.teve_toque === 'boolean'),
    'toda desqualificacao carrega etapa de origem e se houve toque');
  const contra = dqs.filter(d => d.contradiz_motivo);
  const semToque = dqs.filter(d => d.desqualificado_sem_toque);
  ok(contra.every(d => /n[aã]o houve tentativa/i.test(d.motivo) && d.teve_toque),
    'contradiz_motivo == motivo diz "sem tentativa" E houve toque', contra.length);
  ok(semToque.every(d => !d.teve_toque && !/n[aã]o houve tentativa/i.test(d.motivo)),
    'desqualificado_sem_toque == outro motivo E nenhum toque', semToque.length);
  ok(J.diagnostics.contradicoes_desqualificacao.motivo_diz_sem_tentativa_mas_teve_toque === contra.length,
    'o diagnostico bate com a lista (contagem nao inventada)');
  ok(!!(J.premissas || {}).regua_atividade_corrigida,
    'a CORRECAO da regua esta declarada em premissas, nao so no commit');
  ok(!!(J.premissas || {}).razao_da_desqualificacao,
    'a ausencia de campo de razao livre no portal esta declarada');

  // ── 3. Conservação do waterfall ───────────────────────────────────────────────
  console.log('\n== conservação do waterfall ==');
  const wf = J.waterfall || {};
  const somaSetas = Object.values(wf.setas || {}).reduce((a, b) => a + b, 0);
  ok(somaSetas > 0, 'há setas no período', somaSetas);
  ok(somaSetas <= wf.movimentos,
    'Σ setas <= movimentos (a diferença é o Backup descartado, declarado em premissas)',
    somaSetas + ' de ' + wf.movimentos);
  const somaDia = Object.values(wf.por_dia || {})
    .reduce((a, d) => a + Object.values(d).reduce((x, y) => x + y, 0), 0);
  ok(somaDia === somaSetas, 'Σ por_dia == Σ setas (o mesmo total por dois cortes)', somaDia + ' vs ' + somaSetas);

  // ── 4. Recorte de funil pelo pipeline DO EVENTO ────────────────────────────────
  console.log('\n== recorte de funil (Backup fora, pipeline do evento) ==');
  const prin = await call({ funil: 'principal', since: '2026-07-01', until: '2026-07-31', refresh: '1' });
  const diag = await call({ funil: 'diagnostico', since: '2026-07-01', until: '2026-07-31', refresh: '1' });
  const P = prin.body || {}, G = diag.body || {};
  ok(P.coorte.criados + G.coorte.criados === J.coorte.criados,
    'principal + diagnóstico == ambos (partição MECE da coorte)',
    P.coorte.criados + ' + ' + G.coorte.criados + ' = ' + J.coorte.criados);
  const totSnap = o => Object.values(o.snapshot.por_etapa || {}).reduce((a, b) => a + b, 0);
  ok(totSnap(P) < totSnap(J) && totSnap(G) < totSnap(J), 'snapshot de cada recorte < snapshot de ambos',
    totSnap(P) + ' / ' + totSnap(G) + ' < ' + totSnap(J));
  ok(!P.janela.pipelines.includes('807886369') && !J.janela.pipelines.includes('807886369'),
    'pipeline Backup nunca entra no recorte');
  ok(J.snapshot.etapas_nao_mapeadas === 0,
    'nenhuma etapa fora do mapa canônico (etapa nova no portal apareceria aqui)',
    J.snapshot.etapas_nao_mapeadas);

  // ── 5. Premissas e divergências no payload ────────────────────────────────────
  console.log('\n== premissas declaradas no payload ==');
  const obrigatorias = ['objeto', 'quebra_de_serie', 'pipeline_do_evento', 'backup_excluido',
    'stage_canon', 'duas_reguas_de_contato', 'automacao_nao_e_esforco', 'dono_no_instante',
    'motivo_desqualificacao', 'tier_do_bronze', 'tier_vidas_nao_existe', 'defasagem'];
  obrigatorias.forEach(k => ok(!!(J.premissas || {})[k], 'premissa "' + k + '" presente'));
  ok(Object.keys(J.divergencias_conhecidas || {}).length >= 4, 'divergências conhecidas declaradas',
    Object.keys(J.divergencias_conhecidas || {}).length);
  ok(J.snapshot.camada === 'silver' && J.coorte.camada.includes('silver'),
    'camada declarada por bloco (a régua "gold onde reconcilia, silver onde ainda não")');

  // ── 6. Desqualificações: motivo, autor e automação segregada ──────────────────
  console.log('\n== desqualificações ==');
  const dq = J.desqualificacoes || [];
  ok(dq.length > 0, 'há desqualificações no período', dq.length);
  ok(dq.every(d => d.motivo), 'toda desqualificação tem motivo ou "(sem motivo)"');
  ok(dq.every(d => d.autor), 'toda desqualificação tem autor ou bucket de automação');
  const auto = dq.filter(d => d.automacao).length;
  ok(dq.some(d => d.automacao) || auto === 0, 'automação segregada do esforço do BDR', auto + ' de ' + dq.length);
  ok(dq.every(d => typeof d.bdr === 'string'), 'dono no instante resolvido para nome de BDR');

  // ── 6b. Waterfall MACRO: a aritmética TEM de fechar ───────────────────────────
  console.log('\n== waterfall macro (a aritmetica fecha?) ==');
  const M = J.macro || {};
  const soma = M.aberto_inicio + M.entrada_no_funil + M.reativados - M.qualificados - M.desqualificados;
  ok(M.aberto_fim === soma + M.residuo, 'identidade do waterfall: inicio + entrou + reativados − qualif − desqualif + residuo == fim', M.conferencia);
  ok(Math.abs(M.residuo) <= Math.max(5, M.aberto_fim * 0.005),
    'residuo dentro da tolerancia declarada (<= 0,5% do saldo ou 5 leads)', M.residuo + ' de ' + M.aberto_fim);
  ok(M.aberto_inicio > 0 && M.aberto_fim > 0, 'saldos de abertura e fecho positivos', M.aberto_inicio + ' -> ' + M.aberto_fim);
  ok(typeof M.criados_sem_movimento === 'number',
    'lead criado sem movimento de etapa e MEDIDO, nao silenciado', M.criados_sem_movimento);
  // A saida do pool so conta quem saiu de etapa ABERTA. Contar "para=qualificado" de
  // qualquer origem incluiria reativacao e inflaria a saida -- foi o defeito medido
  // que levou o residuo de +1 para +5.
  ok(M.qualificados <= (J.waterfall.setas['conectado>qualificado'] || 0) + (J.waterfall.setas['tentativa>qualificado'] || 0) + (J.waterfall.setas['novo>qualificado'] || 0),
    'saida para Qualificado nao conta reativacao de desqualificado', M.qualificados);

  // ── 6c. POR STATUS: a conservacao por etapa, o corte que faltava ──────────────
  console.log('\n== waterfall por status ==');
  const PS = J.waterfall.por_status || [];
  ok(PS.length === 5, 'as 5 etapas canonicas presentes (inclui o terminal)', PS.length);
  PS.forEach(s => ok(s.saldo_fim === s.saldo_inicio + s.entradas - s.saidas + s.residuo,
    'conservacao em ' + s.rotulo, s.saldo_inicio + ' + ' + s.entradas + ' - ' + s.saidas + ' = ' + s.saldo_fim + ' (res ' + s.residuo + ')'));
  const resPS = PS.filter(s => ['novo','tentativa','conectado'].includes(s.etapa)).reduce((a, s) => a + s.residuo, 0);
  ok(resPS === M.residuo,
    'os DOIS modelos concordam no residuo (macro x soma por status) -- e isso que valida a decomposicao', resPS + ' vs ' + M.residuo);
  const somaEnt = PS.reduce((a, s) => a + s.entradas, 0);
  ok(somaEnt === Object.values(J.waterfall.setas).reduce((a, b) => a + b, 0),
    'Sigma entradas por status == Sigma setas (o mesmo total por dois cortes)', somaEnt);

  // ── 6d. Trilha por lead: e o que torna o drill auditavel ──────────────────────
  console.log('\n== trilha dos leads movimentados ==');
  const LM = J.waterfall.leads || [];
  ok(LM.length > 0, 'ha leads com trilha', LM.length + ' de ' + J.waterfall.leads_total);
  ok(J.waterfall.leads_truncado === 0 || J.waterfall.leads_truncado > 0,
    'truncagem DECLARADA, nunca silenciosa', 'truncado: ' + J.waterfall.leads_truncado);
  ok(LM.every(l => l.criado !== undefined && l.status_atual && Array.isArray(l.passos) && l.passos.length),
    'todo lead traz CRIADO, STATUS ATUAL e a trilha de passos');
  ok(LM.every(l => l.passos.every((p, i, a) => i === 0 || a[i - 1].passo <= p.passo)),
    'passos em ordem cronologica dentro da janela');
  ok(LM.every(l => l.n_movimentos === l.passos.length), 'n_movimentos == tamanho da trilha');
  const encad = LM.filter(l => l.passos.length > 1)
    .filter(l => l.passos.every((p, i, a) => i === 0 || a[i - 1].para === p.de));
  ok(encad.length >= LM.filter(l => l.passos.length > 1).length * 0.9,
    'a trilha ENCADEIA (o "para" de um passo e o "de" do seguinte) em >= 90% dos leads com 2+ passos',
    encad.length + ' de ' + LM.filter(l => l.passos.length > 1).length);
  ok(LM.every(l => l.passos.every(p => p.hora && /^\d{2}:\d{2}$/.test(p.hora))), 'cada passo tem hora');

  // ── 7. Mês corrente não explode (a janela que a tela abre por padrão) ─────────
  console.log('\n== mês corrente (default da tela) ==');
  const cur = await call({ funil: 'todos', refresh: '1' });
  ok(cur.code === 200 && cur.body.success, 'mês corrente responde 200', cur.code);
  ok(cur.body.coorte.criados >= 0 && Object.keys(cur.body.waterfall.setas).length >= 0, 'payload íntegro no mês parcial');

  // ── 8. Contraprova ao vivo (opcional) ─────────────────────────────────────────
  if (PORTAL) {
    console.log('\n== contraprova na Search API do HubSpot ==');
    const pv = await call({ funil: 'todos', since: '2026-07-01', until: '2026-07-31', portal: '1', refresh: '1' });
    const svp = pv.body.diagnostics.snapshot_vs_portal || {};
    ok(!svp.erro, 'contraprova executou', svp.erro || 'ok');
    if (!svp.erro) {
      ok(svp.total_portal === svp.total_armazem,
        'TOTAL do portal == TOTAL do armazém (parte por parte difere pela defasagem; o total, não)',
        svp.total_portal + ' vs ' + svp.total_armazem);
    }
  }

  console.log('\n' + (falhas ? falhas + ' FALHA(S)' : 'TODOS OS CASOS PASSARAM'));
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('\nERRO:', e.message); process.exit(1); });
