// forecast-columns.js v1 | Visibilidade de colunas dos painéis Forecast | FONTE ÚNICA.
//
// Usado por public/forecast.html e public/forecast-stage.html (todos os painéis de
// lista: /forecast, /forecast-cotacao, ..., /forecast-ganho). Pedido do dono
// (2026-07-16): o forecast ficou com muitas colunas; poder mostrar/ocultar colunas
// nas Configurações, em TODOS os painéis, com o MESMO catálogo de colunas.
//
// Contrato:
//   ForecastColumns.loadHidden(panel)      → array de keys ocultas (localStorage).
//   ForecastColumns.saveHidden(panel, arr) → persiste.
//   ForecastColumns.catalog(info)          → [{k,lbl}] das colunas alternáveis
//                                            (exclui a âncora sticky e as colunas de
//                                            comparação comp_*). Rótulo sem o selo 🟡.
//   ForecastColumns.togglesHtml(info, hiddenArr, onChangeFn)
//                                          → { html, visible, total } dos checkboxes.
//
// A visibilidade é POR PAINEL (chave = identidade do painel), então cada painel pode
// ter uma leitura mais enxuta — "simplicidade dependendo do painel". O CATÁLOGO é
// idêntico em todos (os dois HTMLs mantêm o mesmo array INFO base). Default: tudo
// visível (nenhuma coluna perdida por padrão).
(function (root) {
  var LS_PREFIX = 'fc_cols_hidden_v1::';
  function key(panel) { return LS_PREFIX + (panel || 'default'); }

  function loadHidden(panel) {
    try {
      var raw = localStorage.getItem(key(panel));
      if (raw) { var a = JSON.parse(raw); if (Object.prototype.toString.call(a) === '[object Array]') return a; }
    } catch (e) {}
    return [];
  }
  function saveHidden(panel, arr) {
    try { localStorage.setItem(key(panel), JSON.stringify(arr || [])); } catch (e) {}
  }

  // Colunas alternáveis: exclui a âncora (sticky — o nome do deal, sempre visível) e as
  // colunas de comparação (comp_*, contextuais do modo Histórico). Rótulo sem o 🟡.
  function catalog(info) {
    return (info || []).filter(function (c) {
      return !c.sticky && !/^comp_/.test(c.k);
    }).map(function (c) {
      return { k: c.k, lbl: String(c.lbl || c.k).replace(/^🟡\s*/, '') };
    });
  }

  function togglesHtml(info, hiddenArr, onChangeFn) {
    var hidden = {};
    (hiddenArr || []).forEach(function (k) { hidden[k] = 1; });
    var cat = catalog(info);
    var vis = 0;
    var h = '<div class="fc-cols-grid">';
    cat.forEach(function (c) {
      var on = !hidden[c.k];
      if (on) vis++;
      h += '<label class="fc-col-chk" title="' + c.k + '">' +
        '<input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="' + onChangeFn + '(\'' + c.k + '\')">' +
        '<span>' + c.lbl + '</span></label>';
    });
    h += '</div>';
    return { html: h, visible: vis, total: cat.length };
  }

  // CSS próprio (mesmo padrão do filter-bar.js) — usa as variáveis de tema dos painéis.
  function injectCss() {
    if (document.getElementById('fc-cols-css')) return;
    var s = document.createElement('style');
    s.id = 'fc-cols-css';
    s.textContent =
      '.fc-cols-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.3rem .7rem;max-height:230px;overflow:auto;padding:.25rem .1rem;margin-top:.15rem}' +
      '.fc-col-chk{display:flex;align-items:center;gap:.4rem;font-size:.8rem;color:var(--text);cursor:pointer;user-select:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.fc-col-chk input{accent-color:var(--teal,#3ab8b7);cursor:pointer;flex:0 0 auto}' +
      '.fc-col-chk span{overflow:hidden;text-overflow:ellipsis}';
    (document.head || document.documentElement).appendChild(s);
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectCss);
    else injectCss();
  }

  root.ForecastColumns = {
    loadHidden: loadHidden, saveHidden: saveHidden,
    catalog: catalog, togglesHtml: togglesHtml, injectCss: injectCss
  };
})(typeof window !== 'undefined' ? window : this);
