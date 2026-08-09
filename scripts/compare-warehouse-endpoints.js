'use strict';
/**
 * compare-warehouse-endpoints.js — prova a paridade dos endpoints migrados.
 *
 *   node scripts/compare-warehouse-endpoints.js              # todos
 *   node scripts/compare-warehouse-endpoints.js calls         # só um
 *
 * Chama CADA endpoint migrado duas vezes — `fonte=bq` e `fonte=api` — e compara
 * campo a campo. É isto que o handoff F5 pede em "migrar os 10 endpoints, um por
 * vez, comparando com a versão antiga": a comparação tem de ser reprodutível, não
 * uma olhada na tela no dia da troca.
 *
 * Não roda no CI de propósito: gasta request da API do HubSpot em cada execução.
 * É ferramenta de migração e de investigação, para rodar quando alguém desconfia
 * de um número.
 *
 * Credenciais:
 *   GOOGLE_SERVICE_ACCOUNT_JSON  — leitura do armazém (ou ADC via --adc)
 *   HUBSPOT_TOKEN                — o lado "antigo" da comparação
 *
 *   HUBSPOT_TOKEN="$(gcloud secrets versions access latest \
 *     --secret=axenya-hubspot-pat-shared --project=gen-lang-client-0423905839)" \
 *   node scripts/compare-warehouse-endpoints.js --adc
 */

const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ADC = process.argv.includes('--adc');
const SO = process.argv.slice(2).filter((a) => !a.startsWith('--'));

process.env.LOCAL_DEV_BYPASS = process.env.LOCAL_DEV_BYPASS || 'true';

// --adc: troca o JWT da service account por um access token do gcloud. Serve para
// rodar isto na máquina de quem está migrando, sem baixar chave de SA.
if (ADC) {
  const TOKEN = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'adc@local', private_key: 'x' });
  const bq = require(path.join(ROOT, 'lib', 'bigquery.js'));
  bq.query = async (sql, params) => {
    const body = { query: sql, useLegacySql: false, location: 'southamerica-east1', timeoutMs: 60000 };
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
    if (!res.ok) throw new Error('BQ ' + res.status + ': ' + JSON.stringify(data).slice(0, 300));
    const fields = (data.schema && data.schema.fields) || [];
    const rows = (data.rows || []).map((r) => {
      const o = {};
      (r.f || []).forEach((cell, i) => { o[fields[i].name] = bq.decodeCell(cell.v, fields[i]); });
      return o;
    });
    return { fields: fields.map((f) => f.name), rows };
  };
}
if (!process.env.HUBSPOT_TOKEN) {
  try {
    process.env.HUBSPOT_TOKEN = execSync(
      'gcloud secrets versions access latest --secret=axenya-hubspot-pat-shared --project=gen-lang-client-0423905839',
      { encoding: 'utf8' }).trim();
  } catch { /* segue: o lado 'api' vai falhar com mensagem clara */ }
}

const { BDR_TEAM } = require(path.join(ROOT, 'lib', 'bdr-team.js'));

// ---- mini harness: invoca o handler direto, sem subir servidor ----
function fakeRes() {
  const r = { _code: 0, _json: null };
  r.setHeader = () => {}; r.status = (c) => { r._code = c; return r; };
  r.json = (j) => { r._json = j; return r; }; r.end = () => r;
  return r;
}
async function call(mod, { method = 'POST', body = {}, url = '/', query = {} } = {}) {
  const h = require(path.join(ROOT, 'api', mod));
  const res = fakeRes();
  await h({ method, body, url, headers: {}, query }, res);
  return { code: res._code, body: res._json };
}

let falhas = 0;
function linha(ok, texto, extra) {
  if (!ok) falhas++;
  console.log((ok ? '  =  ' : '  !  ') + texto + (extra ? '   ' + extra : ''));
}
const dia = (v) => (v ? String(v).slice(0, 10) : null);
const chaveado = (o) => JSON.stringify(Object.keys(o || {}).sort().map((k) => [k, o[k]]));

// =============================================================== casos =======

async function cmpProbHistory() {
  console.log('\ndeal-prob-history — histórico da probabilidade do AE');
  // Deals com mais mudanças registradas: é onde uma divergência apareceria.
  const wh = require(path.join(ROOT, 'lib', 'hubspot-warehouse.js'));
  const { rows } = await wh.query(`
    SELECT object_id, COUNT(*) n
    FROM ${wh.t('silver', 'fact_crm_change')}
    WHERE object_type = 'deal' AND property = 'probabilidade_de_fechamento_'
    GROUP BY 1 ORDER BY n DESC LIMIT 5
  `);
  for (const r of rows) {
    const id = String(r.object_id);
    const u = (f) => `/api/deal-prob-history?id=${id}${f ? '&fonte=api' : ''}`;
    const B = (await call('deal-prob-history.js', { method: 'GET', url: u(false) })).body;
    const A = (await call('deal-prob-history.js', { method: 'GET', url: u(true) })).body;
    const s = (h) => JSON.stringify((h || []).map((x) => [x.value, x.date]));
    linha(s(B.history) === s(A.history), `deal ${id}`, `${(B.history || []).length} pontos`);
  }
}

