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
    executivo: (r['Executivo'] || '').trim() || null,
    pipeline: r['Pipeline'] || '-',
    stage: closedLost ? 'Perdido' : (r['Etapa'] || '-'),
    vidas: _int(r['Vidas']),
    colaboradores: _int(r['Colaboradores']),
    primeira_fatura: _num(r['1ª Fatura (R$)']),
    arr_estimado: (function () {
      const a = _num(r['ARR Estimado (R$)']); if (a != null && a > 0) return a;
      const pf = _num(r['1ª Fatura (R$)']); if (pf != null && pf > 0) return pf * 12;
      // Fallback VPV (2026-07-20): sem ARR nem 1ª Fatura, nas etapas valoradas por VPV,
      // ARR anual = (vidas||colaboradores) × VPV × 12. Espelha api/forecast-table.js.
      const st = closedLost ? 'Perdido' : (r['Etapa'] || '');
      if (['Diagnóstico', 'Cotação', 'Consultoria', 'Negociação'].indexOf(st) !== -1) {
        const vidas = _int(r['Vidas']) || _int(r['Colaboradores']) || 0;
        if (vidas > 0) { const vpv = vidas <= 200 ? 36 : vidas <= 4999 ? 24 : 12; return vidas * vpv * 12; }
      }
      return null;
    })(),
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
    key: r.key, label: r.label, isBid: !!r.isBid, stages: r.stages,
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
// Tipo de quem SAIU do conjunto do drill, pelo destino bruto em B: 'ganho' (foi p/
// Ganho), 'avancou' (etapa posterior — sair por avanço ≠ sair por perda, requisito
// do dono 2026-07-24), 'saiu' (Perdido, regressão ou fora do pipe).
function _classifySaiu(stageA, rawDestino) {
  const destino = _stageBucket(rawDestino || 'Fora do pipe');
  if (destino === 'Ganho') return 'ganho';
  if (destino === 'Perdido') return 'saiu';
  const rA = _RANK[_stageBucket(stageA)] != null ? _RANK[_stageBucket(stageA)] : -1;
  const rD = _RANK[destino] != null ? _RANK[destino] : -99;
  return rD > rA ? 'avancou' : 'saiu';
}
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
    let row = null;
    for (let i = 0; i < ROWS.length; i++) {
      const r = ROWS[i];
      if (r.stages.indexOf(d.stage) !== -1 && (r.isBid ? d.pipeline === 'Bid' : d.pipeline !== 'Bid')) { row = r; break; }
    }
    // Deals sem linha no Overall (ex.: Stand by / Bid Cotação) e o gêmeo
    // excluído pela dedup continuam nas dimensões de deals, vidas e ARR. Só a
    // contribuição de receita fica zerada, como no painel canônico.
    const excludedRevenue = !row || !!revExcl[_dealId(d)];
    const probAdj = !row ? 0 : (row.isBid ? 0.005 : OverallCore.calcProbInfo(d).final);
    const series = excludedRevenue ? [] : FE.dealMonthly(d, probAdj);
    let r12 = 0, p12 = 0, rT = 0, pT = 0;
    series.forEach((m, i) => { if (m) { rT += m.rec; pT += m.val; if (i >= i0 && i < i0 + 12) { r12 += m.rec; p12 += m.val; } } });
    // Campos aditivos (Leva 2): peso do ARR = mesmo do KPI arrPond (BID→0,5%; senão calcProbInfo.final);
    // vidas/arr/quarter para os drills de KPI, etapa unificada e quarter. Nada removido do contrato.
    const arr = d.arr_estimado || 0;
    const w = d.pipeline === 'Bid' ? 0.005 : (OverallCore.calcProbInfo(d).final || 0);
    out.push({
      id: _dealId(d), dealname: d.dealname, stage: d.stage, pipeline: d.pipeline, rowKey: row ? row.key : null,
      real12: r12, prob12: p12, realTotal: rT, probTotal: pT,
      vidas: d.vidas || 0, arr: arr, arrPond: arr * w, quarter: d.quarter || null,
      revenueExcluded: excludedRevenue,
    });
  });
  return out;
}

// Estágios fechados (pós-venda) para toggle do forecast-delta
const CLOSED_STAGES = new Set(['Implantação', 'Ganho']);

// Filtra deals em estágios fechados, preservando quem foi para Perdido (importante para o drill)
function excludeClosedStages(deals) {
  return (deals || []).filter(d => !CLOSED_STAGES.has(_stageBucket(d.stage)));
}

