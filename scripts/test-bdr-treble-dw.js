'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const endpoint = require('../api/bdr-treble-dw');
const t = endpoint._test;

function loadFrontendHelpers() {
  const root = path.join(__dirname, '..');
  const context = {
    console,
    window: {},
    document: {
      addEventListener() {},
      getElementById() { return null; }
    },
    localStorage: { getItem() { return null; }, setItem() {} },
    fetch: async function () { return { ok: true, json: async function () { return {}; } }; },
    setTimeout,
    clearTimeout,
    Date,
    Math,
    Array,
    Object,
    String,
    Number,
    RegExp,
    Intl
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.addEventListener = function () {};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'public', 'bdr-treble.js'), 'utf8'), context);
  return context.window.BdrTreble._test;
}

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

function testFreshnessCurrentVsHistoricalRange() {
  const todayStr = t.resolveDateRange({ preset: 'today' }).from;

  const currentRange = { from: todayStr, to: todayStr };
  assert.strictEqual(t.periodIncludesToday(currentRange), true, 'range que inclui hoje deve ser detectado como corrente');

  const historicalRange = { from: '2020-01-01', to: '2020-01-05' };
  assert.strictEqual(t.periodIncludesToday(historicalRange), false, 'range puramente histórico não deve ser detectado como corrente');
}

function testStaleEmptyCurrent() {
  const todayStr = t.resolveDateRange({ preset: 'today' }).from;
  const currentRange = { from: todayStr, to: todayStr };

  assert.strictEqual(
    t.computeDwStale(currentRange, 0, null),
    true,
    'período corrente sem nenhuma linha deve ficar stale'
  );
}

function testStaleOver180Minutes() {
  const todayStr = t.resolveDateRange({ preset: 'today' }).from;
  const currentRange = { from: todayStr, to: todayStr };

  assert.strictEqual(
    t.computeDwStale(currentRange, 1, t.STALE_THRESHOLD_MINUTES + 1),
    true,
    'período corrente com última linha > 180min deve ficar stale'
  );

  assert.strictEqual(
    t.computeDwStale(currentRange, 1, t.STALE_THRESHOLD_MINUTES),
    false,
    'exatamente no limiar (180min) ainda não deve ficar stale'
  );
}

function testHistoricalOldNotStale() {
  const historicalRange = { from: '2020-01-01', to: '2020-01-05' };

  assert.strictEqual(
    t.computeDwStale(historicalRange, 0, null),
    false,
    'período histórico sem linhas não fica stale por idade'
  );

  assert.strictEqual(
    t.computeDwStale(historicalRange, 1, 999999),
    false,
    'período histórico com última linha muito antiga não fica stale por idade'
  );
}

function testShouldCachePayloadBackend() {
  const todayStr = t.resolveDateRange({ preset: 'today' }).from;
  const currentRange = { from: todayStr, to: todayStr };
  const historicalRange = { from: '2020-01-01', to: '2020-01-05' };

  assert.strictEqual(
    t.shouldCachePayload({ dwStale: true, rowsReturned: 3 }, currentRange),
    false,
    'payload corrente stale não deve cachear mesmo com linhas'
  );

  assert.strictEqual(
    t.shouldCachePayload({ dwStale: false, rowsReturned: 0 }, currentRange),
    false,
    'payload corrente vazio (rowsReturned 0) não deve cachear mesmo sem flag stale'
  );

  assert.strictEqual(
    t.shouldCachePayload({ dwStale: false, rowsReturned: 5 }, currentRange),
    true,
    'payload corrente saudável (não stale, com linhas) deve cachear'
  );

  assert.strictEqual(
    t.shouldCachePayload({ dwStale: true, rowsReturned: 0 }, historicalRange),
    true,
    'payload de range histórico deve cachear mesmo marcado stale/vazio (stale só se aplica a período corrente)'
  );

  assert.strictEqual(
    t.shouldCachePayload(null, currentRange),
    false,
    'payload ausente nunca deve cachear'
  );
}

