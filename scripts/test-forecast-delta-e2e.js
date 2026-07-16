'use strict';
/**
 * TESTE E2E DO ENDPOINT api/history.js — ZERO-DEPS, ZERO-REDE, ZERO-BQ.
 *
 * Dirige o handler REAL (api/history.js) com o módulo lib/bigquery STUBADO no
 * require.cache: em vez de bater no BigQuery de produção, devolve fotos daily
 * sintéticas em memória. Prova o contrato do serving da Leva 2 sem credenciais:
 *   - action=fotos (weekly) → source bq, lista de fotos;
 *   - action=compare a=2026-07-08 b=2026-07-09 (datas livres, não-sexta) →
 *     resolvedTab exato, invariante ΣΔ==Δtotal, KPIs, stageUnified e quarters;
 *   - action=compare-drill stage:/quarter:/kpi: → deals + saiu/destino/valor;
 *   - guard-rails (B<A → 400, mesma foto → 422).
 *
 * Uso: node scripts/test-forecast-delta-e2e.js   (exit 0 = ok, 1 = falha)
 */
const path = require('path');
process.env.LOCAL_DEV_BYPASS = 'true';   // pula requireAuth no handler

const bqPath = require.resolve('../lib/bigquery');
const { HEADERS } = require('../lib/snapshot-format');
function hidx(name){ const i = HEADERS.indexOf(name); if (i < 0) throw new Error('HEADER ausente: ' + name); return i; }

// Constrói uma linha crua de foto (36 col) a partir de um objeto de deal.
function fotoRow(d){
  const r = new Array(HEADERS.length).fill('');
  r[hidx('Deal ID')] = d.id;
  r[hidx('Deal')] = d.name;
  r[hidx('Pipeline')] = d.pipeline;
  r[hidx('Etapa')] = d.stage;
  r[hidx('Vidas')] = d.vidas != null ? String(d.vidas) : '';
  r[hidx('1ª Fatura (R$)')] = d.pf != null ? String(d.pf) : '';
  r[hidx('ARR Estimado (R$)')] = d.arr != null ? String(d.arr) : '';
  r[hidx('Modelo')] = d.modelo || '';
  r[hidx('Quarter')] = d.quarter || '';
  r[hidx('Data Prevista Receita')] = d.revDate || '';
  r[hidx('Probabilidade (campo)')] = d.prob != null ? String(d.prob) : '';
  r[hidx('Criado')] = d.created || '2025-10-01';   // dentro do cutoff de escopo (>= 2025-09-01)
  r[hidx('Closed Lost')] = d.stage === 'Perdido' ? 'true' : 'false';
  return r;
}
function snapRows(deals){ return [HEADERS.slice()].concat(deals.map(fotoRow)); }

// Fotos daily sintéticas: 08/07 (não-sexta) e 09/07 (não-sexta).
const SNAP = {
  '2026-07-08': snapRows([
    { id: '1', name: 'Alfa', pipeline: 'Vendas', stage: 'Diagnóstico', vidas: 500, arr: 200000, modelo: 'Fee por vida', pf: 20000, revDate: '2026-10-01', quarter: 'Q4 2026', prob: '' },
    { id: '2', name: 'Beta', pipeline: 'Vendas', stage: 'Cotação', vidas: 800, arr: 360000, modelo: 'Fee por vida', pf: 30000, revDate: '2027-01-01', quarter: 'Q1 2027', prob: 0.3 },
    { id: '3', name: 'Gama', pipeline: 'Bid', stage: 'Proposta Enviada', vidas: 9000, arr: 1440000, modelo: 'Corretagem', pf: 120000, quarter: 'Q4 2026', prob: 0.6 },
    { id: '4', name: 'Delta', pipeline: 'Vendas', stage: 'Consultoria', vidas: 1500, arr: 480000, modelo: 'Fee por vida', pf: 40000, revDate: '2026-11-01', quarter: 'Q4 2026', prob: 0.5 },
  ]),
  '2026-07-09': snapRows([
    { id: '1', name: 'Alfa', pipeline: 'Vendas', stage: 'Cotação', vidas: 500, arr: 200000, modelo: 'Fee por vida', pf: 20000, revDate: '2026-10-01', quarter: 'Q4 2026', prob: 0.4 },
    { id: '2', name: 'Beta', pipeline: 'Vendas', stage: 'Perdido', vidas: 800, arr: 360000, modelo: 'Fee por vida', pf: 30000, revDate: '2027-01-01', quarter: 'Q1 2027', prob: 0.3 },
    { id: '3', name: 'Gama', pipeline: 'Bid', stage: 'Proposta Enviada', vidas: 9000, arr: 1440000, modelo: 'Corretagem', pf: 120000, quarter: 'Q4 2026', prob: 0.6 },
    { id: '4', name: 'Delta', pipeline: 'Vendas', stage: 'Negociação', vidas: 1500, arr: 480000, modelo: 'Fee por vida', pf: 40000, revDate: '2026-11-01', quarter: 'Q4 2026', prob: 0.6 },
    { id: '6', name: 'Novo', pipeline: 'Vendas', stage: 'Diagnóstico', vidas: 250, arr: 90000, modelo: 'Fee por vida', pf: 9000, revDate: '2027-02-01', quarter: 'Q1 2027', prob: '' },
  ]),
};
const DAILY_DATES = ['2026-07-09', '2026-07-08'];   // desc
const WEEKLY_DATES = ['2026-07-03', '2026-06-26'];