// ── Escopo do /forecast-delta (2026-07-20) ───────────────────────────────────
// Remove SEMPRE pipeline Bid e etapa Standby. Dois modos:
//   'ativos' (padrão do painel) = só Cotação/Consultoria/Negociação (Diagnóstico NÃO
//              entra em Ativos — decisão do dono 2026-07-20; só aparece em Tudo).
//   'tudo'   = todas as demais de Vendas (Reunião Agendada + Diagnóstico + as 3 +
//              Ganho + Implantação). Perdido já sai no scopeDeals.
const DELTA_ACTIVE_STAGES = new Set(['Cotação', 'Consultoria', 'Negociação']);
function applyDeltaScope(deals, scope) {
  const onlyActive = scope !== 'tudo';
  return (deals || []).filter(d => {
    if (d.pipeline === 'Bid') return false;
    const st = _stageBucket(d.stage);
    if (st === 'Stand by') return false;
    return onlyActive ? DELTA_ACTIVE_STAGES.has(st) : true;
  });
}
// Lista ordenada de etapas exibidas no funil, por escopo (sem Bid/Standby/Perdido).
function deltaScopeStages(scope) {
  return scope === 'tudo'
    ? ['Reunião Agendada', 'Diagnóstico', 'Cotação', 'Consultoria', 'Negociação', 'Ganho', 'Implantação']
    : ['Cotação', 'Consultoria', 'Negociação'];
}
// Uma linha do waterfall (OVERALL_ROWS) está no escopo? Descarta Bid sempre; em
// 'ativos' mantém só as linhas cujas etapas estão todas no conjunto ativo.
function deltaRowInScope(row, scope) {
  if (row.isBid) return false;
  if (scope === 'tudo') return true;
  return (row.stages || []).length > 0 && (row.stages || []).every(s => DELTA_ACTIVE_STAGES.has(s));
}

// ── Filtros Executivo/Quarter do /forecast-delta ─────────────────────────────
// Opções disponíveis (união dos deals de A+B, já escopados) para popular os
// dropdowns multiselect no cliente. Ordena AE por nome e Quarter cronologicamente.
function deltaFilterOptions(deals) {
  const ae = new Set(), q = new Set();
  (deals || []).forEach(d => {
    if (d.executivo && d.executivo !== '-') ae.add(d.executivo);
    if (d.quarter) q.add(d.quarter);
  });
  const executivos = [...ae].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const quarters = [...q].sort((a, b) => {
    const [qa, ya] = String(a).split(' '), [qb, yb] = String(b).split(' ');
    if (ya !== yb) return parseInt(ya) - parseInt(yb);
    return String(qa).localeCompare(String(qb));
  });
  return { executivos, quarters };
}
// Filtra por Executivo/Quarter. Sets vazios/null = sem filtro (tudo). Sentinela
// '__NONE__' (nenhum selecionado no cliente) = resultado vazio.
function applyAeQuarterFilter(deals, aeSet, qSet) {
  if ((aeSet && aeSet.has('__NONE__')) || (qSet && qSet.has('__NONE__'))) return [];
  return (deals || []).filter(d => {
    if (aeSet && aeSet.size && !aeSet.has(d.executivo)) return false;
    if (qSet && qSet.size && !qSet.has(d.quarter)) return false;
    return true;
  });
}

// Rótulo de etapa exibido no funil/tabela unificada, casando com FUNNEL_STAGES.
const _STAGE_LABELS = ['Reunião Agendada', 'Diagnóstico', 'Cotação', 'Consultoria', 'Negociação', 'Proposta Enviada', 'Stand by', 'Ganho', 'Implantação'];
function _stageBucket(stage) { return stage === 'Standby' || stage === 'Stand by' ? 'Stand by' : stage; }

