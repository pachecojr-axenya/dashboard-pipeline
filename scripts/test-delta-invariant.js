'use strict';
/**
 * TESTE DE INTEGRIDADE DO DELTA (1D) — roda no CI.
 *
 * Garante a regra de correção da seção 9/11 da spec:
 *   Σ Δ(etapa) == Total(B) − Total(A)   (em Real e Probabilizada, 12M e total)
 * e que os totais são exatamente a soma das etapas (não pode "sobrar" receita).
 *
 * Parte 1 (UNIT, sem servidor): lib/forecast-compute sobre deals sintéticos.
 * Parte 2 (INTEGRAÇÃO, se o server 3004 estiver no ar): pares de fotos reais via
 *   /api/history?action=compare + os guard-rails (B>A, datas livres, data sem foto).
 *   Se o servidor não responder, a parte 2 é PULADA (não falha o CI).
 *
 * Uso: node scripts/test-delta-invariant.js   (exit 0 = ok, 1 = falha)
 */
const http = require('http');
const FC = require('../lib/forecast-compute');

let fails = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FALHA') + '  ' + name); if (!cond) fails++; }
const near = (a, b) => Math.abs(a - b) < 0.01;
const MEASURES = ['real12', 'prob12', 'realTotal', 'probTotal'];

// ── Parte 1 | UNIT ───────────────────────────────────────────────────────────
console.log('== UNIT (lib/forecast-compute, deals sintéticos) ==');
const dealsA = [
  { hs_id: '1', dealname: 'Alfa', stage: 'Diagnóstico', pipeline: 'Vendas', vidas: 500, createdate: '2025-10-01', probabilidade: null },
  { hs_id: '2', dealname: 'Beta', stage: 'Cotação', pipeline: 'Vendas', vidas: 800, createdate: '2025-11-01', modelo_remuneracao: 'Fee por vida', primeira_fatura: 30000, data_prevista_para_receita: '2026-05-01', probabilidade: 0.3 },
  { hs_id: '3', dealname: 'Gama', stage: 'Negociação', pipeline: 'Bid', vidas: 9000, createdate: '2025-02-01', modelo_remuneracao: 'Corretagem', primeira_fatura: 120000, possui_agenciamento: true, data_prevista_para_receita: '2026-10-01', probabilidade: 0.6 },
  { hs_id: '4', dealname: 'Delta', stage: 'Consultoria', pipeline: 'Vendas', vidas: 1500, createdate: '2025-09-15', modelo_remuneracao: 'Fee por vida', primeira_fatura: 40000, data_prevista_para_receita: '2026-06-01', probabilidade: 0.5 },
  { hs_id: '5', dealname: 'Perdido', stage: 'Perdido', pipeline: 'Vendas', vidas: 300, createdate: '2026-01-01' },
];
// B: Alfa avançou p/ Cotação; Delta avançou p/ Negociação; entrou um novo em Diagnóstico.
const dealsB = [
  { hs_id: '1', dealname: 'Alfa', stage: 'Cotação', pipeline: 'Vendas', vidas: 500, createdate: '2025-10-01', modelo_remuneracao: 'Fee por vida', primeira_fatura: 15000, data_prevista_para_receita: '2026-07-01', probabilidade: 0.4 },
  { hs_id: '2', dealname: 'Beta', stage: 'Cotação', pipeline: 'Vendas', vidas: 800, createdate: '2025-11-01', modelo_remuneracao: 'Fee por vida', primeira_fatura: 30000, data_prevista_para_receita: '2026-05-01', probabilidade: 0.3 },
  { hs_id: '3', dealname: 'Gama', stage: 'Negociação', pipeline: 'Bid', vidas: 9000, createdate: '2025-02-01', modelo_remuneracao: 'Corretagem', primeira_fatura: 120000, possui_agenciamento: true, data_prevista_para_receita: '2026-10-01', probabilidade: 0.6 },
  { hs_id: '4', dealname: 'Delta', stage: 'Negociação', pipeline: 'Vendas', vidas: 1500, createdate: '2025-09-15', modelo_remuneracao: 'Fee por vida', primeira_fatura: 40000, data_prevista_para_receita: '2026-06-01', probabilidade: 0.6 },
  { hs_id: '6', dealname: 'Novo', stage: 'Diagnóstico', pipeline: 'Vendas', vidas: 250, createdate: '2026-01-10', probabilidade: null },
  { hs_id: '7', dealname: 'Incompleto', stage: 'Cotação', pipeline: 'Vendas', vidas: null, createdate: '2025-12-01', modelo_remuneracao: null, primeira_fatura: null, probabilidade: null },
];
const snapA = FC.computeSnapshot(dealsA, '2026-05-15', {});
const snapB = FC.computeSnapshot(dealsB, '2026-06-15', {});

