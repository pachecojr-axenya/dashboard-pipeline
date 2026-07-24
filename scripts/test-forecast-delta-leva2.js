'use strict';
/**
 * TESTE ZERO-DEPS DA LEVA 2 DO FORECAST DELTA.
 *
 * Exercita as agregações aditivas de lib/forecast-compute.js SEM servidor, BQ ou
 * rede — deals sintéticos direto no motor canônico (mesma fonte de receita do
 * waterfall, Regra primária nº 3). Cobre os itens da Auris (Leva 2):
 *   - dealContributions carrega vidas/arr/arrPond/quarter (contrato aditivo);
 *   - stageUnified: deals + vidas + receita real/ponderada por etapa, com delta;
 *   - quarterAgg: ARR total + ponderado por quarter, com delta;
 *   - drillGeneric: stage:/quarter:/kpi: classificam Novo/Permaneceu/Saiu e, para
 *     "saiu", trazem o destino final (etapa bruta em B) e o valor;
 *   - invariante ΣΔ(etapa) == Δtotal preservada nas novas agregações.
 *
 * Uso: node scripts/test-forecast-delta-leva2.js   (exit 0 = ok, 1 = falha)
 */
const FC = require('../lib/forecast-compute');

let fails = 0;
function check(name, cond, detail) { console.log((cond ? 'PASS' : 'FALHA') + '  ' + name + (detail ? ' | ' + detail : '')); if (!cond) fails++; }
const near = (a, b, eps) => Math.abs(a - b) < (eps == null ? 0.01 : eps);

// Foto A (antes): 5 deals no funil de Vendas/Bid + 1 perdido (fora de escopo).
const dealsA = [
  { hs_id: '1', dealname: 'Alfa', stage: 'Diagnóstico', pipeline: 'Vendas', vidas: 500, arr_estimado: 200000, quarter: 'Q4 2026', createdate: '2025-10-01', modelo_remuneracao: 'Fee por vida', primeira_fatura: 20000, data_prevista_para_receita: '2026-10-01', probabilidade: null },
  { hs_id: '2', dealname: 'Beta', stage: 'Cotação', pipeline: 'Vendas', vidas: 800, arr_estimado: 360000, quarter: 'Q1 2027', createdate: '2025-11-01', modelo_remuneracao: 'Fee por vida', primeira_fatura: 30000, data_prevista_para_receita: '2027-01-01', probabilidade: 0.3 },
  { hs_id: '3', dealname: 'Gama', stage: 'Proposta Enviada', pipeline: 'Bid', vidas: 9000, arr_estimado: 1440000, quarter: 'Q4 2026', createdate: '2025-02-01', modelo_remuneracao: 'Corretagem', primeira_fatura: 120000, possui_agenciamento: true, probabilidade: 0.6 },
  { hs_id: '4', dealname: 'Delta', stage: 'Consultoria', pipeline: 'Vendas', vidas: 1500, arr_estimado: 480000, quarter: 'Q4 2026', createdate: '2025-09-15', modelo_remuneracao: 'Fee por vida', primeira_fatura: 40000, data_prevista_para_receita: '2026-11-01', probabilidade: 0.5 },
  { hs_id: '5', dealname: 'Perdido', stage: 'Perdido', pipeline: 'Vendas', vidas: 300, arr_estimado: 100000, createdate: '2026-01-01' },
];
// Foto B (depois): Alfa avança p/ Cotação; Delta avança p/ Negociação; Beta SAIU
// (foi p/ Perdido em B — destino final); entra Novo em Diagnóstico.
const dealsB = [
  { hs_id: '1', dealname: 'Alfa', stage: 'Cotação', pipeline: 'Vendas', vidas: 500, arr_estimado: 200000, quarter: 'Q4 2026', createdate: '2025-10-01', modelo_remuneracao: 'Fee por vida', primeira_fatura: 20000, data_prevista_para_receita: '2026-10-01', probabilidade: 0.4 },
  { hs_id: '2', dealname: 'Beta', stage: 'Perdido', pipeline: 'Vendas', vidas: 800, arr_estimado: 360000, quarter: 'Q1 2027', createdate: '2025-11-01', modelo_remuneracao: 'Fee por vida', primeira_fatura: 30000, data_prevista_para_receita: '2027-01-01', probabilidade: 0.3 },
  { hs_id: '3', dealname: 'Gama', stage: 'Proposta Enviada', pipeline: 'Bid', vidas: 9000, arr_estimado: 1440000, quarter: 'Q4 2026', createdate: '2025-02-01', modelo_remuneracao: 'Corretagem', primeira_fatura: 120000, possui_agenciamento: true, probabilidade: 0.6 },
  { hs_id: '4', dealname: 'Delta', stage: 'Negociação', pipeline: 'Vendas', vidas: 1500, arr_estimado: 480000, quarter: 'Q4 2026', createdate: '2025-09-15', modelo_remuneracao: 'Fee por vida', primeira_fatura: 40000, data_prevista_para_receita: '2026-11-01', probabilidade: 0.6 },
  { hs_id: '6', dealname: 'Novo', stage: 'Diagnóstico', pipeline: 'Vendas', vidas: 250, arr_estimado: 90000, quarter: 'Q1 2027', createdate: '2026-01-10', modelo_remuneracao: 'Fee por vida', primeira_fatura: 9000, data_prevista_para_receita: '2027-02-01', probabilidade: null },
];