async function cmpTickets() {
  console.log('\npull-tickets — Pipeline de Cotação (o único no armazém)');
  const B = (await call('pull-tickets.js', { method: 'POST', body: {} })).body.data;
  const A = (await call('pull-tickets.js', { method: 'POST', body: { fonte: 'api' } })).body.data;
  linha(B.tickets.length === A.tickets.length, 'contagem de tickets', `${B.tickets.length} / ${A.tickets.length}`);

  const ai = {}; A.tickets.forEach((t) => { ai[String(t.hs_object_id || t._id)] = t; });
  const bi = new Set(B.tickets.map((t) => String(t.hs_object_id)));
  const soApi = Object.keys(ai).filter((x) => !bi.has(x));
  linha(soApi.length === 0, 'nenhum ticket só na API', soApi.slice(0, 5).join(','));

  let difCreate = 0, difClose = 0, difDono = 0, difEtapa = 0, difEmpresa = 0;
  B.tickets.forEach((b) => {
    const a = ai[String(b.hs_object_id)]; if (!a) return;
    if (dia(b.createdate) !== dia(a.createdate)) difCreate++;
    if (dia(b.closed_date) !== dia(a.closed_date)) difClose++;
    if (String(b.hubspot_owner_id) !== String(a.hubspot_owner_id)) difDono++;
    if (String(b.hs_pipeline_stage) !== String(a.hs_pipeline_stage)) difEtapa++;
    if (String(b._companyName) !== String(a._companyName)) difEmpresa++;
  });
  linha(difCreate === 0, 'createdate igual em todos', `${difCreate} divergentes`);
  linha(difClose === 0, 'closed_date igual em todos', `${difClose} divergentes`);
  linha(difDono === 0, 'dono igual em todos', `${difDono} divergentes`);
  linha(difEtapa === 0, 'etapa igual em todos', `${difEtapa} divergentes`);
  linha(difEmpresa === 0, 'empresa igual em todos', `${difEmpresa} divergentes`);
  // Superset esperado, não divergência: dim_owner traz os arquivados também.
  console.log(`  ·  donos: ${Object.keys(B.owners).length} no armazém vs ${Object.keys(A.owners).length} em /crm/v3/owners (superset esperado)`);
}

async function cmpCalls(dias) {
  const until = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const since = new Date(Date.now() - (dias + 1) * 86400000).toISOString().slice(0, 10);
  console.log(`\nbdr-workload-calls — ${BDR_TEAM.length} BDRs, ${since} a ${until}`);
  for (const bdr of BDR_TEAM) {
    const u = (f) => `/api/bdr-workload-calls?bdr=${encodeURIComponent(bdr)}&since=${since}&until=${until}&refresh=1${f ? '&fonte=api' : ''}`;
    const B = (await call('bdr-workload-calls.js', { method: 'GET', url: u(false) })).body;
    const A = (await call('bdr-workload-calls.js', { method: 'GET', url: u(true) })).body;
    if (!B || !A || B.success === false || A.success === false) {
      linha(false, bdr.padEnd(22), (B && B.error) || (A && A.error) || 'sem resposta');
      continue;
    }
    const ok = B.total === A.total && B.conversas === A.conversas
      && B.discagens === A.discagens && B.pctConversa === A.pctConversa
      && chaveado(B.byDesfecho) === chaveado(A.byDesfecho)
      && chaveado(B.byBucket) === chaveado(A.byBucket);
    linha(ok, bdr.padEnd(22), `${B.total} / ${A.total} ligações`);
    if (!ok) {
      console.log('       bq  desfecho: ' + JSON.stringify(B.byDesfecho));
      console.log('       api desfecho: ' + JSON.stringify(A.byDesfecho));
    }
  }
}

