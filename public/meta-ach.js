'use strict';
/**
 * meta-ach.js | Bloco compartilhado "Meta vs Ach" (atingimento da meta do trimestre por AE).
 *
 * MÓDULO AUTOCONTIDO E PLUGÁVEL: injeta o próprio CSS (classes ma-*), não depende de
 * nenhuma global da página além do array de deals que recebe. Uso em qualquer painel:
 *
 *     MetaAch.render(document.getElementById('meta-panel'), deals);
 *     // opcional: MetaAch.render(el, deals, { quarter: {y:2026,q:3}, lang:'pt' });
 *
 * Regra (decisão do dono 2026-07-22):
 *  - Meta do TRIMESTRE = R$ 300k de ARR por executivo; time = 5 AEs = R$ 1,5MM.
 *    Roster: André, Fausto, Guilherme, Juliana, Rafael (Ágatta FORA, por decisão do dono).
 *  - "Fechado" = Σ arr_estimado das contas cuja ENTRADA em Implantação (data_implantacao)
 *    — ou, na falta dela, em Ganho (data_ganho) — cai dentro do trimestre. É RECEITA
 *    FECHADA (bookings por data de entrada), NÃO receita que "caiu" no tri.
 *  - Sem commit/forecast: a aba mostra só realizado (Fechado) contra a Meta.
 *
 * ⚠ IMPORTANTE (Regra primária nº 3 | fonte única de receita): esta é uma métrica de
 * BOOKINGS baseada em `arr_estimado` (ARR contratado da conta), conceitualmente diferente
 * das duas séries canônicas Real/Probabilizada (receita reconhecida mês a mês). Por isso
 * ela NÃO passa pelo forecast-engine — não é forecast, é atingimento de meta.
 * (Ainda não validada campo a campo contra o HubSpot.)
 */
