'use strict';
/* semantic-help.js | Drawer de proveniência GERADO da camada semântica (Fase 3 do 2.0).
 *
 * Renderiza seções de ajuda a partir de window.SEMANTIC_REF (regras + dados do
 * catálogo), no lugar de texto escrito à mão — se o catálogo está certo, a ajuda
 * está certa (ADR-006). ES5 puro. Requer semantic-ref.js incluído ANTES.
 *
 * Uso: <div data-semantic-help="regra1,regra2"></div> — auto-renderiza no load.
 * Ou: SemanticHelp.render(el, ['regra1','regra2']).
 * Usa as classes .help-section/.help-h3/.help-p/.help-table do painel hospedeiro.
 */
(function () {
  var STATUS_EMOJI = { rascunho: '🟡', em_revisao: '🟠', validado: '🟢', descontinuado: '🔴' };
  var STATUS_LABEL = { rascunho: 'rascunho', em_revisao: 'em revisão', validado: 'validado', descontinuado: 'descontinuado' };
  var TIPO_LABEL = { raw: 'dado bruto', calculado: 'calculado', manual: '✏️ manual', hibrido: 'híbrido (calculado + manual)' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function dadoChip(ref, key) {
    var d = ref.dados[key];
    if (!d) return '<code>' + esc(key) + '</code>';
    var hub = d.hubspot ? ' <code>' + esc(d.hubspot) + '</code>' : ' <em>(manual)</em>';
    return esc(d.label.pt) + hub;
  }

  function tabelaHtml(t) {
    var h = '<table class="help-table"><thead><tr>';
    for (var i = 0; i < t.colunas.length; i++) h += '<th>' + esc(t.colunas[i]) + '</th>';
    h += '</tr></thead><tbody>';
    for (var r = 0; r < t.linhas.length; r++) {
      h += '<tr>';
      for (var c = 0; c < t.linhas[r].length; c++) h += '<td>' + esc(t.linhas[r][c]) + '</td>';
      h += '</tr>';
    }
    return h + '</tbody></table>';
  }

  function vpvHtml(vpv) {
    var t = { colunas: ['Faixa de vidas', 'R$/vida/mês'], linhas: [] };
    for (var i = 0; i < vpv.faixas.length; i++) {
      var f = vpv.faixas[i];
      t.linhas.push([f.vidas_max == null ? 'acima' : 'até ' + f.vidas_max, 'R$ ' + f.valor]);
    }
    return tabelaHtml(t);
  }

  function secao(ref, key) {
    var r = ref.regras[key];
    if (!r) return '<section class="help-section"><p class="help-p">⚠ regra <code>' + esc(key) + '</code> não encontrada no catálogo.</p></section>';
    var h = '<section class="help-section" data-regra="' + esc(key) + '">';
    h += '<h3 class="help-h3">' + esc(r.label.pt) + ' <span style="font-weight:400;font-size:.72rem;opacity:.75;">' + (STATUS_EMOJI[r.status] || '') + ' ' + esc(STATUS_LABEL[r.status] || r.status) + '</span></h3>';
    if (r.ajuda && r.ajuda.pt) h += '<p class="help-p">' + esc(r.ajuda.pt) + '</p>';
    if (r.formula) h += '<p class="help-p"><strong>Cálculo:</strong> ' + esc(r.formula) + '</p>';
    if (r.tabela) h += tabelaHtml(r.tabela);
    if (r.usa_referencia && r.usa_referencia.indexOf('valor_por_vida') !== -1 && ref.valor_por_vida) h += vpvHtml(ref.valor_por_vida);
    if (r.precedencia) h += '<p class="help-p"><strong>Precedência:</strong> ' + esc(r.precedencia) + '</p>';
    if (r.faltantes) h += '<p class="help-p"><strong>Dados faltantes:</strong> ' + esc(r.faltantes) + '</p>';
    if (r.filtro) h += '<p class="help-p"><strong>Filtro:</strong> ' + esc(r.filtro) + '</p>';
    if (r.usa_dados && r.usa_dados.length) {
      var chips = [];
      for (var i = 0; i < r.usa_dados.length; i++) chips.push(dadoChip(ref, r.usa_dados[i]));
      h += '<p class="help-p"><strong>Campos usados:</strong> ' + chips.join(' · ') + '</p>';
    }
    h += '<p class="help-p" style="font-size:.72rem;opacity:.65;">Tipo: ' + esc(TIPO_LABEL[r.tipo] || r.tipo) + ' | vigente desde ' + esc(r.vigente_desde) + ' | fonte: catálogo semântico (semantic/regras.json)</p>';
    return h + '</section>';
  }

  function render(el, keys) {
    var ref = window.SEMANTIC_REF;
    if (!ref || !ref.regras) { el.innerHTML = '<p class="help-p">⚠ catálogo semântico indisponível (semantic-ref.js).</p>'; return; }
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
