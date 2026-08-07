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

// Frescor é do warehouse inteiro, nunca do recorte: um período sem linhas não
// pode ser lido como dado velho — era essa confusão que trocava a fonte do
// filtro "Hoje" por 30 dias de REST.
function testWarehouseStaleIsIndependentOfPeriod() {
  assert.strictEqual(
    t.computeWarehouseStale(t.STALE_THRESHOLD_MINUTES + 1),
    true,
    'warehouse com último evento acima de 180min deve ficar stale'
  );

  assert.strictEqual(
    t.computeWarehouseStale(t.STALE_THRESHOLD_MINUTES),
    false,
    'exatamente no limiar (180min) ainda não deve ficar stale'
  );

  assert.strictEqual(
    t.computeWarehouseStale(null),
    true,
    'warehouse sem nenhum evento deve ser tratado como stale'
  );

  assert.strictEqual(
    t.computeWarehouseHardStale(t.STALE_HARD_THRESHOLD_MINUTES + 1),
    true,
    'acima de 24h o warehouse deve escalar para hardStale'
  );

  assert.strictEqual(
    t.computeWarehouseHardStale(t.STALE_THRESHOLD_MINUTES + 1),
    false,
    'entre 3h e 24h é stale mas ainda não é hardStale'
  );
}

function testWarehouseStateBlockShape() {
  const now = Date.parse('2026-08-07T17:00:00.000Z');
  const state = t.buildWarehouseState('2026-08-05T16:53:54-03:00', now);

  assert.strictEqual(state.latestEventDay, '2026-08-05', 'dia do último evento deve sair em BRT');
  assert.strictEqual(state.stale, true, 'evento de 2 dias atrás deve marcar stale');
  assert.strictEqual(state.hardStale, true, 'evento de 2 dias atrás deve marcar hardStale');
  assert.ok(state.ageMinutes > 2000, 'idade em minutos deve refletir a distância real até agora');

  const semEvento = t.buildWarehouseState(null, now);
  assert.strictEqual(semEvento.latestEventAt, null, 'warehouse sem evento não deve inventar timestamp');
  assert.strictEqual(semEvento.stale, true, 'warehouse sem evento é stale');
}

function testFreshnessSqlHasNoPeriodFilter() {
  const sql = t.buildFreshnessSql();
  assert.ok(/max\(f\.timestamps_eta\)/.test(sql), 'SQL de frescor deve usar max(timestamps_eta)');
  assert.ok(!/WHERE/i.test(sql), 'SQL de frescor não pode ter WHERE: o frescor é da fato inteira, não do recorte');
  assert.ok(!/cellphone|country_code|deployment_id|batch_id|treble_id|origin_id/i.test(sql), 'SQL de frescor não pode tocar coluna sensível');
}

function testShouldCachePayloadBackend() {
  const todayStr = t.resolveDateRange({ preset: 'today' }).from;
  const currentRange = { from: todayStr, to: todayStr };
  const historicalRange = { from: '2020-01-01', to: '2020-01-05' };

  assert.strictEqual(
    t.shouldCachePayload({ rowsReturned: 0 }, currentRange),
    false,
    'período corrente vazio não deve cachear: a próxima linha pode chegar a qualquer momento'
  );

  assert.strictEqual(
    t.shouldCachePayload({ rowsReturned: 5 }, currentRange),
    true,
    'período corrente com linhas deve cachear'
  );

  assert.strictEqual(
    t.shouldCachePayload({ rowsReturned: 5, warehouse: { stale: true } }, currentRange),
    true,
    'warehouse stale NÃO pode impedir cache: staleness virou aviso, não invalidação de dado real'
  );

  assert.strictEqual(
    t.shouldCachePayload({ rowsReturned: 0 }, historicalRange),
    true,
    'período histórico vazio deve cachear: o vazio dele é definitivo'
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
  const payloadAtWrite = {
    latestEventAt,
    rowsReturned: 1,
    warehouse: t.buildWarehouseState(latestEventAt, writeTime)
  };

  const recomputedAtWrite = t.recomputeFreshness(payloadAtWrite, currentRange, writeTime);
  assert.strictEqual(recomputedAtWrite.freshnessAgeMinutes, 175, 'recomputeFreshness deve recalcular a idade exata em minutos no momento da escrita');
  assert.strictEqual(recomputedAtWrite.warehouse.stale, false, 'warehouse com 175min ainda não deve estar stale no momento da escrita');

  const readTimeCrossedThreshold = writeTime + 10 * 60000;
  const recomputedAtRead = t.recomputeFreshness(payloadAtWrite, currentRange, readTimeCrossedThreshold);
  assert.strictEqual(recomputedAtRead.freshnessAgeMinutes, 185, 'recomputeFreshness deve recalcular com o relógio da leitura, não o da escrita');
  assert.strictEqual(recomputedAtRead.warehouse.stale, true, 'warehouse que cruzou 180min entre escrita e leitura deve virar stale na recomputação');

  assert.strictEqual(t.recomputeFreshness(null, currentRange, writeTime), null, 'recomputeFreshness de payload nulo deve retornar nulo sem lançar');

  const untouched = JSON.parse(JSON.stringify(payloadAtWrite));
  t.recomputeFreshness(payloadAtWrite, currentRange, readTimeCrossedThreshold);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(payloadAtWrite)), untouched, 'recomputeFreshness não deve mutar o payload original (retorna novo objeto)');
}

