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

assert.strictEqual(T.currentBdrRoster().length, 13, 'roster canônico deve permanecer com 13 BDRs');
assert.strictEqual(T.bdrRoster().length, 14, 'escopo local No-Show deve incluir Gabriel histórico além do roster canônico');
assert.strictEqual(T.canonicalBdrName('Gabriele de Almeida Silva'), 'Gabriele Almeida');
assert.strictEqual(T.canonicalBdrName('Bruna Cristina Dos Reis Silva'), 'Bruna Reis');
assert.strictEqual(T.canonicalBdrName('André Pontes'), null, 'AE não pode virar BDR via sdr');
assert.strictEqual(T.canonicalBdrName('Gabriel Milan Ramos'), 'Gabriel Milan Ramos', 'Gabriel deve entrar no escopo BDR histórico local');
assert.ok(T.bdrDisplayName('Gabriel Milan Ramos').includes('Histórico | inativo'), 'Gabriel deve ser rotulado como histórico/inativo');

const outside = T.normalizeDeal(deal({ reuniao_ocorreu: 'Não' }));
const lost = T.normalizeDeal(deal({ hs_id: '2', reuniao_ocorreu: 'Não', stage: 'Perdido', lost_reason: 'No-show' }));
const recovered = T.normalizeDeal(deal({ hs_id: '3', reuniao_ocorreu: 'Não', stage: 'Diagnóstico' }));
const rescheduled = T.normalizeDeal(deal({ hs_id: '4', reuniao_ocorreu: 'Não', dealname: 'Conta reagendada' }));
const pending = T.normalizeDeal(deal({ hs_id: '5', reuniao_ocorreu: null }));
const executive = T.normalizeDeal(deal({ hs_id: '6', sdr: 'André Pontes', ae: 'André Pontes' }));
const gabriel = T.normalizeDeal(deal({ hs_id: '7', sdr: 'Gabriel Milan Ramos', ae: 'Sem AE', reuniao_ocorreu: 'Não' }));
const missingSdr = T.normalizeDeal(deal({ hs_id: '8', sdr: '', ae: '', reuniao_ocorreu: 'Não' }));
const outOfScopeSdr = T.normalizeDeal(deal({ hs_id: '9', sdr: 'Pessoa Fora Roster', ae: 'Carolina AE', reuniao_ocorreu: 'Não' }));

assert.strictEqual(outside.openNoShow, true);
assert.strictEqual(outside.outsideSla, true);
assert.strictEqual(lost.outsideSla, false, 'perdido não entra no SLA operacional');
assert.strictEqual(recovered.outsideSla, false, 'recuperado não entra no SLA operacional');
assert.strictEqual(rescheduled.outsideSla, false, 'reagendado não entra no SLA operacional');
assert.strictEqual(executive.isCanonicalBdr, false, 'AE fora do roster não pode ser classificado como BDR');
assert.strictEqual(gabriel.isCanonicalBdr, true, 'Gabriel histórico entra como BDR atribuível');
assert.strictEqual(gabriel.isHistoricalBdr, true, 'Gabriel deve estar marcado como histórico');
assert.strictEqual(missingSdr.isCanonicalBdr, false, 'registro sem sdr não é atribuível a BDR');
assert.strictEqual(missingSdr.hasSdr, false, 'registro sem sdr deve ser identificado dinamicamente');
assert.strictEqual(missingSdr.ae, 'Sem AE', 'AE vazio deve cair no bucket Sem AE');
assert.strictEqual(outOfScopeSdr.isCanonicalBdr, false, 'sdr fora do roster/histórico não é atribuível a BDR');