// Stub do lib/bigquery no require.cache ANTES do handler ser carregado.
const bqStub = {
  TABLE_DAILY: 'forecast_snapshots_daily',
  TABLE_WEEKLY: 'forecast_snapshots_weekly_gold',
  isConfigured: () => true,
  listSnapshotDates: async (table) => (table === 'forecast_snapshots_daily' ? DAILY_DATES : WEEKLY_DATES).map(d => ({ tab: d, tipo: table === 'forecast_snapshots_daily' ? 'diario' : 'semanal', count: (SNAP[d] || [[]]).length - 1 })),
  readSnapshotRows: async (date, table) => SNAP[date] || [],
};
require.cache[bqPath] = { id: bqPath, filename: bqPath, loaded: true, exports: bqStub };

const handler = require('../api/history.js');

let fails = 0;
function check(name, cond, detail){ console.log((cond ? 'PASS' : 'FALHA') + '  ' + name + (detail ? ' | ' + detail : '')); if (!cond) fails++; }
const near = (a, b, eps) => Math.abs(a - b) < (eps == null ? 1 : eps);

// Mock req/res mínimo compatível com o handler.
function call(url){
  return new Promise((resolve) => {
    const req = { method: 'GET', url, headers: {} };
    const res = {
      _status: 200, _json: null,
      setHeader(){}, status(c){ this._status = c; return this; },
      json(o){ this._json = o; resolve({ status: this._status, body: o }); return this; },
      end(){ resolve({ status: this._status, body: null }); return this; },
    };
    Promise.resolve(handler(req, res)).catch(e => resolve({ status: 500, body: { success: false, error: e.message } }));
  });
}

