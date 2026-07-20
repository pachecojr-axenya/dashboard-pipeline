'use strict';

const assert = require('assert');
const endpoint = require('../api/bdr-treble-dw');
const t = endpoint._test;

async function testTransportSecurity() {
  const originalFetch = global.fetch;
  let captured;
  global.fetch = async function (url, options) {
    captured = { url: String(url), options: options };
    return { ok: true, json: async function () { return { data: [] }; } };
  };
  try {
    await t.clickhouseQuery({ host: 'warehouse.example', port: '8443', user: 'test_user', password: 'test_password', database: 'client_analytics' }, 'SELECT 1 FORMAT JSON');
  } finally {
    global.fetch = originalFetch;
  }
  assert.strictEqual(captured.options.method, 'POST');
  assert.ok(captured.options.headers.Authorization.startsWith('Basic '));
  assert.ok(!captured.url.includes('test_user'));
  assert.ok(!captured.url.includes('test_password'));
  assert.strictEqual(captured.options.body, 'SELECT 1 FORMAT JSON');
}

function testSqlContract() {
  const sql = t.buildSql(30);
  assert.ok(sql.includes('timestamp_responded >'));
  assert.ok(!sql.includes('timestamp_responded IS NOT NULL'));
  assert.ok(sql.includes('LIMIT 10001'));
  assert.ok(!sql.includes('cellphone'));
  assert.ok(!sql.includes('deployment_id'));
}

function testEventGranularityAndSentinel() {
  const base = { flow: 'Gabi | Plano de Saúde', poll_id: '1410169', created_at: '2026-07-20T10:00:00-03:00', created_day: '2026-07-20' };
  const rows = [
    Object.assign({}, base, { status: 'DELIVERED', delivered_real: 1, replied_real: 0 }),
    Object.assign({}, base, { status: 'MISSING_PARAMETER', delivered_real: 0, replied_real: 0 }),
    Object.assign({}, base, { status: 'SUCCESS', delivered_real: 0, replied_real: 1 })
  ];
  const messages = rows.map(t.sanitizeMessage);
  assert.strictEqual(messages.length, 3);
  assert.strictEqual(messages[0].replied, false, 'sentinela não pode contar resposta');
  assert.strictEqual(messages[1].delivered, false);
  assert.strictEqual(messages[2].delivered, true, 'resposta válida implica entrega');
  const agg = t.aggregateMessages(messages);
  assert.strictEqual(agg.byFlow.length, 1, 'flow único não pode colapsar eventos');
  assert.strictEqual(agg.byFlow[0].enviadas, 3);
  assert.strictEqual(agg.summary.entregues, 2);
  assert.strictEqual(agg.summary.respondidas, 1);
  assert.strictEqual(agg.summary.deploymentFailures, 1);
}

function testPrivacyGuard() {
  const safe = t.sanitizeMessage({ flow: 'Flow teste', poll_id: '1', created_at: '2026-07-20T10:00:00-03:00', created_day: '2026-07-20', status: 'DELIVERED', delivered_real: 1, replied_real: 0 });
  t.assertNoPii({ messages: [safe] });
  assert.throws(function () { t.assertNoPii({ cellphone: 'redacted' }); }, /pii_key_in_payload/);
  ['cellphone', 'country_code', 'deployment_id', 'batch_id', 'treble_id', 'content', 'copy', 'session_id'].forEach(function (key) {
    assert.ok(!Object.prototype.hasOwnProperty.call(safe, key));
  });
}

async function main() {
  await testTransportSecurity();
  testSqlContract();
  testEventGranularityAndSentinel();
  testPrivacyGuard();
  console.log('[test-bdr-treble-dw] PASS | transporte, granularidade, sentinela e privacidade');
}

main().catch(function (error) {
  console.error('[test-bdr-treble-dw] FAIL | ' + error.message);
  process.exit(1);
});
