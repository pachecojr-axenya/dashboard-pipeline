'use strict';
/**
 * Prova que falha do legado Sheets não bloqueia a foto canônica no BigQuery e
 * que falha do BigQuery retorna 500 (cron observável). Zero rede/dependências.
 */
process.env.CRON_SECRET = 'test-cron-secret';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"configured":true}';

function stub(modulePath, exports) {
  const p = require.resolve(modulePath);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

const bqInsertions = [];
let failBQ = false;

stub('../lib/hubspot', {
  hubspotPost: async () => ({
    results: [{ properties: { pipeline: 'vendas', dealstage: 'stage' } }],
  }),
  fetchOwners: async () => ({}),
  STAGE_MAP: { stage: 'Diagnóstico' },
});
stub('../lib/sheets', {
  listTabs: async () => { throw new Error('Sheets 403 sintético'); },
  readRange: async () => [],
  appendRow: async () => {},
  writeMonthlySnapshot: async () => {},
});
stub('../api/_helpers', {
  setCORSHeaders: () => {},
  getHubspotToken: () => 'test-token',
});
stub('../lib/auth', { verifyRequest: () => null });
stub('../lib/snapshot-format', {
  PIPELINE_VENDAS: 'vendas', PIPELINE_BID: 'bid', PROPERTIES: [],
  HEADERS: ['Deal ID'], buildRow: () => ['1'],
});
stub('../lib/bigquery', {
  TABLE_DAILY: 'daily', TABLE_WEEKLY: 'weekly',
  isConfigured: () => true,
  ensureTables: async () => { if (failBQ) throw new Error('BQ 403 sintético'); },
  snapshotCount: async () => 0,
  insertSnapshotRows: async (_date, _type, _rows, _capturedAt, table) => {
    bqInsertions.push(table);
    return { inserted: 1 };
  },
});

const handler = require('../api/snapshot');

function call() {
  return new Promise((resolve) => {
    const req = {
      method: 'GET', url: '/api/snapshot', query: {},
      headers: { authorization: 'Bearer test-cron-secret' },
    };
    const res = {
      _status: 200, setHeader() {},
      status(code) { this._status = code; return this; },
      json(body) { resolve({ status: this._status, body }); return this; },
      end() { resolve({ status: this._status, body: null }); return this; },
    };
    Promise.resolve(handler(req, res)).catch((e) => resolve({ status: 500, body: { error: e.message } }));
  });
}

let fails = 0;
function check(name, ok) {
  console.log((ok ? 'PASS' : 'FALHA') + '  ' + name);
  if (!ok) fails++;
}

(async () => {
  const sheetsFail = await call();
  check('Sheets 403 não bloqueia BQ daily', sheetsFail.status === 200 && bqInsertions.filter(t => t === 'daily').length === 1);
  check('Resposta registra falha não bloqueante do Sheets', /ERRO/.test(sheetsFail.body.actions.sheets || ''));
  check('Foto daily foi registrada', /gravada/.test(sheetsFail.body.actions.bq_daily || ''));

  failBQ = true;
  const bqFail = await call();
  check('Falha do BQ retorna 500', bqFail.status === 500 && /BQ 403/.test(bqFail.body.error || ''));

  if (fails) process.exit(1);
  console.log('OK | resiliência do snapshot validada');
})();
