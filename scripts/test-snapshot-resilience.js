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
let userAuth = false;
let userEmail = 'jpacheco@axenya.com';
let existingManual = false;

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
stub('../lib/auth', { verifyRequest: () => userAuth ? { email: userEmail, role: 'staff' } : null });
stub('../lib/snapshot-format', {
  PIPELINE_VENDAS: 'vendas', PIPELINE_BID: 'bid', PROPERTIES: [],
  HEADERS: ['Deal ID'], buildRow: () => ['1'],
});
stub('../lib/bigquery', {
  TABLE_DAILY: 'daily', TABLE_WEEKLY: 'weekly',
  isConfigured: () => true,
  ensureTables: async () => { if (failBQ) throw new Error('BQ 403 sintético'); },
  snapshotCount: async () => 0,
  snapshotMeta: async () => existingManual
    ? ({ count: 2, type: 'semanal_manual', capturedAt: '2026-07-20T18:00:00Z' })
    : ({ count: 0, type: null, capturedAt: null }),
  insertSnapshotRows: async (_date, type, _rows, _capturedAt, table) => {
    bqInsertions.push({ table, type });
    return { inserted: 1 };
  },
});

const handler = require('../api/snapshot');

function call(options) {
  return new Promise((resolve) => {
    const o = options || {};
    const req = {
      method: o.method || 'GET', url: o.url || '/api/snapshot', query: {},
      headers: o.headers || { authorization: 'Bearer test-cron-secret' },
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
  check('Sheets 403 não bloqueia BQ daily', sheetsFail.status === 200 && bqInsertions.filter(x => x.table === 'daily').length === 1);
  check('Resposta registra falha não bloqueante do Sheets', /ERRO/.test(sheetsFail.body.actions.sheets || ''));
  check('Foto daily foi registrada', /gravada/.test(sheetsFail.body.actions.bq_daily || ''));

  bqInsertions.length = 0;
  userAuth = true;
  const manual = await call({
    method: 'POST', url: '/api/snapshot?promote=weekly',
    headers: { 'x-requested-with': 'forecast-dashboard' },
  });
  check('Captura manual autenticada retorna 200', manual.status === 200 && manual.body.capture === 'manual_weekly');
  check('Captura manual grava daily + weekly_gold',
    bqInsertions.some(x => x.table === 'daily' && x.type === 'semanal_manual') &&
    bqInsertions.some(x => x.table === 'weekly' && x.type === 'semanal_manual'));
  check('Captura manual ignora Sheets legado', /ignorado/.test(manual.body.actions.sheets || ''));

  bqInsertions.length = 0;
  existingManual = true;
  const manualAgain = await call({
    method: 'POST', url: '/api/snapshot?promote=weekly',
    headers: { 'x-requested-with': 'forecast-dashboard' },
  });
  check('Captura manual repetida é idempotente mesmo se o pipe mudou',
    manualAgain.status === 200 && bqInsertions.length === 0);
  existingManual = false;

  const noOriginHeader = await call({ method: 'POST', url: '/api/snapshot?promote=weekly', headers: {} });
  check('Captura manual exige origem do dashboard', noOriginHeader.status === 403);

  userEmail = 'outra-pessoa@axenya.com';
  const unauthorizedEditor = await call({
    method: 'POST', url: '/api/snapshot?promote=weekly',
    headers: { 'x-requested-with': 'forecast-dashboard' },
  });
  check('Captura manual restringe editores', unauthorizedEditor.status === 403);

  userAuth = false;
  failBQ = true;
  const bqFail = await call();
  check('Falha do BQ retorna 500', bqFail.status === 500 && /BQ 403/.test(bqFail.body.error || ''));

  if (fails) process.exit(1);
  console.log('OK | resiliência do snapshot validada');
})();
