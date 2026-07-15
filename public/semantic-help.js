'use strict';
/* semantic-help.js | Drawer de proveniência GERADO da camada semântica (Fase 3 do 2.0).
 *
 * v2 (redesign 2026-07-15, feedback do dono): narrativa de negócio primeiro —
 * explicação → como calculamos → tabela → regras práticas — e os metadados
 * técnicos (campos do HubSpot, vigência, código) recolhidos num <details>.
 * Campos aparecem pelo LABEL OFICIAL do portal (label_portal), não pelo interno.
 * CSS próprio injetado (classes sh-*), consistente em qualquer painel hospedeiro.
 *
 * 100% gerado de window.SEMANTIC_REF (catálogo) — nada escrito à mão (ADR-006).
 * Uso: <div data-semantic-help="regra1,regra2"></div> ou SemanticHelp.render(el, keys).
 * ES5 puro. Requer semantic-ref.js incluído ANTES.
 */
(function () {
  var CSS = '' +
    '.sh-sec{background:var(--card2,rgba(127,127,127,.06));border:1px solid var(--border,rgba(127,127,127,.18));border-left:3px solid var(--teal,#23d1b4);border-radius:10px;padding:.85rem 1rem .7rem;margin:0 0 .8rem;text-align:left}' +
    '.sh-h{font-size:.88rem;font-weight:700;margin:0 0 .4rem;color:var(--text,inherit);display:flex;align-items:center;flex-wrap:wrap;gap:.45rem}' +
    '.sh-badge{font-size:.6rem;font-weight:600;padding:.08rem .45rem;border-radius:99px;letter-spacing:.02em;white-space:nowrap}' +
    '.sh-badge.rev{background:rgba(210,153,34,.16);color:var(--yellow,#d29922)}' +
    '.sh-badge.ok{background:rgba(46,160,67,.16);color:var(--green,#2ea043)}' +
    '.sh-badge.man{background:rgba(127,127,127,.14);color:var(--text2,inherit)}' +
    '.sh-lead{margin:0 0 .55rem;font-size:.79rem;line-height:1.6;color:var(--text,inherit)}' +
    '.sh-lbl{display:block;font-size:.62rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text2,inherit);opacity:.8;margin:0 0 .25rem}' +
    '.sh-calc{background:rgba(127,127,127,.09);border-radius:8px;padding:.55rem .7rem;font-size:.76rem;line-height:1.6;margin:0 0 .6rem;color:var(--text,inherit)}' +
    '.sh-note{font-size:.75rem;line-height:1.55;margin:.3rem 0;color:var(--text,inherit)}' +
    '.sh-note b{font-weight:600}' +
    '.sh-tablewrap{overflow-x:auto;margin:0 0 .6rem}' +
    '.sh-table{border-collapse:collapse;font-size:.74rem;color:var(--text,inherit)}' +
    '.sh-table th{text-align:left;padding:.3rem .65rem;border-bottom:2px solid var(--border,rgba(127,127,127,.3));font-weight:600;white-space:nowrap}' +
    '.sh-table td{padding:.3rem .65rem;border-bottom:1px solid var(--border,rgba(127,127,127,.15))}' +
    '.sh-tech{margin:.45rem 0 .1rem;font-size:.72rem;color:var(--text2,inherit)}' +
    '.sh-tech summary{cursor:pointer;font-size:.7rem;opacity:.75;user-select:none}' +
    '.sh-tech[open] summary{margin-bottom:.35rem}' +
    '.sh-chip{display:inline-block;background:rgba(127,127,127,.12);border-radius:6px;padding:.06rem .45rem;margin:.12rem .18rem .12rem 0;font-size:.7rem;line-height:1.45}' +
    '.sh-chip code{font-size:.62rem;opacity:.7}';

  var STATUS = {
    rascunho: { cls: 'rev', txt: '🟡 rascunho' },
    em_revisao: { cls: 'rev', txt: '🟠 em revisão' },
    validado: { cls: 'ok', txt: '🟢 validado' },
    descontinuado: { cls: 'man', txt: '🔴 descontinuado' }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function injectCss() {
    if (document.getElementById('sh-css')) return;
    var st = document.createElement('style');
    st.id = 'sh-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function chip(ref, key) {
    var d = ref.dados[key];
    if (!d) return '<span class="sh-chip">' + esc(key) + '</span>';
    var nome = (d.label_portal || d.label.pt);
    var tech = d.hubspot ? ' <code>' + esc(d.hubspot) + '</code>' : ' <em>(manual)</em>';
    return '<span class="sh-chip">' + esc(nome) + tech + '</span>';
  }

  function tabela(t) {
    var h = '<div class="sh-tablewrap"><table class="sh-table"><thead><tr>';
    for (var i = 0; i < t.colunas.length; i++) h += '<th>' + esc(t.colunas[i]) + '</th>';
    h += '</tr></thead><tbody>';
    for (var r = 0; r < t.linhas.length; r++) {
      h += '<tr>';
      for (var c = 0; c < t.linhas[r].length; c++) h += '<td>' + esc(t.linhas[r][c]) + '</td>';
      h += '</tr>';
    }
    return h + '</tbody></table></div>';
  }

  function vpvTabela(vpv) {
    var t = { colunas: ['Faixa de vidas', 'R$/vida/mês'], linhas: [] };
    for (var i = 0; i < vpv.faixas.length; i++) {
      var f = vpv.faixas[i];
      t.linhas.push([f.vidas_max == null ? 'acima' : 'até ' + f.vidas_max, 'R$ ' + f.valor]);
    }
    return tabela(t);
  }

  function secao(ref, key) {
    var r = ref.regras[key];
    if (!r) return '<section class="sh-sec"><p class="sh-lead">⚠ regra <code>' + esc(key) + '</code> não encontrada no catálogo.</p></section>';
    var st = STATUS[r.status] || STATUS.rascunho;
    var h = '<section class="sh-sec" data-regra="' + esc(key) + '">';

    // Título + selos (status; ✏️ quando envolve dado manual)
    h += '<h3 class="sh-h">' + esc(r.label.pt) +
      '<span class="sh-badge ' + st.cls + '">' + st.txt + '</span>' +
      (r.tipo === 'manual' || r.tipo === 'hibrido' ? '<span class="sh-badge man">✏️ contém dado manual</span>' : '') +
      '</h3>';

    // 1. O que é (linguagem de negócio)
    if (r.ajuda && r.ajuda.pt) h += '<p class="sh-lead">' + esc(r.ajuda.pt) + '</p>';

    // 2. Como calculamos
    if (r.formula) h += '<div class="sh-calc"><span class="sh-lbl">Como calculamos</span>' + esc(r.formula) + '</div>';
    if (r.tabela) h += tabela(r.tabela);
    if (r.usa_referencia && r.usa_referencia.indexOf('valor_por_vida') !== -1 && ref.valor_por_vida) h += vpvTabela(ref.valor_por_vida);

    // 3. Regras práticas, em frases nomeadas
    if (r.precedencia) h += '<p class="sh-note"><b>Ordem de prioridade |</b> ' + esc(r.precedencia) + '</p>';
    if (r.filtro) h += '<p class="sh-note"><b>O que entra na conta |</b> ' + esc(r.filtro) + '</p>';
    if (r.faltantes) h += '<p class="sh-note"><b>Quando falta dado |</b> ' + esc(r.faltantes) + '</p>';

    // 4. Técnica recolhida (clique para abrir)
    var tech = '';
    if (r.usa_dados && r.usa_dados.length) {
      var chips = [];
      for (var i = 0; i < r.usa_dados.length; i++) chips.push(chip(ref, r.usa_dados[i]));
      tech += '<div><span class="sh-lbl">Campos do HubSpot usados</span>' + chips.join('') + '</div>';
    }
    if (r.ponto_no_tempo) tech += '<p class="sh-note"><b>Fotos históricas |</b> ' + esc(r.ponto_no_tempo) + '</p>';
    if (r.notas) tech += '<p class="sh-note"><b>Notas |</b> ' + esc(r.notas) + '</p>';
    tech += '<p class="sh-note">Vigente desde ' + esc(r.vigente_desde) + ' · definição: catálogo semântico (semantic/regras.json → <code>' + esc(key) + '</code>) · implementação: ' + esc((r.fonte_codigo || []).join(' · ')) + '</p>';
    h += '<details class="sh-tech"><summary>Detalhes técnicos</summary>' + tech + '</details>';

    return h + '</section>';
  }

  function render(el, keys) {
    var ref = window.SEMANTIC_REF;
    if (!ref || !ref.regras) { el.innerHTML = '<p class="sh-lead">⚠ catálogo semântico indisponível (semantic-ref.js).</p>'; return; }
    injectCss();
    var html = '';
    for (var i = 0; i < keys.length; i++) html += secao(ref, keys[i]);
    el.innerHTML = html;
  }

  function auto() {
    var nodes = document.querySelectorAll('[data-semantic-help]');
    for (var i = 0; i < nodes.length; i++) {
      var keys = nodes[i].getAttribute('data-semantic-help').split(',');
      for (var k = 0; k < keys.length; k++) keys[k] = keys[k].replace(/^\s+|\s+$/g, '');
      render(nodes[i], keys);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto);
  else auto();

  window.SemanticHelp = { render: render };
})();
