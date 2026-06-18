/* ============================================================
 * filter-bar.js — Barra de filtros de período compartilhada
 * Autocontida: injeta o próprio CSS (classes axf-*), gerencia estado,
 * renderiza a barra e expõe AxFilter.inWin(dataISO) para filtrar dados.
 *
 * Uso numa view:
 *   1) <script src="/filter-bar.js?v=1"></script> antes do script principal
 *   2) No início do conteúdo: AxFilter.barHtml()
 *   3) Filtrar os dados: arr.filter(d => AxFilter.inWin(d.createdate))
 *   Ao mudar o filtro, chama automaticamente window.novoRender()
 *   (ou AxFilter.onChange, se definido).
 * ============================================================ */
(function () {
  if (window.AxFilter) return; // singleton

  // ---------- CSS ----------
  var CSS = [
    '.axf-bar{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin:-.35rem 0 1rem;position:sticky;top:74px;z-index:90;background:linear-gradient(180deg,var(--bg) 0%,rgba(13,17,23,.92) 100%);padding:.7rem .2rem .75rem;border-bottom:1px solid var(--border);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}',
    'html[data-theme="light"] .axf-bar{background:linear-gradient(180deg,var(--bg) 0%,rgba(246,248,250,.92) 100%)}',
    '.axf-seg{display:inline-flex;background:var(--card2);border-radius:99px;padding:3px;position:relative}',
    '.axf-thumb{position:absolute;top:3px;height:calc(100% - 6px);border-radius:99px;background:rgba(255,255,255,.14);pointer-events:none;z-index:0;transition:left .22s cubic-bezier(.4,0,.2,1),width .22s cubic-bezier(.4,0,.2,1)}',
    'html[data-theme="light"] .axf-thumb{background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.15)}',
    '.axf-seg-btn{background:transparent;border:none;border-radius:99px;color:var(--text2);padding:.36rem .85rem;cursor:pointer;font-size:.74rem;font-weight:600;font-family:inherit;transition:color .18s;position:relative;z-index:1;white-space:nowrap}',
    '.axf-seg-btn.active{color:var(--text)}',
    '.axf-pill{padding:.36rem .85rem;font-size:.74rem;border-radius:99px;border:1px solid var(--border);cursor:pointer;font-family:inherit;background:var(--card2);color:var(--text2);font-weight:600;transition:border-color .15s,color .15s,background .15s;display:inline-flex;align-items:center;gap:.4rem;white-space:nowrap}',
    '.axf-pill:hover{border-color:var(--teal);color:var(--text)}',
    '.axf-pill.active{background:rgba(58,184,183,.16);border-color:var(--teal);color:var(--teal)}',
    '.axf-pill svg{opacity:.7;flex:none}',
    '.axf-pill.active svg{opacity:1}',
    '.axf-wrap{position:relative;display:inline-flex}',
    '.axf-div{width:1px;height:22px;background:var(--border);margin:0 .3rem}',
    '.axf-group{display:inline-flex;align-items:stretch;border:1px solid var(--border);border-radius:99px;background:var(--card2)}',
    '.axf-group .axf-pill{border:none;border-radius:0;background:transparent}',
    '.axf-group > *:not(:last-child){border-right:1px solid var(--border)}',
    '.axf-group > :first-child .axf-pill{border-top-left-radius:99px;border-bottom-left-radius:99px}',
    '.axf-group > .axf-pill:last-child{border-top-right-radius:99px;border-bottom-right-radius:99px}',
    '.axf-group .axf-pill.active{background:rgba(58,184,183,.16);color:var(--teal)}',
    '.axf-group .axf-pill:last-child{color:var(--teal)}',
    '.axf-group .axf-pill:last-child:hover{background:rgba(58,184,183,.12)}',
    '.axf-pop{position:absolute;top:calc(100% + 8px);left:0;z-index:300;background:var(--card);border:1px solid var(--border);border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.5);padding:.85rem;width:236px;opacity:0;transform:translateY(-6px);pointer-events:none;transition:opacity .16s ease,transform .16s ease}',
    'html[data-theme="light"] .axf-pop{box-shadow:0 16px 48px rgba(0,0,0,.18)}',
    '.axf-pop.open{opacity:1;transform:translateY(0);pointer-events:auto}',
    '.axf-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:.55rem}',
    '.axf-title{font-size:.85rem;font-weight:600;color:var(--text)}',
    '.axf-nav{background:var(--card2);border:none;border-radius:8px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;color:var(--text);cursor:pointer;transition:background .15s,color .15s}',
    '.axf-nav:hover{background:var(--teal);color:#fff}',
    '.axf-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-top:.15rem}',
    '.axf-cell{border:none;background:transparent;border-radius:9px;color:var(--text);font-size:.78rem;cursor:pointer;font-family:inherit;padding:.5rem .2rem;text-transform:capitalize;transition:background .12s,color .12s}',
    '.axf-cell:hover{background:var(--card2)}',
    '.axf-cell.sel{background:var(--teal);color:#fff;font-weight:700}'
  ].join('');
  var st = document.createElement('style'); st.id = 'axf-style'; st.textContent = CSS;
  (document.head || document.documentElement).appendChild(st);

  // ---------- i18n ----------
  function lang() { return (window.NOVO_LANG === 'en') ? 'en' : 'pt'; }
  var L = {
    pt: { all: 'Tudo', curmonth: 'Mês atual', lastmonth: 'Mês passado', lastweek: 'Semana passada', curweek: 'Semana atual', last3mo: 'Últimos 3 meses', curyear: 'Este ano', quarter: 'Trimestre…', apply: 'Aplicar', reset: 'Limpar', from: 'Mês inicial', to: 'Mês final' },
    en: { all: 'All', curmonth: 'Current Month', lastmonth: 'Last Month', lastweek: 'Last Week', curweek: 'Current Week', last3mo: 'Last 3 mo', curyear: 'This year', quarter: 'Quarter…', apply: 'Apply', reset: 'Reset', from: 'From month', to: 'To month' }
  };
  function tt(k) { return (L[lang()] || L.pt)[k]; }

  var MON_I = { pt:['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'], en:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] };
  function MON_() { return MON_I[lang()]; }
  var QS = ['2025-3', '2025-4', '2026-1', '2026-2', '2026-3', '2026-4', '2027-1', '2027-2', '2027-3', '2027-4'];
  var CAL = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
  var CHEV = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  var PREV = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
  var NEXT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

  var S = { mode: 'all', start: null, end: null, label: null };
  var rFrom = null, rTo = null, mpView = null, mpTarget = null;

  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function qLabel(q) { var p = q.split('-'); return 'Q' + p[1] + "'" + p[0].slice(2); }
  function monLabel(ym) { var p = String(ym).split('-'); return MON_()[(+p[1]) - 1] + ' ' + p[0]; }

  function barHtml() {
    var presets = ['all', 'curmonth', 'lastmonth', 'lastweek', 'curweek', 'last3mo', 'curyear'];
    var seg = '<div id="axf-seg" class="axf-seg">' + presets.map(function (m) {
      return '<button class="axf-seg-btn' + (S.mode === m ? ' active' : '') + '" data-mode="' + m + '" onclick="AxF.preset(\'' + m + '\')">' + tt(m) + '</button>';
    }).join('') + '</div>';
    var qActive = S.mode && S.mode.indexOf('q') === 0;
    var qLab = qActive ? qLabel(S.mode.slice(1)) : tt('quarter');
    var quarter = '<div class="axf-wrap"><button class="axf-pill' + (qActive ? ' active' : '') + '" onclick="AxF.toggleQuarter(event)">' + qLab + CHEV + '</button><div class="axf-pop" id="axf-q-pop" style="width:188px"></div></div>';
    var rangeOn = S.mode === 'range';
    var fromL = rFrom ? monLabel(rFrom) : tt('from'), toL = rTo ? monLabel(rTo) : tt('to');
    var range = '<div class="axf-group">' +
      '<div class="axf-wrap"><button class="axf-pill' + (rangeOn ? ' active' : '') + '" onclick="AxF.openMonth(\'from\',event)">' + CAL + fromL + '</button><div class="axf-pop" id="axf-mp-from"></div></div>' +
      '<div class="axf-wrap"><button class="axf-pill' + (rangeOn ? ' active' : '') + '" onclick="AxF.openMonth(\'to\',event)">' + CAL + toL + '</button><div class="axf-pop" id="axf-mp-to"></div></div>' +
      '<button class="axf-pill" onclick="AxF.apply()">' + tt('apply') + '</button>' +
    '</div>';
    var reset = '<button class="axf-pill" onclick="AxF.reset()">' + tt('reset') + '</button>';
    setTimeout(initThumb, 0);
    return '<div id="axf-bar" class="axf-bar">' + seg + '<span class="axf-div"></span>' + quarter + range + '<span class="axf-div"></span>' + reset + '</div>';
  }

  function initThumb() {
    var sub = document.getElementById('axf-seg'); if (!sub) return;
    var th = sub.querySelector('.axf-thumb');
    if (!th) { th = document.createElement('div'); th.className = 'axf-thumb'; sub.insertBefore(th, sub.firstChild); }
    moveThumb(sub, false);
  }
  function moveThumb(sub, animate) {
    var th = sub.querySelector('.axf-thumb'); if (!th) return;
    var a = sub.querySelector('.axf-seg-btn.active');
    if (!a) { th.style.opacity = '0'; th.style.width = '0px'; return; }
    th.style.opacity = '';
    if (!animate) th.style.transition = 'none';
    th.style.left = a.offsetLeft + 'px'; th.style.width = a.offsetWidth + 'px';
    if (!animate) { void th.offsetWidth; th.style.transition = ''; }
  }

  function refreshBar() { var bar = document.getElementById('axf-bar'); if (bar) bar.outerHTML = barHtml(); }
  function closePops() { ['axf-mp-from', 'axf-mp-to', 'axf-q-pop'].forEach(function (id) { var p = document.getElementById(id); if (p) p.classList.remove('open'); }); }
  function changed() { closePops(); var y = window.scrollY || 0; var fn = (window.AxFilter && AxFilter.onChange) || window.novoRender; if (typeof fn === 'function') fn(); setTimeout(function(){ window.scrollTo(0, y); }, 0); }

  // true = mantém o registro. Tolerante: sem data → mantém (não esvazia views sem campo de data).
  function inWin(dateStr) { if (!S.start) return true; if (!dateStr) return true; var x = String(dateStr).slice(0, 10); return x >= S.start && x <= S.end; }

  function mpRender() {
    var pop = document.getElementById(mpTarget === 'from' ? 'axf-mp-from' : 'axf-mp-to'); if (!pop || !mpView) return;
    var cur = mpTarget === 'from' ? rFrom : rTo;
    var selY = cur ? (+cur.split('-')[0]) : null, selM = cur ? ((+cur.split('-')[1]) - 1) : null;
    var h = '<div class="axf-head"><button class="axf-nav" type="button" onclick="AxF.mpNav(-1)" aria-label="Ano anterior">' + PREV + '</button><span class="axf-title" style="text-transform:none">' + mpView.y + '</span><button class="axf-nav" type="button" onclick="AxF.mpNav(1)" aria-label="Próximo ano">' + NEXT + '</button></div><div class="axf-grid">';
    for (var m = 0; m < 12; m++) { var isSel = selY === mpView.y && selM === m; h += '<button class="axf-cell' + (isSel ? ' sel' : '') + '" type="button" onclick="AxF.mpPick(' + m + ')">' + MON_()[m] + '</button>'; }
    pop.innerHTML = h + '</div>';
  }

  window.AxF = {
    preset: function (mode) {
      var now = new Date(), y = now.getFullYear(), mo = now.getMonth(), dd = now.getDate(), s, e, lbl;
      rFrom = null; rTo = null;
      if (mode === 'all') { S = { mode: 'all', start: null, end: null, label: null }; changed(); return; }
      if (mode === 'curmonth') { s = new Date(y, mo, 1); e = new Date(y, mo + 1, 0); lbl = tt('curmonth'); }
      else if (mode === 'lastmonth') { s = new Date(y, mo - 1, 1); e = new Date(y, mo, 0); lbl = tt('lastmonth'); }
      else if (mode === 'curweek') { var w1 = now.getDay(); s = new Date(y, mo, dd + (w1 === 0 ? -6 : 1 - w1)); e = new Date(s.getTime()); e.setDate(e.getDate() + 6); lbl = tt('curweek'); }
      else if (mode === 'lastweek') { var w2 = now.getDay(); var mon = new Date(y, mo, dd + (w2 === 0 ? -6 : 1 - w2)); s = new Date(mon.getTime()); s.setDate(s.getDate() - 7); e = new Date(s.getTime()); e.setDate(e.getDate() + 6); lbl = tt('lastweek'); }
      else if (mode === 'last3mo') { e = new Date(y, mo, dd); s = new Date(y, mo - 3, dd); lbl = tt('last3mo'); }
      else if (mode === 'curyear') { s = new Date(y, 0, 1); e = new Date(y, 11, 31); lbl = tt('curyear'); }
      else return;
      S = { mode: mode, start: ymd(s), end: ymd(e), label: lbl }; changed();
    },
    toggleQuarter: function (e) {
      if (e) e.stopPropagation();
      var pop = document.getElementById('axf-q-pop'); if (!pop) return;
      if (pop.classList.contains('open')) { pop.classList.remove('open'); return; }
      closePops();
      var h = '<div class="axf-grid" style="grid-template-columns:repeat(2,1fr)">';
      QS.forEach(function (q) { var on = S.mode === 'q' + q; h += '<button class="axf-cell' + (on ? ' sel' : '') + '" type="button" onclick="AxF.quarter(\'' + q + '\')">' + qLabel(q) + '</button>'; });
      pop.innerHTML = h + '</div>'; pop.classList.add('open');
    },
    quarter: function (q) {
      var p = q.split('-'), yy = +p[0], qq = +p[1], sm = (qq - 1) * 3;
      var s = new Date(yy, sm, 1), e = new Date(yy, sm + 3, 0);
      rFrom = null; rTo = null;
      S = { mode: 'q' + q, start: ymd(s), end: ymd(e), label: qLabel(q) }; changed();
    },
    openMonth: function (which, e) {
      if (e) e.stopPropagation();
      var pop = document.getElementById(which === 'from' ? 'axf-mp-from' : 'axf-mp-to'); if (!pop) return;
      if (pop.classList.contains('open')) { pop.classList.remove('open'); return; }
      closePops();
      mpTarget = which;
      var cur = which === 'from' ? rFrom : rTo;
      mpView = { y: cur ? (+cur.split('-')[0]) : (new Date()).getFullYear() };
      mpRender(); pop.classList.add('open');
    },
    mpNav: function (d) { if (!mpView) return; mpView = { y: mpView.y + d }; mpRender(); },
    mpPick: function (m) {
      var ym = mpView.y + '-' + String(m + 1).padStart(2, '0');
      if (mpTarget === 'from') rFrom = ym; else rTo = ym;
      closePops(); refreshBar();
    },
    apply: function () {
      if (!rFrom || !rTo) return;
      var lo = rFrom <= rTo ? rFrom : rTo, hi = rFrom <= rTo ? rTo : rFrom;
      var lp = lo.split('-'), hp = hi.split('-');
      var s = new Date(+lp[0], +lp[1] - 1, 1), e = new Date(+hp[0], +hp[1], 0);
      S = { mode: 'range', start: ymd(s), end: ymd(e), label: monLabel(lo) + ' → ' + monLabel(hi) }; changed();
    },
    reset: function () { rFrom = null; rTo = null; S = { mode: 'all', start: null, end: null, label: null }; changed(); },
    closePops: closePops
  };

  window.AxFilter = { barHtml: barHtml, inWin: inWin, afterRender: initThumb, onChange: null, getState: function () { return S; } };

  document.addEventListener('click', function (e) { var bar = document.getElementById('axf-bar'); if (bar && !bar.contains(e.target)) closePops(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' || e.keyCode === 27) closePops(); });
})();