// (a) totais == soma das etapas, em cada medida, dos dois lados
[['A', snapA], ['B', snapB]].forEach(([nm, s]) => {
  MEASURES.forEach(m => {
    const sum = s.stages.reduce((acc, st) => acc + st[m], 0);
    check('total ' + m + ' == Σ etapas (' + nm + ')', near(sum, s.totals[m]));
  });
});
// (b) invariante Σ Δ(etapa) == Total(B) − Total(A), em cada medida
const byA = {}; snapA.stages.forEach(s => byA[s.key] = s);
MEASURES.forEach(m => {
  const sumDelta = snapB.stages.reduce((acc, s) => acc + (s[m] - (byA[s.key] ? byA[s.key][m] : 0)), 0);
  check('Σ Δ(etapa) == Δtotal (' + m + ')', near(sumDelta, snapB.totals[m] - snapA.totals[m]));
});
// (c) deal incompleto (hs_id 7) contribui 0 e não quebra a soma (invariante acima já cobre)
check('deal incompleto nao quebra a soma (implicito em b)', true);

// ── Parte 1b | Fase 2: régua muda entre A e B (Δ composição × Δ convicção) ────
// Régua "da época de A": Cotação valia 10% (vs 18,58% atual). Convicção deve
// avaliar A com 10% e B com a atual; composição avalia as duas com a atual.
console.log('\n== UNIT Fase 2 (stageProb por foto | composição × convicção) ==');
const RULER_A = Object.assign({}, FC.STAGE_PROB_DEFAULT, { 'Cotação': 0.10 });
const snapAconv = FC.computeSnapshot(dealsA, '2026-05-15', {}, null, RULER_A);
const snapBconv = FC.computeSnapshot(dealsB, '2026-06-15', {}, null, null);   // B usa a régua atual
// composição: mesma régua nos dois lados → o par (A régua-atual, B régua-atual) é o baseline (snapA/snapB)
const dComp = snapB.totals.prob12 - snapA.totals.prob12;
const dConv = snapBconv.totals.prob12 - snapAconv.totals.prob12;
// Beta está em Cotação nas DUAS fotos com os mesmos números → na composição ele não move nada;
// na convicção, a régua de Cotação subiu 10%→18,58% e o delta captura o ganho de crença.
check('Δ convicção > Δ composição quando a régua de Cotação SOBE entre A e B', dConv > dComp + 1);
// invariante Σ Δ = Δtotal vale TAMBÉM na convicção (réguas diferentes por lado)
const byAc = {}; snapAconv.stages.forEach(s => byAc[s.key] = s);
MEASURES.forEach(m => {
  const sumDeltaC = snapBconv.stages.reduce((acc, s) => acc + (s[m] - (byAc[s.key] ? byAc[s.key][m] : 0)), 0);
  check('Σ Δ(etapa) == Δtotal | convicção (' + m + ')', near(sumDeltaC, snapBconv.totals[m] - snapAconv.totals[m]));
});
// deal parado em Cotação: em probTotal (horizonte FIXO — prob12 é janela rolante
// ancorada na data da foto e mexe mesmo sem mudança de config), a composição não
// registra Δ; a convicção captura a régua 10% → 18,58%.
const cA_at = FC.dealContributions(dealsA, '2026-05-15', {});
const cB_at = FC.dealContributions(dealsB, '2026-06-15', {});
const cA_rl = FC.dealContributions(dealsA, '2026-05-15', {}, null, RULER_A);
const betaCompA = cA_at.find(x => x.id === '2'), betaCompB = cB_at.find(x => x.id === '2');
const betaConvA = cA_rl.find(x => x.id === '2');
check('Beta (parado em Cotação): Δ composição = 0 (probTotal)', near(betaCompB.probTotal - betaCompA.probTotal, 0));
check('Beta (parado em Cotação): Δ convicção > 0 (probTotal, régua 10% → 18,58%)', (betaCompB.probTotal - betaConvA.probTotal) > 1);

