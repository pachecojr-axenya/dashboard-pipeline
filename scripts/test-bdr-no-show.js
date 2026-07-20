'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const context = {
  console,
  window: {},
  document: { addEventListener() {}, getElementById() { return null; }, documentElement: { getAttribute() { return 'dark'; }, setAttribute() {} } },
  localStorage: { getItem() { return null; }, setItem() {} },
  setTimeout,
  clearTimeout,
  Date,
  Math,
  Array,
  Object,
  String,
  Number,
  RegExp,
};
context.window.window = context.window;
context.window.document = context.document;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'public', 'semantic-ref.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'public', 'bdr-no-show.js'), 'utf8'), context);
const T = context.window.NoShowBDR._test;

function deal(overrides) {
  return Object.assign({
    hs_id: '1',
    dealname: 'Conta teste',
    data_reuniao_agendada: '2026-01-05',
    reuniao_ocorreu: null,
    stage: 'Reunião Agendada',
    stage_entered: {},
    sdr: 'Anderson Souza',
    ae: 'André Pontes',
    origem: 'Outbound',
  }, overrides || {});
}

assert.strictEqual(T.bdrRoster().length, 13, 'roster canônico deve ter 13 BDRs');
assert.strictEqual(T.canonicalBdrName('Gabriele de Almeida Silva'), 'Gabriele Almeida');
assert.strictEqual(T.canonicalBdrName('Bruna Cristina Dos Reis Silva'), 'Bruna Reis');
assert.strictEqual(T.canonicalBdrName('André Pontes'), null, 'AE não pode virar BDR');

const outside = T.normalizeDeal(deal({ reuniao_ocorreu: 'Não' }));
const lost = T.normalizeDeal(deal({ hs_id: '2', reuniao_ocorreu: 'Não', stage: 'Perdido', lost_reason: 'No-show' }));
const recovered = T.normalizeDeal(deal({ hs_id: '3', reuniao_ocorreu: 'Não', stage: 'Diagnóstico' }));
const rescheduled = T.normalizeDeal(deal({ hs_id: '4', reuniao_ocorreu: 'Não', dealname: 'Conta reagendada' }));
const pending = T.normalizeDeal(deal({ hs_id: '5', reuniao_ocorreu: null }));
const executive = T.normalizeDeal(deal({ hs_id: '6', sdr: 'André Pontes', ae: 'André Pontes' }));

assert.strictEqual(outside.openNoShow, true);
assert.strictEqual(outside.outsideSla, true);
assert.strictEqual(lost.outsideSla, false, 'perdido não entra no SLA operacional');
assert.strictEqual(recovered.outsideSla, false, 'recuperado não entra no SLA operacional');
assert.strictEqual(rescheduled.outsideSla, false, 'reagendado não entra no SLA operacional');
assert.strictEqual(executive.isCanonicalBdr, false, 'AE fora do roster deve ser excluído');

const metrics = T.metrics([outside, lost, recovered, pending]);
assert.strictEqual(metrics.knownOutcomes, 3);
assert.strictEqual(metrics.noShows, 3);
assert.strictEqual(metrics.noShowRate, 1);
assert.strictEqual(metrics.openNoShows, 1);
assert.strictEqual(metrics.outsideSla, 1);

const rank = T.rankRows([outside, lost, recovered, pending], 'bdr', 'outside');
assert.strictEqual(rank.length, 1);
assert.strictEqual(rank[0].outside, 1);
assert.strictEqual(rank[0].open, 1);

const weekly = T.weeklyRateData([
  { week: '2026-S01', knownOutcome: true, noShow: true },
  { week: '2026-S01', knownOutcome: true, noShow: false },
], ['2026-S01', '2026-S02']);
assert.strictEqual(weekly[0].rate, 0.5);
assert.strictEqual(weekly[1].rate, null, 'semana sem desfecho deve ser lacuna, não 0%');

assert.strictEqual(T.rateAxisMax([1]), 1, 'eixo percentual não pode ultrapassar 100%');
assert.ok(T.rateAxisMax([0.2]) >= 0.2 && T.rateAxisMax([0.2]) <= 1);

const chart = T.generateRateSvg([outside, lost, recovered, pending], 'bdr');
assert.ok(!chart.svg.includes('130%'), 'eixo não pode exibir 130%');
assert.strictEqual(chart.linesData.length, 13, 'todos os BDRs do roster devem permanecer na legenda');
assert.ok(chart.linesData.every(line => T.bdrRoster().includes(line.name)), 'gráfico BDR só usa roster canônico');

console.log('OK | bdr-no-show: 19 checks de domínio e visual passaram');