async function cmpActivities() {
  console.log('\ncompany-activities / deal-activities — feed de toques');
  const wh = require(path.join(ROOT, 'lib', 'hubspot-warehouse.js'));
  const whq = require(path.join(ROOT, 'lib', 'hubspot-wh-queries.js'));
  for (const [escopo, coluna, mod, col] of [
    ['empresa', 'company_id', 'company-activities.js', 'company_id'],
    ['deal', 'deal_id', 'deal-activities.js', 'deal_id'],
  ]) {
    const { rows } = await wh.query(`
      SELECT ${col} AS id, COUNT(*) n
      FROM ${wh.t('silver', 'fact_engagement')}
      WHERE ${col} IS NOT NULL AND kind IN ('notes','emails','calls','meetings')
      GROUP BY 1 ORDER BY n DESC LIMIT 3
    `);
    for (const r of rows) {
      const id = String(r.id);
      // Quantos toques de cada tipo o objeto tem. Acima de 50 num tipo, a versão da
      // API TRUNCA (busca 50 associações por tipo antes de ordenar e cortar em 20),
      // e aí o conjunto dela não é o top 20 — comparar os conjuntos como se fossem
      // equivalentes marcaria falha onde não há, e script que grita em tudo é script
      // que ninguém lê.
      const { rows: porTipo } = await wh.query(`
        SELECT kind, COUNT(*) n
        FROM ${wh.t('silver', 'fact_engagement')}
        WHERE ${col} = '${id.replace(/[^0-9]/g, '')}'
          AND kind IN ('notes','emails','calls','meetings')
        GROUP BY 1
      `);
      const estourou = porTipo.filter((t) => Number(t.n) > 50);

      const B = (await call(mod, { method: 'POST', body: { hsId: id } })).body;
      const A = (await call(mod, { method: 'POST', body: { hsId: id, fonte: 'api' } })).body;
      const bs = (B.activities || []).map((x) => x.type + '@' + x.date).sort();
      const as = (A.activities || []).map((x) => x.type + '@' + x.date).sort();
      const comCorpo = (B.activities || []).filter((x) => x.body).length;

      if (estourou.length) {
        // Não é divergência: é a fonte antiga truncando. O que se pode exigir aqui é
        // que o armazém devolva 20 e com corpo.
        const detalhe = estourou.map((t) => `${t.kind}=${t.n}`).join(' ');
        linha(bs.length === whq.FEED_LIMIT && comCorpo > 0,
          `${escopo} ${id}`.padEnd(26),
          `${bs.length} toques · ${comCorpo} com corpo · API TRUNCA (${detalhe} > 50/tipo), conjunto não comparável`);
        continue;
      }
      linha(JSON.stringify(bs) === JSON.stringify(as),
        `${escopo} ${id}`.padEnd(26),
        `${bs.length} / ${as.length} toques · ${comCorpo} com corpo no bq`);
    }
  }
}

async function cmpCompanyDeals() {
  console.log('\ncompany-deals — deals da empresa (ponte simétrica)');
  const wh = require(path.join(ROOT, 'lib', 'hubspot-warehouse.js'));
  const { rows } = await wh.query(`
    SELECT company_id, num_deals
    FROM ${wh.t('silver', 'dim_company')}
    WHERE is_current AND num_deals > 1
    ORDER BY num_deals DESC LIMIT 4
  `);
  for (const r of rows) {
    const id = String(r.company_id);
    const B = (await call('company-deals.js', { method: 'POST', body: { hsId: id } })).body;
    const A = (await call('company-deals.js', { method: 'POST', body: { hsId: id, fonte: 'api' } })).body;
    const bi = new Set((B.deals || []).map((d) => String(d.hs_object_id)));
    const ai = new Set((A.deals || []).map((d) => String(d.hs_object_id)));
    const soApi = [...ai].filter((x) => !bi.has(x));
    const soBq = [...bi].filter((x) => !ai.has(x));
    // Só na API = perda de dado, é falha. Só no BQ = a ponte simétrica achou uma
    // associação que a direção única da API não pedia — é ganho, não falha.
    linha(soApi.length === 0, `empresa ${id}`.padEnd(26),
      `${bi.size} / ${ai.size} deals` + (soBq.length ? ` · ${soBq.length} só no bq (ponte simétrica)` : ''));
    if (soApi.length) console.log('       perdidos: ' + soApi.slice(0, 5).join(','));
  }
}