// Tabela unificada por ETAPA (spec Leva 2): nº deals + vidas + receita real/ponderada +
// deltas A→B. Reusa dealContributions (mesma fonte de receita, Regra primária nº 3).
// Cada etapa vira uma linha drillável por `row=stage:<Etapa>`.
// rawBStageById (opcional): id → etapa BRUTA em B (inclui Perdido), usado para 
// calcular movimento: novos = entrou na etapa, caiuPerdido = saiu para Perdido
// (saiu para Ganho NÃO conta como "caiu" — requisito Samuel 2026-07-20).
function stageUnified(contribA, contribB, rawBStageById) {
  const blank = () => ({ deals: 0, vidas: 0, real12: 0, prob12: 0, realTotal: 0, probTotal: 0, arr: 0, arrPond: 0 });
  const A = {}, B = {};
  _STAGE_LABELS.forEach(s => { A[s] = blank(); B[s] = blank(); });
  const acc = (bag, x) => { const stage = _stageBucket(x.stage); if (!bag[stage]) return; const t = bag[stage]; t.deals++; t.vidas += x.vidas || 0; t.real12 += x.real12; t.prob12 += x.prob12; t.realTotal += x.realTotal; t.probTotal += x.probTotal; t.arr += x.arr || 0; t.arrPond += x.arrPond || 0; };
  (contribA || []).forEach(x => acc(A, x));
  (contribB || []).forEach(x => acc(B, x));
  
  const rawB = rawBStageById || {};
  
  return _STAGE_LABELS.map(s => {
    const a = A[s], b = B[s];
    const delta = {};
    Object.keys(blank()).forEach(k => { delta[k] = b[k] - a[k]; });
    
    // Movimento por etapa (fluxo A→B). Entrada: novos. Saída classificada pelo
    // destino BRUTO em B (rawB), distinguindo AVANÇAR de PERDER (requisito do dono
    // 2026-07-20): avancou (foi p/ etapa posterior, inclui Ganho/Implantação),
    // regrediu (voltou p/ etapa anterior), caiuPerdido (foi p/ Perdido), saiuOutro
    // (sumiu do pipe / etapa fora do funil).
    const idsA = new Set((contribA || []).filter(x => _stageBucket(x.stage) === s).map(x => x.id));
    const idsB = new Set((contribB || []).filter(x => _stageBucket(x.stage) === s).map(x => x.id));

    let novos = 0, avancou = 0, regrediu = 0, caiuPerdido = 0, saiuOutro = 0;
    const rankS = _RANK[s] != null ? _RANK[s] : -1;

    // Novos: está em B mas não em A nesta etapa (entrou na etapa)
    idsB.forEach(id => { if (!idsA.has(id)) novos++; });

    // Saiu: está em A mas não em B nesta etapa — classifica pelo destino
    idsA.forEach(id => {
      if (!idsB.has(id)) {
        const destino = _stageBucket(rawB[id] || 'Fora do pipe');
        if (destino === 'Perdido') { caiuPerdido++; return; }
        const rankD = _RANK[destino] != null ? _RANK[destino] : -99;
        if (rankD > rankS) avancou++;
        else if (rankD >= 0 && rankD < rankS) regrediu++;
        else saiuOutro++;
      }
    });

    return {
      stage: s, a, b, delta,
      // saiuGanhoIgnorado mantido p/ compat (subconjunto de avancou que foi p/ Ganho)
      movement: { novos, avancou, regrediu, caiuPerdido, saiuOutro,
        saiuGanhoIgnorado: [...idsA].filter(id => !idsB.has(id) && _stageBucket(rawB[id] || '') === 'Ganho').length }
    };
  });
}

// Agregação por QUARTER previsto (spec Leva 2): ARR Total e ARR Ponderado por quarter,
// com deltas A→B. Cada quarter vira linha drillável por `row=quarter:<Q>`.
function quarterAgg(contribA, contribB) {
  const norm = (q) => q || 'Sem quarter';
  const A = {}, B = {};
  const bump = (bag, x) => { const q = norm(x.quarter); if (!bag[q]) bag[q] = { deals: 0, vidas: 0, arr: 0, arrPond: 0, real12: 0, prob12: 0 }; const t = bag[q]; t.deals++; t.vidas += x.vidas || 0; t.arr += x.arr || 0; t.arrPond += x.arrPond || 0; t.real12 += x.real12; t.prob12 += x.prob12; };
  (contribA || []).forEach(x => bump(A, x));
  (contribB || []).forEach(x => bump(B, x));
  const keys = {}; Object.keys(A).forEach(k => keys[k] = 1); Object.keys(B).forEach(k => keys[k] = 1);
  const sortQ = (a, b) => { if (a === 'Sem quarter') return 1; if (b === 'Sem quarter') return -1; const pa = a.match(/Q(\d)\s+(\d{4})/), pb = b.match(/Q(\d)\s+(\d{4})/); if (pa && pb) { const va = +pa[2] * 4 + +pa[1], vb = +pb[2] * 4 + +pb[1]; return va - vb; } return a.localeCompare(b); };
  return Object.keys(keys).sort(sortQ).map(q => {
    const a = A[q] || { deals: 0, vidas: 0, arr: 0, arrPond: 0, real12: 0, prob12: 0 };
    const b = B[q] || { deals: 0, vidas: 0, arr: 0, arrPond: 0, real12: 0, prob12: 0 };
    const delta = {}; Object.keys(a).forEach(k => { delta[k] = b[k] - a[k]; });
    return { quarter: q, a, b, delta };
  });
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
    // Classificação: novo, permaneceu, ou ver destino de quem saiu
    let tipo = !a ? 'novo' : (!b ? 'saiu' : 'permaneceu');
    // destino do que saiu: etapa bruta em B (Perdido/Ganho/outra) ou "Fora do pipe" se sumiu
    const stageB = tipo === 'saiu' ? (rawB[id] || 'Fora do pipe') : (b ? b.stage : null);
    if (tipo === 'saiu') tipo = _classifySaiu(a.stage, rawB[id]);
    return { id, dealname: (b || a).dealname, stageA: a ? a.stage : null, stageB: stageB, aCash, bCash, delta: bCash - aCash, tipo };
  });
  rows.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  const sumDelta = rows.reduce((s, r) => s + r.delta, 0);
  return { rowKey, measure: m, deals: rows, sumDelta };
}

