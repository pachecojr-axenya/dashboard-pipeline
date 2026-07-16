/* ============================================================================
   AXENYA PREMIUM VISUAL LAYER — premium.js
   1) Envolve o construtor do Chart.js: remapeia a paleta legada para a paleta
      premium (theme-aware), aplica gradientes em barras, tooltips glass,
      grid refinado e defaults tipográficos — sem tocar no código das views.
   2) Microinterações: entrance stagger dos cards via MutationObserver.
   ============================================================================ */
(function () {
  'use strict';

  /* ── Host canônico ───────────────────────────────────────────────────────
     `project-bsmfu.vercel.app` é domínio técnico do projeto Vercel. Login de
     usuário final deve acontecer no domínio autorizado no Google OAuth. */
  var CANONICAL_HOST = 'axenya-pipeline-dashboard.vercel.app';
  if (location.hostname === 'project-bsmfu.vercel.app') {
    location.replace(location.protocol + '//' + CANONICAL_HOST + location.pathname + location.search + location.hash);
    return;
  }

  /* ── Marca a página no <html> p/ estilos premium por view ─────────────── */
  var page = (location.pathname.replace(/\.html$/, '').replace(/^\//, '') || 'index')
    .replace(/[^\w-]/g, '');
  document.documentElement.classList.add('pm-page-' + page);
  if (/forecast/.test(page)) document.documentElement.classList.add('pm-forecast');

  /* ── Paleta: legado (r,g,b) → premium ─────────────────────────────────── */
  var MAP_DARK = {
    '58,184,183':  '45,212,191',   // teal
    '88,166,255':  '96,165,250',   // blue
    '63,185,80':   '52,211,153',   // green
    '248,81,73':   '251,113,133',  // red
    '210,153,34':  '245,158,11',   // orange
    '227,179,65':  '251,191,36',   // yellow
    '147,112,219': '167,139,250',  // purple
    '219,109,40':  '249,115,22'    // orange2 (watcher)
  };
  var MAP_LIGHT = {
    '58,184,183':  '13,148,136',
    '88,166,255':  '37,99,235',
    '63,185,80':   '5,150,105',
    '248,81,73':   '225,29,72',
    '210,153,34':  '217,119,6',
    '227,179,65':  '202,138,4',
    '147,112,219': '124,58,237',
    '219,109,40':  '234,88,12'
  };

  function isLight() {
    return document.documentElement.getAttribute('data-theme') === 'light';
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /* Converte 'var(--x)', '#rrggbb', '#rgb', 'rgb()/rgba()' em {r,g,b,a} */
  function parseColor(str) {
    if (typeof str !== 'string') return null;
    var s = str.trim();
    var vm = s.match(/^var\((--[\w-]+)\)$/);
    if (vm) { s = cssVar(vm[1]); if (!s) return null; }
    var m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
    var h = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (h) {
      var hex = h[1];
      if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 1
      };
    }
    return null;
  }

  function remapColor(str) {
    var c = parseColor(str);
    if (!c) return str;
    var key = Math.round(c.r) + ',' + Math.round(c.g) + ',' + Math.round(c.b);
    var map = isLight() ? MAP_LIGHT : MAP_DARK;
    var to = map[key];
    if (!to) {
      // resolve var()/normaliza mesmo sem remap (canvas não entende var())
      if (/^var\(/.test(String(str).trim())) return 'rgba(' + key + ',' + c.a + ')';
      return str;
    }
    return 'rgba(' + to + ',' + c.a + ')';
  }

  function remapAny(v) {
    if (typeof v === 'string') return remapColor(v);
    if (Array.isArray(v)) return v.map(remapColor);
    return v; // funções/gradientes: não tocar
  }

  /* Gradiente vertical (ou horizontal p/ indexAxis:'y') a partir da cor base */
  function gradientize(orig, horizontal) {
    function baseAt(i) {
      return Array.isArray(orig) ? orig[i % orig.length] : orig;
    }
    return function (ctx) {
      var base = baseAt(ctx.dataIndex || 0);
      var chart = ctx.chart, area = chart.chartArea;
      var c = parseColor(base);
      if (!area || !c) return base;
      var g = horizontal
        ? chart.ctx.createLinearGradient(area.left, 0, area.right, 0)
        : chart.ctx.createLinearGradient(0, area.bottom, 0, area.top);
      g.addColorStop(0, 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + Math.max(0, c.a * 0.5) + ')');
      g.addColorStop(1, 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + Math.min(1, c.a * 1.18) + ')');
      return g;
    };
  }

  /* ── Defaults globais (lidos a cada criação p/ acompanhar o tema) ─────── */
  function applyDefaults(Chart) {
    var light = isLight();
    var text2 = cssVar('--text2') || (light ? '#536179' : '#9aa9bf');
    var grid = light ? 'rgba(15,23,42,.07)' : 'rgba(148,163,184,.08)';

    Chart.defaults.color = text2;
    Chart.defaults.font.family = "'Inter','Segoe UI',system-ui,sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.borderColor = grid;
    Chart.defaults.animation.duration = 650;
    Chart.defaults.animation.easing = 'easeOutQuart';

    var tt = Chart.defaults.plugins.tooltip;
    tt.backgroundColor = light ? 'rgba(255,255,255,.97)' : 'rgba(10,16,28,.94)';
    tt.titleColor = light ? '#15202e' : '#eef3fb';
    tt.bodyColor = light ? '#536179' : '#b7c3d4';
    tt.borderColor = light ? 'rgba(15,23,42,.1)' : 'rgba(148,163,184,.18)';
    tt.borderWidth = 1;
    tt.cornerRadius = 12;
    tt.padding = 12;
    tt.caretSize = 6;
    tt.boxPadding = 4;
    tt.usePointStyle = true;
    tt.titleFont = { weight: '700', size: 12.5, family: "'Inter',system-ui,sans-serif" };
    tt.bodyFont = { size: 12, family: "'Inter',system-ui,sans-serif" };

    var lg = Chart.defaults.plugins.legend.labels;
    lg.usePointStyle = true;
    lg.boxWidth = 8;
    lg.boxHeight = 8;
    lg.padding = 14;
  }

  /* ── Transformação do config antes da criação ─────────────────────────── */
  var COLOR_PROPS = ['backgroundColor', 'borderColor', 'hoverBackgroundColor',
    'hoverBorderColor', 'pointBackgroundColor', 'pointBorderColor'];

  function premiumize(config) {
    if (!config || !config.data || !Array.isArray(config.data.datasets)) return;
    var type = config.type;
    var opts = config.options || (config.options = {});
    var horizontal = opts.indexAxis === 'y';
    var light = isLight();
    var cardBg = cssVar('--card') || (light ? '#ffffff' : '#0f1727');
    var grid = light ? 'rgba(15,23,42,.07)' : 'rgba(148,163,184,.08)';

    config.data.datasets.forEach(function (ds) {
      var dsType = ds.type || type;

      COLOR_PROPS.forEach(function (p) {
        if (ds[p] !== undefined) ds[p] = remapAny(ds[p]);
      });

      if (dsType === 'bar') {
        if (typeof ds.backgroundColor === 'string' || Array.isArray(ds.backgroundColor)) {
          var solid = ds.backgroundColor;
          ds.backgroundColor = gradientize(solid, horizontal);
          if (ds.hoverBackgroundColor === undefined) {
            ds.hoverBackgroundColor = function (ctx) {
              var base = Array.isArray(solid) ? solid[(ctx.dataIndex || 0) % solid.length] : solid;
              var c = parseColor(base);
              return c ? 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',1)' : base;
            };
          }
        }
        if (typeof ds.borderRadius === 'number') ds.borderRadius = Math.max(ds.borderRadius, 7);
        else if (ds.borderRadius === undefined) ds.borderRadius = 7;
        if (ds.maxBarThickness === undefined) ds.maxBarThickness = 44;
      }

      if (dsType === 'doughnut' || dsType === 'pie' || dsType === 'polarArea') {
        ds.borderColor = cardBg;
        if (ds.borderWidth === undefined) ds.borderWidth = 2;
        if (ds.hoverOffset === undefined) ds.hoverOffset = 8;
      }
    });

    /* Grid consistente em todas as escalas declaradas inline */
    if (opts.scales) {
      Object.keys(opts.scales).forEach(function (k) {
        var sc = opts.scales[k];
        if (!sc || typeof sc !== 'object') return;
        sc.grid = sc.grid || {};
        if (typeof sc.grid.color !== 'function') sc.grid.color = grid;
        if (sc.grid.drawTicks === undefined) sc.grid.drawTicks = false;
        sc.border = sc.border || {};
        if (sc.border.display === undefined) sc.border.display = false;
        sc.ticks = sc.ticks || {};
        if (sc.ticks.padding === undefined) sc.ticks.padding = 7;
      });
    }
  }

  /* ── Wrapper do construtor ─────────────────────────────────────────────── */
  function installChartWrapper() {
    var Orig = window.Chart;
    if (!Orig || Orig.__pmWrapped) return;

    function PremiumChart(item, config) {
      try {
        applyDefaults(Orig);
        premiumize(config);
      } catch (e) { /* nunca quebrar a view por causa do tema */ }
      return new Orig(item, config);
    }
    PremiumChart.prototype = Orig.prototype;
    Object.setPrototypeOf(PremiumChart, Orig); // estáticos: defaults, register, getChart…
    PremiumChart.__pmWrapped = true;
    window.Chart = PremiumChart;

    try { applyDefaults(Orig); } catch (e) { }
  }

  if (window.Chart) installChartWrapper();
  else {
    // Chart.js pode carregar depois (defer/async) — vigia a chegada
    var tries = 0;
    var t = setInterval(function () {
      if (window.Chart) { installChartWrapper(); clearInterval(t); }
      else if (++tries > 200) clearInterval(t);
    }, 25);
  }

  /* ── Menu lateral canônico ─────────────────────────────────────────────
     Cada view trazia sua própria cópia do nav-drawer (o forecast tinha só 2
     itens). Fonte única de verdade: o mesmo menu, ícones e ordem em todas as
     views de navegação. Drawers internos (ex.: dashboard.html legado, que usa
     switchView) são detectados e preservados. */
  var NAV_MODEL = [
    { href: '/novo', label: 'CRO Dashboard', svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>' },
    { href: '/novo-board', label: 'Board View', health: 'g', svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20h20M4 20V10l8-6 8 6v10"/><path d="M10 20v-6h4v6"/></svg>' },
    { href: '/novo-ae', label: 'AE Performance', health: 'g', svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' },
    /* Grupo BDR (acordeão): "BDR Performance" é o pai (acc) e leva à visão geral;
       as subpáginas (sub) ficam recolhidas atrás da setinha. Espelha o PANELS
       inline das páginas grandes — ver docs/nav-bdr-accordion.md. */
    { href: '/novo-bdr', label: 'BDR Performance', health: 'g', acc: true, grp: 'bdr', svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' },
    { href: '/novo-bdr/workload', label: 'Workload | Intraday', health: 'y', sub: true, grp: 'bdr', svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>' },
    { href: '/novo-bdr/no-show', label: 'No-Show', health: 'g', sub: true, grp: 'bdr', svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="14" y1="14" x2="10" y2="18"/><line x1="10" y1="14" x2="14" y2="18"/></svg>' },
    { href: '/novo-bdr/list-attack', label: 'Ataque à Lista', health: 'g', sub: true, grp: 'bdr', svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>' },
    { href: '/novo-bdr/treble', label: 'Treble', health: 'y', sub: true, grp: 'bdr', svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 9h8"/><path d="M8 13h5"/></svg>' },
    { href: '/novo-48h', label: 'Last 48h', health: 'g', svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' },
    // CS Dashboard e Cotação ocultos do menu (pedido do dono, 2026-07-16) — rotas
    // /novo-cs e /novo-cotacao continuam vivas; espelho do hidden:true do nav.js.
    { divider: true },
    { href: '/forecast', label: 'Forecast', svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>' }
  ];

  function buildCanonicalNav() {
    var menu = document.querySelector('.nav-drawer .nav-menu');
    if (!menu) return;
    // Drawer interno (alterna views dentro da própria página): não tocar
    if (/switchView/.test(menu.innerHTML)) return;

    var current = location.pathname.replace(/\.html$/, '') || '/' + page;
    if (page === 'novo-dashboard' || page === 'dashboard' || current === '/dashboard') current = '/novo';
    if (current === '/dashboard/bdr/workload' || current === '/novo-bdr-workload' || page === 'bdr-workload') current = '/novo-bdr/workload';
    if (current === '/dashboard/bdr/no-show' || current === '/novo-bdr-no-show' || page === 'bdr-no-show') current = '/novo-bdr/no-show';
    if (current === '/dashboard/bdr/list-attack' || current === '/novo-bdr-list-attack' || page === 'bdr-list-attack') current = '/novo-bdr/list-attack';
    if (current === '/dashboard/bdr/treble' || current === '/novo-bdr-treble' || page === 'bdr-treble') current = '/novo-bdr/treble';

    function dot(h) {
      if (!h) return '';
      var tt = { g: 'live', y: 'wip', r: 'not working' };
      var t = tt[h] || '';
      return '<span class="health-dot ' + h + '" title="' + t + '" aria-label="' + t + '"></span>';
    }
    var CHEVRON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

    var html = '';
    NAV_MODEL.forEach(function (it) {
      if (it.divider) { html += '<li class="nav-divider" role="separator"></li>'; return; }
      var active = it.href === current;
      var cls = 'nav-item' + (it.sub ? ' nav-sub' : '') + (it.acc ? ' nav-acc' : '') + (active ? ' active' : '');
      var acc = it.acc ? '<span class="nav-acc-chevron" data-acc-grp="' + it.grp + '" role="button" tabindex="0" title="Mostrar/ocultar subpáginas" aria-label="Mostrar/ocultar subpáginas">' + CHEVRON + '</span>' : '';
      html += '<li class="' + cls + '" data-href="' + it.href + '"' +
        (it.grp ? ' data-grp="' + it.grp + '"' : '') +
        (active ? ' aria-current="page"' : '') + '>' + it.svg + it.label + dot(it.health) + acc + '</li>';
    });
    menu.innerHTML = html;

    // Acordeão: recolhe cada grupo, exceto o que contém a página atual.
    var groups = {};
    NAV_MODEL.forEach(function (it) {
      if (!it.grp) return;
      if (groups[it.grp] === undefined) groups[it.grp] = false;
      if ((it.acc || it.sub) && it.href === current) groups[it.grp] = true;
    });
    function setGroup(grp, open) {
      var subs = menu.querySelectorAll('.nav-item.nav-sub[data-grp="' + grp + '"]');
      for (var i = 0; i < subs.length; i++) subs[i].classList.toggle('nav-collapsed', !open);
      var ch = menu.querySelector('.nav-acc-chevron[data-acc-grp="' + grp + '"]');
      if (ch) ch.classList.toggle('open', open);
    }
    Object.keys(groups).forEach(function (g) { setGroup(g, groups[g]); });
    // Local de propósito: NÃO sobrescrever window.toggleNavGroup — as páginas
    // grandes trazem a própria versão inline (DOM diferente, com <a href>).
    function toggleGroup(grp) {
      var ch = menu.querySelector('.nav-acc-chevron[data-acc-grp="' + grp + '"]');
      setGroup(grp, !(ch && ch.classList.contains('open')));
    }

    menu.addEventListener('click', function (e) {
      // Clique na setinha: só expande/recolhe, não navega.
      var chev = e.target.closest ? e.target.closest('.nav-acc-chevron') : null;
      if (chev) { e.stopPropagation(); e.preventDefault(); toggleGroup(chev.getAttribute('data-acc-grp')); return; }
      var li = e.target.closest ? e.target.closest('.nav-item') : null;
      if (li && li.getAttribute('data-href') && !li.classList.contains('active')) {
        window.location.href = li.getAttribute('data-href');
      }
    });
  }

  /* ── Entrance stagger dos cards (re-renders incluídos) ─────────────────── */
  var SEL = '.kpi-card, .kpi-sec, .novo-card';

  function animateIn(root) {
    var els = [];
    if (root.nodeType !== 1) return;
    if (root.matches && root.matches(SEL)) els.push(root);
    if (root.querySelectorAll) els = els.concat(Array.prototype.slice.call(root.querySelectorAll(SEL)));
    els.forEach(function (el, i) {
      if (el.classList.contains('pm-in')) return;
      el.style.setProperty('--pm-i', i % 14);
      el.classList.add('pm-in');
    });
  }

  function startObserver() {
    if (!document.body) return;
    buildCanonicalNav();
    animateIn(document.body);
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        Array.prototype.forEach.call(m.addedNodes, animateIn);
      });
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }
})();