async function cmpLeads() {
  console.log('\nbdr-leads — contatos do time com histórico de hs_lead_status');
  const B = (await call('bdr-leads.js', { method: 'GET', url: '/api/bdr-leads?refresh=1' })).body;
  const A = (await call('bdr-leads.js', { method: 'GET', url: '/api/bdr-leads?refresh=1&fonte=api' })).body;
  if (!B || B.success === false || !A || A.success === false) {
    linha(false, 'chamada', (B && B.error) || (A && A.error) || 'sem resposta');
    return;
  }
  linha(B.total === A.total, 'total com status', `${B.total} / ${A.total}`);
  // semStatus tem defasagem legítima: o portal segue sendo editado depois da
  // extração. Tolerância de 1% — acima disso é defeito, não relógio.
  const drift = A.semStatus ? Math.abs(B.semStatus - A.semStatus) / A.semStatus : 0;
  linha(drift <= 0.01, 'semStatus (tol. 1%)',
    `${B.semStatus} / ${A.semStatus} · ${(drift * 100).toFixed(2)}% de defasagem`);

  const bi = new Map(B.contacts.map((c) => [String(c.id), c]));
  const ai = new Map(A.contacts.map((c) => [String(c.id), c]));
  const soApi = [...ai.keys()].filter((x) => !bi.has(x));
  linha(soApi.length === 0, 'nenhum contato só na API', soApi.slice(0, 5).join(','));

  const campos = ['nome', 'cargo', 'bdr', 'status', 'origem', 'empresa', 'colaboradores'];
  const dif = {};
  let histDif = 0;
  bi.forEach((b, id) => {
    const a = ai.get(id); if (!a) return;
    campos.forEach((c) => {
      const nb = b[c] == null ? null : String(b[c]);
      const na = a[c] == null ? null : String(a[c]);
      if (nb !== na) dif[c] = (dif[c] || 0) + 1;
    });
    const s = (h) => JSON.stringify((h || []).map((x) => [x[0], String(x[1]).slice(0, 19)]));
    if (s(b.hist) !== s(a.hist)) histDif++;
  });
  campos.forEach((c) => linha(!dif[c], `campo ${c}`, `${dif[c] || 0} / ${bi.size}`));
  // hist NÃO é exigido igual: a API repete o mesmo status em re-save (NEW@18:49 e
  // NEW@19:22, ou CONNECTED duas vezes no mesmo instante) e o armazém colapsa.
  // NEW → NEW não é transição, e contá-la infla "quantos mudaram de status hoje".
  console.log(`  ·  hist: ${histDif} de ${bi.size} diferem — a API repete status em `
    + `re-save e o armazém colapsa; divergência ESPERADA e a favor do armazém`);
}

async function cmpWorkload() {
  const until = new Date(Date.now() - 86400000 * 3).toISOString().slice(0, 10);
  const since = new Date(Date.now() - 86400000 * 8).toISOString().slice(0, 10);
  console.log(`\nbdr-workload — payload nominal, ${since} a ${until}`);
  const u = (f) => `/api/bdr-workload?since=${since}&until=${until}&refresh=1${f ? '&fonte=api' : ''}`;
  const B = (await call('bdr-workload.js', { method: 'GET', url: u(false) })).body;
  const A = (await call('bdr-workload.js', { method: 'GET', url: u(true) })).body;
  if (!B || B.success === false || !A || A.success === false) {
    linha(false, 'chamada', (B && B.error) || (A && A.error) || 'sem resposta');
    return;
  }
  for (const k of ['companiesCreated', 'contactsCreated', 'transitions', 'activities']) {
    const b = B[k] || [], a = A[k] || [];
    const bi = new Set(b.map((x) => String(x.id || x.contato_id)));
    const ai = new Set(a.map((x) => String(x.id || x.contato_id)));
    const soApi = [...ai].filter((x) => !bi.has(x));
    const soBq = [...bi].filter((x) => !ai.has(x));
    linha(soApi.length === 0 && soBq.length === 0, k.padEnd(18),
      `${b.length} / ${a.length} · só API ${soApi.length} · só BQ ${soBq.length}`);
  }
  const desc = B.diagnostics && B.diagnostics.rawCounts
    && B.diagnostics.rawCounts.toquesAtribuidosDescartados;
  console.log(`  ·  toques atribuídos ao dono do CONTATO descartados por decisão: ${desc}`
    + ' (nota/e-mail; `?atribuidos=todos` inclui)');
}

// ================================================================= run =======
(async () => {
  const casos = {
    prob: cmpProbHistory,
    tickets: cmpTickets,
    calls: () => cmpCalls(30),
    activities: cmpActivities,
    deals: cmpCompanyDeals,
    leads: cmpLeads,
    workload: cmpWorkload,
  };
  const alvo = SO.length ? SO : Object.keys(casos);
  for (const nome of alvo) {
    if (!casos[nome]) { console.log(`(caso desconhecido: ${nome})`); continue; }
    try { await casos[nome](); }
    catch (e) { falhas++; console.log(`  !  ${nome} estourou: ${e.message}`); }
  }
  console.log(falhas ? `\n${falhas} divergência(s) — investigar antes de considerar migrado.`
    : '\nparidade em todos os casos comparados.');
  process.exitCode = falhas ? 1 : 0;
})();