function testRecomputeFreshness() {
  const todayStr = t.resolveDateRange({ preset: 'today' }).from;
  const currentRange = { from: todayStr, to: todayStr };

  const writeTime = new Date(todayStr + 'T12:00:00.000Z').getTime();
  const latestEventAt = new Date(writeTime - 175 * 60000).toISOString();
  const payloadAtWrite = { latestEventAt, rowsReturned: 1, dwStale: false };

  const recomputedAtWrite = t.recomputeFreshness(payloadAtWrite, currentRange, writeTime);
  assert.strictEqual(recomputedAtWrite.freshnessAgeMinutes, 175, 'recomputeFreshness deve recalcular a idade exata em minutos no momento da escrita');
  assert.strictEqual(recomputedAtWrite.dwStale, false, 'payload com 175min (abaixo do limiar) ainda não deve ficar stale no momento da escrita');

  const readTimeCrossedThreshold = writeTime + 10 * 60000;
  const recomputedAtRead = t.recomputeFreshness(payloadAtWrite, currentRange, readTimeCrossedThreshold);
  assert.strictEqual(recomputedAtRead.freshnessAgeMinutes, 185, 'recomputeFreshness deve recalcular com o relógio da leitura, não o da escrita');
  assert.strictEqual(recomputedAtRead.dwStale, true, 'payload que cruzou 180min entre escrita e leitura deve ficar stale na recomputação');

  assert.strictEqual(t.recomputeFreshness(null, currentRange, writeTime), null, 'recomputeFreshness de payload nulo deve retornar nulo sem lançar');

  const untouched = Object.assign({}, payloadAtWrite);
  t.recomputeFreshness(payloadAtWrite, currentRange, readTimeCrossedThreshold);
  assert.deepStrictEqual(payloadAtWrite, untouched, 'recomputeFreshness não deve mutar o payload original (retorna novo objeto)');
}

function testCacheCrossesThresholdAndInvalidatesOnRead() {
  const todayStr = t.resolveDateRange({ preset: 'today' }).from;
  const currentRange = { from: todayStr, to: todayStr };
  const key = t.cacheKey(currentRange);

  t.resetCache();

  const writeTime = new Date(todayStr + 'T12:00:00.000Z').getTime();
  const latestEventAt = new Date(writeTime - 175 * 60000).toISOString();
  const freshPayload = { success: true, latestEventAt, rowsReturned: 4, dwStale: false, freshnessAgeMinutes: 175 };

  t.setCache(key, freshPayload, writeTime);

  const readBeforeThreshold = t.getFromCache(key, currentRange, writeTime + 2 * 60000);
  assert.ok(readBeforeThreshold, 'leitura dentro do TTL e antes de cruzar 180min deve servir o payload cacheado');
  assert.strictEqual(readBeforeThreshold.dwStale, false, 'antes de cruzar o limiar o payload servido não deve estar stale');

  const readAfterCrossingThreshold = t.getFromCache(key, currentRange, writeTime + 10 * 60000);
  assert.strictEqual(readAfterCrossingThreshold, null, 'leitura após a idade do evento cruzar 180min (mesmo dentro do TTL de cache) deve invalidar e retornar null');

  const readAgainAfterInvalidation = t.getFromCache(key, currentRange, writeTime + 11 * 60000);
  assert.strictEqual(readAgainAfterInvalidation, null, 'entrada invalidada não deve ressurgir em leitura subsequente (delete efetivo do cacheByKey)');

  t.resetCache();

  const emptyPayload = { success: true, latestEventAt: null, rowsReturned: 0, dwStale: true, freshnessAgeMinutes: null };
  t.setCache(key, emptyPayload, writeTime);
  const readEmptyStillStale = t.getFromCache(key, currentRange, writeTime + 1000);
  assert.strictEqual(readEmptyStillStale, null, 'payload vazio/stale escrito diretamente no cache (bypass de shouldCachePayload) deve ser invalidado na leitura');

  t.resetCache();

  const ttlExpired = t.getFromCache(key, currentRange, writeTime + 11 * 60 * 1000);
  assert.strictEqual(ttlExpired, null, 'cache vazio após resetCache deve retornar null');
}

