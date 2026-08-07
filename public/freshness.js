/* ============================================================
 * freshness.js — selo de frescor + botão Atualizar da fonte única
 *
 * Por que existe: as telas migradas para o armazém `axenya_hubspot_prd_*` leem
 * BATCH. Antes elas batiam na API do HubSpot e o número era de agora; agora pode
 * ser de horas atrás. Dado batch sem carimbo de idade é como o usuário passa a
 * desconfiar de tudo — inclusive do que está certo. Então o selo NÃO é enfeite:
 * é o que torna a migração aceitável.
 *
 * As cinco regras do handoff F5, do lado do browser:
 *   1. Trava de concorrência — o 429 do servidor manda; aqui só se mostra
 *   2. Janela curta — quem decide é /api/refresh (2 dias), não o front
 *   3. SEMPRE VISÍVEL — o selo é renderizado no load, não ao clicar
 *   4. Estado de falha visível — check BLOCK vira selo de alerta com o nome dele
 *   5. Teto de 5 min — o botão desabilita sozinho, e o servidor confirma
 *
 * Autocontido no padrão do filter-bar.js: injeta o próprio CSS, sem deps.
 *
 * Uso numa view:
 *   1) <script src="/freshness.js?v=1"></script>
 *   2) HTML: AxFresh.badgeHtml()            (dentro da barra de filtros)
 *   3) JS:   AxFresh.init({ escopo:'workload', onRefreshed: minhaRecarga })
 *
 * Cor: só preto/branco/cinzas/azul/turquesa. Alerta usa dark-card, nunca
 * vermelho — Brandbook 2026, complementares são uso interno.
 * ============================================================ */
