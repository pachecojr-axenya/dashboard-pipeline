'use strict';
/**
 * ax-ui.js | Componente único de estado vazio/erro/aviso | FONTE ÚNICA.
 *
 * Antes, "sem dados no período"/"erro ao buscar"/"aviso" tinham 7+ variações
 * diferentes espalhadas pelos painéis (levantamento completo em
 * `docs/design-system-proposal.md`, seções 1.9 e 2.5): texto solto
 * `color:var(--red)`/`color:var(--text2)` na maioria, `.banner-api` (morto em
 * cs.html), `.state`/`.state.err` (forecast.html/forecast-stage.html),
 * `.banner-warn` (bdr.html), etc. Nem o próprio `dashboard.html` (padrão-ouro)
 * tinha um componente dedicado para isso.
 *
 * Este módulo segue o MESMO padrão de auto-inclusão de `help-drawer.js`/
 * `nav.js`/`filter-bar.js`/`settings-modal.js`: cada painel só inclui
 * `<script src="/ax-ui.js?v=1"></script>` (sem `configure()` — não há estado
 * global para inicializar, só duas funções puras) e passa a chamar:
 *
 *   AxUI.emptyState(msg, opts?)
 *     - `msg`  : texto (o MESMO texto que já existia antes da migração — o
 *                gate de paridade da FASE 1 exige que o conteúdo não mude).
 *     - `opts.size` : 'sm' (default, uso dentro de modal/card) | 'lg' (estado
 *                de página inteira, ex. "Aguardando dados…" antes do 1º load).
 *     Retorna uma STRING html (não insere no DOM sozinho) — para casar com o
 *     padrão já usado nos painéis (`el.innerHTML = '...'` ou
 *     `openModal(title, htmlString)`).
 *
 *   AxUI.banner(msg, opts?)
 *     - `opts.severity` : 'info' | 'warn' | 'error' (default 'error').
 *     - `opts.retry`    : string com o JS a rodar no onclick do botão (ex.
 *                `'novoLoadData()'`) — se omitido, não desenha botão.
 *     - `opts.retryLabel` : texto do botão (default 'Tentar novamente').
 *     Também retorna STRING html.
 *
 * Paleta por severidade: `var(--blue)` (info) / `var(--yellow)` (warn) /
 * `var(--red)` (error) — mesmas vars usadas em todo o resto do app
 * (`premium.css`), nunca hex fixo.
 */
(function () {
  if (!document.getElementById('ax-ui-css')) {
    var st = document.createElement('style'); st.id = 'ax-ui-css';
    st.textContent = [
      '.ax-empty{text-align:center;padding:1.5rem 1rem;color:var(--text2);font-size:.85rem;line-height:1.6}',
      '.ax-empty-lg{padding:3rem 0;font-size:.9rem}',
      '.ax-banner{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;padding:.75rem 1rem;border-radius:10px;background:var(--card2);border:1px solid var(--border);font-size:.85rem;line-height:1.5;text-align:left}',
      '.ax-banner-msg{flex:1;min-width:160px}',
      '.ax-banner-error{border-left:3px solid var(--red)}',
      '.ax-banner-error .ax-banner-msg{color:var(--red)}',
      '.ax-banner-warn{border-left:3px solid var(--yellow)}',
      '.ax-banner-warn .ax-banner-msg{color:var(--yellow)}',
      '.ax-banner-info{border-left:3px solid var(--blue)}',
      '.ax-banner-info .ax-banner-msg{color:var(--blue)}',
      '.ax-banner-retry{flex-shrink:0;background:var(--teal);color:#fff;border:none;border-radius:8px;padding:.4rem 1rem;font-size:.8rem;font-weight:600;cursor:pointer;font-family:inherit;transition:filter .15s}',
      '.ax-banner-retry:hover{filter:brightness(1.1)}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function emptyState(msg, opts) {
    opts = opts || {};
    var sizeClass = opts.size === 'lg' ? ' ax-empty-lg' : '';
    return '<div class="ax-empty' + sizeClass + '">' + msg + '</div>';
  }

  function banner(msg, opts) {
    opts = opts || {};
    var sev = (opts.severity === 'info' || opts.severity === 'warn') ? opts.severity : 'error';
    var retryHtml = opts.retry
      ? '<button class="ax-banner-retry" onclick="' + opts.retry + '">' + (opts.retryLabel || 'Tentar novamente') + '</button>'
      : '';
    return '<div class="ax-banner ax-banner-' + sev + '">' +
      '<span class="ax-banner-msg">' + msg + '</span>' +
      retryHtml +
      '</div>';
  }

  window.AxUI = { emptyState: emptyState, banner: banner };
})();
