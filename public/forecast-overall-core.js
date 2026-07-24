'use strict';
/**
 * forecast-overall-core.js | Orquestração do Forecast Overall | FONTE ÚNICA.
 *
 * Extrai do forecast-stage.html a lógica que transforma a lista bruta de deals na
 * matriz etapa×mês (Receita Real / Probabilizada) — escopo, override BID, dedup
 * Fee×Corretagem, probabilização por etapa e a soma por linha. A matemática de
 * receita em si continua nas fontes únicas forecast-engine.js e revenue-engine.js;
 * este módulo só as ORQUESTRA, para que a página ao vivo e o endpoint de comparação
 * (api/history.js?action=compare, em Node) produzam números idênticos por construção
 * (Regra primária nº 3 | fonte única de receita).
 *
 * Dual-load: no browser pendura em window.OverallCore; em Node, module.exports.
 * Dependências injetadas via config() (a página e o Node fornecem as suas):
 *   MONTHS, ForecastEngine, calcReceita, dealId, stageProbDefault, stageProbSaved,
 *   funnelProb, bidProb, bidRevDate.
 * A âncora ponto-no-tempo (referenceDate) NÃO mora aqui: é passada por quem configura
 * a ForecastEngine (config.referenceDate), então a série mensal já vem ancorada.
 */
