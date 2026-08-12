#!/usr/bin/env node
'use strict';
/**
 * _lead-funnel-fixture.js — captura payloads REAIS do /api/bdr-lead-funnel em disco,
 * para o smoke de render rodar sem credencial de service account.
 *
 * O smoke de PIXEL não pode depender do BigQuery: o local-server.js não tem
 * GOOGLE_SERVICE_ACCOUNT_JSON (o teste de dados usa o ADC do gcloud por um shim), e
 * sem fixture o navegador só veria a tela de erro — que renderiza bem e não prova nada.
 *
 * A fixture é capturada do endpoint DE VERDADE, não escrita à mão: fixture inventada
 * esconde justamente o defeito que ela deveria pegar (foi assim que um bug de etiqueta
 * do Apollo passou por um teste verde).
 *
 *   node scripts/_lead-funnel-fixture.js <diretório-de-saída>
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');

process.env.LOCAL_DEV_BYPASS = 'true';
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

function fakeRes() {
  const r = { _code: 0, _json: null };
  r.setHeader = () => {}; r.status = (c) => { r._code = c; return r; };
  r.json = (j) => { r._json = j; return r; }; r.end = () => r;
  return r;
}

// Os quatro estados que o smoke precisa exercitar: o padrão, a granularidade escolhida,
// o recorte por pessoa e o recorte por atributo.
const CASOS = [
  { nome: 'base', query: { funil: 'todos', since: '2026-06-01', until: '2026-08-11' } },
  { nome: 'gran-mes', query: { funil: 'todos', since: '2026-06-01', until: '2026-08-11', gran: 'mes' } },
  { nome: 'recorte-bdr', query: { funil: 'todos', since: '2026-06-01', until: '2026-08-11', dim: 'bdr', val: null } },
  { nome: 'recorte-canal', query: { funil: 'todos', since: '2026-06-01', until: '2026-08-11', dim: 'canal_macro', val: 'Outbound' } },
];

(async () => {
  const out = process.argv[2];
  if (!out) { console.error('uso: node scripts/_lead-funnel-fixture.js <dir>'); process.exit(1); }
  fs.mkdirSync(out, { recursive: true });
  const h = require(path.join(ROOT, 'api', 'bdr-lead-funnel.js'));
  let bdrEscolhido = null;

  for (const c of CASOS) {
    const q = { ...c.query, refresh: '1' };
    // O BDR do recorte sai do próprio dado (o mais volumoso), não de um nome chumbado:
    // nome chumbado quebra calado quando a pessoa sai do time.
    if (q.dim === 'bdr' && q.val === null) {
      if (!bdrEscolhido) throw new Error('caso base precisa vir antes do recorte por BDR');
      q.val = bdrEscolhido;
    }
    const res = fakeRes();
    await h({ method: 'GET', url: '/api/bdr-lead-funnel', headers: {}, query: q }, res);
    if (res._code !== 200) throw new Error(c.nome + ': HTTP ' + res._code + ' ' + JSON.stringify(res._json).slice(0, 200));
    if (c.nome === 'base') {
      const cand = (res._json.coorte.por_dimensao.bdr || [])
        .filter(r => r.bdr && r.criados > 20).sort((a, b) => b.criados - a.criados)[0];
      bdrEscolhido = cand && cand.valor;
    }
    fs.writeFileSync(path.join(out, c.nome + '.json'), JSON.stringify(res._json));
    console.log('ok', c.nome, (JSON.stringify(res._json).length / 1048576).toFixed(2) + ' MB');
  }
  fs.writeFileSync(path.join(out, '_meta.json'), JSON.stringify({ bdr: bdrEscolhido }));
  console.log('BDR do recorte:', bdrEscolhido);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