(async () => {
  // action=fotos (weekly listing via stub)
  const fotos = await call('/api/history?action=fotos');
  check('action=fotos source=bq', fotos.body.success && fotos.body.source === 'bq', 'source=' + fotos.body.source);
  check('action=fotos lista fotos', (fotos.body.fotos || []).length === 2, 'n=' + (fotos.body.fotos || []).length);
  check('action=fotos default preserva weekly', fotos.body.cadence === 'weekly' && fotos.body.fotos[0].tab === '2026-07-03');
  const dailyFotos = await call('/api/history?action=fotos&cadence=daily');
  check('action=fotos daily libera datas livres', dailyFotos.body.success && dailyFotos.body.cadence === 'daily' && dailyFotos.body.fotos[0].tab === '2026-07-09');

  // compare 08/07 -> 09/07 (datas livres, não-sexta)
  const cmp = await call('/api/history?action=compare&a=2026-07-08&b=2026-07-09');
  check('compare success', cmp.body.success, 'err=' + cmp.body.error);
  check('resolvedTab exato (não-sexta)', cmp.body.a.resolvedTab === '2026-07-08' && cmp.body.b.resolvedTab === '2026-07-09',
    cmp.body.a && (cmp.body.a.resolvedTab + ' -> ' + cmp.body.b.resolvedTab));
  check('requested ecoado', cmp.body.a.requested === '2026-07-08' && cmp.body.b.requested === '2026-07-09');
  check('invariante ΣΔ == Δtotal', cmp.body.invariant && cmp.body.invariant.ok === true);
  check('KPIs presentes (vidas/arrTotal/arrPond)', cmp.body.a.kpis && cmp.body.a.kpis.vidas != null && cmp.body.a.kpis.arrTotal != null && cmp.body.a.kpis.arrPond != null);

  // agregações aditivas Leva 2
  check('stageUnified presente (funil + Stand by)', Array.isArray(cmp.body.stageUnified) && cmp.body.stageUnified.length === 9, 'n=' + (cmp.body.stageUnified || []).length);
  check('quarters presente', Array.isArray(cmp.body.quarters) && cmp.body.quarters.length >= 1, 'n=' + (cmp.body.quarters || []).length);
  check('quarter do AE no BID preservado', cmp.body.quarters.some(q => q.quarter === 'Q4 2026') && !cmp.body.quarters.some(q => q.quarter === 'Q2 2027'));
  const suSumProb12 = cmp.body.stageUnified.reduce((s, r) => s + r.delta.prob12, 0);
  check('Σ Δ(etapa unificada) == Δtotal prob12', near(suSumProb12, cmp.body.totals.b.prob12 - cmp.body.totals.a.prob12), Math.round(suSumProb12));
  const qArrTotB = cmp.body.quarters.reduce((s, r) => s + r.b.arr, 0);
  check('Σ ARR total por quarter (B) == KPI arrTotal (B)', near(qArrTotB, cmp.body.b.kpis.arrTotal), Math.round(qArrTotB) + ' vs ' + Math.round(cmp.body.b.kpis.arrTotal));

  // drill stage:
  const dStage = await call('/api/history?action=compare-drill&a=2026-07-08&b=2026-07-09&row=' + encodeURIComponent('stage:Cotação') + '&measure=prob12');
  check('drill stage:Cotação success', dStage.body.success && Array.isArray(dStage.body.deals), 'n=' + ((dStage.body.deals || []).length));

  // drill quarter:
  const dQ = await call('/api/history?action=compare-drill&a=2026-07-08&b=2026-07-09&row=' + encodeURIComponent('quarter:Q4 2026') + '&measure=prob12&field=arr');
  check('drill quarter:Q4 2026 success', dQ.body.success && Array.isArray(dQ.body.deals), 'n=' + ((dQ.body.deals || []).length));
  check('drill quarter usa ARR selecionado', dQ.body.field === 'arr' && dQ.body.deals.some(x => x.aCash > 0 || x.bCash > 0), 'field=' + dQ.body.field);

  // drill kpi:vidas → Beta SAIU (foi p/ Perdido), destino + valor
  const dKpi = await call('/api/history?action=compare-drill&a=2026-07-08&b=2026-07-09&row=kpi:vidas&measure=prob12');
  check('drill kpi:vidas field=vidas', dKpi.body.success && dKpi.body.field === 'vidas', 'field=' + dKpi.body.field);
  const beta = (dKpi.body.deals || []).find(x => x.id === '2');
  check('Beta SAIU com destino Perdido', beta && beta.tipo === 'saiu' && beta.stageB === 'Perdido', beta && (beta.tipo + '/' + beta.stageB));
  check('Beta SAIU traz valor (vidas A=800)', beta && beta.aCash === 800, beta && ('aCash=' + beta.aCash));

  // guard-rails
  const g1 = await call('/api/history?action=compare&a=2026-07-09&b=2026-07-08');
  check('guard B<A -> 400', g1.status === 400 && !g1.body.success);
  const g2 = await call('/api/history?action=compare&a=2026-07-08&b=2026-07-08');
  check('guard mesma data -> 400/422', (g2.status === 400 || g2.status === 422) && !g2.body.success, 'status=' + g2.status);

  console.log('\n' + (fails === 0 ? 'OK — E2E do endpoint (Leva 2) passou' : 'FALHOU — ' + fails + ' check(s)'));
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('ERRO:', e.stack || e.message); process.exit(1); });