function testFrontendShouldFallbackDwPayload() {
  const T = loadFrontendHelpers();

  assert.strictEqual(
    T.shouldFallbackDwPayload({ dwStale: true, rowsReturned: 5 }),
    true,
    'dwStale===true deve acionar fallback mesmo com linhas'
  );

  assert.strictEqual(
    T.shouldFallbackDwPayload({ dwStale: false, rowsReturned: 0 }),
    false,
    'histórico vazio sem flag stale (dwStale false) não deve acionar fallback só por payload vazio'
  );

  assert.strictEqual(
    T.shouldFallbackDwPayload({ rowsReturned: 0 }),
    false,
    'ausência de dwStale (undefined) não deve acionar fallback'
  );

  assert.strictEqual(
    T.shouldFallbackDwPayload(null),
    false,
    'payload nulo não deve acionar fallback'
  );
}

function testFrontendIsNoFallbackStatus() {
  const T = loadFrontendHelpers();

  [400, 401, 403].forEach(function (status) {
    assert.strictEqual(T.isNoFallbackStatus(status), true, 'status ' + status + ' deve bloquear fallback (erro de cliente/auth)');
  });

  [500, 0].forEach(function (status) {
    assert.strictEqual(T.isNoFallbackStatus(status), false, 'status ' + status + ' não deve bloquear fallback (erro de servidor/rede)');
  });
}

function testFrontendMajoritySourcePicksFlowRule() {
  const T = loadFrontendHelpers();

  const rows = { direct: 1, rule: 5, inferred: 2, unknown: 0 };
  assert.strictEqual(T.majoritySource(rows), 'flow_rule', 'quando a contagem de flow_rule é a maior, majoritySource deve retornar flow_rule');

  const tieBrokenByDirect = { direct: 5, rule: 1, inferred: 0, unknown: 0 };
  assert.strictEqual(T.majoritySource(tieBrokenByDirect), 'direct', 'quando direct é a maior contagem, majoritySource deve retornar direct');
}

function testFrontendFallbackAndStaleNotesNotEmpty() {
  const T = loadFrontendHelpers();

  const fallbackNote = T.buildFallbackNote({ latestEventAt: '2026-07-20T10:00:00-03:00', freshnessAgeMinutes: 5 });
  assert.ok(typeof fallbackNote === 'string' && fallbackNote.trim().length > 0, 'buildFallbackNote não deve retornar string vazia');
  assert.ok(fallbackNote.includes('Fallback REST'), 'buildFallbackNote deve identificar a fonte de contingência');

  const fallbackNoteMinimal = T.buildFallbackNote(null);
  assert.ok(typeof fallbackNoteMinimal === 'string' && fallbackNoteMinimal.trim().length > 0, 'buildFallbackNote sem dados extras ainda deve retornar aviso não vazio');

  const staleNote = T.buildStaleNote({ latestEventAt: '2026-07-20T10:00:00-03:00', freshnessAgeMinutes: 200 });
  assert.ok(typeof staleNote === 'string' && staleNote.trim().length > 0, 'buildStaleNote não deve retornar string vazia');
  assert.ok(staleNote.includes('Data Warehouse'), 'buildStaleNote deve mencionar o Data Warehouse');

  const staleNoteMinimal = T.buildStaleNote(null);
  assert.ok(typeof staleNoteMinimal === 'string' && staleNoteMinimal.trim().length > 0, 'buildStaleNote sem dados extras ainda deve retornar aviso não vazio');
}

function testFrontendNormalizeRestRowsPreservesCount() {
  const T = loadFrontendHelpers();

  const input = {
    messages: [
      { flow: 'Flow A', pollId: '1', createdAt: '2026-07-20T10:00:00-03:00', delivered: true, replied: false },
      { flow: 'Flow B', pollId: '2', createdAt: '2026-07-20T11:00:00-03:00', delivered: false, replied: false, nonDeliveryReason: 'FAILURE' },
      { flow: 'Flow C', pollId: '3', createdAt: '2026-07-20T12:00:00-03:00', delivered: true, replied: true },
      { flow: 'Flow A', pollId: '4', createdAt: '2026-07-20T13:00:00-03:00', delivered: false, replied: false }
    ]
  };

  const output = T.normalizeRestRows(input);

  assert.strictEqual(output.length, input.messages.length, 'normalizeRestRows não pode mesclar nem descartar linhas: quantidade deve ser preservada');

  const inputPollIds = input.messages.map(function (m) { return m.pollId; });
  const outputPollIds = output.map(function (m) { return m.pollId; });
  assert.deepStrictEqual(outputPollIds, inputPollIds, 'normalizeRestRows deve preservar a ordem e a identidade de cada linha (1:1), sem merge por flow duplicado');

  const emptyOutput = T.normalizeRestRows({ messages: [] });
  assert.strictEqual(emptyOutput.length, 0, 'entrada vazia deve produzir saída vazia, sem inventar linhas');

  const noMessagesKey = T.normalizeRestRows({});
  assert.strictEqual(noMessagesKey.length, 0, 'ausência de messages não deve quebrar nem inventar linhas');
}

