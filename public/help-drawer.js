'use strict';
/**
 * help-drawer.js | Botão "i" de ajuda + tooltip + drawer lateral | FONTE ÚNICA.
 *
 * Antes, dashboard.html/board.html/ae.html tinham cada um sua PRÓPRIA cópia do
 * mecanismo do botão "i" (CSS do botão/tag/tooltip/drawer + a função `_infoBtn` +
 * o toggle "?" que liga/desliga tudo via body.novo-info-on). Agora vive só aqui:
 * cada painel inclui <script src="/help-drawer.js?v=1"></script> no <head> (ANTES
 * do <script> inline que declara o mapa de ajuda daquela página) e chama
 * `HelpDrawer.configure({...})` logo depois de declarar seu próprio mapa
 * (NOVO_HELP_CHARTS/BOARD_HELP_CHARTS/AE_HELP_CHARTS + NOVO_CARD_CODES/
 * BOARD_CARD_CODES/AE_CARD_CODES) — nome, campos e conteúdo de cada mapa NÃO
 * mudam, só o mecanismo que os consome saiu daqui. O RENDER do conteúdo de cada
 * ficha (campos/fórmula/filtro de data por gráfico) continua 100% no HTML de
 * cada painel (funções `_novoHelpSection`/`_boardHelpSection`/`_aeHelpSection` e
 * a função que abre o drawer com o texto pronto, ex. `novoHelpChart(key)`) —
 * este módulo só desenha o botão "i", o tooltip, e abre/fecha o shell do drawer.
 *
 * Duas variantes herdadas do código antigo (diferenças REAIS encontradas entre
 * os 3 HTMLs ao extrair — não inventadas aqui; ver STATUS_LOG.md 2026-08-02):
 *  - 'cro' (dashboard.html): botão 14px, oculto por padrão e revelado
 *    GLOBALMENTE por body.novo-info-on (em QUALQUER lugar da página); tooltip
 *    ANCORADO embaixo/em cima do botão (calculado 1x no mouseover, sem seguir o
 *    mouse); data-code fica AUSENTE quando o gráfico não tem code mapeado.
 *  - 'panel' (board.html/ae.html — DEFAULT): botão 16px, visível por padrão e
 *    ocultado só DENTRO de `.novo-card` quando body NÃO tem novo-info-on — por
 *    isso, historicamente, os "i" dentro de `.kpi-card` (fora de `.novo-card`)
 *    em board/ae NÃO respeitam o toggle "?" e ficam sempre visíveis; mantido de
 *    propósito, é o comportamento de produção hoje, não um bug desta extração;
 *    tooltip SEGUE o cursor (mousemove); data-code cai para a própria key
 *    quando não há code mapeado.
 * O host declara `var HELP_DRAWER_VARIANT = 'cro';` (global, antes do
 * `HelpDrawer.configure`) para usar a variante do CRO; omitido = 'panel'.
 *
 * Outra diferença real preservada: o blur de fundo (`.content-blur` em
 * `#view-novo`) ao abrir o drawer — dashboard.html e board.html sempre
 * aplicavam `setContentBlur(true/false)` ao abrir/fechar a ficha; ae.html
 * nunca aplicava (mesmo tendo a função `setContentBlur` disponível para outros
 * usos). Controlado por `configure({ blur: false })` (default: true).
 *
 * Também real: a chave de localStorage do toggle "?" era por painel
 * (`novo_show_info` | `board_show_info` | `ae_show_info`) — preservada via
 * `configure({ storageKey: '...' })` para não resetar a preferência já salva
 * de quem já usa o dashboard.
 */
