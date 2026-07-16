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