const globalRows = [outside, lost, recovered, pending, gabriel, missingSdr, outOfScopeSdr];
const bdrOnlyRows = T.bdrRows(globalRows);
assert.strictEqual(globalRows.length, 7, 'universo global preserva todos os registros filtrados');
assert.strictEqual(bdrOnlyRows.length, 5, 'universo BDR exclui sem sdr e sdr fora do escopo');
assert.ok(bdrOnlyRows.includes(gabriel), 'universo BDR inclui Gabriel histórico');
assert.ok(globalRows.includes(missingSdr), 'registro sem sdr permanece no global');
assert.ok(!bdrOnlyRows.includes(missingSdr), 'registro sem sdr não entra no BDR');
assert.ok(!bdrOnlyRows.includes(outOfScopeSdr), 'sdr fora do escopo BDR não entra no BDR');

const rec = T.reconciliation(globalRows);
assert.strictEqual(rec.total, 7);
assert.strictEqual(rec.attributed, 5);
assert.strictEqual(rec.missingSdr, 1);
assert.strictEqual(rec.outsideBdrScope, 1);
const recHtml = T.renderReconciliation(globalRows);
assert.ok(recHtml.includes('Total global: 7'));
assert.ok(recHtml.includes('atribuíveis a BDR: 5'));
assert.ok(recHtml.includes('sem sdr: 1'));
assert.ok(recHtml.includes('sdr fora do escopo BDR: 1'));
assert.ok(recHtml.includes('A taxa global usa todas as reuniões; cortes por BDR usam apenas reuniões atribuíveis. Dados faltantes podem alterar as taxas por responsável, mas não somem da taxa global.'));

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

const chartBdr = T.generateRateSvg(globalRows, 'bdr');
assert.ok(!chartBdr.svg.includes('130%'), 'eixo não pode exibir 130%');
assert.strictEqual(chartBdr.linesData.length, 14, 'todos os BDRs do escopo local devem permanecer na legenda');
assert.ok(chartBdr.linesData.every(line => T.bdrRoster().includes(line.name)), 'gráfico BDR só usa roster atual + histórico local');
assert.ok(chartBdr.linesData.some(line => line.name === 'Gabriel Milan Ramos' && line.label.includes('Histórico | inativo')), 'legenda BDR rotula Gabriel como histórico');
assert.ok(!chartBdr.linesData.some(line => line.name === 'Pessoa Fora Roster'), 'gráfico BDR exclui sdr fora do escopo');

const chartAe = T.generateRateSvg(globalRows, 'ae');
assert.ok(chartAe.linesData.some(line => line.name === 'Sem AE'), 'Por AE deve incluir bucket Sem AE');
assert.ok(chartAe.linesData.some(line => line.name === 'Carolina AE'), 'Por AE deve incluir AE de registro com sdr fora do escopo');
assert.ok(chartAe.linesData.some(line => line.name === 'André Pontes'), 'Por AE deve incluir registros atribuíveis a BDR e não atribuíveis');
const aeTotal = chartAe.linesData.reduce((sum, line) => sum + line.total, 0);
assert.strictEqual(aeTotal, globalRows.length, 'Por AE usa o universo global inteiro');

// ---------------------------------------------------------------------------
// REAGENDAMENTO | campo HubSpot data_do_reagendamento_com_o_executivo (24/08/2026).
// Contrato: a régua é o CAMPO, nunca o texto do deal. Antes desta data o KPI
// "Reagendadas" lia texto e exibia 0 contra 140 registros reais no CRM.
// ---------------------------------------------------------------------------
const REA = '2026-01-20';

// 1. O campo dirige o KPI, e o texto sozinho não conta como reagendamento estruturado.
const reaField = T.normalizeDeal(deal({ hs_id: '20', reuniao_ocorreu: 'Não', data_reagendamento_exec: REA }));
const reaTextOnly = T.normalizeDeal(deal({ hs_id: '21', reuniao_ocorreu: 'Não', dealname: 'Conta reagendada' }));
assert.strictEqual(reaField.rescheduled, true, 'campo de reagendamento preenchido deve marcar rescheduled');
assert.strictEqual(reaField.reaIso, REA, 'data do reagendamento deve chegar normalizada ao registro');
assert.strictEqual(reaField.reaGap, 15, 'gap deve ser a distância em dias contra a reunião original');
assert.strictEqual(reaTextOnly.rescheduled, false, 'texto do deal NÃO pode ser contado como reagendamento estruturado');
assert.strictEqual(reaTextOnly.reaTextOnly, true, 'texto do deal deve ficar registrado como evidência secundária');
assert.ok(reaField.reaSource.includes('Campo HubSpot'), 'fonte do reagendamento deve ser rastreável na UI');