const refA = '2026-05-15', refB = '2026-06-15';
const snapA = FC.computeSnapshot(dealsA, refA, {});
const snapB = FC.computeSnapshot(dealsB, refB, {});
const cA = FC.dealContributions(dealsA, refA, {});
const cB = FC.dealContributions(dealsB, refB, {});

// ── 1. dealContributions carrega os campos aditivos ──────────────────────────
console.log('== dealContributions (campos aditivos) ==');
const alfaB = cB.find(x => x.id === '1');
check('vidas presente por deal', alfaB && alfaB.vidas === 500, 'vidas=' + (alfaB && alfaB.vidas));
check('arr presente por deal', alfaB && alfaB.arr === 200000, 'arr=' + (alfaB && alfaB.arr));
check('arrPond presente e <= arr', alfaB && alfaB.arrPond >= 0 && alfaB.arrPond <= alfaB.arr, 'arrPond=' + (alfaB && Math.round(alfaB.arrPond)));
check('quarter presente por deal', alfaB && alfaB.quarter === 'Q4 2026', 'quarter=' + (alfaB && alfaB.quarter));
const gamaB = cB.find(x => x.id === '3');
check('quarter do AE no BID não é sobrescrito pela régua fixa', gamaB && gamaB.quarter === 'Q4 2026', 'quarter=' + (gamaB && gamaB.quarter));

// ── 2. stageUnified: soma por etapa, delta, invariante de receita ────────────
console.log('\n== stageUnified (tabela por etapa) ==');
const su = FC.stageUnified(cA, cB);
const suMap = {}; su.forEach(r => suMap[r.stage] = r);
check('etapa unificada cobre funil + Stand by', su.length === 9, 'n=' + su.length);
// Alfa saiu de Diagnóstico(A) e entrou em Cotação(B); Novo entrou em Diagnóstico(B).
check('Diagnóstico deals A=1 (Alfa)', suMap['Diagnóstico'].a.deals === 1, 'A=' + suMap['Diagnóstico'].a.deals);
check('Diagnóstico deals B=1 (Novo)', suMap['Diagnóstico'].b.deals === 1, 'B=' + suMap['Diagnóstico'].b.deals);
check('Cotação deals B>=1 (Alfa entrou)', suMap['Cotação'].b.deals >= 1, 'B=' + suMap['Cotação'].b.deals);
// ΣΔ(etapa) da tabela unificada em prob12 == Δtotal do snapshot (mesma fonte)
const suSumProb12 = su.reduce((s, r) => s + r.delta.prob12, 0);
check('Σ Δ(etapa unificada, prob12) == Δtotal', near(suSumProb12, snapB.totals.prob12 - snapA.totals.prob12, 1), 'ΣΔ=' + Math.round(suSumProb12) + ' vs ' + Math.round(snapB.totals.prob12 - snapA.totals.prob12));
const suSumVidasB = su.reduce((s, r) => s + r.b.deals, 0);
check('Σ deals por etapa (B) == KPI deals (B)', suSumVidasB === snapB.kpis.deals, suSumVidasB + ' vs ' + snapB.kpis.deals);

// ── 3. quarterAgg: ARR total + ponderado por quarter, delta ──────────────────
console.log('\n== quarterAgg (ARR por quarter) ==');
const qa = FC.quarterAgg(cA, cB);
const qMap = {}; qa.forEach(r => qMap[r.quarter] = r);
check('quarters ordenados começam em Q4 2026', qa[0].quarter === 'Q4 2026', 'primeiro=' + qa[0].quarter);
// Σ ARR total por quarter (B) == ARR total do KPI (B)
const qArrTotB = qa.reduce((s, r) => s + r.b.arr, 0);
check('Σ ARR total por quarter (B) == KPI arrTotal (B)', near(qArrTotB, snapB.kpis.arrTotal, 1), Math.round(qArrTotB) + ' vs ' + Math.round(snapB.kpis.arrTotal));
const qArrPondB = qa.reduce((s, r) => s + r.b.arrPond, 0);
check('Σ ARR ponderado por quarter (B) == KPI arrPond (B)', near(qArrPondB, snapB.kpis.arrPond, 1), Math.round(qArrPondB) + ' vs ' + Math.round(snapB.kpis.arrPond));
// delta de deals no Q4 2026: Beta saiu de Q1 2027, mas Delta permanece Q4 → checar coerência básica
check('quarter delta.arr coerente (B-A)', near(qMap['Q4 2026'].delta.arr, qMap['Q4 2026'].b.arr - qMap['Q4 2026'].a.arr), '');

