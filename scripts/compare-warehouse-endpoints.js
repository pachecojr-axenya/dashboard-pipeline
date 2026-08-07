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
      const B = (await call(mod, { method: 'POST', body: { hsId: id } })).body;
      const A = (await call(mod, { method: 'POST', body: { hsId: id, fonte: 'api' } })).body;
      const bs = (B.activities || []).map((x) => x.type + '@' + x.date).sort();
      const as = (A.activities || []).map((x) => x.type + '@' + x.date).sort();
      const comCorpo = (B.activities || []).filter((x) => x.body).length;
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

// ================================================================= run =======
(async () => {
  const casos = {
    prob: cmpProbHistory,
    tickets: cmpTickets,
    calls: () => cmpCalls(30),
    activities: cmpActivities,
    deals: cmpCompanyDeals,
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
