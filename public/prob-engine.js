'use strict';
/**
 * prob-engine.js | Motor de probabilidade de fechamento por deal | FONTE ÚNICA.
 *
 * Extrai a lógica de probabilidade que o CRO Dashboard (public/dashboard.html) usa
 * inline, para que o Board View (public/board.html) pondere o pipeline com EXATAMENTE
 * as mesmas premissas globais: C07 por pipeline (derivado do funil) + ajuste ±10% do AE
 * + override manual por pipeline. É puro/stateless: cada página injeta seu estado
 * (config do usuário e dados do funil) via `ctx`, no mesmo espírito do config() do
 * forecast-engine.js.
 *
 * Precedência da prob. de ETAPA (stageProbFor):
 *   override manual (por pipeline) > C07 do funil (por pipeline) > default fixo.
 * Ajuste do AE (calcProbInfo): a prob. custom do deal NÃO substitui a da etapa; só
 * empurra ±10% se divergir da etapa em ≥ 30 pontos percentuais (0.3).
 *
 * NOTA (2026-07-07): enquanto uma sessão paralela edita o dashboard.html, o CRO
 * mantém a cópia inline dessa lógica. A migração do CRO para consumir este arquivo
 * (eliminando a duplicação) fica para um momento coordenado. A lógica aqui é cópia
 * verbatim da do CRO — os números batem.
 */
(function (root) {
  // RÉGUA ÚNICA (D4/D4b, decisão do dono 2026-07-15): o fallback do C07 é a MESMA
  // régua validada do Forecast (semantic/referencia.json → forecast_flat, via
  // semantic-ref.js). O literal abaixo é espelho para páginas sem semantic-ref.
  var DEFAULT = (root.SEMANTIC_REF && root.SEMANTIC_REF.reguas && root.SEMANTIC_REF.reguas.forecast_flat.valores) || {
    'Reunião Agendada': 0.06, 'Cotação': 0.185790008, 'Proposta Enviada': 0.285,
    'Consultoria': 0.284954, 'Negociação': 0.493, 'Implantação': 0.8, 'Ganho': 1.0,
    'Standby': 0.12, 'Stand by': 0.12, 'Diagnóstico': 0.06
  };
  // Amostra mínima do funil para uma etapa gerar prob. derivada (senão cai no default).
  var MIN_SAMPLE = 20;

  // Config de probabilidade por etapa do usuário. Lê a MESMA chave do CRO
  // ('novo_stage_prob_cfg', values por pipeline), migrando o formato flat antigo.
  function loadCfg() {
    function norm(v) {
      if (!v || typeof v !== 'object') return { vendas: {}, bid: {} };
      if (v.vendas || v.bid) return { vendas: v.vendas || {}, bid: v.bid || {} };
      return { vendas: v, bid: v };
    }
    try { var r = localStorage.getItem('novo_stage_prob_cfg'); if (r) { var p = JSON.parse(r); if (p && typeof p === 'object') return { manual: !!p.manual, values: norm(p.values) }; } } catch (e) {}
    try { var old = localStorage.getItem('novo_stage_prob'); if (old) return { manual: true, values: norm(JSON.parse(old)) }; } catch (e) {}
    return { manual: false, values: { vendas: {}, bid: {} } };
  }

  // C07 | prob. de GANHO por etapa, POR PIPELINE (ganho absoluto ÷ entraram na etapa),
  // a partir do payload de /api/funnel-stages. Idêntico a _novoFunnelDerivedProbPipe do CRO.
  function funnelDerivedProbPipe(funnelData) {
    if (!funnelData) return null;
    function forPipe(pd) {
      if (!pd || !pd.stages) return {};
      var cnt = {}; pd.stages.forEach(function (s) { cnt[s.stage] = s.count || 0; });
      var ganho = cnt['Ganho'] || 0; if (ganho <= 0) return {};
      var order = ['Reunião Agendada', 'Cotação', 'Proposta Enviada', 'Consultoria', 'Negociação'];
      var out = {};
      order.forEach(function (s) { var c = cnt[s] || 0; if (c >= MIN_SAMPLE) { var p = ganho / c; if (p > 1) p = 1; if (p < 0) p = 0; out[s] = p; } });
      return out;
    }
    return { vendas: forPipe(funnelData.vendas), bid: forPipe(funnelData.bid) };
  }

  // Prob. de etapa efetiva de um deal. ctx = { cfg, funnelProbPipe }.
  // Toggle global (Fase 4b/ADR-008, D1-D3 decididas 2026-07-15): window.CONFIG_GLOBAL
  // .prob_fonte='premissas' pula o C07 e usa a régua única direto; 'calculada'
  // (default) = comportamento atual. Override manual do usuário vence sempre.
  function stageProbFor(stage, pipeline, ctx) {
    ctx = ctx || {};
    var cfg = ctx.cfg || { manual: false, values: { vendas: {}, bid: {} } };
    var pk = pipeline === 'Bid' ? 'bid' : 'vendas';
    if (cfg.manual && cfg.values) {
      var ov = cfg.values[pk];
      if (ov && ov[stage] != null) return ov[stage];   // override manual POR PIPELINE
    }
    var g = root.CONFIG_GLOBAL;
    if (!(g && g.prob_fonte === 'premissas')) {
      var fp = ctx.funnelProbPipe && ctx.funnelProbPipe[pk];
      if (fp && fp[stage] != null) return fp[stage];    // C07 do funil por pipeline
    }
    return DEFAULT[stage];                               // régua única (fallback/premissas)
  }

  // Prob. FINAL do deal com o ajuste ±10% do AE. Retorna { sp, cp, final }.
  // Idêntico a _calcProbInfo do CRO.
  function calcProbInfo(deal, ctx) {
    var sp = stageProbFor(deal.stage, deal.pipeline, ctx);
    if (sp == null) return { sp: null, cp: null, final: null };
    var cp = deal.probabilidade;
    if (cp == null) return { sp: sp, cp: null, final: sp };
    if (cp <= sp - 0.3) return { sp: sp, cp: cp, final: sp * 0.9 };  // AE muito abaixo → −10%
    if (cp >= sp + 0.3) return { sp: sp, cp: cp, final: sp * 1.1 };  // AE muito acima  → +10%
    return { sp: sp, cp: cp, final: sp };                            // dentro de ±30 pts → = etapa
  }

  root.ProbEngine = {
    DEFAULT: DEFAULT,
    MIN_SAMPLE: MIN_SAMPLE,
    loadCfg: loadCfg,
    funnelDerivedProbPipe: funnelDerivedProbPipe,
    stageProbFor: stageProbFor,
    calcProbInfo: calcProbInfo
  };

  // Fase 4b: carrega a config global (KV) e re-renderiza se a fonte de prob mudou.
  // Roda em qualquer página que inclua este engine (CRO, Board); o settings-modal
  // também carrega/salva — GET duplicado é inofensivo.
  if (typeof fetch === 'function' && typeof root.document !== 'undefined') {
    fetch('/api/config-global', { credentials: 'same-origin' })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.success) return;
        var antes = root.CONFIG_GLOBAL && root.CONFIG_GLOBAL.prob_fonte;
        root.CONFIG_GLOBAL = j.config;
        if (antes !== j.config.prob_fonte && typeof root.novoRender === 'function') root.novoRender();
      })
      .catch(function () {});
  }
})(typeof window !== 'undefined' ? window : this);
