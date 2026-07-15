'use strict';
/**
 * forecast-compute.js — cálculo do Forecast Overall no servidor (Node), sobre uma
 * FOTO histórica. Reúsa as fontes únicas do browser (forecast-engine, revenue-engine,
 * faturamento-manual, forecast-overall-core), então o número reproduz o painel ao vivo
 * por construção (Regra primária nº 3). Usado pelo api/history.js?action=compare.
 *
 * Ponto-no-tempo: recebe referenceDate (a data da foto) e a injeta na ForecastEngine,
 * de modo que a projeção é ancorada naquela data (correção do Gap 1, sub-fase 1A).
 * Caveat conhecido (Fase 1): faturamento manual e probabilidades do funil NÃO são
 * snapshotados — usa-se o estado atual (probabilidades: STAGE_PROB_DEFAULT).
 */
const engMod = require('../public/forecast-engine.js');
const revMod = require('../public/revenue-engine.js');
const fmMod = require('../public/faturamento-manual.js');
const coreMod = require('../public/forecast-overall-core.js');
const FE = engMod.ForecastEngine;
const FaturamentoManual = fmMod.FaturamentoManual;
const OverallCore = coreMod.OverallCore;
const calcReceitaMes = revMod.calcReceitaMes;
engMod.FaturamentoManual = FaturamentoManual;   // dealMonthly lê root.FaturamentoManual

const MONTH_LABELS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const MONTHS = [];
for (let y = 2026; y <= 2027; y++) for (let mo = 0; mo < 12; mo++) MONTHS.push({ y, mo, label: MONTH_LABELS[mo] + ' ' + y, key: y * 100 + mo });

const STAGE_PROB_DEFAULT = { 'Reunião Agendada': 0.06, 'Cotação': 0.185790008, 'Proposta Enviada': 0.285, 'Consultoria': 0.284954, 'Negociação': 0.493, 'Implantação': 0.8, 'Ganho': 1.0, 'Standby': 0.12, 'Diagnóstico': 0.06 };

function getVpv(v) { return !v || v <= 200 ? 36 : v <= 4999 ? 24 : 12; }
function parseRevenueDate(s) { if (!s) return null; const m = String(s).match(/^(\d{4})-(\d{2})/); return m ? { y: +m[1], mo: +m[2] - 1 } : null; }
function addMonths(rs, n) { if (!rs) return null; const t = rs.mo + n; return { y: rs.y + Math.floor(t / 12), mo: ((t % 12) + 12) % 12 }; }
function calcReceita(n, deal) { const r = calcReceitaMes(n, deal); return r ? r.total : null; }

// ── Mapeador foto (35 colunas cruas) → shape de deal do forecast-table ──────
function _num(v) { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; }
function _int(v) { if (v == null || v === '') return null; const n = parseInt(v, 10); return isNaN(n) ? null : n; }
function _d10(v) { return v ? String(v).substring(0, 10) : null; }
function _prob(v) { const n = parseFloat(v); if (isNaN(n) || n < 0) return null; return n > 1 ? n / 100 : n; }
function _bool(v) { const s = (v == null ? '' : v).toString().trim().toLowerCase(); if (s === 'true' || s === 'sim' || s === 'yes') return true; if (s === 'false' || s === 'não' || s === 'nao' || s === 'no') return false; return null; }
function _stripName(n) { return String(n || '').replace(/ - Novo\(a\) Deal$/i, '').replace(/ - New Deal$/i, '').trim(); }
// Espelho do normalizeQuarter do forecast-table (decisão do dono 2026-07-15: "Qx" sem ano = 2026).
function _quarter(v) { if (!v) return null; const m = String(v).trim().match(/^Q([1-4])(?:\s+(\d{4}))?$/i); return m ? `Q${m[1]} ${m[2] || '2026'}` : null; }

