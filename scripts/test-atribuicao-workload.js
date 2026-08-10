'use strict';
/**
 *   HUBSPOT_TOKEN nao e necessario: le so o armazem, via ADC.
 *   node scripts/test-atribuicao-workload.js
 *
 * Fora do `npm run check` de proposito: precisa de credencial de BigQuery, que
 * o CI do GitHub nao tem — mesma razao do compare-warehouse-endpoints.js.
 *
 * Prova a de atribuição (e-mail sim, nota não) com dados reais e
 * verifica a partição MECE: entraram + descartados == total.
 *
 * Também confere que `?atribuidos=todos` é superconjunto do default, e que a
 * diferença entre os dois é EXATAMENTE o que foi declarado como descartado.
 */
const path = require('path'); const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
process.env.LOCAL_DEV_BYPASS = 'true';
const TOKEN = execSync('gcloud auth application-default print-access-token', { encoding: 'utf8' }).trim();
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'adc@local', private_key: 'x' });
const bq = require(path.join(ROOT, 'lib', 'bigquery.js'));
bq.query = async (sql, params) => {
  const body = { query: sql, useLegacySql: false, location: 'southamerica-east1', timeoutMs: 120000 };
  if (params && params.length) {
    body.parameterMode = 'NAMED';
    body.queryParameters = params.map((p) => ({ name: p.name, parameterType: { type: p.type || 'STRING' }, parameterValue: { value: p.value == null ? null : String(p.value) } }));
  }
  const res = await fetch('https://bigquery.googleapis.com/bigquery/v2/projects/gen-lang-client-0423905839/queries',
    { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await res.json(); if (!res.ok) throw new Error('BQ ' + res.status + ': ' + JSON.stringify(d).slice(0, 300));
  const f = (d.schema && d.schema.fields) || [];
  const rows = (d.rows || []).map((r) => { const o = {}; (r.f || []).forEach((c, i) => { o[f[i].name] = bq.decodeCell(c.v, f[i]); }); return o; });
  return { fields: f.map((x) => x.name), rows };
};
function fakeRes() { const r = { _code: 0, _json: null }; r.setHeader = () => {}; r.status = (c) => { r._code = c; return r; }; r.json = (j) => { r._json = j; return r; }; r.end = () => r; return r; }

let falhas = 0;
function ok(cond, texto, extra) {
  if (!cond) falhas++;
  console.log((cond ? '  ok   ' : '  FALHA ') + texto + (extra ? '   ' + extra : ''));
}

(async () => {
  const h = require(path.join(ROOT, 'api', 'bdr-workload.js'));
  const until = new Date(Date.now() - 86400000 * 3).toISOString().slice(0, 10);
  const since = new Date(Date.now() - 86400000 * 8).toISOString().slice(0, 10);
  const get = async (extra) => {
    const res = fakeRes();
    await h({ method: 'GET', body: {}, url: `/api/bdr-workload?since=${since}&until=${until}&refresh=1${extra}`, headers: {}, query: {} }, res);
    return res._json;
  };

  console.log(`\njanela ${since} a ${until}\n`);
  const def = await get('');
  const todos = await get('&atribuidos=todos');
  const a = def.diagnostics.rawCounts.atribuicaoPorDonoDoContato;

  console.log('  regra:', a.regra);
  console.log('  entraram por tipo:  ', JSON.stringify(a.entraramPorTipo));
  console.log('  descartados por tipo:', JSON.stringify(a.descartadosPorTipo));
  console.log('');

  ok(a.entraram + a.descartados === a.total, 'MECE: entraram + descartados == total',
    `${a.entraram} + ${a.descartados} == ${a.total}`);
  ok(!('notes' in a.entraramPorTipo), 'NOTA nao entra no default (decisao: nota nao e acao)',
    `entraramPorTipo tem [${Object.keys(a.entraramPorTipo).join(',')}]`);
  ok((a.entraramPorTipo.emails || 0) > 0, 'E-MAIL entra no default (decisao: e-mail e acao)',
    `${a.entraramPorTipo.emails || 0} e-mails atribuidos`);
  ok(Object.keys(a.descartadosPorTipo).every((k) => k === 'notes'), 'so NOTA e descartada',
    `descartadosPorTipo tem [${Object.keys(a.descartadosPorTipo).join(',')}]`);
  ok(a.descartados === def.diagnostics.rawCounts.toquesAtribuidosDescartados,
    'campo antigo toquesAtribuidosDescartados segue coerente', String(a.descartados));

  // ?atribuidos=todos tem de ser superconjunto, e a diferenca tem de ser
  // EXATAMENTE o descartado — se nao for, o payload declara um numero e entrega
  // outro, que e o modo de falha que esta declaracao existe para impedir.
  const dif = todos.activities.length - def.activities.length;
  ok(dif === a.descartados, 'diferenca entre ?atribuidos=todos e o default == descartados',
    `${todos.activities.length} - ${def.activities.length} = ${dif} (declarado ${a.descartados})`);

  const idsDef = new Set(def.activities.map((x) => String(x.id)));
  ok(def.activities.every((x) => idsDef.has(String(x.id))) && todos.activities.filter((x) => !idsDef.has(String(x.id))).length === dif,
    'todos = default + exatamente os descartados (superconjunto real)');

  // Premissas: a chave duplicada fazia a do roster nunca chegar. Confere que as
  // tres chaves distintas estao no payload.
  const p = def.premissas || {};
  ok(!!p.atribuicao_dono_proprio, 'premissa atribuicao_dono_proprio chega no payload');
  ok(!!p.atribuicao_sem_dono, 'premissa atribuicao_sem_dono chega no payload');
  ok(!!p.atribuicao_mudanca, 'premissa atribuicao_mudanca (aviso de quebra de serie) chega no payload');

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\ntodos os casos ok');
  process.exitCode = falhas ? 1 : 0;
})().catch((e) => { console.error('ESTOUROU:', e.message); process.exitCode = 1; });