function testCacheServesStaleWarehouseWithFlagRefreshed() {
  const todayStr = t.resolveDateRange({ preset: 'today' }).from;
  const currentRange = { from: todayStr, to: todayStr };
  const key = t.cacheKey(currentRange);

  t.resetCache();

  const writeTime = new Date(todayStr + 'T12:00:00.000Z').getTime();
  const latestEventAt = new Date(writeTime - 175 * 60000).toISOString();
  const freshPayload = {
    success: true,
    latestEventAt,
    rowsReturned: 4,
    warehouse: t.buildWarehouseState(latestEventAt, writeTime)
  };

  t.setCache(key, freshPayload, writeTime);

  const readBeforeThreshold = t.getFromCache(key, currentRange, writeTime + 2 * 60000);
  assert.ok(readBeforeThreshold, 'leitura dentro do TTL deve servir o payload cacheado');
  assert.strictEqual(readBeforeThreshold.warehouse.stale, false, 'antes de cruzar o limiar o warehouse servido não deve estar stale');

  // Contraste com o comportamento antigo: cruzar 180min NÃO joga o payload fora.
  // O dado do período continua válido; só o selo de frescor muda.
  const readAfterCrossingThreshold = t.getFromCache(key, currentRange, writeTime + 10 * 60000);
  assert.ok(readAfterCrossingThreshold, 'payload com linhas reais deve continuar sendo servido depois de cruzar 180min');
  assert.strictEqual(readAfterCrossingThreshold.rowsReturned, 4, 'as linhas do período não podem ser descartadas por staleness do warehouse');
  assert.strictEqual(readAfterCrossingThreshold.warehouse.stale, true, 'o selo de frescor deve acompanhar o relógio da leitura');

  t.resetCache();

  const emptyPayload = { success: true, latestEventAt: null, rowsReturned: 0, warehouse: t.buildWarehouseState(null, writeTime) };
  t.setCache(key, emptyPayload, writeTime);
  const readEmpty = t.getFromCache(key, currentRange, writeTime + 1000);
  assert.strictEqual(readEmpty, null, 'período corrente vazio escrito direto no cache deve ser invalidado na leitura');

  t.resetCache();

  const ttlExpired = t.getFromCache(key, currentRange, writeTime + 11 * 60 * 1000);
  assert.strictEqual(ttlExpired, null, 'cache vazio após resetCache deve retornar null');
}

// Regressão do defeito relatado: com "Hoje" selecionado e zero linhas, a tela
// tem de continuar no warehouse mostrando zero, nunca puxar 30 dias de REST.
function testFrontendKeepsDwWhenPeriodIsEmpty() {
  const T = loadFrontendHelpers();

  assert.strictEqual(
    typeof T.shouldFallbackDwPayload,
    'undefined',
    'gatilho de fallback por payload stale/vazio precisa ter sido removido do frontend'
  );

  const range = T.resolveClientRange({ preset: 'today' });
  const emptyState = T.composeEmptyState({ success: true, rowsReturned: 0 }, true, range, []);

  assert.ok(
    emptyState.title.indexOf('Hoje') !== -1,
    'empty state de período corrente deve nomear o período selecionado, não um genérico "sem dados"'
  );
  assert.ok(
    /zero é a resposta do período/i.test(emptyState.text),
    'empty state deve afirmar que zero é a resposta do período, não sugerir troca de fonte'
  );
}