(function () {
  if (window.AxFresh) return; // singleton

  var CSS = [
    '.axfr{display:inline-flex;align-items:center;gap:.45rem;font-size:.72rem;color:var(--text2);white-space:nowrap}',
    '.axfr-dot{width:7px;height:7px;border-radius:99px;background:var(--teal);flex:none;transition:background .2s}',
    '.axfr-dot.velho{background:var(--muted)}',
    '.axfr-dot.alerta{background:var(--text);box-shadow:0 0 0 2px var(--card2)}',
    '.axfr-dot.indisponivel{background:transparent;border:1px solid var(--muted)}',
    '.axfr-dot.rodando{background:var(--teal);animation:axfr-pulse 1.1s ease-in-out infinite}',
    '@keyframes axfr-pulse{0%,100%{opacity:1}50%{opacity:.25}}',
    '.axfr-txt{font-weight:600}',
    '.axfr-btn{display:inline-flex;align-items:center;gap:.35rem;background:var(--card2);border:1px solid var(--border);color:var(--text2);border-radius:99px;padding:.3rem .7rem;font-size:.72rem;font-weight:600;font-family:inherit;cursor:pointer;transition:border-color .15s,color .15s}',
    '.axfr-btn:hover:not(:disabled){border-color:var(--teal);color:var(--teal)}',
    '.axfr-btn:disabled{opacity:.5;cursor:not-allowed}',
    '.axfr-btn svg{flex:none}',
    '.axfr-btn.rodando svg{animation:axfr-spin 1s linear infinite}',
    '@keyframes axfr-spin{to{transform:rotate(360deg)}}',
    // Alerta = dark-card com borda, não cor de aviso. Ocupa a linha toda porque
    // esconder QUAL check caiu num tooltip é o mesmo que falhar em silêncio.
    '.axfr-alerta{display:block;margin:.5rem 0 0;background:var(--card2);border:1px solid var(--border);border-left:3px solid var(--text2);border-radius:8px;padding:.55rem .75rem;font-size:.73rem;color:var(--text);line-height:1.45}',
    '.axfr-alerta b{font-weight:700}',
    '.axfr-alerta code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em;background:var(--hover);padding:.05rem .3rem;border-radius:4px}',
    '.axfr-msg{font-size:.72rem;color:var(--text2)}',
    '.axfr-div{width:1px;height:20px;background:var(--border);flex:none;margin:0 .5rem}',
  ].join('\n');

  var st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);

  var ICON_REFRESH = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>';

  var cfg = { escopo: 'tudo', onRefreshed: null, pollMs: 60000 };
  var estado = null;      // último payload de /api/freshness
  var rodando = false;    // há refresh em curso (nosso ou de outro usuário)
  var msgTemp = '';       // mensagem transitória (429, erro)
  var timerPoll = null;
  var timerTick = null;

  function el(id) { return document.getElementById(id); }

  function idade(min) {
    if (min == null) return 'idade desconhecida';
    if (min < 1) return 'agora mesmo';
    if (min < 60) return 'há ' + min + ' min';
    var h = Math.floor(min / 60);
    if (h < 24) return 'há ' + h + 'h' + (min % 60 ? String(min % 60).padStart(2, '0') : '');
    var d = Math.floor(h / 24);
    return 'há ' + d + (d === 1 ? ' dia' : ' dias');
  }

  function badgeHtml() {
    return '<span class="axfr" id="axfr-selo">'
      + '<span class="axfr-dot" id="axfr-dot"></span>'
      + '<span class="axfr-txt" id="axfr-txt">carregando frescor…</span>'
      + '</span>'
      + '<button class="axfr-btn" id="axfr-btn" onclick="AxFresh.refresh()" title="Reconcilia os últimos 2 dias na fonte única">'
      + ICON_REFRESH + '<span id="axfr-btn-txt">Atualizar</span></button>'
      + '<span class="axfr-msg" id="axfr-msg"></span>'
      + '<div class="axfr-alerta" id="axfr-alerta" style="display:none"></div>';
  }

  function render() {
    var dot = el('axfr-dot'), txt = el('axfr-txt'), btn = el('axfr-btn');
    var btxt = el('axfr-btn-txt'), msg = el('axfr-msg'), alerta = el('axfr-alerta');
    if (!dot || !txt) return;

    var e = estado || {};
    var classe = rodando ? 'rodando' : (e.estado || 'indisponivel');
    dot.className = 'axfr-dot ' + classe;

    if (rodando) {
      txt.textContent = 'atualizando…';
    } else if (e.estado === 'indisponivel') {
      txt.textContent = 'frescor indisponível';
    } else {
      txt.textContent = 'Atualizado ' + idade(e.idade_minutos);
    }

    if (btn) {
      btn.disabled = rodando;
      btn.className = 'axfr-btn' + (rodando ? ' rodando' : '');
      if (btxt) btxt.textContent = rodando ? 'Atualizando' : 'Atualizar';
    }
    if (msg) msg.textContent = msgTemp || '';

    // Regra 4: se o último run travou num check BLOCK, o selo diz QUAL.
    if (alerta) {
      var c = e.checks || {};
      var block = c.block || [];
      var runErro = e.ultimo_run && e.ultimo_run.status === 'ERROR';
      if (block.length) {
        alerta.style.display = '';
        var det = (c.falhas || []).filter(function (f) { return f.severidade === 'BLOCK'; })[0];
        // Escapa CADA nome e só depois emenda as tags: escapar a string já
        // emendada transformaria o próprio <code> em texto.
        var nomes = block.map(function (b) { return '<code>' + esc(b) + '</code>'; }).join(', ');
        alerta.innerHTML = '<b>Fonte única travada.</b> '
          + block.length + ' check BLOCK falhou no último run — ' + nomes + '. '
          + 'O número na tela é o da última carga válida (' + esc(idade(e.idade_minutos)) + ').'
          + (det && det.detalhe ? '<br><span style="color:var(--text2)">' + esc(det.detalhe) + '</span>' : '');
      } else if (runErro) {
        alerta.style.display = '';
        alerta.innerHTML = '<b>A última extração falhou.</b> '
          + esc(e.ultimo_run.erro || 'sem detalhe registrado')
          + ' — o dado na tela é de ' + esc(idade(e.idade_minutos)) + '.';
      } else {
        alerta.style.display = 'none';
        alerta.innerHTML = '';
      }
    }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function puxarFrescor() {
    try {
      var r = await fetch('/api/freshness', { credentials: 'include' });
      var j = await r.json();
      var estavaRodando = rodando;
      estado = j;
      // A verdade sobre "tem refresh rodando" é do servidor, não do nosso clique:
      // se outra pessoa disparou, o botão desta aba também tem de mostrar.
      rodando = !!(j && j.em_andamento);
      if (estavaRodando && !rodando) {
        // O run terminou. Recarrega os dados da tela, senão o selo diz "agora
        // mesmo" em cima dos números velhos — pior que não ter selo.
        msgTemp = '';
        if (typeof cfg.onRefreshed === 'function') {
          try { cfg.onRefreshed(); } catch (err) { console.error('[freshness] onRefreshed:', err); }
        }
      }
      render();
      reagendar();
    } catch (e) {
      estado = { estado: 'indisponivel', erro: String(e.message || e) };
      render();
      reagendar();
    }
  }

  // Enquanto roda, olha de perto (5s); parado, devagar (o pollMs configurado).
  function reagendar() {
    if (timerPoll) clearTimeout(timerPoll);
    timerPoll = setTimeout(puxarFrescor, rodando ? 5000 : cfg.pollMs);
  }

  async function refresh() {
    if (rodando) return;
    msgTemp = '';
    rodando = true; render();
    try {
      var r = await fetch('/api/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ escopo: cfg.escopo }),
      });
      var j = await r.json().catch(function () { return {}; });

      if (r.status === 202) {
        msgTemp = 'disparado · ~' + Math.round((j.eta_segundos || 300) / 60) + ' min';
      } else if (r.status === 429) {
        // Concorrência ou teto. Nos dois casos JÁ existe execução recente que
        // cobre esta tela — então não é erro, é reaproveitamento. Só o de
        // concorrência mantém o botão travado.
        msgTemp = j.mensagem || 'atualização recente reaproveitada';
        rodando = !!j.em_andamento;
      } else {
        rodando = false;
        msgTemp = 'não deu para atualizar: ' + (j.erro || ('HTTP ' + r.status));
      }
    } catch (e) {
      rodando = false;
      msgTemp = 'não deu para atualizar: ' + String(e.message || e);
    }
    render();
    reagendar();
  }

  function init(opts) {
    opts = opts || {};
    if (opts.escopo) cfg.escopo = opts.escopo;
    if (opts.onRefreshed) cfg.onRefreshed = opts.onRefreshed;
    if (opts.pollMs) cfg.pollMs = opts.pollMs;
    render();
    puxarFrescor();
    // O selo tem de envelhecer à vista: sem este tick ele congelaria em
    // "há 3 min" até o próximo poll.
    if (timerTick) clearInterval(timerTick);
    timerTick = setInterval(function () {
      if (estado && estado.extraido_em && !rodando) {
        var ms = Date.now() - new Date(estado.extraido_em).getTime();
        estado.idade_minutos = Math.max(0, Math.round(ms / 60000));
        render();
      }
    }, 30000);
  }

  // Telas que re-renderizam a barra de filtros a cada mudança destroem o DOM do
  // selo. remount() repinta a partir do estado JÁ em memória, sem novo request —
  // trocar de filtro não é motivo para bater no /api/freshness de novo.
  function remount() {
    if (!el('axfr-dot')) return;
    render();
    if (!timerPoll) reagendar();
  }

  window.AxFresh = {
    badgeHtml: badgeHtml,
    init: init,
    remount: remount,
    refresh: refresh,
    estado: function () { return estado; },
  };
})();
