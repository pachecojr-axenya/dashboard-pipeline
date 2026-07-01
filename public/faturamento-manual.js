'use strict';
/**
 * faturamento-manual.js | Faturamento manual (Receita Real) | FONTE ÚNICA.
 *
 * Consumido por public/forecast.html e public/forecast-stage.html (e por qualquer
 * painel futuro que envolva receita). Materializa a Regra primária nº 3 do
 * STATUS_LOG (Diretrizes do Projeto): deals em Ganho/Implantação que já faturam
 * usam valores mensais REAIS digitados à mão, que substituem o forecast estimado.
 *
 * Gate automático: `vencimento_primeira_fatura` preenchido e já vencido → o deal
 * entra em faturamento manual. Override explícito (botão no editor) vence o gate.
 *
 * Estado (store): { "<dealId>": { manual?: boolean, months?: { "YYYY-MM": valor } } }
 * O `dealId` é resolvido pela função que cada página injeta via config({dealId}),
 * para bater exatamente com a dedup/render de quem consome.
 */
(function (root) {
  var _store = {};
  var _dealId = function (d) {
    return d && d.hs_id != null ? String(d.hs_id) : (d && d.dealname || '');
  };

  function config(opts) { if (opts && typeof opts.dealId === 'function') _dealId = opts.dealId; }
  function setData(data) { _store = data || {}; return _store; }
  function data() { return _store; }
  function entry(d) { return _store[_dealId(d)]; }

  // Carrega o store do backend (Upstash KV via api/faturamento-manual.js).
  function load() {
    return fetch('/api/faturamento-manual', { credentials: 'same-origin' })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.success && j.data) _store = j.data; return _store; })
      .catch(function () { return _store; });
  }

  function monthKey(m) { return m.y + '-' + String(m.mo + 1).padStart(2, '0'); }
  function vencido(d, todayISO) { var v = d.vencimento_primeira_fatura; return !!v && v <= todayISO; }
  function elegivel(d) { return d.stage === 'Ganho' || d.stage === 'Implantação'; }

  // Estado manual efetivo: override explícito (botão) vence o gate; senão decide pelo vencimento.
  function isManual(d, todayISO) {
    if (!elegivel(d)) return false;
    var e = entry(d);
    if (e && typeof e.manual === 'boolean') return e.manual;
    return vencido(d, todayISO);
  }

  // Mapa de meses do deal manual ({} se ainda não preenchido); null se o deal não é manual.
  function manualMonths(d, todayISO) {
    if (!isManual(d, todayISO)) return null;
    var e = entry(d);
    return (e && e.months) ? e.months : {};
  }

  root.FaturamentoManual = {
    config: config, setData: setData, data: data, entry: entry, load: load,
    monthKey: monthKey, vencido: vencido, elegivel: elegivel,
    isManual: isManual, manualMonths: manualMonths
  };
})(typeof window !== 'undefined' ? window : this);