function testFrontendClientRangeMirrorsBackend() {
  const T = loadFrontendHelpers();

  const today = T.resolveClientRange({ preset: 'today' });
  assert.strictEqual(today.from, today.to, 'preset today deve ter from === to');
  assert.strictEqual(today.label, 'Hoje');
  assert.strictEqual(T.fallbackDaysForRange(today), 1, 'fallback de "Hoje" deve pedir 1 dia, não 30');

  const yesterday = T.resolveClientRange({ preset: 'yesterday' });
  assert.strictEqual(yesterday.from, yesterday.to, 'preset yesterday deve ter from === to');
  assert.strictEqual(T.shiftIso(today.from, -1), yesterday.from, 'ontem deve ser hoje menos um dia');
  assert.strictEqual(T.fallbackDaysForRange(yesterday), 2, 'fallback de "Ontem" precisa de janela de 2 dias e recorte no cliente');

  const sevenDays = T.resolveClientRange({ preset: '7d' });
  assert.strictEqual(sevenDays.to, today.from, '7d deve terminar hoje');
  assert.strictEqual(T.fallbackDaysForRange(sevenDays), 7, 'fallback de 7d deve pedir 7 dias');

  const custom = T.resolveClientRange({ preset: 'custom', from: '2026-07-01', to: '2026-07-03' });
  assert.strictEqual(custom.from, '2026-07-01');
  assert.strictEqual(custom.to, '2026-07-03');
}

function testFrontendClipsRestRowsToSelectedRange() {
  const T = loadFrontendHelpers();
  const range = { from: '2026-08-03', to: '2026-08-04', label: 'teste' };

  const clipped = T.clipRowsToRange([
    { createdDay: '2026-08-02' },
    { createdDay: '2026-08-03' },
    { createdDay: '2026-08-04' },
    { createdDay: '2026-08-05' },
    { createdDay: '' }
  ], range);

  assert.strictEqual(clipped.length, 2, 'fallback REST tem de ser recortado ao período escolhido, não devolver a janela inteira');
  assert.strictEqual(clipped[0].createdDay, '2026-08-03');
  assert.strictEqual(clipped[1].createdDay, '2026-08-04');
}

// O <select> some com o valor órfão (nenhuma option casa => browser mostra
// "Todos"), mas o filtro continuava ativo e zerava a tela sem causa visível.
function testFrontendPrunesGhostFilters() {
  const T = loadFrontendHelpers();
  const st = T._state;

  st.filters.agent = 'Fantasma Que Nao Existe';
  st.filters.flow = 'flow_existente';
  st.filters.status = '';

  const dropped = T.pruneGhostFilters([
    { agent: 'Gabriele Almeida', flow: 'flow_existente', statusLabel: 'Entregue' }
  ]);

  assert.strictEqual(st.filters.agent, '', 'agente inexistente no conjunto carregado deve ser descartado');
  assert.strictEqual(st.filters.flow, 'flow_existente', 'filtro que ainda existe no conjunto deve ser preservado');
  assert.strictEqual(dropped.length, 1, 'o descarte precisa ser reportado, não silencioso');
  assert.ok(/Fantasma/.test(dropped[0]), 'o aviso deve nomear o valor descartado');

  const note = T.buildDroppedFilterNoteHtml(dropped);
  assert.ok(note.indexOf('Fantasma') !== -1, 'a nota renderizada deve mostrar o filtro descartado ao usuário');
  assert.strictEqual(T.buildDroppedFilterNoteHtml([]), '', 'sem descarte não deve haver nota');

  st.filters.flow = '';
}

