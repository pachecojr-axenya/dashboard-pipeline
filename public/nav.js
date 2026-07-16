'use strict';
/**
 * nav.js | Menu lateral + panel switcher | FONTE ÚNICA (Regra primária nº 2).
 *
 * Antes, o bloco PANELS + buildNav era copiado em 10 HTMLs → menus divergentes.
 * Agora vive SÓ aqui: cada página inclui <script src="/nav.js?v=N"></script> e este
 * arquivo injeta o CSS, monta o drawer (#nav-drawer) e o dropdown do título (#panel-dd),
 * marca a página ativa por URL e roda no load. Para mudar um item do menu, edite APENAS
 * este arquivo. Depende de globais que cada página já define: closeDrawer,
 * doLogout/logout, toggleTheme e (opcional) novoToggleLang (footer/handlers do chrome).
 *
 * Acordeão generalizado por grupo: item com acc:'<g>' vira cabeçalho recolhível do grupo
 * <g>; itens com sub:'<g>' são os filhos. Hoje: 'fc' (Forecast) e 'bdr' (BDR).
 */
(function () {
  // ── CSS (injetado uma vez) ────────────────────────────────────────────────
  if (!document.getElementById('nav-shared-css')) {
    var st = document.createElement('style'); st.id = 'nav-shared-css';
    st.textContent = [
      '.panel-switcher{position:relative;display:inline-block}',
      '.panel-switch-btn{display:inline-flex;align-items:center;gap:.5rem;background:none;border:none;padding:0;margin:0;cursor:pointer;color:inherit;font:inherit;text-align:left}',
      '.panel-switch-btn h1{margin:0}',
      '.panel-chevron{transition:transform .22s ease,color .15s ease;color:var(--text2);flex-shrink:0}',
      '.panel-switcher.open .panel-chevron{transform:rotate(180deg)}',
      '.panel-switch-btn:hover .panel-chevron{color:var(--teal)}',
      '.panel-dd{position:absolute;top:calc(100% + 10px);left:0;min-width:236px;background:rgba(23,31,46,.62);backdrop-filter:blur(20px) saturate(1.7);-webkit-backdrop-filter:blur(20px) saturate(1.7);border:none;border-radius:12px;box-shadow:0 16px 40px rgba(0,0,0,.4);padding:.4rem;z-index:1500;opacity:0;transform:translateY(-6px);pointer-events:none;transition:opacity .18s ease,transform .18s ease}',
      '[data-theme="light"] .panel-dd{background:rgba(246,248,250,.7)}',
      '.panel-switcher.open .panel-dd{opacity:1;transform:translateY(0);pointer-events:auto}',
      '.panel-dd-item{display:flex;align-items:center;gap:.65rem;padding:.55rem .7rem;border-radius:8px;cursor:pointer;font-size:.85rem;color:var(--text2);transition:background .14s,color .14s;white-space:nowrap}',
      '.panel-dd-item:hover{background:rgba(255,255,255,.1);color:var(--text)}',
      '.panel-dd-item.active{color:var(--teal);font-weight:600;background:rgba(58,184,183,.16)}',
      '.panel-dd-item.active svg{stroke:var(--teal)}',
      '.panel-dd-item svg{flex-shrink:0;opacity:.9}',
      '[data-theme="light"] .panel-dd-item:hover{background:rgba(0,0,0,.06)}',
      '.health-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;display:inline-block;animation:health-glow 1.8s ease-in-out infinite}',
      '.panel-switch-btn .health-dot{margin:0 .15rem}',
      '.nav-item .health-dot,.panel-dd-item .health-dot{margin-left:auto}',
      '@keyframes health-glow{0%,100%{box-shadow:0 0 3px 0 var(--hg)}50%{box-shadow:0 0 9px 2px var(--hg)}}',
      '.health-dot.g{background:#2ecc71;--hg:rgba(46,204,113,.95)}',
      '.health-dot.y{background:#f1c40f;--hg:rgba(241,196,15,.95)}',
      '.health-dot.r{background:#e74c3c;--hg:rgba(231,76,60,.95)}',
      '.nav-menu li.nav-hidden{display:none}',
      '.novo-theme-sun{display:block}',
      '.novo-theme-moon{display:none}',
      '[data-theme="light"] .novo-theme-sun{display:none}',
      '[data-theme="light"] .novo-theme-moon{display:block}',
      '.modal-body,.novo-help-body,.novo-prob-body,[style*="overflow-x:auto"]{scrollbar-width:thin;scrollbar-color:var(--text2) transparent}',
      '.modal-body::-webkit-scrollbar,.novo-help-body::-webkit-scrollbar,.novo-prob-body::-webkit-scrollbar,[style*="overflow-x:auto"]::-webkit-scrollbar{height:11px;width:11px}',
      '.modal-body::-webkit-scrollbar-track,.novo-help-body::-webkit-scrollbar-track,.novo-prob-body::-webkit-scrollbar-track,[style*="overflow-x:auto"]::-webkit-scrollbar-track{background:transparent}',
      '.modal-body::-webkit-scrollbar-thumb,.novo-help-body::-webkit-scrollbar-thumb,.novo-prob-body::-webkit-scrollbar-thumb,[style*="overflow-x:auto"]::-webkit-scrollbar-thumb{background:var(--text2);border-radius:8px;border:2px solid transparent;background-clip:padding-box}',
      '.modal-body::-webkit-scrollbar-thumb:hover,.novo-help-body::-webkit-scrollbar-thumb:hover,.novo-prob-body::-webkit-scrollbar-thumb:hover,[style*="overflow-x:auto"]::-webkit-scrollbar-thumb:hover{background:var(--teal)}'
    ].join('\n');
    document.head.appendChild(st);
  }

  // ── Menu (fonte única) ──────────────────────────────────────────────────────
  var PANELS = [
    {label:'CRO Dashboard',url:'/novo',file:'dashboard.html',health:'g',icon:'<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>'},
    {label:'Board View',url:'/novo-board',file:'board.html',health:'g',icon:'<path d="M2 20h20M4 20V10l8-6 8 6v10"/><path d="M10 20v-6h4v6"/>'},
    {label:'AE Performance',url:'/novo-ae',file:'ae.html',health:'g',icon:'<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'},
    {label:'BDR Performance',url:'/novo-bdr',file:'bdr.html',health:'g',acc:'bdr',icon:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'},
    {label:'Workload | Intraday',url:'/novo-bdr/workload',file:'bdr-workload.html',sub:'bdr',health:'y',icon:'<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'},
    {label:'No-Show',url:'/novo-bdr/no-show',file:'bdr-no-show.html',sub:'bdr',health:'g',icon:'<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'},
    {label:'Ataque à Lista',url:'/novo-bdr/list-attack',file:'bdr-list-attack.html',sub:'bdr',health:'g',icon:'<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>'},
    {label:'Treble',url:'/novo-bdr/treble',file:'bdr-treble.html',sub:'bdr',health:'y',icon:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'},
    {label:'Last 48h',url:'/novo-48h',file:'48h.html',health:'g',icon:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'},
    // hidden:true = fora do menu/dropdown, rota continua viva (pedido do dono, 2026-07-16).
    {label:'CS Dashboard',url:'/novo-cs',file:'cs.html',health:'r',hidden:true,icon:'<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>'},
    {label:'Cotação',url:'/novo-cotacao',file:'cotacao.html',health:'r',hidden:true,icon:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>'},
    {label:'Forecast',url:'/forecast',file:'forecast.html',health:'g',sec:'Forecast',icon:'<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'},
    {label:'Comparativo',url:'/forecast-delta',file:'forecast-delta.html',health:'y',icon:'<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>'},
    {label:'Overall',url:'/forecast-overall',acc:'fc',file:'forecast-panel.html',health:'g',icon:'<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>'},
    {label:'MQL / Reunião',url:'/forecast-mql',sub:'fc',file:'forecast-panel.html',health:'g',icon:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'},
    {label:'Diagnóstico',url:'/forecast-diagnostico',sub:'fc',file:'forecast-panel.html',health:'g',icon:'<path d="M9 11H5a2 2 0 0 0-2 2v7h6"/><path d="M14 11h5a2 2 0 0 1 2 2v7h-6"/><path d="M9 7h6"/><circle cx="12" cy="5" r="2"/>'},
    {label:'Cotação',url:'/forecast-cotacao',sub:'fc',file:'forecast-panel.html',health:'g',icon:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'},
    {label:'Consultoria',url:'/forecast-consultoria',sub:'fc',file:'forecast-panel.html',health:'g',icon:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'},
    {label:'Negociação',url:'/forecast-negociacao',sub:'fc',file:'forecast-panel.html',health:'g',icon:'<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'},
    {label:'BID',url:'/forecast-bid',sub:'fc',file:'forecast-panel.html',health:'g',icon:'<path d="M3 3v18h18"/><path d="M19 9l-5 5-3-3-4 4"/>'},
    {label:'Ganho',url:'/forecast-ganho',sub:'fc',file:'forecast-panel.html',health:'g',icon:'<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'}
  ];
  function findByUrl(u){ for(var i=0;i<PANELS.length;i++){ if(PANELS[i].url===u) return PANELS[i]; } return null; }
  var p2 = location.pathname; if (p2.length > 1 && p2.charAt(p2.length - 1) === '/') p2 = p2.slice(0, -1);
  var current = null;
  for (var i = 0; i < PANELS.length; i++) { if (p2 === PANELS[i].url || p2.indexOf(PANELS[i].file) !== -1) { current = PANELS[i].url; break; } }
  function dot(h){ var tt={g:'live',y:'wip',r:'not working'}; var t=tt[h]||''; return '<span class="health-dot '+h+'" title="'+t+'" aria-label="'+t+'"></span>'; }
  function svgFor(p){ return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+p.icon+'</svg>'; }

  // Acordeão por grupo. toggleNavGroup(e,'fc'|'bdr') recolhe/expande os filhos do grupo.
  window.toggleNavGroup = function (e, g) {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    var nav = document.getElementById('nav-drawer'); if (!nav) return;
    var chev = nav.querySelector('.nav-acc-chevron[data-group="' + g + '"]');
    var willCollapse = chev ? chev.classList.contains('open') : true;
    var lis = nav.querySelectorAll('.nav-menu li[data-group="' + g + '"]');
    for (var k = 0; k < lis.length; k++) lis[k].classList.toggle('nav-hidden', willCollapse);
    if (chev) chev.classList.toggle('open', !willCollapse);
  };
  // Compat: chamadas antigas ao acordeão do Forecast continuam funcionando.
  window.toggleForecastAccordion = function (e) { window.toggleNavGroup(e, 'fc'); };

  function chevron(g){ return '<span class="nav-acc-chevron" data-group="'+g+'" onclick="toggleNavGroup(event,\''+g+'\')" title="Mostrar/ocultar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>'; }

  function buildNav(){
    var nav=document.getElementById('nav-drawer'); if(!nav) return;
    var h='<div class="nav-drawer-header"><span class="nav-drawer-brand">Dashboard Axenya</span>'+
      '<button class="hdr-btn" onclick="closeDrawer()" aria-label="Fechar menu"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>'+
      '<ul class="nav-menu">';
    for(var i=0;i<PANELS.length;i++){
      var p=PANELS[i];
      if(p.hidden) continue;
      if(p.sec) h+='<li style="list-style:none;padding:.85rem 1.25rem .3rem;margin-top:.35rem;border-top:1px solid var(--border);font-size:.64rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text2)">'+p.sec+'</li>';
      var accId=p.acc||''; var subId=p.sub||'';
      var chev = accId ? chevron(accId) : '';
      var liAttr = subId ? ' data-group="'+subId+'"' : '';
      var cls='nav-item'+(subId?' nav-sub':'')+(accId?' nav-acc':'')+(p.url===current?' active':'');
      h+='<li'+liAttr+'><a class="'+cls+'" href="'+p.url+'" data-url="'+p.url+'" style="text-decoration:none">'+svgFor(p)+'<span>'+p.label+'</span>'+dot(p.health)+chev+'</a></li>';
    }
    // Idioma: só nas páginas que expõem novoToggleLang (forecast/forecast-stage não têm).
    var langBtn = (typeof window.novoToggleLang === 'function')
      ? '<button class="nav-foot-btn" type="button" onclick="novoToggleLang()" title="Idioma / Language"><span id="novo-lang-label">'+(typeof window.NOVO_LANG!=='undefined'&&window.NOVO_LANG==='pt'?'EN':'PT')+'</span></button>'
      : '';
    h+='</ul><div class="nav-drawer-footer"><button class="nav-foot-btn" type="button" onclick="(window.doLogout||window.logout)()" title="Sair" aria-label="Sair"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></button>'+langBtn+'<button class="nav-foot-btn" type="button" onclick="toggleTheme()" title="Tema / Theme"><svg class="novo-theme-sun" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg><svg class="novo-theme-moon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg></button></div>';
    nav.innerHTML=h;
    // Auto-recolher: cada grupo de acordeão começa expandido só se a página atual pertence a ele.
    var groups={}; for(var a=0;a<PANELS.length;a++){ if(PANELS[a].acc) groups[PANELS[a].acc]=true; }
    Object.keys(groups).forEach(function(g){
      var inGroup=false;
      for(var k=0;k<PANELS.length;k++){ var q=PANELS[k]; if((q.acc===g||q.sub===g)&&q.url===current){ inGroup=true; break; } }
      var chev=nav.querySelector('.nav-acc-chevron[data-group="'+g+'"]');
      if(!inGroup){ var lis=nav.querySelectorAll('.nav-menu li[data-group="'+g+'"]'); for(var j=0;j<lis.length;j++) lis[j].classList.add('nav-hidden'); if(chev) chev.classList.remove('open'); }
      else if(chev){ chev.classList.add('open'); }
    });
  }
  function buildDropdown(){
    var dd=document.getElementById('panel-dd'); if(!dd) return;
    var html='';
    for(var i=0;i<PANELS.length;i++){ var p=PANELS[i]; if(p.hidden) continue; var act=(p.url===current?' active':''); html+='<a class="panel-dd-item'+act+'" role="menuitem" href="'+p.url+'" data-url="'+p.url+'" style="text-decoration:none">'+svgFor(p)+'<span>'+p.label+'</span>'+dot(p.health)+'</a>'; }
    dd.innerHTML=html;
  }
  function buildTitleDot(){
    var btn=document.querySelector('.panel-switch-btn');
    if(btn && current && !btn.querySelector('.health-dot')){
      var cp=findByUrl(current);
      if(cp){ var s=document.createElement('span'); s.className='health-dot '+cp.health; var _tt={g:'live',y:'wip',r:'not working'}; s.title=_tt[cp.health]||''; s.setAttribute('aria-label',s.title); var ch=btn.querySelector('.panel-chevron'); if(ch) btn.insertBefore(s,ch); else btn.appendChild(s); }
    }
  }
  function build(){ buildNav(); buildDropdown(); buildTitleDot(); }
  window.togglePanelMenu=function(e){ if(e){e.stopPropagation();} var sw=document.getElementById('panel-switcher'); if(!sw) return; var open=!sw.classList.contains('open'); sw.classList.toggle('open',open); var btn=sw.querySelector('.panel-switch-btn'); if(btn) btn.setAttribute('aria-expanded',open?'true':'false'); };
  window.closePanelMenu=function(){ var sw=document.getElementById('panel-switcher'); if(sw){ sw.classList.remove('open'); var btn=sw.querySelector('.panel-switch-btn'); if(btn) btn.setAttribute('aria-expanded','false'); } };
  document.addEventListener('click',function(e){ var sw=document.getElementById('panel-switcher'); if(sw&&sw.classList.contains('open')&&!sw.contains(e.target)) window.closePanelMenu(); });
  // Escape em cascata (paridade com o antigo bloco inline): settings → ajuda → modal → dropdown.
  document.addEventListener('keydown',function(e){
    if(e.key!=='Escape'&&e.keyCode!==27) return;
    var gs=document.getElementById('gs-drawer'); if(gs&&gs.classList.contains('open')&&typeof window.novoCloseSettings==='function'){ window.novoCloseSettings(); return; }
    var help=document.getElementById('novo-help-drawer'); if(help&&help.classList.contains('open')&&typeof window.novoCloseHelp==='function'){ window.novoCloseHelp(); return; }
    var modal=document.getElementById('modal-overlay'); if(modal&&modal.classList.contains('open')&&typeof window.closeModal==='function'){ window.closeModal(); return; }
    var sw=document.getElementById('panel-switcher'); if(sw&&sw.classList.contains('open')) window.closePanelMenu();
  });
  if(document.readyState!=='loading') build(); else document.addEventListener('DOMContentLoaded',build);
})();