(function () {
  var cfg = {
    variant: 'panel',
    blur: true,
    storageKey: 'novo_show_info',
    charts: [],
    codes: {}
  };
  var _showInfo = true;

  function _ne(s) { return (s == null ? '—' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // ── CSS compartilhado (injetado uma vez; parte independe de variante) ───────
  if (!document.getElementById('help-drawer-css')) {
    var st = document.createElement('style'); st.id = 'help-drawer-css';
    st.textContent = [
      '.novo-code-tag{display:none;align-items:center;font-size:.6rem;font-weight:700;letter-spacing:.04em;font-family:ui-monospace,Menlo,Consolas,monospace;color:var(--teal);background:rgba(58,184,183,.14);border:1px solid rgba(58,184,183,.32);border-radius:5px;padding:.05rem .32rem;line-height:1.35;flex-shrink:0}',
      'body.novo-info-on .novo-code-tag{display:inline-flex}',
      // Selo de família de probabilidade (2026-08-06): "fixa" (régua flat, forecast de caixa)
      // vs. "funil" (conversão real, pipeline ponderado) — mesmo toggle "?" dos code-tags,
      // pra não inventar um segundo controle. Ver docs/forecast-revenue-rules.md seção 6.
      '.novo-regua-tag{display:none;align-items:center;gap:.2rem;font-size:.6rem;font-weight:700;letter-spacing:.02em;border-radius:5px;padding:.05rem .32rem;line-height:1.35;flex-shrink:0;cursor:help}',
      'body.novo-info-on .novo-regua-tag{display:inline-flex}',
      '.novo-regua-tag.fixa{color:var(--text2);background:rgba(139,148,158,.14);border:1px solid rgba(139,148,158,.32)}',
      '.novo-regua-tag.funil{color:#a78bfa;background:rgba(167,139,250,.14);border:1px solid rgba(167,139,250,.32)}',
      '#novo-tip{position:fixed;z-index:9999;background:rgba(23,31,46,.78);backdrop-filter:blur(14px) saturate(1.5);-webkit-backdrop-filter:blur(14px) saturate(1.5);border-radius:6px;padding:.45rem .7rem;width:278px;pointer-events:none;display:none;box-shadow:0 6px 20px rgba(0,0,0,.3)}',
      'html[data-theme="light"] #novo-tip{background:rgba(246,248,250,.82)}',
      '#novo-tip.nt-show{display:block}',
      '#novo-tip .nt-text{font-size:.73rem;color:var(--text);font-weight:400;line-height:1.5;font-family:Inter,\'Segoe UI\',system-ui,sans-serif}',
      '#novo-tip .nt-code{font-size:.62rem;font-weight:700;color:var(--teal);font-family:ui-monospace,Menlo,Consolas,monospace;margin-top:.3rem;padding-top:.28rem;border-top:1px solid rgba(255,255,255,.12);letter-spacing:.07em}',
      'html[data-theme="light"] #novo-tip .nt-code{border-top-color:rgba(0,0,0,.1)}',
      '.novo-help-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:3000;opacity:0;pointer-events:none;transition:opacity .25s ease}',
      '.novo-help-backdrop.open{opacity:1;pointer-events:auto}',
      '.novo-help-drawer{position:fixed;top:0;right:-580px;width:540px;max-width:100vw;height:100vh;background:var(--card);border-left:1px solid var(--border);z-index:3001;display:flex;flex-direction:column;transition:right .28s cubic-bezier(0.4,0,0.2,1);box-shadow:-8px 0 32px rgba(0,0,0,.25)}',
      '.novo-help-drawer.open{right:0}',
      '.novo-help-hdr{display:flex;align-items:center;justify-content:space-between;padding:1.25rem 1.5rem;border-bottom:1px solid var(--border);flex-shrink:0}',
      '.novo-help-hdr h3{margin:0;font-size:1.15rem;font-weight:600;color:var(--text)}',
      '.novo-help-body{flex:1;overflow-y:auto;padding:1.25rem 1.5rem}'
    ].join('\n');
    document.head.appendChild(st);
  }
  // CSS do botão "i" propriamente: depende da variante, então fica num <style>
  // à parte, (re)escrito por `configure()` — pode rodar depois deste bloco.
  function _injectButtonCss() {
    var btn = document.getElementById('help-drawer-btn-css');
    if (!btn) { btn = document.createElement('style'); btn.id = 'help-drawer-btn-css'; document.head.appendChild(btn); }
    btn.textContent = (cfg.variant === 'cro')
      ? '.novo-info-btn{width:14px;height:14px;border-radius:50%;border:1.5px solid var(--text2);background:none;color:var(--text2);font-size:.56rem;font-style:normal;font-weight:700;cursor:pointer;display:none;align-items:center;justify-content:center;position:relative;flex-shrink:0;padding:0;line-height:1}\nbody.novo-info-on .novo-info-btn{display:inline-flex}'
      : '.novo-info-btn{width:16px;height:16px;border-radius:50%;border:1.5px solid var(--text2);background:none;color:var(--text2);font-size:.62rem;font-style:normal;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;position:relative;flex-shrink:0;padding:0;line-height:1}\nbody:not(.novo-info-on) .novo-card .novo-info-btn{display:none}';
  }
  _injectButtonCss(); // default ('panel'); refeito se configure() trocar a variante

  // ── Shell do DOM (tooltip + drawer) — injetado uma vez, quando o body existir ──
  function _initShell() {
    if (!document.getElementById('novo-tip')) {
      document.body.insertAdjacentHTML('beforeend', '<div id="novo-tip"><div class="nt-text"></div><div class="nt-code"></div></div>');
    }
    if (!document.getElementById('novo-help-drawer')) {
      document.body.insertAdjacentHTML('beforeend',
        '<div class="novo-help-backdrop" id="novo-help-backdrop" onclick="novoCloseHelp()"></div>' +
        '<div class="novo-help-drawer" id="novo-help-drawer" aria-label="Ajuda | campos do HubSpot">' +
          '<div class="novo-help-hdr">' +
            '<h3 id="novo-help-title">Campos do HubSpot</h3>' +
            '<button class="hdr-btn" onclick="novoCloseHelp()" aria-label="Fechar">' +
              '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
            '</button>' +
          '</div>' +
          '<div class="novo-help-body" id="novo-help-body"></div>' +
        '</div>');
    }
    var stored;
    try { stored = localStorage.getItem(cfg.storageKey) !== '0'; } catch (e) { stored = true; }
    _showInfo = stored;
    if (_showInfo) {
      document.body.classList.add('novo-info-on');
      var b = document.getElementById('btn-info-toggle');
      if (b) b.classList.add('highlighted');
    }
  }
  if (document.readyState !== 'loading') _initShell(); else document.addEventListener('DOMContentLoaded', _initShell);

  // ── Tooltip do botão "i" (duas variantes de posicionamento) ─────────────────
  if (cfg.variant === 'cro') {
    // fallback inicial; se configure() trocar para 'cro' depois, os listeners
    // abaixo já cobrem os dois modos via checagem de cfg.variant em tempo real.
  }
  var _tipEl = null;
  function _getTip() { return _tipEl || (_tipEl = document.getElementById('novo-tip')); }
  function _showTipAnchored(btn) {
    var el = _getTip(); if (!el) return;
    var text = btn.getAttribute('data-tip') || '';
    var code = btn.getAttribute('data-code') || '';
    el.querySelector('.nt-text').textContent = text;
    var codeEl = el.querySelector('.nt-code');
    codeEl.textContent = code;
    codeEl.style.display = code ? '' : 'none';
    el.classList.add('nt-show');
    var r = btn.getBoundingClientRect();
    var tw = el.offsetWidth, th = el.offsetHeight;
    var x = r.left + r.width / 2 - tw / 2;
    var y = r.bottom + 7;
    x = Math.max(8, Math.min(x, window.innerWidth - tw - 8));
    if (y + th > window.innerHeight - 8) y = r.top - th - 7;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }
  function _showTipCursor(btn) {
    var el = _getTip(); if (!el) return;
    el.querySelector('.nt-text').textContent = btn.getAttribute('data-tip') || '';
    el.querySelector('.nt-code').textContent = btn.getAttribute('data-code') || '';
    el.classList.add('nt-show');
  }
  function _hideTip() { var el = _getTip(); if (el) el.classList.remove('nt-show'); }
  document.addEventListener('mouseover', function (e) {
    var btn = e.target && e.target.closest && e.target.closest('.novo-info-btn,[data-tip]');
    if (!btn) return;
    if (cfg.variant === 'cro') _showTipAnchored(btn); else _showTipCursor(btn);
  });
  document.addEventListener('mouseout', function (e) {
    if (e.target && e.target.closest && e.target.closest('.novo-info-btn,[data-tip]')) _hideTip();
  });
  document.addEventListener('mousemove', function (e) {
    if (cfg.variant === 'cro') return; // variante 'cro' é ancorada, não segue o cursor
    var el = _getTip(); if (!el || !el.classList.contains('nt-show')) return;
    var r = el.getBoundingClientRect();
    var x = e.clientX + 14, y = e.clientY + 14;
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - 10;
    if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - 10;
    el.style.left = x + 'px'; el.style.top = y + 'px';
  });
  document.addEventListener('scroll', function () { if (cfg.variant === 'cro') _hideTip(); }, true);

  // ── Botão "i" (equivalente ao antigo `_infoBtn(tooltip, key)`) ──────────────
  // regua (opcional): 'fixa' (régua flat, forecast de caixa) | 'funil' (conversão real do
  // funil, pipeline ponderado) — ver docs/forecast-revenue-rules.md seção 6. Omitir = sem selo
  // (a maioria dos cards não pondera por probabilidade, então não se aplica).
  function _infoBtn(tip, helpKey, regua) {
    var code = (helpKey && cfg.codes[helpKey]) ? cfg.codes[helpKey] : '';
    var tag = code ? '<span class="novo-code-tag">' + code + '</span>' : '';
    var reguaTitle = regua === 'funil'
      ? 'Probabilidade pela conversão real do funil (piso na régua fixa quando a amostra da etapa é pequena)'
      : (regua === 'fixa' ? 'Probabilidade pela régua fixa (premissa validada) — não usa o funil ao vivo, de propósito' : '');
    var reguaTag = regua ? '<span class="novo-regua-tag ' + (regua === 'funil' ? 'funil' : 'fixa') + '" title="' + _ne(reguaTitle) + '">' + (regua === 'funil' ? '📊 Funil' : '🔒 Fixa') + '</span>' : '';
    var hasHelp = !!(helpKey && cfg.charts && cfg.charts.some(function (x) { return x.key === helpKey; }));
    var dataCode = code || (cfg.variant === 'cro' ? '' : (helpKey || ''));
    return tag + reguaTag + '<button class="novo-info-btn"' +
      (tip ? ' data-tip="' + _ne(tip) + '"' : '') +
      (dataCode ? ' data-code="' + dataCode + '"' : '') +
      (hasHelp ? ' onclick="event.stopPropagation();novoHelpChart(\'' + helpKey + '\')"' : '') +
      ' aria-label="Campos do HubSpot">i</button>';
  }

  // ── Abrir/fechar o shell do drawer (o CONTEÚDO html é montado pela página) ──
  function open(title, html) {
    var ttl = document.getElementById('novo-help-title');
    if (ttl) ttl.textContent = title;
    var body = document.getElementById('novo-help-body');
    if (body) body.innerHTML = html;
    if (cfg.blur && typeof window.setContentBlur === 'function') window.setContentBlur(true);
    var bd = document.getElementById('novo-help-backdrop'); if (bd) bd.classList.add('open');
    var dr = document.getElementById('novo-help-drawer'); if (dr) dr.classList.add('open');
  }
  window.novoCloseHelp = function () {
    var bd = document.getElementById('novo-help-backdrop'); if (bd) bd.classList.remove('open');
    var dr = document.getElementById('novo-help-drawer'); if (dr) dr.classList.remove('open');
    if (cfg.blur && typeof window.setContentBlur === 'function') window.setContentBlur(false);
  };

  // ── Botão "?" do header: liga/desliga os "i"/tags em toda a página ──────────
  window.novoToggleInfo = function () {
    _showInfo = !_showInfo;
    document.body.classList.toggle('novo-info-on', _showInfo);
    var b = document.getElementById('btn-info-toggle');
    if (b) b.classList.toggle('highlighted', _showInfo);
    try { localStorage.setItem(cfg.storageKey, _showInfo ? '1' : '0'); } catch (e) {}
  };

  function configure(opts) {
    opts = opts || {};
    for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) cfg[k] = opts[k];
    _injectButtonCss();
  }

  window._infoBtn = _infoBtn;
  window.HelpDrawer = { configure: configure, open: open };
})();