// Drill genérico (Leva 2). `target` roteia por prefixo, reusando a MESMA base de
// contribuições por deal (fonte única). Casa deals A×B por id e classifica em
// Novo / Permaneceu / Saiu; para "saiu" mostra o destino (etapa bruta em B).
//   stage:<Etapa>   → deals daquela etapa do funil (unificada)
//   quarter:<Q>     → deals daquele quarter previsto
//   kpi:vidas       → conta por deal, foco em vidas
//   kpi:arrTotal    → ARR total (não ponderado)
//   kpi:arrPond     → ARR ponderado
//   <rowKey>        → linha do Overall (compat com drillRow / waterfall)
// `field` decide qual métrica vira aCash/bCash/delta do drill (default = measure).
function drillGeneric(contribA, contribB, target, measure, rawBStageById, fieldOverride) {
  const rawB = rawBStageById || {};
  const t = String(target || '');
  const allowedFields = new Set(['vidas', 'arr', 'arrPond', 'real12', 'prob12', 'realTotal', 'probTotal']);
  let inA, inB, rowKey = t, field = allowedFields.has(fieldOverride) ? fieldOverride : (measure || 'prob12');
  if (t.indexOf('bidstage:') === 0) {
    // Pipe de Bid (D08): etapa restrita ao pipeline Bid (2026-07-24)
    const st = t.slice(9);
    const m = (x) => x.pipeline === 'Bid' && _stageBucket(x.stage) === st;
    inA = contribA.filter(m); inB = contribB.filter(m);
  } else if (t.indexOf('stage:') === 0) {
    const st = t.slice(6);
    inA = contribA.filter(x => _stageBucket(x.stage) === st); inB = contribB.filter(x => _stageBucket(x.stage) === st);
  } else if (t.indexOf('quarter:') === 0) {
    const q = t.slice(8);
    const match = (x) => (x.quarter || 'Sem quarter') === q;
    inA = contribA.filter(match); inB = contribB.filter(match);
  } else if (t.indexOf('kpi:') === 0) {
    const k = t.slice(4);
    field = k === 'vidas' ? 'vidas' : k === 'arrTotal' ? 'arr' : k === 'arrPond' ? 'arrPond' : (measure || 'prob12');
    inA = contribA.slice(); inB = contribB.slice();   // KPIs olham todo o escopo
  } else {
    inA = contribA.filter(x => x.rowKey === t); inB = contribB.filter(x => x.rowKey === t);
  }
  const mapA = {}; inA.forEach(x => mapA[x.id] = x);
  const mapB = {}; inB.forEach(x => mapB[x.id] = x);
  const ids = {}; inA.forEach(x => ids[x.id] = 1); inB.forEach(x => ids[x.id] = 1);
  const rows = Object.keys(ids).map(id => {
    const a = mapA[id], b = mapB[id];
    const aCash = a ? (a[field] || 0) : 0, bCash = b ? (b[field] || 0) : 0;
    // Classificação: novo, permaneceu, ou ver destino de quem saiu
    let tipo = !a ? 'novo' : (!b ? 'saiu' : 'permaneceu');
    const stageB = tipo === 'saiu' ? (rawB[id] || 'Fora do pipe') : (b ? b.stage : null);
    if (tipo === 'saiu') tipo = _classifySaiu(a.stage, rawB[id]);
    return {
      id, dealname: (b || a).dealname, stageA: a ? a.stage : null, stageB: stageB,
      pipeline: (b || a).pipeline, quarter: (b || a).quarter || null,
      aCash, bCash, delta: bCash - aCash, tipo,
      vidas: (b || a).vidas || 0, arr: (b || a).arr || 0,
    };
  });
  rows.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  const sumDelta = rows.reduce((s, r) => s + r.delta, 0);
  return { rowKey, measure: measure || 'prob12', field, deals: rows, sumDelta };
}

module.exports = {
  MONTHS, MONTH_LABELS, STAGE_PROB_DEFAULT, CLOSED_STAGES,
  excludeClosedStages, applyDeltaScope, deltaScopeStages, deltaRowInScope,
  deltaFilterOptions, applyAeQuarterFilter,
  mapFotoDeal, mapFotoDeals, computeSnapshot,
  dealContributions, stageUnified, quarterAgg, drillRow, drillGeneric,
  dealDiff, refMonthIndex, dealId: _dealId
};