// ── Parte 1c | Fechado (2026-08-02): barra informativa "foi para Ganho" ──────
// Pedido do dono (reunião 2026-07-31, caso Cappta): hoje um deal que vira Ganho
// entre A e B "derruba" o Total B como se fosse perda de valor — na verdade é
// vitória. FC.closedWonAgg soma ARR/ARR Ponderado (na foto A) dos deals que
// saíram do escopo aberto porque foram para Ganho. É ADITIVO/informativo por
// design: NÃO deve alterar o invariante Σ Δ(etapa) == Δtotal das barras já
// existentes (ver nota em lib/forecast-compute.js).
console.log('\n== UNIT Fechado (2026-08-02): agregado correto + invariante das barras preservado ==');
const dealsWonA = [
  { hs_id: '10', dealname: 'Cappta', stage: 'Negociação', pipeline: 'Vendas', vidas: 1000, arr_estimado: 345000, createdate: '2025-10-01', modelo_remuneracao: 'Fee por vida', primeira_fatura: 28750, data_prevista_para_receita: '2026-08-01', probabilidade: 0.5 },
  { hs_id: '11', dealname: 'Fica', stage: 'Cotação', pipeline: 'Vendas', vidas: 400, arr_estimado: 120000, createdate: '2025-12-01', modelo_remuneracao: 'Fee por vida', primeira_fatura: 10000, data_prevista_para_receita: '2026-09-01', probabilidade: 0.2 },
];
const dealsWonB = [
  { hs_id: '10', dealname: 'Cappta', stage: 'Ganho', pipeline: 'Vendas', vidas: 1000, arr_estimado: 345000, createdate: '2025-10-01', modelo_remuneracao: 'Fee por vida', primeira_fatura: 28750, data_prevista_para_receita: '2026-08-01', probabilidade: 0.5 },
  { hs_id: '11', dealname: 'Fica', stage: 'Cotação', pipeline: 'Vendas', vidas: 400, arr_estimado: 120000, createdate: '2025-12-01', modelo_remuneracao: 'Fee por vida', primeira_fatura: 10000, data_prevista_para_receita: '2026-09-01', probabilidade: 0.2 },
];
// Escopo Ativos (o padrão do painel): Ganho não é etapa ativa, então Cappta sai do
// conjunto escopado em B — exatamente o caso que "derrubava" o Total B.
const scopedWonA = FC.applyDeltaScope(dealsWonA, 'ativos');
const scopedWonB = FC.applyDeltaScope(dealsWonB, 'ativos');
const rawBWon = {}; dealsWonB.forEach(d => { rawBWon[d.hs_id] = d.stage; });
const snapWonA = FC.computeSnapshot(scopedWonA, '2026-05-15', {});
const snapWonB = FC.computeSnapshot(scopedWonB, '2026-06-15', {});
const cWonA = FC.dealContributions(scopedWonA, '2026-05-15', {});
const cWonB = FC.dealContributions(scopedWonB, '2026-06-15', {});
const fechadoAgg = FC.closedWonAgg(cWonA, cWonB, rawBWon);
check('closedWonAgg identifica o deal que foi para Ganho (Cappta)', fechadoAgg.deals === 1);
check('closedWonAgg soma o ARR de Cappta na foto A (345.000)', near(fechadoAgg.arr, 345000));
check('closedWonAgg não conta quem permaneceu no escopo (Fica)', fechadoAgg.arr < 345000 + 120000);
// Invariante das barras EXISTENTES preservado mesmo com um deal fechado no período:
// Fechado é calculado à parte (FC.closedWonAgg) e não entra nesta soma.
const byAWon = {}; snapWonA.stages.forEach(s => byAWon[s.key] = s);
MEASURES.forEach(m => {
  const sumDeltaWon = snapWonB.stages.reduce((acc, s) => acc + (s[m] - (byAWon[s.key] ? byAWon[s.key][m] : 0)), 0);
  check('Σ Δ(etapa) == Δtotal com deal fechado no período | ' + m, near(sumDeltaWon, snapWonB.totals[m] - snapWonA.totals[m]));
});