// ── 4. drillGeneric | stage: ─────────────────────────────────────────────────
console.log('\n== drillGeneric (stage / quarter / kpi + saiu/destino/valor) ==');
const rawBStage = {}; dealsB.forEach(d => { rawBStage[d.hs_id] = (String(d['Closed Lost']||'').toLowerCase()==='true'||d.stage==='Perdido') ? 'Perdido' : d.stage; });
const dCot = FC.drillGeneric(cA, cB, 'stage:Cotação', 'prob12', rawBStage);
check('drill stage:Cotação retorna deals', Array.isArray(dCot.deals) && dCot.deals.length >= 1, 'n=' + dCot.deals.length);
const alfaRow = dCot.deals.find(x => x.id === '1');
check('drill stage: Alfa é NOVO em Cotação (veio de Diagnóstico)', alfaRow && alfaRow.tipo === 'novo', 'tipo=' + (alfaRow && alfaRow.tipo));
// Sair da etapa por AVANÇO ≠ sair por perda (2026-07-24): Alfa saiu de Diagnóstico
// rumo a Cotação (posterior) → tipo 'avancou', com o destino preservado.
const dDiag = FC.drillGeneric(cA, cB, 'stage:Diagnóstico', 'prob12', rawBStage);
const alfaDiag = dDiag.deals.find(x => x.id === '1');
check('drill stage: Alfa AVANÇOU de Diagnóstico (não é "saiu")', alfaDiag && alfaDiag.tipo === 'avancou', 'tipo=' + (alfaDiag && alfaDiag.tipo));
check('AVANÇOU traz destino (Cotação)', alfaDiag && alfaDiag.stageB === 'Cotação', 'destino=' + (alfaDiag && alfaDiag.stageB));

// ── 5. drillGeneric | quarter: ───────────────────────────────────────────────
const dQ = FC.drillGeneric(cA, cB, 'quarter:Q4 2026', 'prob12', rawBStage);
check('drill quarter:Q4 2026 retorna deals', Array.isArray(dQ.deals) && dQ.deals.length >= 1, 'n=' + dQ.deals.length);
const dQArr = FC.drillGeneric(cA, cB, 'quarter:Q4 2026', 'prob12', rawBStage, 'arr');
check('drill quarter respeita campo ARR selecionado', dQArr.field === 'arr' && dQArr.deals.some(x => x.aCash > 0 || x.bCash > 0), 'field=' + dQArr.field);

// ── 6. drillGeneric | kpi:vidas com SAIU + destino final + valor ─────────────
const dVidas = FC.drillGeneric(cA, cB, 'kpi:vidas', 'prob12', rawBStage);
check('drill kpi:vidas usa field=vidas', dVidas.field === 'vidas', 'field=' + dVidas.field);
const betaRow = dVidas.deals.find(x => x.id === '2');
check('Beta classificado como SAIU (foi p/ Perdido)', betaRow && betaRow.tipo === 'saiu', 'tipo=' + (betaRow && betaRow.tipo));
check('SAIU traz destino final (Perdido)', betaRow && betaRow.stageB === 'Perdido', 'destino=' + (betaRow && betaRow.stageB));
check('SAIU traz valor (aCash vidas de Beta=800)', betaRow && betaRow.aCash === 800, 'aCash=' + (betaRow && betaRow.aCash));

const dArrTot = FC.drillGeneric(cA, cB, 'kpi:arrTotal', 'prob12', rawBStage);
check('drill kpi:arrTotal usa field=arr', dArrTot.field === 'arr', 'field=' + dArrTot.field);
const dArrPond = FC.drillGeneric(cA, cB, 'kpi:arrPond', 'prob12', rawBStage);
check('drill kpi:arrPond usa field=arrPond', dArrPond.field === 'arrPond', 'field=' + dArrPond.field);

// ── 7. drillGeneric compat com rowKey do waterfall ───────────────────────────
const dRow = FC.drillGeneric(cA, cB, 'neg', 'prob12', rawBStage);
const dRowLegacy = FC.drillRow(cA, cB, 'neg', 'prob12', rawBStage);
check('drillGeneric(neg) sumDelta == drillRow(neg) sumDelta', near(dRow.sumDelta, dRowLegacy.sumDelta), Math.round(dRow.sumDelta) + ' vs ' + Math.round(dRowLegacy.sumDelta));

console.log('\n' + (fails === 0 ? 'OK — todos os checks da Leva 2 passaram' : 'FALHOU — ' + fails + ' check(s)'));
process.exit(fails === 0 ? 0 : 1);