function mapFotoDeal(r) {
  const closedLost = String(r['Closed Lost'] || '').toLowerCase() === 'true';
  return {
    hs_id: r['Deal ID'] != null && r['Deal ID'] !== '' ? String(r['Deal ID']) : null,
    dealname: _stripName(r['Deal']),
    pipeline: r['Pipeline'] || '-',
    stage: closedLost ? 'Perdido' : (r['Etapa'] || '-'),
    vidas: _int(r['Vidas']),
    colaboradores: _int(r['Colaboradores']),
    primeira_fatura: _num(r['1ª Fatura (R$)']),
    arr_estimado: (function () { const a = _num(r['ARR Estimado (R$)']); if (a != null && a > 0) return a; const pf = _num(r['1ª Fatura (R$)']); return (pf != null && pf > 0) ? pf * 12 : null; })(),
    modelo_remuneracao: r['Modelo'] || null,
    possui_agenciamento: _bool(r['Agenciamento']),
    possui_vitalicio: _bool(r['Vitalício']),
    probabilidade: (function () { const c = _prob(r['Probabilidade (campo)']); return c !== null ? c : _prob(r['Probabilidade HS']); })(),
    quarter: (function () { const q = _quarter(r['Quarter']); if (q) return q; const d = parseRevenueDate(r['Data Prevista Receita']); return d ? `Q${Math.floor(d.mo / 3) + 1} ${d.y}` : null; })(),
    data_prevista_para_receita: _d10(r['Data Prevista Receita']),
    vigencia: _d10(r['Vigência']),
    vencimento_primeira_fatura: _d10(r['Vencimento 1ª Fatura']),
    createdate: _d10(r['Criado']),
    close_date: _d10(r['Fechado']),
    is_poc: _bool(r['É POC?']),   // fotos a partir de 2026-07-13 capturam É POC? → POC zera no Delta também
  };
}
function mapFotoDeals(rows) { return (rows || []).map(mapFotoDeal); }

function _dealId(d) { return d.hs_id != null ? String(d.hs_id) : ('n:' + OverallCore.dedupKey(d.dealname) + '|m:' + (d.modelo_remuneracao || '')); }

// índice, em MONTHS, do 1º mês da janela rolante de 12M a partir de referenceDate
function refMonthIndex(referenceDate) {
  const p = parseRevenueDate(referenceDate);
  if (!p) return 0;
  const idx = MONTHS.findIndex(m => m.y === p.y && m.mo === p.mo);
  return idx < 0 ? 0 : idx;
}