// 2. DECISÃO DO DONO: reagendou + a reunião ocorreu = sai do numerador da incidência.
const reaResolvido = T.normalizeDeal(deal({ hs_id: '22', reuniao_ocorreu: 'Não', stage: 'Diagnóstico', data_reagendamento_exec: REA }));
assert.strictEqual(reaResolvido.reaResolved, true);
assert.strictEqual(reaResolvido.noShow, false, 'reunião movida que ocorreu não é falta do BDR');
assert.strictEqual(reaResolvido.status, 'Reagendada | realizada', 'status precisa dizer o que aconteceu, não "Recuperado"');
assert.strictEqual(reaResolvido.recovered, false, 'não pode contar como recuperado quem nunca entrou como no-show');

// 3. Reagendou e a reunião NUNCA aconteceu continua sendo no-show — mover data não absolve.
const reaFaltou = T.normalizeDeal(deal({ hs_id: '23', reuniao_ocorreu: 'Não', stage: 'Perdido', lost_reason: 'No-show', data_reagendamento_exec: REA }));
assert.strictEqual(reaFaltou.noShow, true, 'reagendamento sem desfecho positivo permanece no-show');
assert.strictEqual(reaFaltou.reaResolved, false);

// 4. Contradição campo × funil: avançou de etapa mas o campo segue Não.
assert.strictEqual(reaResolvido.reaContradiction, true, 'avanço de funil com campo Não é contradição a sinalizar');
assert.strictEqual(reaField.reaContradiction, false, 'sem avanço de funil não há contradição');

// 5. Reagendamento vencido: data passou, campo não virou Sim, deal não avançou.
assert.strictEqual(reaField.reaOverdue, true, 'data remarcada no passado sem desfecho deve entrar na fila');
assert.strictEqual(reaField.reaOverdueOpen, true, 'deal fora de Perdido é fila viva');
assert.strictEqual(reaFaltou.reaOverdueOpen, false, 'deal em Perdido não infla a fila acionável');
assert.strictEqual(reaResolvido.reaOverdue, false, 'reunião que ocorreu não é reagendamento vencido');
const reaFuturo = T.normalizeDeal(deal({ hs_id: '24', reuniao_ocorreu: null, data_reagendamento_exec: '2099-01-01' }));
assert.strictEqual(reaFuturo.reaOverdue, false, 'reagendamento no futuro não está vencido');

// 6. Métricas: o KPI conta o campo em TODO o universo, não só dentro dos no-shows.
const reaMetrics = T.metrics([reaField, reaTextOnly, reaResolvido, reaFaltou, reaFuturo]);
assert.strictEqual(reaMetrics.rescheduled, 4, 'Reagendadas conta os 4 com campo preenchido');
assert.strictEqual(reaMetrics.rescheduledTextOnly, 1, 'evidência textual é reportada em separado');
assert.strictEqual(reaMetrics.rescheduledResolved, 1);
assert.strictEqual(reaMetrics.reaContradictions, 1);
assert.strictEqual(reaMetrics.reaOverdue, 2);
assert.strictEqual(reaMetrics.reaOverdueOpen, 1);
assert.strictEqual(reaMetrics.withRea, 4);
assert.strictEqual(reaMetrics.withoutRea, 1);
assert.strictEqual(reaMetrics.reaLost, 1, 'só o deal em Perdido conta como perdido no grupo com reagendamento');
assert.strictEqual(reaMetrics.reaGapMedian, 15);

console.log('OK | bdr-no-show: checks de domínio, escopo global/BDR/AE, reagendamento e visual passaram');