(function (root) {
  // Roster do time (nomes próprios). Ágatta fora por decisão do dono (2026-07-22).
  // Match por primeiro nome, tolerante a acento (espelha _isCoreAE do painel AE).
  var DEFAULT_ROSTER = [
    { first: 'andré', display: 'André' },
    { first: 'fausto', display: 'Fausto' },
    { first: 'guilherme', display: 'Guilherme' },
    { first: 'juliana', display: 'Juliana' },
    { first: 'rafael', display: 'Rafael' }
  ];
  // Aliases de primeiro nome (sem acento) → forma canônica do roster.
  var FIRST_ALIAS = { 'andre': 'andré' };

  var META_PER_AE = 300000;

  // Régua GLOBAL de probabilidade por etapa (fonte única: semantic forecast_flat, via
  // semantic-ref.js). O literal é espelho p/ páginas sem semantic-ref — idêntico ao
  // DEFAULT de prob-engine.js (régua validada do Forecast, decisão do dono 2026-07-15).
  var RULER_FALLBACK = {
    'Reunião Agendada': 0.06, 'Cotação': 0.185790008, 'Proposta Enviada': 0.285,
    'Consultoria': 0.284954, 'Negociação': 0.493, 'Implantação': 0.8, 'Ganho': 1.0,
    'Standby': 0.12, 'Stand by': 0.12, 'Diagnóstico': 0.06
  };
  function ruler() {
    var r = root.SEMANTIC_REF;
    if (r && r.reguas && r.reguas.forecast_flat && r.reguas.forecast_flat.valores) return r.reguas.forecast_flat.valores;
    return RULER_FALLBACK;
  }
  // Prob. da etapa pela régua global. Etapa fora da régua → 0 (não infla o número).
  function stageProb(stage) {
    var p = ruler()[stage];
    return (p == null) ? 0 : p;
  }

  var I18N = {
    pt: {
      rule: 'regra: ARR estimado × régua de etapa (Implantação 80% · Ganho 100%)',
      metaTime: 'Meta do time', fechado: 'Fechado', gap: 'Gap p/ meta',
      contas: 'Contas no tri', daMeta: 'da meta', faltam: 'faltam',
      legFechado: 'Fechado (ponderado)', legMeta: 'Meta (300k)',
      batido: 'batido', noRitmo: 'no ritmo', atras: 'atrás',
      timeLabel: 'Time', ritmoLabel: 'ritmo esperado',
      colDeal: 'Deal', colStage: 'Etapa', colVidas: 'Vidas', colArr: 'ARR est.',
      colProb: 'Régua', colPond: 'Ponderado', colDate: 'Entrada no tri',
      modalTitle: 'contas fechadas no tri', semContas: 'Nenhuma conta fechada no trimestre.',
      empty: 'Sem contas fechadas no trimestre ainda.',
      memoria: 'Campos: <b>arr_estimado</b> (ARR estimado) × <b>prob. de etapa</b> pela régua global (semantic <code>forecast_flat</code>: Implantação 80% · Ganho 100%) · <b>data_implantacao</b> (entrada em Implantação) com fallback <b>data_ganho</b> · <b>hubspot_owner_id</b> (AE). ' +
               'Fórmula: Σ (arr_estimado × régua da etapa) das contas cuja entrada em Implantação (ou Ganho) cai no trimestre, por AE do time (André, Fausto, Guilherme, Juliana, Rafael). Meta = 300k/AE. ' +
               'Status: ritmo esperado = % de dias decorridos do trimestre. ' +
               '⚠ Métrica de <b>bookings ponderados</b> (ARR estimado × régua de etapa), não a receita canônica da Regra primária nº 3 (Real/Probabilizada). Não validado no HubSpot.'
    },
    en: {
      rule: 'rule: closed revenue (entered implementation within the quarter)',
      metaTime: 'Team target', fechado: 'Closed', gap: 'Gap to target',
      contas: 'Accounts in qtr', daMeta: 'of target', faltam: 'missing',
      legFechado: 'Closed (weighted)', legMeta: 'Target (300k)',
      batido: 'hit', noRitmo: 'on pace', atras: 'behind',
      timeLabel: 'Team', ritmoLabel: 'expected pace',
      colDeal: 'Deal', colStage: 'Stage', colVidas: 'Lives', colArr: 'Est. ARR',
      colProb: 'Ruler', colPond: 'Weighted', colDate: 'Entered in qtr',
      modalTitle: 'accounts closed in qtr', semContas: 'No accounts closed this quarter.',
      empty: 'No accounts closed this quarter yet.',
      memoria: 'Fields: <b>arr_estimado</b> (estimated ARR) × <b>stage prob.</b> from the global ruler (semantic <code>forecast_flat</code>: Implementation 80% · Won 100%) · <b>data_implantacao</b> (entered Implementation) fallback <b>data_ganho</b> · <b>hubspot_owner_id</b> (AE). ' +
               'Formula: Σ (arr_estimado × stage ruler) of accounts whose entry into Implementation (or Won) falls within the quarter, per team AE. Target = 300k/AE. ' +
               'Status: expected pace = % of quarter days elapsed. ' +
               '⚠ This is a <b>weighted bookings</b> metric (estimated ARR × stage ruler), not the canonical revenue of primary rule #3. Not validated against HubSpot.'
    }
  };
  var MONTHS_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  function t(lang, k) { return (I18N[lang] || I18N.pt)[k]; }

  function firstNameKey(ae) {
    if (!ae || ae === '-') return null;
    var f = String(ae).trim().split(/\s+/)[0].toLowerCase();
    return FIRST_ALIAS[f] || f;
  }

  // Trimestre corrente (ou o passado via opts.quarter {y,q}). Retorna limites yyyy-mm-dd.
  function resolveQuarter(opts) {
    var y, q;
    if (opts && opts.quarter && opts.quarter.y && opts.quarter.q) {
      y = opts.quarter.y; q = opts.quarter.q;
    } else {
      var now = new Date();
      y = now.getFullYear();
      q = Math.floor(now.getMonth() / 3) + 1;
    }
    var m0 = (q - 1) * 3;               // 0,3,6,9
    var start = y + '-' + pad2(m0 + 1) + '-01';
    var endM = m0 + 3;                   // mês seguinte ao último do tri (1-based = m0+3+1-1)
    var endY = y, endMo = m0 + 2;        // último mês do tri (0-based)
    var lastDay = new Date(endY, endMo + 1, 0).getDate();
    var end = endY + '-' + pad2(endMo + 1) + '-' + pad2(lastDay);
    return {
      y: y, q: q, start: start, end: end,
      label: 'Q' + q + ' ' + y,
      months: MONTHS_ABBR[m0] + '-' + MONTHS_ABBR[m0 + 2]
    };
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // Fração de dias decorridos do trimestre (0..1). Usa "hoje" real; se o tri já acabou → 1.
  function paceFraction(qtr) {
    var s = new Date(qtr.start + 'T00:00:00');
    var e = new Date(qtr.end + 'T23:59:59');
    var now = new Date();
    if (now <= s) return 0;
    if (now >= e) return 1;
    return (now - s) / (e - s);
  }

  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }

  // ── Cálculo puro ────────────────────────────────────────────────────────────
  // Retorna { quarter, pace, team:{meta,fechado,pct,gap,gapPct,contas}, aes:[{first,display,fechado,meta,pct,status,deals}] }
  function compute(deals, opts) {
    opts = opts || {};
    var roster = opts.roster || DEFAULT_ROSTER;
    var metaAe = opts.metaPerAe || META_PER_AE;
    var qtr = resolveQuarter(opts);
    deals = deals || [];

    var idx = {};                        // first -> registro do AE
    roster.forEach(function (r) {
      idx[r.first] = { first: r.first, display: r.display, fechado: 0, meta: metaAe, deals: [] };
    });

    for (var i = 0; i < deals.length; i++) {
      var d = deals[i];
      var fk = firstNameKey(d.ae);
      if (!fk || !idx[fk]) continue;                     // fora do time
      var closeDate = d.data_implantacao || d.data_ganho; // entrada em Implantação, fallback Ganho
      if (!closeDate) continue;
      var cd = String(closeDate).substring(0, 10);
      if (cd < qtr.start || cd > qtr.end) continue;       // fora do trimestre
      // ARR estimado ponderado pela régua GLOBAL da etapa (Implantação 80% · Ganho 100%).
      var arr = num(d.arr_estimado) * stageProb(d.stage);
      idx[fk].fechado += arr;
      idx[fk].deals.push(d);
    }

    var pace = paceFraction(qtr);
    var aes = roster.map(function (r) {
      var a = idx[r.first];
      a.pct = a.meta > 0 ? a.fechado / a.meta : 0;
      a.status = a.pct >= 1 ? 'batido' : (a.pct >= pace ? 'noRitmo' : 'atras');
      return a;
    });
    // Ordena por fechado desc (líder no topo), como o leaderboard dos outros painéis.
    aes.sort(function (a, b) { return b.fechado - a.fechado; });

    var fechadoTotal = 0, contas = 0;
    aes.forEach(function (a) { fechadoTotal += a.fechado; contas += a.deals.length; });
    var metaTime = roster.length * metaAe;
    var team = {
      meta: metaTime, fechado: fechadoTotal,
      pct: metaTime > 0 ? fechadoTotal / metaTime : 0,
      gap: Math.max(0, metaTime - fechadoTotal),
      gapPct: metaTime > 0 ? Math.max(0, (metaTime - fechadoTotal) / metaTime) : 0,
      contas: contas
    };
    return { quarter: qtr, pace: pace, team: team, aes: aes };
  }

  // ── Formatação BRL ────────────────────────────────────────────────────────────
  function fmtCompact(v) {
    v = num(v);
    var neg = v < 0; v = Math.abs(v);
    var out;
    if (v >= 1e6) { out = trimDec((v / 1e6).toFixed(v >= 1e7 ? 0 : 1)) + 'MM'; }
    else if (v >= 1e3) { out = Math.round(v / 1e3) + 'k'; }
    else { out = String(Math.round(v)); }
    return 'R$ ' + (neg ? '-' : '') + out;
  }
  function trimDec(s) { return String(s).replace('.', ','); }
  function fmtPct(f) { return Math.round(num(f) * 100) + '%'; }
  function fmtBRLfull(v) {
    return 'R$ ' + Math.round(num(v)).toLocaleString('pt-BR');
  }
  // 'yyyy-mm-dd' -> 'dd/mm/yy' (sem timezone; evita new Date para não deslocar o dia).
  function fmtDate(s) {
    if (!s) return '—';
    var p = String(s).substring(0, 10).split('-');
    if (p.length < 3) return String(s);
    return p[2] + '/' + p[1] + '/' + p[0].substring(2);
  }

  // ── CSS (injetado uma vez) ───────────────────────────────────────────────────
  var CSS_INJECTED = false;
  function injectCss() {
    if (CSS_INJECTED) return;
    CSS_INJECTED = true;
    var css = [
      '.ma-root{max-width:1100px;margin:0 auto;padding:1.4rem 0 3rem}',
      '.ma-head{display:flex;align-items:baseline;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:1.25rem}',
      '.ma-title{font-size:1.35rem;font-weight:800;letter-spacing:-.01em;color:var(--text,#e6edf3)}',
      '.ma-title .ma-months{color:var(--text2,#8b949e);font-weight:600}',
      '.ma-rule{font-size:.8rem;color:var(--muted,#6e7681)}',
      '.ma-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:.9rem;margin-bottom:1.6rem}',
      '@media(max-width:760px){.ma-kpis{grid-template-columns:repeat(2,1fr)}}',
      '.ma-kpi{background:var(--card,#161b22);border:1px solid var(--border,#30363d);border-radius:14px;padding:1rem 1.1rem}',
      '.ma-kpi .k-lab{font-size:.78rem;color:var(--text2,#8b949e);margin-bottom:.35rem;line-height:1.25}',
      '.ma-kpi .k-val{font-size:1.7rem;font-weight:800;letter-spacing:-.02em;color:var(--text,#e6edf3);line-height:1}',
      '.ma-kpi .k-sub{font-size:.8rem;margin-top:.4rem;font-weight:600}',
      '.ma-legend{display:flex;gap:1.2rem;align-items:center;flex-wrap:wrap;margin-bottom:1.1rem;font-size:.8rem;color:var(--text2,#8b949e)}',
      '.ma-legend .lg{display:inline-flex;align-items:center;gap:.4rem}',
      '.ma-legend .sw{width:12px;height:12px;border-radius:3px;display:inline-block}',
      // Barra do time (total × meta geral)
      '.ma-team{background:var(--card,#161b22);border:1px solid var(--border,#30363d);border-radius:14px;padding:1.1rem 1.2rem;margin-bottom:1.6rem}',
      '.ma-team-top{display:flex;align-items:baseline;justify-content:space-between;gap:1rem;margin-bottom:.7rem;flex-wrap:wrap}',
      '.ma-team-lab{font-size:.95rem;font-weight:700;color:var(--text,#e6edf3)}',
      '.ma-team-vals{font-size:.92rem;color:var(--text2,#8b949e);font-variant-numeric:tabular-nums}',
      '.ma-team-vals b{color:var(--text,#e6edf3);font-weight:800;font-size:1.05rem}',
      '.ma-team-pct{font-size:1.05rem;font-weight:800;margin-left:.5rem}',
      '.ma-track-lg{height:20px;border-radius:10px}',
      '.ma-pace{position:absolute;top:-4px;bottom:-4px;width:0;border-left:2px dashed var(--text2,#8b949e);opacity:.8}',
      '.ma-pace-lab{position:absolute;top:-1.35rem;transform:translateX(-50%);font-size:.66rem;color:var(--text2,#8b949e);white-space:nowrap}',
      '.ma-bars{display:flex;flex-direction:column}',
      '.ma-row{padding:1rem 0;border-top:1px solid var(--border,#30363d)}',
      '.ma-row:first-child{border-top:none}',
      '.ma-row-top{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:.6rem}',
      '.ma-name{font-size:1.02rem;font-weight:700;color:var(--text,#e6edf3)}',
      '.ma-name.clickable{cursor:pointer}',
      '.ma-name.clickable:hover{color:var(--teal,#3ab8b7);text-decoration:underline}',
      '.ma-name .ma-caret{font-size:.7rem;color:var(--text2,#8b949e);margin-left:.35rem}',
      '.ma-rt{display:flex;align-items:center;gap:.7rem;white-space:nowrap}',
      '.ma-vals{font-size:.92rem;color:var(--text2,#8b949e);font-variant-numeric:tabular-nums}',
      '.ma-vals b{color:var(--text,#e6edf3);font-weight:700}',
      '.ma-chip{font-size:.72rem;font-weight:700;padding:.2rem .55rem;border-radius:999px;white-space:nowrap}',
      '.ma-chip.batido{color:var(--green,#3fb950);background:color-mix(in srgb,var(--green,#3fb950) 16%,transparent)}',
      '.ma-chip.noRitmo{color:var(--yellow,#d29922);background:color-mix(in srgb,var(--yellow,#d29922) 16%,transparent)}',
      '.ma-chip.atras{color:var(--red,#f85149);background:color-mix(in srgb,var(--red,#f85149) 16%,transparent)}',
      '.ma-track{position:relative;height:14px;border-radius:8px;background:var(--card2,rgba(255,255,255,.06));overflow:hidden}',
      '.ma-fill{height:100%;border-radius:8px;transition:width .5s ease}',
      '.ma-fill.batido{background:var(--green,#3fb950)}',
      '.ma-fill.noRitmo{background:var(--yellow,#d29922)}',
      '.ma-fill.atras{background:var(--red,#f85149)}',
      '.ma-meta-tick{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--muted,#6e7681);opacity:.65}',
      '.ma-foot{margin-top:2rem;font-size:.76rem;line-height:1.55;color:var(--muted,#6e7681);background:var(--card,#161b22);border:1px solid var(--border,#30363d);border-radius:12px;padding:.9rem 1.05rem}',
      '.ma-foot b{color:var(--text2,#8b949e);font-weight:700}',
      '.ma-empty{padding:2rem;text-align:center;color:var(--muted,#6e7681);font-size:.9rem}',
      // Modal de lista de deals
      '.ma-ov{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9998;display:flex;align-items:center;justify-content:center;padding:1.2rem}',
      '.ma-modal{background:var(--card,#161b22);border:1px solid var(--border,#30363d);border-radius:16px;max-width:820px;width:100%;max-height:82vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.5)}',
      '.ma-modal-h{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1.1rem 1.3rem;border-bottom:1px solid var(--border,#30363d)}',
      '.ma-modal-h .mt{font-size:1.05rem;font-weight:800;color:var(--text,#e6edf3)}',
      '.ma-modal-h .ms{font-size:.8rem;color:var(--text2,#8b949e);margin-top:.15rem}',
      '.ma-x{cursor:pointer;background:none;border:none;color:var(--text2,#8b949e);font-size:1.4rem;line-height:1;padding:.2rem .4rem;border-radius:8px}',
      '.ma-x:hover{background:var(--card2,rgba(255,255,255,.08));color:var(--text,#e6edf3)}',
      '.ma-modal-b{overflow:auto;padding:.4rem 0}',
      '.ma-tbl{width:100%;border-collapse:collapse;font-size:.85rem}',
      '.ma-tbl th{position:sticky;top:0;background:var(--card,#161b22);text-align:left;padding:.6rem 1.3rem;color:var(--text2,#8b949e);font-weight:600;font-size:.74rem;text-transform:uppercase;letter-spacing:.03em;border-bottom:1px solid var(--border,#30363d)}',
      '.ma-tbl td{padding:.6rem 1.3rem;border-bottom:1px solid var(--border,#30363d);color:var(--text,#e6edf3);white-space:nowrap}',
      '.ma-tbl tr:last-child td{border-bottom:none}',
      '.ma-tbl td.num{text-align:right;font-variant-numeric:tabular-nums}',
      '.ma-tbl th.num{text-align:right}',
      '.ma-tbl a{color:var(--teal,#3ab8b7);text-decoration:none}',
      '.ma-tbl a:hover{text-decoration:underline}',
      '.ma-tbl tfoot td{font-weight:800;color:var(--text,#e6edf3);border-top:2px solid var(--border,#30363d)}'
    ].join('');
    var el = document.createElement('style');
    el.id = 'ma-style';
    el.textContent = css;
    document.head.appendChild(el);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  function render(container, deals, opts) {
    if (!container) return;
    opts = opts || {};
    var lang = opts.lang === 'en' ? 'en' : 'pt';
    injectCss();
    var m = compute(deals, opts);
    var q = m.quarter, team = m.team;

    var kSub = function (txt, cls) { return '<div class="k-sub" style="color:var(--' + cls + ')">' + txt + '</div>'; };

    var html = '';
    html += '<div class="ma-root">';
    // Cabeçalho
    html += '<div class="ma-head">'
      + '<div class="ma-title">' + esc(q.label) + ' <span class="ma-months">| ' + esc(q.months) + '</span></div>'
      + '<div class="ma-rule">' + esc(t(lang, 'rule')) + '</div>'
      + '</div>';

    // KPIs
    html += '<div class="ma-kpis">';
    html += '<div class="ma-kpi"><div class="k-lab">' + t(lang, 'metaTime') + '</div><div class="k-val">' + fmtCompact(team.meta) + '</div></div>';
    html += '<div class="ma-kpi"><div class="k-lab">' + t(lang, 'fechado') + '</div><div class="k-val">' + fmtCompact(team.fechado) + '</div>'
      + kSub(fmtPct(team.pct) + ' ' + t(lang, 'daMeta'), 'teal') + '</div>';
    html += '<div class="ma-kpi"><div class="k-lab">' + t(lang, 'gap') + '</div><div class="k-val">' + fmtCompact(team.gap) + '</div>'
      + kSub(t(lang, 'faltam') + ' ' + fmtPct(team.gapPct), 'muted') + '</div>';
    html += '<div class="ma-kpi"><div class="k-lab">' + t(lang, 'contas') + '</div><div class="k-val">' + team.contas + '</div></div>';
    html += '</div>';

    // Barra do TIME (total × meta geral). Status pela mesma régua dos AEs (ritmo do tri).
    var teamStatus = team.pct >= 1 ? 'batido' : (team.pct >= m.pace ? 'noRitmo' : 'atras');
    var teamFill = Math.min(1, team.pct) * 100;
    var paceLeft = Math.max(0, Math.min(1, m.pace)) * 100;
    html += '<div class="ma-team">'
      + '<div class="ma-team-top">'
      + '<span class="ma-team-lab">' + t(lang, 'timeLabel') + '</span>'
      + '<span class="ma-team-vals"><b>' + fmtCompact(team.fechado) + '</b> / ' + fmtCompact(team.meta)
      + '<span class="ma-team-pct" style="color:var(--' + statusVar(teamStatus) + ')">' + fmtPct(team.pct) + '</span></span>'
      + '</div>'
      + '<div class="ma-track ma-track-lg">'
      + '<div class="ma-fill ' + teamStatus + '" style="width:' + teamFill.toFixed(1) + '%"></div>'
      + (m.pace > 0 && m.pace < 1 ? '<div class="ma-pace" style="left:' + paceLeft.toFixed(1) + '%"></div>'
          + '<div class="ma-pace-lab" style="left:' + paceLeft.toFixed(1) + '%">' + t(lang, 'ritmoLabel') + ' ' + fmtPct(m.pace) + '</div>' : '')
      + (team.pct > 1 ? '<div class="ma-meta-tick" style="left:calc(' + (100 / team.pct).toFixed(1) + '% - 1px)"></div>' : '')
      + '</div></div>';

    // Legenda
    html += '<div class="ma-legend">'
      + '<span class="lg"><span class="sw" style="background:var(--green)"></span>' + t(lang, 'legFechado') + '</span>'
      + '<span class="lg"><span class="sw" style="background:var(--muted,#6e7681)"></span>' + t(lang, 'legMeta') + '</span>'
      + '</div>';

    // Barras por AE (nome clicável → drill dos deals que compõem o número)
    html += '<div class="ma-bars">';
    m.aes.forEach(function (a) {
      var fillPct = Math.min(1, a.pct) * 100;
      var clickable = a.deals.length > 0;
      html += '<div class="ma-row">'
        + '<div class="ma-row-top">'
        + '<div class="ma-name' + (clickable ? ' clickable" data-ma-ae="' + esc(a.first) + '"' : '"')
          + '>' + esc(a.display) + (clickable ? '<span class="ma-caret">▸ ' + a.deals.length + '</span>' : '') + '</div>'
        + '<div class="ma-rt">'
        + '<span class="ma-vals"><b>' + fmtCompact(a.fechado) + '</b> / ' + fmtCompact(a.meta) + '</span>'
        + '<span class="ma-chip ' + a.status + '">' + t(lang, a.status) + ' · ' + fmtPct(a.pct) + '</span>'
        + '</div></div>'
        + '<div class="ma-track">'
        + '<div class="ma-fill ' + a.status + '" style="width:' + fillPct.toFixed(1) + '%"></div>'
        + (a.pct > 1 ? '<div class="ma-meta-tick" style="left:calc(' + (100 / a.pct).toFixed(1) + '% - 1px)"></div>' : '')
        + '</div></div>';
    });
    html += '</div>';

    // Memória de cálculo
    html += '<div class="ma-foot">' + t(lang, 'memoria') + '</div>';
    html += '</div>';

    container.innerHTML = html;

    // Drill por AE: usa opts.onAeClick(aeRec) se o painel host fornecer; senão, modal embutido.
    var byFirst = {};
    m.aes.forEach(function (a) { byFirst[a.first] = a; });
    var nodes = container.querySelectorAll('[data-ma-ae]');
    for (var i = 0; i < nodes.length; i++) {
      (function (node) {
        node.addEventListener('click', function () {
          var rec = byFirst[node.getAttribute('data-ma-ae')];
          if (!rec) return;
          if (typeof opts.onAeClick === 'function') opts.onAeClick(rec, m);
          else openAeModal(rec, m.quarter, lang, opts.hubId || DEFAULT_HUB_ID);
        });
      })(nodes[i]);
    }
  }

  function statusVar(s) { return s === 'batido' ? 'green' : (s === 'noRitmo' ? 'yellow' : 'red'); }

  // ── Modal embutido de lista de deals (autocontido; usado se o host não passar onAeClick) ──
  var DEFAULT_HUB_ID = '44715285';
  function openAeModal(rec, qtr, lang, hubId) {
    var ov = document.createElement('div');
    ov.className = 'ma-ov';
    var ds = (rec.deals || []).slice().sort(function (a, b) { return num(b.arr_estimado) - num(a.arr_estimado); });

    var rows = '';
    ds.forEach(function (d) {
      var url = 'https://app.hubspot.com/contacts/' + esc(hubId) + '/deal/' + esc(d.hs_id);
      var entrada = d.data_implantacao || d.data_ganho;
      var prob = stageProb(d.stage);
      var pond = num(d.arr_estimado) * prob;
      rows += '<tr>'
        + '<td><a href="' + url + '" target="_blank" rel="noopener">' + esc(d.dealname || '—') + '</a></td>'
        + '<td>' + esc(d.stage || '—') + '</td>'
        + '<td class="num">' + (d.vidas != null ? num(d.vidas).toLocaleString('pt-BR') : '—') + '</td>'
        + '<td class="num">' + fmtBRLfull(d.arr_estimado) + '</td>'
        + '<td class="num">' + fmtPct(prob) + '</td>'
        + '<td class="num">' + fmtBRLfull(pond) + '</td>'
        + '<td class="num">' + fmtDate(entrada) + '</td>'
        + '</tr>';
    });
    if (!rows) rows = '<tr><td colspan="7" class="ma-empty">' + t(lang, 'semContas') + '</td></tr>';

    ov.innerHTML = '<div class="ma-modal">'
      + '<div class="ma-modal-h"><div>'
      + '<div class="mt">' + esc(rec.display) + '</div>'
      + '<div class="ms">' + ds.length + ' ' + t(lang, 'modalTitle') + ' · ' + esc(qtr.label) + ' | ' + esc(qtr.months)
      + ' · ' + t(lang, 'fechado') + ' ' + fmtBRLfull(rec.fechado) + ' / ' + fmtBRLfull(rec.meta) + '</div>'
      + '</div><button class="ma-x" aria-label="Fechar">×</button></div>'
      + '<div class="ma-modal-b"><table class="ma-tbl"><thead><tr>'
      + '<th>' + t(lang, 'colDeal') + '</th><th>' + t(lang, 'colStage') + '</th>'
      + '<th class="num">' + t(lang, 'colVidas') + '</th><th class="num">' + t(lang, 'colArr') + '</th>'
      + '<th class="num">' + t(lang, 'colProb') + '</th><th class="num">' + t(lang, 'colPond') + '</th>'
      + '<th class="num">' + t(lang, 'colDate') + '</th>'
      + '</tr></thead><tbody>' + rows + '</tbody>'
      + (ds.length ? '<tfoot><tr><td colspan="5">Total</td><td class="num">' + fmtBRLfull(rec.fechado) + '</td><td></td></tr></tfoot>' : '')
      + '</table></div></div>';

    function close() {
      if (ov.parentNode) ov.parentNode.removeChild(ov);
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('.ma-x').addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
  }

  root.MetaAch = {
    render: render,
    compute: compute,
    openAeModal: openAeModal,
    resolveQuarter: resolveQuarter,
    fmtCompact: fmtCompact,
    DEFAULT_ROSTER: DEFAULT_ROSTER,
    META_PER_AE: META_PER_AE
  };
})(typeof window !== 'undefined' ? window : this);
