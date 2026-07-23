'use strict';

const assert = require('assert');
const endpoint = require('../api/bdr-treble-dw');
const t = endpoint._test;

function testDateRanges() {
  const todayRange = t.resolveDateRange({ preset: 'today' });
  assert.strictEqual(todayRange.days, 1);
  assert.strictEqual(todayRange.preset, 'today');

  const custom = t.resolveDateRange({ preset: 'custom', from: '2026-07-01', to: '2026-07-02' });
  assert.strictEqual(custom.days, 2);
  assert.strictEqual(custom.label, '01/07/2026 a 02/07/2026');

  assert.throws(function () {
    t.resolveDateRange({ preset: 'custom', from: '2026-01-01', to: '2026-04-15' });
  }, /date_range_too_large/);

  assert.throws(function () {
    t.resolveDateRange({ preset: 'custom', from: '2026-01-40', to: '2026-02-01' });
  }, /invalid_custom_date/);
}

async function testTransportSecurity() {
  const originalFetch = global.fetch;
  let captured;

  global.fetch = async function (url, options) {
    captured = { url: String(url), options: options };
    return { ok: true, json: async function () { return { data: [] }; } };
  };

  try {
    await t.clickhouseQuery({
      host: 'warehouse.example',
      port: '8443',
      user: 'test_user',
      password: 'test_password',
      database: 'client_analytics'
    }, 'SELECT 1 FORMAT JSON');
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
  const sql = t.buildSql({ from: '2026-07-01', to: '2026-07-20' });
  assert.ok(sql.includes('LEFT ANY JOIN client_analytics.dim_agents a ON f.origin_id = a.id'));
  assert.ok(sql.includes('first_name'));
  assert.ok(sql.includes('last_name'));
  assert.ok(!sql.includes('a.email'));
  assert.ok(!sql.includes('toString(f.origin_id) = toString(a.id)'));
  assert.ok(sql.includes("toDate('2026-07-01')"));
  assert.ok(sql.includes("toDate('2026-07-20')"));
  assert.ok(!sql.includes('cellphone'));
  assert.ok(!sql.includes('deployment_id'));
}

function testStatusAgentAndAggregates() {
  const rows = [
    {
      flow: 'Gabi | Plano',
      poll_id: '1',
      created_at: '2026-07-20T10:00:00-03:00',
      created_day: '2026-07-20',
      status: 'DELIVERED',
      delivered_real: 1,
      replied_real: 0,
      agent_first_name: 'Gabriele',
      agent_last_name: 'Silva'
    },
    {
      flow: 'Gabi follow-up',
      poll_id: '2',
      created_at: '2026-07-20T10:00:00-03:00',
      created_day: '2026-07-20',
      status: 'SUCCESS',
      delivered_real: 0,
      replied_real: 0
    },
    {
      flow: 'Flow sem nome 59580',
      poll_id: '3',
      created_at: '2026-07-20T10:00:00-03:00',
      created_day: '2026-07-20',
      status: 'MISSING_PARAMETER',
      delivered_real: 0,
      replied_real: 0
    },
    {
      flow: 'Manu follow',
      poll_id: '4',
      created_at: '2026-07-20T10:00:00-03:00',
      created_day: '2026-07-20',
      status: 'FAILURE_BY_META_CHOSE_NOT_DELIVER',
      delivered_real: 0,
      replied_real: 1
    }
  ];

  const messages = rows.map(t.sanitizeMessage);

  assert.strictEqual(messages[0].agent, 'Gabriele Almeida');
  assert.strictEqual(messages[0].agentSource, 'direct');
  assert.strictEqual(messages[1].agent, 'Gabriele Almeida');
  assert.strictEqual(messages[1].agentSource, 'flow_inference');
  assert.strictEqual(messages[2].agentSource, 'unknown');
  assert.ok(!Object.prototype.hasOwnProperty.call(messages[0], 'originId'));

  assert.strictEqual(messages[1].statusGroup, 'processed_unconfirmed');
  assert.strictEqual(messages[1].delivered, false, 'SUCCESS isolado não é entregue');
  assert.strictEqual(messages[3].delivered, true, 'resposta pode implicar entrega no funil');
  assert.strictEqual(messages[3].statusGroup, 'not_delivered', 'status bruto continua falha');
  assert.strictEqual(messages[3].statusLabel, 'Meta não entregou');

  const agg = t.aggregateMessages(messages);
  assert.strictEqual(agg.byAgent.length, 3, 'direto + inferido de Gabriele unificados');
  assert.strictEqual(agg.attributionCoverage.direct, 1);
  assert.strictEqual(agg.attributionCoverage.inferred, 2);
  assert.strictEqual(agg.attributionCoverage.unknown, 1);

  const pctSum = agg.byStatus.reduce(function (a, b) { return a + b.pct; }, 0);
  assert.ok(Math.abs(pctSum - 100) <= 0.2, 'byStatus soma 100%');
  assert.ok(agg.byStatus.some(function (x) {
    return x.status === 'SUCCESS' && x.statusGroup === 'processed_unconfirmed';
  }));
}

function testPrivacyGuard() {
  const safe = t.sanitizeMessage({
    flow: 'Flow teste',
    poll_id: '1',
    created_at: '2026-07-20T10:00:00-03:00',
    created_day: '2026-07-20',
    status: 'DELIVERED',
    delivered_real: 1,
    replied_real: 0,
    origin_id: '59580'
  });

  t.assertNoPii({ messages: [safe] });
  assert.throws(function () { t.assertNoPii({ originId: '59580' }); }, /pii_key_in_payload/);
  assert.throws(function () { t.assertNoPii({ origin_id: '59580' }); }, /pii_key_in_payload/);
  assert.throws(function () { t.assertNoPii({ email: 'redacted' }); }, /pii_key_in_payload/);

  ['cellphone', 'country_code', 'deployment_id', 'batch_id', 'treble_id', 'content', 'copy', 'session_id', 'email', 'originId', 'origin_id'].forEach(function (key) {
    assert.ok(!Object.prototype.hasOwnProperty.call(safe, key));
  });
}

function testFlowRuleAttribution() {
  // Regra de negócio pelo construtor do flow (pesquisa RH / exp outbound = Samuel; deal4b = Gabriel Milan).
  assert.strictEqual(t.agentFromFlowRule('Pesquisa RH - abertura'), 'Samuel Alencar');
  assert.strictEqual(t.agentFromFlowRule('pesquisa rh msg 2'), 'Samuel Alencar');
  assert.strictEqual(t.agentFromFlowRule('Exp Outbound v3'), 'Samuel Alencar');
  assert.strictEqual(t.agentFromFlowRule('experimento outbound'), 'Samuel Alencar');
  assert.strictEqual(t.agentFromFlowRule('Deal4b follow'), 'Gabriel Milan');
  assert.strictEqual(t.agentFromFlowRule('deal 4b abertura'), 'Gabriel Milan');
  assert.strictEqual(t.agentFromFlowRule('Flow generico'), '');

  // Separadores flexíveis (_ - . espaço) no poll_name real da Treble.
  assert.strictEqual(t.agentFromFlowRule('PESQUISA_RH_CONARH_2026W30_V3_SALESAI2'), 'Samuel Alencar');
  assert.strictEqual(t.agentFromFlowRule('exp_outbound_teste'), 'Samuel Alencar');
  assert.strictEqual(t.agentFromFlowRule('deal_4_b'), 'Gabriel Milan');

  // Apelido no nome do flow (inferência por nome, não regra de negócio).
  assert.strictEqual(t.inferAgentFromFlow('Modelo_24_Andy_RH'), 'Anderson Souza');

  // Precedência: match direto em dim_agents vence a regra de flow.
  const direct = t.sanitizeMessage({
    flow: 'Pesquisa RH', status: 'DELIVERED', delivered_real: 1, replied_real: 0,
    created_day: '2026-07-20', agent_first_name: 'Leticia', agent_last_name: 'Romão'
  });
  assert.strictEqual(direct.agent, 'Leticia Romão');
  assert.strictEqual(direct.agentSource, 'direct');

  // Sem match direto, a regra de flow atribui e marca a fonte flow_rule.
  const bySamuel = t.sanitizeMessage({
    flow: 'Pesquisa RH', status: 'DELIVERED', delivered_real: 1, replied_real: 0, created_day: '2026-07-20'
  });
  assert.strictEqual(bySamuel.agent, 'Samuel Alencar');
  assert.strictEqual(bySamuel.agentSource, 'flow_rule');
  assert.strictEqual(bySamuel.bdrSource, 'Regra de negócio pelo construtor do flow');

  const byGabriele = t.sanitizeMessage({
    flow: 'Deal4b abertura', status: 'DELIVERED', delivered_real: 1, replied_real: 0, created_day: '2026-07-20'
  });
  assert.strictEqual(byGabriele.agent, 'Gabriel Milan');
  assert.strictEqual(byGabriele.agentSource, 'flow_rule');

  // Cobertura de atribuição contabiliza a fonte de regra.
  const agg = t.aggregateMessages([bySamuel, byGabriele, direct]);
  assert.strictEqual(agg.attributionCoverage.rule, 2);
  assert.strictEqual(agg.attributionCoverage.direct, 1);
  assert.strictEqual(agg.attributionCoverage.unknown, 0);
  assert.strictEqual(agg.attributionCoverage.attributedPct, 100);
}

async function main() {
  testDateRanges();
  await testTransportSecurity();
  testSqlContract();
  testStatusAgentAndAggregates();
  testFlowRuleAttribution();
  testPrivacyGuard();
  console.log('[test-bdr-treble-dw] PASS | presets, SQL seguro, agentes, status bruto, regra de flow, agregados e PII');
}

main().catch(function (error) {
  console.error('[test-bdr-treble-dw] FAIL | ' + error.message);
  process.exit(1);
});