function testFrontendFreshnessNoteSeparatesEmptyFromStale() {
  const T = loadFrontendHelpers();

  const hard = T.buildFreshnessNoteHtml({
    warehouse: { latestEventAt: '2026-08-05T16:53:54-03:00', ageMinutes: 2800, stale: true, hardStale: true }
  });
  assert.ok(/05\/08\/2026 16:53/.test(hard), 'aviso duro deve cravar a data e hora do último evento ingerido');
  assert.ok(/note warn/.test(hard), 'aviso de ingestão parada deve usar o estilo de alerta');

  const soft = T.buildFreshnessNoteHtml({
    warehouse: { latestEventAt: '2026-08-07T09:00:00-03:00', ageMinutes: 240, stale: true, hardStale: false }
  });
  assert.ok(!/note warn/.test(soft), 'entre 3h e 24h o aviso é informativo, não alerta');
  assert.ok(/07\/08\/2026 09:00/.test(soft), 'aviso informativo também deve mostrar o último evento');

  assert.strictEqual(T.buildFreshnessNoteHtml({}), '', 'payload sem bloco warehouse não deve inventar selo de frescor');

  assert.strictEqual(T.humanAge(45), '45 min');
  assert.strictEqual(T.humanAge(240), '4h');
  assert.strictEqual(T.humanAge(2880), '2 dias');
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

function testFrontendFallbackNoteNamesPeriodAndContract() {
  const T = loadFrontendHelpers();

  const fallbackNote = T.buildFallbackNote({ label: 'Hoje', from: '2026-08-07', to: '2026-08-07' });
  assert.ok(typeof fallbackNote === 'string' && fallbackNote.trim().length > 0, 'buildFallbackNote não deve retornar string vazia');
  assert.ok(fallbackNote.indexOf('Hoje') !== -1, 'o aviso de fallback deve nomear o período que está sendo exibido');
  assert.ok(/sess(õ|o)es materializadas/i.test(fallbackNote), 'o aviso deve dizer que o contrato de métrica muda no REST');
  assert.ok(!/30 dias/.test(fallbackNote), 'o fallback não pode mais anunciar 30 dias fixos');

  const fallbackNoteMinimal = T.buildFallbackNote(null);
  assert.ok(typeof fallbackNoteMinimal === 'string' && fallbackNoteMinimal.trim().length > 0, 'buildFallbackNote sem range ainda deve retornar aviso não vazio');

  assert.strictEqual(typeof T.buildStaleNote, 'undefined', 'buildStaleNote pertencia ao fallback por staleness e deve ter sido removido');
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

function testFrontendEmptyStateDistinguishesCauses() {
  const T = loadFrontendHelpers();
  const range = { label: 'Hoje', from: '2026-08-07', to: '2026-08-07' };

  // Período vazio com warehouse parado: a tela precisa dizer as duas coisas —
  // zero no período E ingestão velha — sem misturar uma com a outra.
  const staleWarehouseRaw = {
    success: true,
    rowsReturned: 0,
    warehouse: { latestEventAt: '2026-08-05T16:53:54-03:00', ageMinutes: 2800, stale: true, hardStale: true }
  };
  const emptyStale = T.composeEmptyState(staleWarehouseRaw, true, range, []);
  assert.strictEqual(emptyStale.type, 'empty');
  assert.ok(emptyStale.title.indexOf('Hoje') !== -1, 'título deve nomear o período');
  assert.ok(/05\/08\/2026/.test(emptyStale.noteHtml), 'o empty state deve carregar o selo de frescor com a data do último evento ingerido');

  // Warehouse saudável e período historicamente vazio: nada de alarme.
  const healthyRaw = {
    success: true,
    rowsReturned: 0,
    warehouse: { latestEventAt: '2026-08-07T13:00:00-03:00', ageMinutes: 30, stale: false, hardStale: false }
  };
  const emptyHealthy = T.composeEmptyState(healthyRaw, true, range, []);
  assert.ok(!/note warn/.test(emptyHealthy.noteHtml), 'warehouse fresco não pode gerar alerta no empty state');

  // Vazio causado por filtro de campo tem título e ação diferentes.
  const emptyByFilter = T.composeEmptyState(healthyRaw, true, range, ['Agente: Gabriele Almeida']);
  assert.ok(/filtros aplicados/i.test(emptyByFilter.title), 'vazio por filtro deve ter título próprio, distinto de período sem disparo');
  assert.ok(emptyByFilter.text.indexOf('Gabriele Almeida') !== -1, 'vazio por filtro deve listar os filtros ativos');

  const restFallbackModeEmptyRaw = { success: true, source: 'treble_rest_fallback' };
  const emptyStateRestMode = T.composeEmptyState(restFallbackModeEmptyRaw, false, range, []);
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
  testWarehouseStaleIsIndependentOfPeriod();
  testWarehouseStateBlockShape();
  testFreshnessSqlHasNoPeriodFilter();
  testShouldCachePayloadBackend();
  testRecomputeFreshness();
  testCacheServesStaleWarehouseWithFlagRefreshed();
  testFrontendKeepsDwWhenPeriodIsEmpty();
  testFrontendClientRangeMirrorsBackend();
  testFrontendClipsRestRowsToSelectedRange();
  testFrontendPrunesGhostFilters();
  testFrontendFreshnessNoteSeparatesEmptyFromStale();
  testFrontendIsNoFallbackStatus();
  testFrontendMajoritySourcePicksFlowRule();
  testFrontendFallbackNoteNamesPeriodAndContract();
  testFrontendNormalizeRestRowsPreservesCount();
  testFrontendEmptyStateDistinguishesCauses();
  console.log('[test-bdr-treble-dw] PASS | presets, SQL seguro, agentes, status bruto, regra de flow, agregados, PII, frescor do warehouse independente do recorte (computeWarehouseStale/buildWarehouseState/buildFreshnessSql), cache backend, período vazio NÃO troca de fonte, range do cliente espelha o backend, recorte do fallback REST, poda de filtros órfãos, selo de frescor e empty state por causa');
}

main().catch(function (error) {
  console.error('[test-bdr-treble-dw] FAIL | ' + error.message);
  process.exit(1);
});