function testFrontendEmptyStateShowsGlobalNoteWhenDwStaleAndFallbackEmpty() {
  const T = loadFrontendHelpers();

  const dwStaleFallbackEmptyRaw = {
    success: true,
    dwStale: true,
    rowsReturned: 0,
    fallbackNote: 'Aviso: Data Warehouse sem dados novos ou vazio no período e o fallback REST veio vazio ou falhou; exibindo o último payload do Data Warehouse.'
  };

  const emptyState = T.composeEmptyState(dwStaleFallbackEmptyRaw, true);

  assert.strictEqual(emptyState.type, 'empty', 'estado vazio com DW stale + fallback vazio deve permanecer type=empty');
  assert.ok(
    emptyState.noteHtml && emptyState.noteHtml.length > 0,
    'quando DW está stale/vazio e o fallback veio vazio ou falhou, o aviso global (noteHtml) deve ser composto junto do empty state, não descartado'
  );
  assert.ok(
    emptyState.noteHtml.indexOf('Aviso: Data Warehouse sem dados novos') !== -1,
    'noteHtml do empty state deve conter o texto exato do fallbackNote de stale, não um texto genérico'
  );
  assert.ok(emptyState.noteHtml.indexOf('note') !== -1, 'noteHtml deve usar a classe .note para renderizar no wrapper visual correto');

  const dwHealthyEmptyRaw = { success: true, dwStale: false, rowsReturned: 0 };
  const emptyStateNoFallback = T.composeEmptyState(dwHealthyEmptyRaw, true);
  assert.strictEqual(
    emptyStateNoFallback.noteHtml,
    '',
    'empty state de período historicamente vazio (sem fallbackNote, dwMode true) não deve inventar aviso'
  );

  const restFallbackModeEmptyRaw = { success: true, source: 'treble_rest_fallback' };
  const emptyStateRestMode = T.composeEmptyState(restFallbackModeEmptyRaw, false);
  assert.ok(
    emptyStateRestMode.noteHtml.indexOf('Fallback REST') !== -1,
    'empty state em modo REST fallback (dwMode=false) deve mostrar o aviso de fallback REST mesmo sem fallbackNote explícito'
  );
}

async function main() {
  testDateRanges();
  await testTransportSecurity();
  testSqlContract();
  testStatusAgentAndAggregates();
  testFlowRuleAttribution();
  testPrivacyGuard();
  testFreshnessCurrentVsHistoricalRange();
  testStaleEmptyCurrent();
  testStaleOver180Minutes();
  testHistoricalOldNotStale();
  testShouldCachePayloadBackend();
  testRecomputeFreshness();
  testCacheCrossesThresholdAndInvalidatesOnRead();
  testFrontendShouldFallbackDwPayload();
  testFrontendIsNoFallbackStatus();
  testFrontendMajoritySourcePicksFlowRule();
  testFrontendFallbackAndStaleNotesNotEmpty();
  testFrontendNormalizeRestRowsPreservesCount();
  testFrontendEmptyStateShowsGlobalNoteWhenDwStaleAndFallbackEmpty();
  console.log('[test-bdr-treble-dw] PASS | presets, SQL seguro, agentes, status bruto, regra de flow, agregados, PII, freshness/stale, cache backend (shouldCachePayload, recomputeFreshness, getFromCache/setCache/resetCache cruzando 180min), fallback frontend (shouldFallbackDwPayload, isNoFallbackStatus), helpers de frontend (majoritySource, fallback/stale notes, normalizeRestRows) e composição do empty state com aviso global (composeEmptyState)');
}

main().catch(function (error) {
  console.error('[test-bdr-treble-dw] FAIL | ' + error.message);
  process.exit(1);
});