// Calcula o Overall de UMA foto, ancorado em referenceDate. Retorna por etapa a soma
// no horizonte total (24m) e na janela TCV(12M) rolante, em Real e Probabilizada.
function computeSnapshot(deals, referenceDate, manualStore) {
  FaturamentoManual.setData(manualStore || {});
  FaturamentoManual.config({ dealId: _dealId });
  FE.config({ MONTHS, getVpv, parseRevenueDate, addMonths, todayStr: () => referenceDate, calcReceita, monthLabels: MONTH_LABELS, referenceDate });
  OverallCore.config({ MONTHS, ForecastEngine: FE, calcReceita, dealId: _dealId, stageProbDefault: STAGE_PROB_DEFAULT, stageProbSaved: {}, funnelProb: null, bidProb: 0.005 });

  const scoped = OverallCore.scopeDeals(OverallCore.applyBidRevDate(deals));
  const ov = OverallCore.buildOverall(scoped);
  const i0 = refMonthIndex(referenceDate);
  const win = (arr) => { let s = 0; for (let i = i0; i < i0 + 12 && i < arr.length; i++) s += arr[i]; return s; };
  const tot = (arr) => arr.reduce((a, v) => a + v, 0);

  const stages = ov.rows.map(r => ({
    key: r.key, label: r.label,
    real12: win(r.data.real), prob12: win(r.data.prob),
    realTotal: tot(r.data.real), probTotal: tot(r.data.prob),
  }));
  const totals = {
    real12: stages.reduce((a, s) => a + s.real12, 0), prob12: stages.reduce((a, s) => a + s.prob12, 0),
    realTotal: stages.reduce((a, s) => a + s.realTotal, 0), probTotal: stages.reduce((a, s) => a + s.probTotal, 0),
  };
  // KPIs de apoio (spec 6.2). ARR Ponderado usa o mesmo peso do waterfall:
  // BID → bidProb; demais → calcProbInfo(d).final (Diagnóstico 6% etc.).
  let arrTotal = 0, arrPond = 0;
  scoped.forEach(d => {
    const arr = d.arr_estimado || 0;
    arrTotal += arr;
    const w = d.pipeline === 'Bid' ? 0.005 : (OverallCore.calcProbInfo(d).final || 0);
    arrPond += arr * w;
  });
  const kpis = {
    deals: scoped.length,
    vidas: scoped.reduce((a, d) => a + (d.vidas || 0), 0),
    arrTotal: arrTotal,
    arrPond: arrPond,
    mrrPond: arrPond / 12,
    tcv12: totals.prob12,   // forecast probabilizado, janela 12M rolante (headline do waterfall)
  };
  // Contagem por etapa do funil (para o funil delta A×B, spec 6.3).
  const FUNNEL_STAGES = ['Reunião Agendada', 'Diagnóstico', 'Cotação', 'Consultoria', 'Negociação', 'Proposta Enviada', 'Ganho', 'Implantação'];
  const stageCounts = {};
  FUNNEL_STAGES.forEach(s => { stageCounts[s] = 0; });
  scoped.forEach(d => { if (stageCounts[d.stage] != null) stageCounts[d.stage]++; });
  const scopedDeals = scoped.map(d => ({ id: _dealId(d), stage: d.stage, dealname: d.dealname, pipeline: d.pipeline, vidas: d.vidas || 0 }));
  return { referenceDate, refMonthIndex: i0, stages, totals, kpis, stageCounts, funnelStages: FUNNEL_STAGES, scopedDeals, scopedCount: scoped.length };
}

// Rank de avanço de etapa (mesma escala do dedup do core). Deals fora do funil → -1.
const _RANK = { 'Reunião Agendada': 0, 'Diagnóstico': 1, 'Cotação': 2, 'Proposta Enviada': 3, 'Consultoria': 4, 'Negociação': 5, 'Implantação': 6, 'Ganho': 7 };
// Diff entre dois conjuntos escopados (por id): novos / avançaram / regrediram / saíram.
function dealDiff(scopedA, scopedB) {
  const mapA = {}; (scopedA || []).forEach(d => mapA[d.id] = d);
  const mapB = {}; (scopedB || []).forEach(d => mapB[d.id] = d);
  const novos = [], avancaram = [], regrediram = [], sairam = [];
  Object.keys(mapB).forEach(id => {
    const b = mapB[id], a = mapA[id];
    if (!a) { novos.push({ id, dealname: b.dealname, stage: b.stage }); return; }
    const ra = _RANK[a.stage] != null ? _RANK[a.stage] : -1, rb = _RANK[b.stage] != null ? _RANK[b.stage] : -1;
    if (rb > ra) avancaram.push({ id, dealname: b.dealname, de: a.stage, para: b.stage });
    else if (rb < ra) regrediram.push({ id, dealname: b.dealname, de: a.stage, para: b.stage });
  });
  Object.keys(mapA).forEach(id => { if (!mapB[id]) sairam.push({ id, dealname: mapA[id].dealname, stage: mapA[id].stage }); });
  return {
    novos, avancaram, regrediram, sairam,
    counts: { novos: novos.length, avancaram: avancaram.length, regrediram: regrediram.length, sairam: sairam.length },
  };
}