(function (root) {
  var _cfg = {};
  function config(deps) { _cfg = deps || {}; return _cfg; }

  // ── Escopo (espelha o load() do forecast-stage.html) ────────────────────────
  // Realizada (Ganho/Implantação) entra sempre; funil/pipeline usa cutoff set/2025;
  // BID entra desde jan/2025 (deals longos de alto valor). Perdido nunca entra.
  function _isRealizada(d) { return d.stage === 'Ganho' || d.stage === 'Implantação'; }
  function scopeDeals(deals) {
    return (deals || []).filter(function (d) {
      return d.stage !== 'Perdido' &&
        ((d.createdate && d.createdate >= '2025-09-01') || _isRealizada(d) ||
         (d.pipeline === 'Bid' && d.createdate && d.createdate >= '2025-01-01'));
    });
  }

  // BID: mês de início de receita FIXO por etapa (regra do bloco BID), sobrescreve a
  // data por-deal do HubSpot. Retorna uma NOVA lista (não muta a original).
  function applyBidRevDate(deals) {
    var map = _cfg.bidRevDate || { 'Negociação': '2026-10-01', 'Proposta Enviada': '2027-06-01' };
    return (deals || []).map(function (d) {
      if (d.pipeline !== 'Bid') return d;
      var rd = map[d.stage];
      if (!rd) return d;
      var mo = parseInt(rd.substring(5, 7), 10) - 1;
      var nd = {}; for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k)) nd[k] = d[k];
      nd.data_prevista_para_receita = rd;
      // O quarter informado pelo AE tem precedência. A régua fixa do BID imputa
      // apenas a data de receita; só deriva quarter quando o deal não tem um.
      if (!nd.quarter) nd.quarter = 'Q' + (Math.floor(mo / 3) + 1) + ' ' + rd.substring(0, 4);
      return nd;
    });
  }

  // ── Probabilização | fonte única: prob-engine.js ────────────────────────────
  // DELEGADO à fonte única prob-engine.js (unificação 2026-07-24): este módulo não
  // calcula mais probabilidade — monta o ctx a partir do config() e chama o ProbEngine.
  // Resolução preguiçosa: no browser o prob-engine.js pode vir depois deste script na
  // página; em Node o require embute o módulo no bundle da Vercel.
  var _PE = null;
  function _probEngine() {
    if (_PE) return _PE;
    _PE = root.ProbEngine || (typeof require === 'function' ? require('./prob-engine.js').ProbEngine : null);
    return _PE;
  }
  function _probCtx() {
    var saved = _cfg.stageProbSaved || {};
    var hasSaved = false; for (var k in saved) { if (Object.prototype.hasOwnProperty.call(saved, k)) { hasSaved = true; break; } }
    var f = _cfg.funnelProb;
    // aceita mapa flat (aplica aos dois pipelines) ou já por pipeline {vendas,bid}
    var fp = f ? ((f.vendas || f.bid) ? f : { vendas: f, bid: f }) : null;
    return { cfg: { manual: hasSaved, values: { vendas: saved, bid: saved } }, funnelProbPipe: fp, defaults: _cfg.stageProbDefault };
  }
  function stageProbFor(stage, pipeline) { return _probEngine().stageProbFor(stage, pipeline, _probCtx()); }
  function calcProbInfo(deal) { return _probEngine().calcProbInfo(deal, _probCtx()); }

  // ── Dedup Fee × Corretagem (espelha _fcDedupKey/_fcStageRank/_fcRevExcluded) ─
  function dedupKey(name) {
    return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/novo\(a\)\s*deal/g, ' ')
      .replace(/fii\s*por\s*vida/g, ' ')
      .replace(/fee\s*por\s*vida/g, ' ')
      .replace(/corretagem/g, ' ')
      .replace(/\bfee\b/g, ' ')
      .replace(/[-–—|]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  function dealId(d) {
    if (_cfg.dealId) return _cfg.dealId(d);
    return d.hs_id != null ? String(d.hs_id) : ('n:' + dedupKey(d.dealname) + '|m:' + (d.modelo_remuneracao || ''));
  }
  function stageRank(d) {
    var R = { 'Reunião Agendada': 0, 'Diagnóstico': 1, 'Cotação': 2, 'Proposta Enviada': 3, 'Consultoria': 4, 'Negociação': 5, 'Implantação': 6, 'Ganho': 7 };
    return R[d.stage] != null ? R[d.stage] : -1;
  }
  function revExcluded(deals) {
    var calcReceita = _cfg.calcReceita;
    var tcv12 = function (d) { var s = 0; for (var n = 1; n <= 12; n++) { var r = calcReceita(n, d); if (r) s += r; } return s; };
    var vig = function (d) { return d.vigencia ? String(d.vigencia).substring(0, 10) : ''; };
    var groups = {};
    (deals || []).forEach(function (d) { var k = dedupKey(d.dealname); if (k) (groups[k] = groups[k] || []).push(d); });
    var excl = {};
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      if (g.length < 2) return;
      var hasFee = g.some(function (d) { return /fee/i.test(d.modelo_remuneracao || ''); });
      var hasCorr = g.some(function (d) { return /corretagem/i.test(d.modelo_remuneracao || ''); });
      if (!(hasFee && hasCorr)) return;
      var sorted = g.slice().sort(function (a, b) {
        var ra = stageRank(a), rb = stageRank(b);
        if (ra !== rb) return rb - ra;
        var ta = tcv12(a), tb = tcv12(b);
        if (ta !== tb) return ta - tb;
        return vig(b).localeCompare(vig(a));
      });
      for (var i = 1; i < sorted.length; i++) excl[dealId(sorted[i])] = true;
    });
    return excl;  // objeto usado como Set: excl[id] === true
  }

  // ── Agregação por linha (espelha _fcRowMonthly) ─────────────────────────────
  var OVERALL_ROWS = [
    { key: 'mql',   label: 'MQLs / Reunião',           stages: ['Reunião Agendada'],     isBid: false, addBdr: true },
    { key: 'diag',  label: 'Diagnóstico',              stages: ['Diagnóstico'],          isBid: false },
    { key: 'cot',   label: 'Cotação',                  stages: ['Cotação'],              isBid: false },
    { key: 'cons',  label: 'Consultoria',              stages: ['Consultoria'],          isBid: false },
    { key: 'neg',   label: 'Negociação',               stages: ['Negociação'],           isBid: false },
    { key: 'bidp',  label: 'BID | Proposta Comercial', stages: ['Proposta Enviada'],     isBid: true  },
    { key: 'bidn',  label: 'BID | Negociação',         stages: ['Negociação'],           isBid: true  },
    { key: 'ganho', label: 'Ganho / Implantação',      stages: ['Ganho', 'Implantação'], isBid: false }
  ];

  function _mqlConv() { var p = stageProbFor('Reunião Agendada', 'Vendas'); return (p != null ? p : (_cfg.winRate || 0)); }

  function rowMonthly(scoped, stages, isBid, addBdr, revExcl) {
    var MONTHS = _cfg.MONTHS, FE = _cfg.ForecastEngine, bidProb = _cfg.bidProb != null ? _cfg.bidProb : 0.005;
    var real = []; var prob = []; for (var i = 0; i < MONTHS.length; i++) { real.push(0); prob.push(0); }
    (scoped || []).forEach(function (d) {
      if (stages.indexOf(d.stage) === -1) return;
      if (isBid ? d.pipeline !== 'Bid' : d.pipeline === 'Bid') return;
      if (revExcl && revExcl[dealId(d)]) return;
      var probAdj = isBid ? bidProb : calcProbInfo(d).final;
      FE.dealMonthly(d, probAdj).forEach(function (m, i) { if (m) { real[i] += m.rec; prob[i] += m.val; } });
    });
    if (addBdr && FE.bdrCohorts) {
      FE.bdrCohorts().forEach(function (c) {
        MONTHS.forEach(function (m, i) {
          var diff = (m.y - c.revStart.y) * 12 + (m.mo - c.revStart.mo);
          if (diff < 0) return;
          real[i] += c.rec; prob[i] += c.rec * _mqlConv();
        });
      });
    }
    return { real: real, prob: prob };
  }

  // Matriz completa: recebe a lista JÁ escopada+BID-ajustada; devolve linhas + totais.
  function buildOverall(scoped) {
    var revExcl = revExcluded(scoped || []);
    var rows = OVERALL_ROWS.map(function (r) {
      return { key: r.key, label: r.label, stages: r.stages, isBid: !!r.isBid, data: rowMonthly(scoped, r.stages, r.isBid, r.addBdr, revExcl) };
    });
    var n = (_cfg.MONTHS || []).length;
    var totReal = []; var totProb = []; for (var i = 0; i < n; i++) { totReal.push(0); totProb.push(0); }
    rows.forEach(function (r) { for (var j = 0; j < n; j++) { totReal[j] += r.data.real[j]; totProb[j] += r.data.prob[j]; } });
    return { rows: rows, totalReal: totReal, totalProb: totProb, months: _cfg.MONTHS };
  }

  root.OverallCore = {
    config: config,
    scopeDeals: scopeDeals, applyBidRevDate: applyBidRevDate,
    stageProbFor: stageProbFor, calcProbInfo: calcProbInfo,
    dedupKey: dedupKey, dealId: dealId, stageRank: stageRank, revExcluded: revExcluded,
    rowMonthly: rowMonthly, buildOverall: buildOverall, OVERALL_ROWS: OVERALL_ROWS
  };
})(typeof window !== 'undefined' ? window : this);