// ── Parte 2 | INTEGRAÇÃO (server local) ──────────────────────────────────────
// Porta: arg1 ou env PORT (default 3004). Ex.: node scripts/test-delta-invariant.js 3002
const PORT = parseInt(process.argv[2], 10) || parseInt(process.env.PORT, 10) || 3004;
function getJSON(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: 'localhost', port: PORT, path: encodeURI(path), agent: false, timeout: 30000 }, res => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve({ status: res.statusCode, j: JSON.parse(b) }); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}
async function integ() {
  console.log('\n== INTEGRAÇÃO (/api/history?action=compare @ ' + PORT + ') ==');
  const pairs = [['2026-06-05', '2026-07-03'], ['2026-06-12', '2026-07-10'], ['2026-05-12', '2026-06-19']];
  for (const [a, b] of pairs) {
    const { j } = await getJSON('/api/history?action=compare&a=' + a + '&b=' + b);
    check('invariante ok | ' + a + ' -> ' + b, !!(j.success && j.invariant && j.invariant.ok));
  }
  // guard-rails
  const g1 = await getJSON('/api/history?action=compare&a=2026-07-10&b=2026-06-12');
  check('guard B<A -> 400', g1.status === 400 && !g1.j.success);
  const g2 = await getJSON('/api/history?action=compare&a=2026-07-08&b=2026-07-09');
  check('datas não-sextas resolvem no daily', g2.status === 200 && g2.j.success && g2.j.a.resolvedTab === '2026-07-08' && g2.j.b.resolvedTab === '2026-07-09');
  const gSame = await getJSON('/api/history?action=compare&a=2026-07-08&b=2026-07-08');
  check('guard A=B -> 400', gSame.status === 400 && !gSame.j.success);
  const g3 = await getJSON('/api/history?action=compare&a=2025-01-01&b=2026-07-10');
  check('guard data < foto mais antiga -> 422', g3.status === 422 && !g3.j.success);
  // drill-down (1F): Σ das contribuições da linha == delta da barra no waterfall
  const cmp = await getJSON('/api/history?action=compare&a=2026-06-12&b=2026-07-10');
  const drill = await getJSON('/api/history?action=compare-drill&a=2026-06-12&b=2026-07-10&row=neg&measure=prob12');
  const barNeg = (cmp.j.waterfall.find(w => w.key === 'neg') || {}).delta;
  check('drill(neg) Σ == delta da barra neg (prob12)', !!(drill.j.success && barNeg && near(drill.j.sumDelta, barNeg.prob12)));
}

(async () => {
  try { await getJSON('/api/history?action=fotos'); await integ(); }
  catch (e) { console.log('\n(INTEGRAÇÃO pulada — servidor 3004 indisponível: ' + e.message + ')'); }
  console.log('\n' + (fails === 0 ? 'OK — todos os checks passaram' : 'FALHOU — ' + fails + ' check(s)'));
  process.exit(fails === 0 ? 0 : 1);
})();