// Contribuição POR DEAL a uma foto, atribuída à linha do Overall (drill-down 1F).
// Espelha o filtro/probabilização de rowMonthly: mesmo peso, mesma exclusão por dedup.
function dealContributions(deals, referenceDate, manualStore) {
  FaturamentoManual.setData(manualStore || {});
  FaturamentoManual.config({ dealId: _dealId });
  FE.config({ MONTHS, getVpv, parseRevenueDate, addMonths, todayStr: () => referenceDate, calcReceita, monthLabels: MONTH_LABELS, referenceDate });
  OverallCore.config({ MONTHS, ForecastEngine: FE, calcReceita, dealId: _dealId, stageProbDefault: STAGE_PROB_DEFAULT, stageProbSaved: {}, funnelProb: null, bidProb: 0.005 });

  const scoped = OverallCore.scopeDeals(OverallCore.applyBidRevDate(deals));
  const revExcl = OverallCore.revExcluded(scoped);
  const ROWS = OverallCore.OVERALL_ROWS;
  const i0 = refMonthIndex(referenceDate);
  const out = [];
  scoped.forEach(d => {
    if (revExcl[_dealId(d)]) return;
    let row = null;
    for (let i = 0; i < ROWS.length; i++) {
      const r = ROWS[i];
      if (r.stages.indexOf(d.stage) !== -1 && (r.isBid ? d.pipeline === 'Bid' : d.pipeline !== 'Bid')) { row = r; break; }
    }
    if (!row) return;   // etapa fora do funil do Overall
    const probAdj = row.isBid ? 0.005 : OverallCore.calcProbInfo(d).final;
    const series = FE.dealMonthly(d, probAdj);
    let r12 = 0, p12 = 0, rT = 0, pT = 0;
    series.forEach((m, i) => { if (m) { rT += m.rec; pT += m.val; if (i >= i0 && i < i0 + 12) { r12 += m.rec; p12 += m.val; } } });
    out.push({ id: _dealId(d), dealname: d.dealname, stage: d.stage, pipeline: d.pipeline, rowKey: row.key, real12: r12, prob12: p12, realTotal: rT, probTotal: pT });
  });
  return out;
}

// Merge das contribuições de A e B para UMA linha → lista de deals com before/after/Δ.
// rawBStageById (opcional): id → etapa BRUTA em B (inclui Perdido/Ganho/fora de escopo),
// usado para mostrar PARA ONDE foi o deal que "saiu" desta etapa.
function drillRow(contribA, contribB, rowKey, measure, rawBStageById) {
  const m = measure || 'prob12';
  const rawB = rawBStageById || {};
  const inA = contribA.filter(x => x.rowKey === rowKey), inB = contribB.filter(x => x.rowKey === rowKey);
  const mapA = {}; inA.forEach(x => mapA[x.id] = x);
  const mapB = {}; inB.forEach(x => mapB[x.id] = x);
  const ids = {}; inA.forEach(x => ids[x.id] = 1); inB.forEach(x => ids[x.id] = 1);
  const rows = Object.keys(ids).map(id => {
    const a = mapA[id], b = mapB[id];
    const aCash = a ? a[m] : 0, bCash = b ? b[m] : 0;
    const tipo = !a ? 'novo' : (!b ? 'saiu' : 'permaneceu');
    // destino do que saiu: etapa bruta em B (Perdido/Ganho/outra) ou "Fora do pipe" se sumiu
    const stageB = tipo === 'saiu' ? (rawB[id] || 'Fora do pipe') : (b ? b.stage : null);
    return { id, dealname: (b || a).dealname, stageA: a ? a.stage : null, stageB: stageB, aCash, bCash, delta: bCash - aCash, tipo };
  });
  rows.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  const sumDelta = rows.reduce((s, r) => s + r.delta, 0);
  return { rowKey, measure: m, deals: rows, sumDelta };
}

module.exports = { MONTHS, MONTH_LABELS, STAGE_PROB_DEFAULT, mapFotoDeal, mapFotoDeals, computeSnapshot, dealContributions, drillRow, dealDiff, refMonthIndex, dealId: _dealId };
