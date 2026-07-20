'use strict';
/* BDR Workload | carga de trabalho e movimentação intraday/weekly/monthly.
   Consome /api/bdr-workload (inserções por createdate + transições de hs_lead_status
   via propertiesWithHistory). Agregação e filtros 100% no front. Spec:
   docs/2026-07-13_bdr-workload-intraday-spec.md */
var WorkloadBDR = (function () {
  var HS_PORTAL = 'https://app.hubspot.com/contacts/44715285';

  var STATUS_LABEL = {
    NEW: 'Novo', OPEN: 'Aberto', IN_PROGRESS: 'Em andamento',
    ATTEMPTED_TO_CONTACT: 'Tentativa de contato', CONNECTED: 'Contato efetivo',
    OPEN_DEAL: 'Qualificado (deal)', UNQUALIFIED: 'Desqualificado', BAD_TIMING: 'Timing ruim',
  };
  var STATUS_CLS = {
    CONNECTED: 'good', OPEN_DEAL: 'good', UNQUALIFIED: 'bad', BAD_TIMING: 'warn',
    ATTEMPTED_TO_CONTACT: 'warn',
  };
  var FONTES = ['Apollo', 'Lusha', 'Manual', 'API interna'];

  var raw = null;
  var history = null;
  var historyError = null;
  var state = { period: 'hoje', since: null, until: null, bdr: '', porte: '', fonte: '', diasUteis: true };

  // ---------- datas (America/Sao_Paulo = fuso local dos usuários) ----------
  function iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function periodRange(p) {
    var now = new Date(), s = new Date(now), u = new Date(now);
    if (p === 'ontem') { s.setDate(s.getDate() - 1); u = new Date(s); }
    else if (p === '7d') { s.setDate(s.getDate() - 6); }
    else if (p === '30d') { s.setDate(s.getDate() - 29); } // 30 dias contando hoje
    else if (p === 'semana') { var dow = (now.getDay() + 6) % 7; s.setDate(s.getDate() - dow); }
    else if (p === 'mes') { s.setDate(1); }
    return { since: iso(s), until: iso(u) };
  }

  function porteOf(colabs) {
    if (colabs == null || !isFinite(colabs)) return 'Sem info';
    if (colabs <= 200) return '≤200';
    if (colabs <= 500) return '201–500';
    if (colabs <= 5000) return '501–5k';
    return '>5k';
  }
  var PORTES = ['≤200', '201–500', '501–5k', '>5k', 'Sem info'];

  function hhmm(ts) {
    var d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function dmhm(ts) {
    var d = new Date(ts);
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + ' ' + hhmm(ts);
  }
  function ddmmFromIso(s) { return s.slice(8, 10) + '/' + s.slice(5, 7); }
  function isDiaUtil(date) {
    var day = date.getDay();
    return day !== 0 && day !== 6;
  }
  function eachDate(since, until, fn) {
    var d = new Date(since + 'T00:00:00'), end = new Date(until + 'T00:00:00');
    while (d <= end) { fn(new Date(d)); d.setDate(d.getDate() + 1); }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ---------- filtros ----------
  function passBdr(x) { return !state.bdr || x.bdr === state.bdr; }
  function passPorte(x) { return !state.porte || porteOf(x.colaboradores) === state.porte; }
  function passFonte(x) { return !state.fonte || (x.fonte || 'Outra') === state.fonte; }

  function fCompanies() { return raw.companiesCreated.filter(function (c) { return passBdr(c) && passPorte(c) && passFonte(c); }); }
  function fContacts() { return raw.contactsCreated.filter(function (c) { return passBdr(c) && passPorte(c) && passFonte(c); }); }
  // fonte não se aplica a transição (movimentação não tem fonte de criação)
  function fTransitions() { return raw.transitions.filter(function (t) { return passBdr(t) && passPorte(t); }); }
  // atividade não tem empresa nem fonte de criação: só filtro de BDR
  function fActivities() { return (raw.activities || []).filter(passBdr); }
  function historyAvailable() { return !!(history && Array.isArray(history.dailyRows) && Array.isArray(history.sqlDeals)); }
  function fSqlDeals() { return historyAvailable() ? history.sqlDeals.filter(function (d) { return !state.bdr || d.bdr === state.bdr; }) : []; }
  function renderFreshness() {
    var msg = 'Hoje: HubSpot live | Histórico e SQL: ';
    if (!historyAvailable()) return msg + 'BigQuery indisponível' + (historyError ? ' (' + historyError + ')' : '');
    var rec = history.metadata && history.metadata.reconciliation;
    return msg + 'BigQuery atualizado ' + (history.metadata && history.metadata.refreshedAt ? dmhm(history.metadata.refreshedAt) : '—') +
      (rec && rec.matches === false ? ' | ALERTA: SQL não reconciliado' : '');
  }

  // ---------- carga ----------
  function load(refresh) {
    var r = state.period === 'custom' ? { since: state.since, until: state.until } : periodRange(state.period);
    state.since = r.since; state.until = r.until;
    document.getElementById('state').classList.remove('hidden');
    document.getElementById('content').classList.add('hidden');
    var url = '/api/bdr-workload?since=' + r.since + '&until=' + r.until + (refresh ? '&refresh=1' : '');
    var histUrl = '/api/bdr-workload-history?since=' + r.since + '&until=' + r.until;
    var liveReq = fetch(url, { credentials: 'same-origin' })
      .then(function (res) {
        if (res.status === 401) { window.location.href = '/'; throw new Error('login'); }
        return res.json();
      })
      .then(function (data) {
        if (!data.success) throw new Error(data.error || 'Falha ao carregar');
        return data;
      });
    var histReq = fetch(histUrl, { credentials: 'same-origin' })
      .then(function (res) {
        if (res.status === 401) { window.location.href = '/'; throw new Error('login'); }
        return res.json().then(function (data) {
          if (!res.ok || !data.success) throw new Error(data.error || 'Falha ao carregar histórico');
          return data;
        });
      })
      .catch(function (e) {
        if (e.message === 'login') throw e;
        historyError = e.message || 'Falha ao carregar histórico';
        return null;
      });
    Promise.all([liveReq, histReq])
      .then(function (results) {
        raw = results[0];
        history = results[1];
        if (history) historyError = null;
        render();
      })
      .catch(function (e) {
        if (e.message === 'login') return;
        document.getElementById('state').innerHTML = '<strong>Erro ao carregar</strong>' + esc(e.message);
      });
  }

  // ---------- render ----------
  function render() {
    renderFilters();
    var comps = fCompanies(), conts = fContacts(), trans = fTransitions(), sqlDeals = fSqlDeals();
    var kEfetivo = trans.filter(function (t) { return t.para === 'CONNECTED'; });
    var kQualif = trans.filter(function (t) { return t.para === 'OPEN_DEAL'; });
    var kDesq = trans.filter(function (t) { return t.para === 'UNQUALIFIED' || t.para === 'BAD_TIMING'; });

    var html = '<section class="note"><b>Fonte dos dados:</b> ' + esc(renderFreshness()) + '. O snapshot BigQuery roda durante o dia; a série de hoje usa HubSpot live para não mostrar atividade parcial.</section>';
    html += kpis([
      { label: 'Empresas inseridas', value: comps.length, cls: 'teal', drill: 'empresas', sub: subFontes(comps), help: 'empresas-ins' },
      { label: 'Contatos inseridos', value: conts.length, cls: 'teal', drill: 'contatos', sub: subFontes(conts), help: 'contatos-ins' },
      { label: 'SQL real (deals)', value: historyAvailable() ? sqlDeals.length : '—', cls: 'good', drill: 'sql-real', sub: historyAvailable() ? 'deals SQL no pipeline' + (kQualif.length ? ' | proxy OPEN_DEAL ' + kQualif.length : '') : 'histórico BigQuery indisponível', help: 'sql-real' },
      { label: 'Contato efetivo', value: kEfetivo.length, cls: 'good', drill: 'efetivo', sub: 'transições para Contato efetivo', help: 'contato-efetivo' },
      { label: 'Movimentações de status', value: trans.length, cls: '', drill: 'movs', sub: trans.length ? 'em ' + uniq(trans, 'contato_id') + ' contatos' : 'sem movimentação no recorte', help: 'movs-status' },
      { label: 'Desqualificado | Timing', value: kDesq.length, cls: kDesq.length ? 'bad' : '', drill: 'desq', sub: 'motivos: propriedade pendente no HubSpot', help: 'desqualificado' },
    ]);
    if (historyError) html += '<div class="note" style="margin-bottom:1rem"><b>Histórico indisponível:</b> ' + esc(historyError) + '</div>';
    if (historyAvailable() && history.metadata && history.metadata.maxMetricDate && history.metadata.maxMetricDate < state.until) html += '<div class="note" style="margin-bottom:1rem"><b>Histórico possivelmente defasado:</b> último dia no BigQuery é ' + esc(history.metadata.maxMetricDate) + '.</div>';
    html += chartInsercoes(conts, trans);
    html += chartRealActivities(fActivities());
    html += chartFonteResultado(comps, conts, trans);
    html += tabelaAtividades(fActivities(), comps, conts, trans);
    html += tabelaSqlDeals(sqlDeals);
    html += '<div class="grid">';
    html += chartPorBdr(comps, conts, trans);
    html += chartPorFonte(comps, conts);
    html += '</div>';
    html += tabelaMovs(trans);
    html += tabelaEmpresas(comps, conts);
    html += tabelaContatos(conts);

    document.getElementById('content').innerHTML = html;
    document.getElementById('state').classList.add('hidden');
    document.getElementById('content').classList.remove('hidden');
    var gen = document.getElementById('gen-at');
    if (gen) gen.textContent = 'Janela ' + state.since + ' a ' + state.until + ' | gerado ' + dmhm(raw.generatedAt) + (raw.cached ? ' | cache' : '') + ' | ' + renderFreshness();
  }

  function uniq(arr, key) {
    var s = {}; arr.forEach(function (x) { s[x[key]] = 1; }); return Object.keys(s).length;
  }
  function subFontes(arr) {
    if (!arr.length) return 'nada inserido no recorte';
    var c = {};
    arr.forEach(function (x) { var f = x.fonte || 'Outra'; c[f] = (c[f] || 0) + 1; });
    return Object.keys(c).sort(function (a, b) { return c[b] - c[a]; })
      .map(function (f) { return f + ' ' + c[f]; }).join(' | ');
  }

  function kpis(items) {
    var h = '<section class="kpis">';
    items.forEach(function (k) {
      var helpKey = k.help || k.drill || 'universo';
      h += '<div class="kpi clickable ' + k.cls + '" onclick="WorkloadBDR.drill(\'' + k.drill + '\')">' +
        '<div class="label"><span>' + esc(k.label) + '</span><span class="calc-btn" onclick="event.stopPropagation();WorkloadBDR.openHelpFor(\'' + helpKey + '\')" title="Ver memória de cálculo">?</span></div>' +
        '<div class="value">' + k.value + '</div>' +
        '<div class="sub">' + esc(k.sub) + '</div></div>';
    });
    return h + '</section>';
  }

  function chartInsercoes(conts, trans) {
    var multiDay = state.since !== state.until;
    var buckets = {}, order = [];
    function push(ts, tipo) {
      var d = new Date(ts);
      var key = multiDay
        ? String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0')
        : String(d.getHours()).padStart(2, '0') + 'h';
      if (!buckets[key]) { buckets[key] = { ins: 0, mov: 0 }; order.push(key); }
      buckets[key][tipo]++;
    }
    conts.forEach(function (c) { push(c.criado, 'ins'); });
    trans.forEach(function (t) { push(t.ts, 'mov'); });
    order.sort();
    var max = 1;
    order.forEach(function (k) { max = Math.max(max, buckets[k].ins + buckets[k].mov); });
    var h = '<div class="grid"><div class="card span-12"><div class="card-title"><div><h2>Ritmo | ' +
      (multiDay ? 'atividade por dia' : 'atividade por hora') + '</h2>' +
      '<div class="desc">Contatos inseridos (turquesa) e movimentações de status (amarelo) ao longo ' + (multiDay ? 'dos dias' : 'do dia') + '</div></div></div>';
    if (!order.length) { return h + '<div class="desc">Sem atividade no recorte.</div></div></div>'; }
    h += '<div class="bars" style="height:190px">';
    order.forEach(function (k) {
      var b = buckets[k], tot = b.ins + b.mov;
      var hi = Math.round(b.ins / max * 150), hm = Math.round(b.mov / max * 150);
      h += '<div class="bar-wrap"><div style="width:100%;max-width:36px;display:flex;flex-direction:column;justify-content:end">' +
        '<div class="bar" style="position:relative;background:linear-gradient(180deg,var(--yellow),rgba(227,179,65,.4));height:' + Math.max(hm, b.mov ? 3 : 0) + 'px;border-radius:' + (b.ins ? '7px 7px 0 0' : '7px 7px 0 0') + '"><small>' + (tot || '') + '</small></div>' +
        '<div style="width:100%;background:linear-gradient(180deg,var(--teal),rgba(58,184,183,.4));height:' + Math.max(hi, b.ins ? 3 : 0) + 'px;border-radius:0 0 0 0"></div>' +
        '</div><span class="bar-label" style="transform:none">' + esc(k) + '</span></div>';
    });
    return h + '</div></div></div>';
  }

  function activityBucket(a) {
    if (a.tipo === 'calls') return 'calls';
    if (a.tipo === 'emails') return 'emails';
    if (a.tipo === 'communications' && a.canal === 'WHATS_APP') return 'whatsApp';
    if (a.tipo === 'communications' && a.canal === 'LINKEDIN_MESSAGE') return 'linkedin';
    if (a.tipo === 'meetings') return 'meetings';
    return null;
  }
  function aggregateActsByDay(acts, since, until, onlyBusinessDays) {
    var by = {}, out = [];
    eachDate(since, until, function (d) {
      if (onlyBusinessDays && !isDiaUtil(d)) return;
      var key = iso(d);
      by[key] = { date: key, calls: 0, callsReal: 0, emails: 0, whatsApp: 0, linkedin: 0, meetings: 0, total: 0 };
      out.push(by[key]);
    });
    acts.forEach(function (a) {
      var d = new Date(a.ts), key = iso(d), b = activityBucket(a);
      if (!b || !by[key]) return;
      by[key][b]++;
      if (b === 'calls' && a.duracao_ms != null && a.duracao_ms >= 60000) by[key].callsReal++;
      by[key].total++;
    });
    return out;
  }
  function aggregateHistoryByDay(since, until, onlyBusinessDays, includeLiveToday, acts) {
    var by = {}, out = [], todayIso = iso(new Date());
    eachDate(since, until, function (d) {
      if (onlyBusinessDays && !isDiaUtil(d)) return;
      var key = iso(d);
      by[key] = { date: key, calls: 0, callsReal: 0, emails: 0, whatsApp: 0, linkedin: 0, meetings: 0, total: 0 };
      out.push(by[key]);
    });
    if (!historyAvailable()) return includeLiveToday ? aggregateActsByDay(acts, since, until, onlyBusinessDays) : out;
    history.dailyRows.forEach(function (r) {
      var key = r.metric_date;
      if (state.bdr && r.owner_name !== state.bdr) return;
      if (!by[key] || (includeLiveToday && key === todayIso)) return;
      by[key].calls += r.calls_total || 0;
      by[key].emails += r.emails_sent_total || 0;
      by[key].whatsApp += r.whatsapp_total || 0;
      by[key].linkedin += r.linkedin_total || 0;
      by[key].meetings += r.meetings_total || 0;
      by[key].total += (r.calls_total || 0) + (r.emails_sent_total || 0) +
        (r.whatsapp_total || 0) + (r.linkedin_total || 0) + (r.meetings_total || 0);
    });
    if (includeLiveToday) aggregateActsByDay(acts, since, until, onlyBusinessDays).forEach(function (r) {
      if (r.date === todayIso && by[r.date]) by[r.date] = r;
    });
    return out;
  }
  function sumActivityRows(rows) {
    var s = { calls: 0, callsReal: 0, emails: 0, whatsApp: 0, linkedin: 0, meetings: 0, total: 0 };
    rows.forEach(function (r) { Object.keys(s).forEach(function (k) { s[k] += r[k] || 0; }); });
    return s;
  }
  function pctDelta(now, prev) {
    if (!prev && !now) return '0%';
    if (!prev) return '+100%';
    var v = Math.round((now - prev) / prev * 100);
    return (v > 0 ? '+' : '') + v + '%';
  }
  function cmpText(now, prev, label) {
    if (!historyAvailable()) return '— ' + label + ' · <b>indisponível</b>';
    return now + ' ' + label + ' vs ' + prev + ' no período anterior equivalente · <b>' + pctDelta(now, prev) + '</b>';
  }
  function shiftIso(value, days) {
    var d = new Date(value + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return iso(d);
  }
  function inclusiveCalendarDays(since, until) {
    return Math.floor((new Date(until + 'T00:00:00') - new Date(since + 'T00:00:00')) / 86400000) + 1;
  }
  function chartRealActivities(acts) {
    var rows = aggregateHistoryByDay(state.since, state.until, state.diasUteis, true, acts);
    var today = new Date(state.until + 'T00:00:00');
    var weekStart = new Date(today); weekStart.setDate(weekStart.getDate() - 6);
    var lastWeekStart = new Date(weekStart); lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    var lastWeekEnd = new Date(weekStart); lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);
    var thisWeek = sumActivityRows(aggregateHistoryByDay(iso(weekStart), iso(today), state.diasUteis, true, acts));
    var lastWeek = sumActivityRows(aggregateHistoryByDay(iso(lastWeekStart), iso(lastWeekEnd), state.diasUteis, false, acts));
    var currentPeriod = sumActivityRows(rows);
    var periodDays = inclusiveCalendarDays(state.since, state.until);
    var previousUntil = shiftIso(state.since, -1);
    var previousSince = shiftIso(state.since, -periodDays);
    var previousPeriod = sumActivityRows(aggregateHistoryByDay(previousSince, previousUntil, state.diasUteis, false, acts));
    var h = '<div class="grid"><div class="card span-12"><div class="card-title"><div><h2>Ritmo Real de Atividades <span class="calc-btn" onclick="WorkloadBDR.openHelpFor(\'atividades-reais\')" title="Ver memória de cálculo">?</span></h2>' +
      '<div class="desc">Atividades registradas por dia' + (state.diasUteis ? ' útil' : '') + ': ligações, e-mails, WhatsApp, LinkedIn e reuniões. Conversas ≥ 1 min aparecem separadamente na tabela live.</div></div></div>';
    h += '<div class="story-grid"><div class="story-card"><div class="story-head"><b>WoW | ligações registradas</b></div><span>' + cmpText(thisWeek.calls, lastWeek.calls, 'nesta semana') + '</span></div>' +
      '<div class="story-card"><div class="story-head"><b>WoW | e-mails</b></div><span>' + cmpText(thisWeek.emails, lastWeek.emails, 'nesta semana') + '</span></div>' +
      '<div class="story-card"><div class="story-head"><b>Período anterior | atividades</b></div><span>' + cmpText(currentPeriod.total, previousPeriod.total, 'na janela') + '</span></div></div>';
    if (!rows.length) return h + '<div class="desc">Sem dias no recorte após filtro.</div></div></div>';
    var max = 1; rows.forEach(function (r) { max = Math.max(max, r.total); });
    var W = 1120, H = 260, L = 42, R = 16, T = 18, B = 34, plotW = W - L - R, plotH = H - T - B;
    var keys = [['calls', 'var(--teal)', 'Ligações'], ['emails', 'var(--yellow)', 'E-mails'], ['whatsApp', 'var(--green)', 'WhatsApp'], ['linkedin', 'var(--orange)', 'LinkedIn'], ['meetings', 'rgba(58,184,183,.42)', 'Reuniões']];
    var cum = rows.map(function () { return 0; });
    function x(i) { return L + (rows.length === 1 ? plotW / 2 : i * plotW / (rows.length - 1)); }
    function y(v) { return T + plotH - (v / max * plotH); }
    h += '<div class="line-legend">' + keys.map(function (k) { return '<span><i style="background:' + k[1] + '"></i>' + k[2] + '</span>'; }).join('') + '</div>';
    h += '<svg class="area-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Ritmo real de atividades por dia">';
    for (var gy = 0; gy <= 4; gy++) { var yy = T + gy * plotH / 4; h += '<line x1="' + L + '" y1="' + yy + '" x2="' + (W - R) + '" y2="' + yy + '"></line><text x="4" y="' + (yy + 4) + '">' + Math.round(max * (4 - gy) / 4) + '</text>'; }
    keys.forEach(function (k) {
      var top = [], bottom = [];
      rows.forEach(function (r, i) { bottom.push([x(i), y(cum[i])]); cum[i] += r[k[0]] || 0; top.push([x(i), y(cum[i])]); });
      var d = 'M ' + top.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' L ') + ' L ' + bottom.slice().reverse().map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' L ') + ' Z';
      h += '<path class="area-layer" fill="' + k[1] + '" d="' + d + '"><title>' + k[2] + '</title></path>';
    });
    rows.forEach(function (r, i) { if (i % Math.ceil(rows.length / 12) === 0 || i === rows.length - 1) h += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle">' + ddmmFromIso(r.date) + '</text>'; });
    h += '</svg>';
    var zeros = rows.filter(function (r) { return r.total === 0; });
    if (zeros.length) h += '<div class="zero-audit">' + zeros.slice(0, 6).map(function (z) { return '<div class="zero-day"><b>' + ddmmFromIso(z.date) + '</b><br>Nenhuma atividade registrada neste dia útil. ' + (historyAvailable() ? '0 registrado.' : 'Histórico indisponível; pode ser falha de registro/API.') + '</div>'; }).join('') + (zeros.length > 6 ? '<div class="zero-day">+' + (zeros.length - 6) + ' dias úteis zerados</div>' : '') + '</div>';
    return h + '</div></div>';
  }

  function chartFonteResultado(comps, conts, trans) {
    if (!historyAvailable()) return '<div class="story-grid"><div class="story-card"><b>Correlação fonte → resultado</b><span>Insight indisponível: SQL real por deal depende do histórico BigQuery.</span></div></div>';
    var by = {};
    raw.team.forEach(function (b) { by[b] = { apollo: 0, total: 0, qual: 0 }; });
    comps.concat(conts).forEach(function (x) { if (by[x.bdr]) { by[x.bdr].total++; if (x.fonte === 'Apollo') by[x.bdr].apollo++; } });
    fSqlDeals().forEach(function (d) { if (by[d.bdr]) by[d.bdr].qual++; });
    var rows = Object.keys(by).filter(function (b) { return by[b].total || by[b].qual; });
    if (!rows.length) return '';
    var avgApollo = rows.reduce(function (s, b) { return s + (by[b].total ? by[b].apollo / by[b].total : 0); }, 0) / rows.length;
    var high = rows.filter(function (b) { return by[b].total && by[b].apollo / by[b].total >= avgApollo; });
    var low = rows.filter(function (b) { return high.indexOf(b) < 0; });
    function rate(list) { var q = 0, t = 0; list.forEach(function (b) { q += by[b].qual; t += by[b].total; }); return t ? q / t : 0; }
    var rh = rate(high), rl = rate(low), teamRate = rate(rows);
    var delta = rl ? Math.round((rh - rl) / rl * 100) : (rh ? 100 : 0);
    return '<div class="story-grid"><div class="story-card"><b>Correlação fonte → resultado</b><span>BDRs com maior uso de Apollo têm taxa de SQL real de <b>' + Math.round(rh * 100) + '%</b> vs <b>' + Math.round(rl * 100) + '%</b> no grupo de menor uso.</span></div>' +
      '<div class="story-card"><b>Insight MBB</b><span>Diferença estimada: <b>' + (delta > 0 ? '+' : '') + delta + '%</b> sobre o grupo de baixa Apollo. Leitura: fonte parece influenciar qualidade, mas precisa validar mix de porte/persona.</span></div>' +
      '<div class="story-card"><b>Ação sugerida</b><span>Replicar cadência dos BDRs de alto Apollo e auditar se o ganho vem da fonte ou da disciplina de follow-up. Média do time: <b>' + Math.round(teamRate * 100) + '%</b>.</span></div></div>';
  }

  function chartPorBdr(comps, conts, trans) {
    var por = {};
    raw.team.forEach(function (b) { por[b] = { emp: 0, cont: 0, mov: 0, efetivo: 0, desq: 0, sql: 0 }; });
    comps.forEach(function (c) { if (por[c.bdr]) por[c.bdr].emp++; });
    conts.forEach(function (c) { if (por[c.bdr]) por[c.bdr].cont++; });
    fSqlDeals().forEach(function (d) { if (por[d.bdr]) por[d.bdr].sql++; });
    trans.forEach(function (t) {
      if (!por[t.bdr]) return;
      por[t.bdr].mov++;
      if (t.para === 'CONNECTED') por[t.bdr].efetivo++;
      if (t.para === 'UNQUALIFIED' || t.para === 'BAD_TIMING') por[t.bdr].desq++;
    });
    var rows = raw.team.slice().sort(function (a, b) {
      return (por[b].cont + por[b].mov) - (por[a].cont + por[a].mov);
    });
    var max = 1;
    rows.forEach(function (b) { max = Math.max(max, por[b].cont + por[b].mov); });
    var h = '<div class="card span-6"><div class="card-title"><div><h2>Por BDR | inserção e movimentação</h2>' +
      '<div class="desc">Barra = contatos inseridos + movimentações | pills: empresas inseridas, SQL real, contatos efetivos, desqualificações</div></div></div><div class="break-list">';
    rows.forEach(function (b) {
      var p = por[b], tot = p.cont + p.mov;
      h += '<div class="break-row" style="grid-template-columns:minmax(120px,1fr) auto">' +
        '<span class="break-name">' + esc(b) + '</span>' +
        '<span style="display:flex;gap:.3rem;justify-content:end">' +
        '<span class="pill" data-tip="Empresas inseridas">🏢 ' + p.emp + '</span>' +
        '<span class="pill' + (p.sql ? ' good' : '') + '" data-tip="SQL real (deals)">SQL ' + (historyAvailable() ? p.sql : '—') + '</span>' +
        '<span class="pill' + (p.efetivo ? ' good' : '') + '" data-tip="Contatos efetivos">✓ ' + p.efetivo + '</span>' +
        '<span class="pill' + (p.desq ? ' bad' : '') + '" data-tip="Desqualificados">✕ ' + p.desq + '</span></span>' +
        '<div class="break-track"><div class="break-fill" style="width:' + Math.round(tot / max * 100) + '%"></div></div>' +
        '<span class="break-val">' + p.cont + ' ins | ' + p.mov + ' mov | SQL ' + (historyAvailable() ? p.sql : '—') + '</span></div>';
    });
    return h + '</div></div>';
  }

  function chartPorFonte(comps, conts) {
    var por = {};
    function add(arr, key) {
      arr.forEach(function (x) {
        var f = x.fonte || 'Outra';
        if (!por[f]) por[f] = { emp: 0, cont: 0 };
        por[f][key]++;
      });
    }
    add(comps, 'emp'); add(conts, 'cont');
    var fontes = Object.keys(por).sort(function (a, b) { return (por[b].emp + por[b].cont) - (por[a].emp + por[a].cont); });
    var max = 1;
    fontes.forEach(function (f) { max = Math.max(max, por[f].emp + por[f].cont); });
    var h = '<div class="card span-6"><div class="card-title"><div><h2>Por fonte | de onde vem a inserção</h2>' +
      '<div class="desc">Apollo e Lusha = push do próprio BDR via extensão | Manual = criado no HubSpot | API interna = automações (não é inserção de BDR)</div></div></div><div class="break-list">';
    if (!fontes.length) h += '<div class="desc">Sem inserções no recorte.</div>';
    fontes.forEach(function (f) {
      var p = por[f], tot = p.emp + p.cont;
      h += '<div class="break-row"><span class="break-name">' + esc(f) + '</span>' +
        '<div class="break-track"><div class="break-fill" style="width:' + Math.round(tot / max * 100) + '%"></div></div>' +
        '<span class="break-val">' + p.emp + ' emp | ' + p.cont + ' cont</span></div>';
    });
    return h + '</div></div>';
  }

  function tabelaAtividades(acts, comps, conts, trans) {
    var MIN_CONVERSA = 60000;
    var por = {};
    raw.team.forEach(function (b) {
      por[b] = { calls: 0, calls1m: 0, emails: 0, whats: 0, linkedin: 0, comOutras: 0, notes: 0, tasks: 0, meetings: 0, ins: 0, mov: 0 };
    });
    acts.forEach(function (a) {
      var p = por[a.bdr]; if (!p) return;
      if (a.tipo === 'calls') { p.calls++; if (a.duracao_ms != null && a.duracao_ms >= MIN_CONVERSA) p.calls1m++; }
      else if (a.tipo === 'emails') p.emails++;
      else if (a.tipo === 'communications') {
        if (a.canal === 'WHATS_APP') p.whats++;
        else if (a.canal === 'LINKEDIN_MESSAGE') p.linkedin++;
        else p.comOutras++;
      }
      else if (a.tipo === 'notes') p.notes++;
      else if (a.tipo === 'tasks') p.tasks++;
      else if (a.tipo === 'meetings') p.meetings++;
    });
    comps.forEach(function (c) { if (por[c.bdr]) por[c.bdr].ins++; });
    conts.forEach(function (c) { if (por[c.bdr]) por[c.bdr].ins++; });
    trans.forEach(function (t) { if (por[t.bdr]) por[t.bdr].mov++; });
    function tot(p) { return p.calls + p.emails + p.whats + p.linkedin + p.comOutras + p.notes + p.tasks + p.meetings; }
    var rows = raw.team.slice().sort(function (a, b) { return tot(por[b]) - tot(por[a]); });
    var totalActs = 0; rows.forEach(function (b) { totalActs += tot(por[b]); });

    var h = '<div class="grid"><div class="card span-12"><div class="card-title"><div><h2>Atividades | o trabalho além da inserção</h2>' +
      '<div class="desc">Engagements registrados no HubSpot dentro da janela, por dono | ligação com conversa = duração ≥ 1 min | inserir nada e ligar o dia inteiro aparece aqui, não nos KPIs de inserção</div></div>' +
      '<span class="pill">' + totalActs + ' atividades</span></div>';
    if (!totalActs) return h + '<div class="desc">Sem atividades registradas no recorte.</div></div></div>';
    h += '<div class="table-wrap"><table><thead><tr><th>BDR</th><th class="right">Ligações</th><th class="right">Com conversa (≥1 min)</th>' +
      '<th class="right">E-mails</th><th class="right">WhatsApp</th><th class="right">LinkedIn</th><th class="right">Outras</th><th class="right">Notas</th>' +
      '<th class="right">Tarefas</th><th class="right">Reuniões</th><th class="right">Total</th><th class="right">Inserções</th><th class="right">Movimentações</th></tr></thead><tbody>';
    rows.forEach(function (b) {
      var p = por[b], t = tot(p);
      if (!t && !p.ins && !p.mov) return;
      h += '<tr><td>' + esc(b) + '</td><td class="right">' +
        (p.calls ? '<span class="calls-link" onclick="WorkloadBDR.drillCalls(\'' + b + '\')" title="Ver detalhe das ligações" style="cursor:pointer;color:var(--teal);text-decoration:underline dotted;text-underline-offset:2px">' + p.calls + '</span>' : '0') + '</td>' +
        '<td class="right">' + (p.calls ? p.calls1m + ' <span class="muted">(' + Math.round(p.calls1m / p.calls * 100) + '%)</span>' : '0') + '</td>' +
        '<td class="right">' + p.emails + '</td><td class="right">' + p.whats + '</td><td class="right">' + p.linkedin + '</td><td class="right">' + p.comOutras + '</td>' +
        '<td class="right">' + p.notes + '</td><td class="right">' + p.tasks + '</td><td class="right">' + p.meetings + '</td>' +
        '<td class="right"><b>' + t + '</b></td>' +
        '<td class="right">' + (p.ins || '<span class="muted">0</span>') + '</td>' +
        '<td class="right">' + (p.mov || '<span class="muted">0</span>') + '</td></tr>';
    });
    return h + '</tbody></table></div></div></div>';
  }

  function pillStatus(s) {
    if (!s) return '<span class="muted">—</span>';
    var cls = STATUS_CLS[s] || '';
    return '<span class="pill ' + cls + '">' + esc(STATUS_LABEL[s] || s) + '</span>';
  }
  function linkContato(id, nome) {
    return '<a class="deal-link" target="_blank" rel="noopener" href="' + HS_PORTAL + '/record/0-1/' + id + '">' + esc(nome) + '</a>';
  }
  function linkEmpresa(id, nome) {
    if (!id) return esc(nome || '—');
    return '<a class="deal-link" target="_blank" rel="noopener" href="' + HS_PORTAL + '/record/0-2/' + id + '">' + esc(nome || id) + '</a>';
  }
  function linkDeal(id) {
    return '<a class="deal-link" target="_blank" rel="noopener" href="' + HS_PORTAL + '/record/0-3/' + id + '">' + esc(id) + '</a>';
  }

  function tabelaSqlDeals(deals) {
    var h = '<div class="grid"><div class="card span-12"><div class="card-title"><div><h2>SQL real | deals no pipeline</h2>' +
      '<div class="desc">Deals SQL no BigQuery dentro da janela. Sem PII: apenas ID do deal, data, BDR e stage.</div></div>' +
      '<span class="pill">' + (historyAvailable() ? deals.length : '—') + ' deals</span></div>';
    if (!historyAvailable()) return h + '<div class="desc">Histórico BigQuery indisponível; tabela de SQL real não carregada.</div></div></div>';
    if (!deals.length) return h + '<div class="desc">Sem SQL real no recorte.</div></div></div>';
    h += '<div class="table-wrap"><table><thead><tr><th>Data SQL</th><th>Deal</th><th>BDR</th><th>Stage</th></tr></thead><tbody>';
    deals.forEach(function (d) {
      h += '<tr><td class="nowrap">' + esc(d.sql_date || '—') + '</td><td>' + linkDeal(d.deal_id) + '</td><td>' + esc(d.bdr || '—') + '</td><td class="muted">' + esc(d.deal_stage_id || '—') + '</td></tr>';
    });
    return h + '</tbody></table></div></div></div>';
  }

  function tabelaMovs(trans) {
    var h = '<div class="grid"><div class="card span-12"><div class="card-title"><div><h2>Movimentações de status | quem foi movido, por quem, para onde</h2>' +
      '<div class="desc">Cada linha é uma transição de hs_lead_status dentro da janela (fonte: histórico nativo do HubSpot)</div></div>' +
      '<span class="pill">' + trans.length + ' transições</span></div>';
    if (!trans.length) return h + '<div class="desc">Sem movimentações no recorte.</div></div></div>';
    h += '<div class="table-wrap"><table><thead><tr><th>Quando</th><th>Contato</th><th>Cargo</th><th>Empresa</th><th>Porte</th><th>BDR</th><th>De</th><th>Para</th></tr></thead><tbody>';
    trans.slice().reverse().forEach(function (t) {
      h += '<tr><td class="nowrap">' + dmhm(t.ts) + '</td><td>' + linkContato(t.contato_id, t.nome) + '</td>' +
        '<td class="muted">' + esc(t.cargo || '—') + '</td><td>' + linkEmpresa(t.empresa_id, t.empresa) + '</td>' +
        '<td>' + porteOf(t.colaboradores) + '</td><td>' + esc(t.bdr || '—') + '</td>' +
        '<td>' + (t.de ? pillStatus(t.de) : '<span class="muted">(entrada)</span>') + '</td><td>' + pillStatus(t.para) + '</td></tr>';
    });
    return h + '</tbody></table></div></div></div>';
  }

  function tabelaEmpresas(comps, conts) {
    var contPorEmp = {};
    conts.forEach(function (c) { if (c.empresa_id) contPorEmp[c.empresa_id] = (contPorEmp[c.empresa_id] || 0) + 1; });
    var h = '<div class="grid"><div class="card span-12"><div class="card-title"><div><h2>Empresas inseridas | criadas na janela com dono no time</h2>' +
      '<div class="desc">Push Apollo/Lusha conta como inserção do BDR | contatos = inseridos na mesma empresa dentro da janela</div></div>' +
      '<span class="pill">' + comps.length + ' empresas</span></div>';
    if (!comps.length) return h + '<div class="desc">Sem empresas inseridas no recorte.</div></div></div>';
    h += '<div class="table-wrap"><table><thead><tr><th>Quando</th><th>Empresa</th><th>Porte</th><th>Fonte</th><th>BDR</th><th class="right">Contatos inseridos</th></tr></thead><tbody>';
    comps.forEach(function (c) {
      h += '<tr><td class="nowrap">' + dmhm(c.criado) + '</td><td>' + linkEmpresa(c.id, c.nome) + '</td>' +
        '<td>' + porteOf(c.colaboradores) + '</td><td>' + esc(c.fonte) + '</td><td>' + esc(c.bdr || '—') + '</td>' +
        '<td class="right">' + (contPorEmp[c.id] || 0) + '</td></tr>';
    });
    return h + '</tbody></table></div></div></div>';
  }

  function tabelaContatos(conts) {
    var h = '<div class="grid"><div class="card span-12"><div class="card-title"><div><h2>Contatos inseridos | com ou sem lead status</h2>' +
      '<div class="desc">Inserção por createdate com dono no time | status atual mostra se o contato já começou a ser trabalhado</div></div>' +
      '<span class="pill">' + conts.length + ' contatos</span></div>';
    if (!conts.length) return h + '<div class="desc">Sem contatos inseridos no recorte.</div></div></div>';
    h += '<div class="table-wrap"><table><thead><tr><th>Quando</th><th>Contato</th><th>Cargo</th><th>Empresa</th><th>Porte</th><th>Fonte</th><th>BDR</th><th>Status atual</th></tr></thead><tbody>';
    conts.forEach(function (c) {
      h += '<tr><td class="nowrap">' + dmhm(c.criado) + '</td><td>' + linkContato(c.id, c.nome) + '</td>' +
        '<td class="muted">' + esc(c.cargo || '—') + '</td><td>' + linkEmpresa(c.empresa_id, c.empresa) + '</td>' +
        '<td>' + porteOf(c.colaboradores) + '</td><td>' + esc(c.fonte) + '</td><td>' + esc(c.bdr || '—') + '</td>' +
        '<td>' + pillStatus(c.status) + '</td></tr>';
    });
    return h + '</tbody></table></div></div></div>';
  }

  // ---------- filtros UI ----------
  function renderFilters() {
    var el = document.getElementById('filters');
    var periods = [['hoje', 'Hoje'], ['ontem', 'Ontem'], ['7d', 'Últimos 7 dias'], ['30d', 'Últimos 30 dias'], ['semana', 'Semana atual'], ['mes', 'Mês atual'], ['custom', 'Período custom']];
    var h = '<div class="periodbar"><span class="period-label">Período</span>';
    periods.forEach(function (p) {
      h += '<button class="period-chip' + (state.period === p[0] ? ' active' : '') + '" onclick="WorkloadBDR.setPeriod(\'' + p[0] + '\')">' + p[1] + '</button>';
    });
    if (state.period === 'custom') {
      h += '<input type="date" id="f-since" value="' + (state.since || '') + '" style="width:auto;background:var(--card2);border:1px solid var(--border);color:var(--text);border-radius:10px;padding:.4rem .5rem">' +
        '<input type="date" id="f-until" value="' + (state.until || '') + '" style="width:auto;background:var(--card2);border:1px solid var(--border);color:var(--text);border-radius:10px;padding:.4rem .5rem">' +
        '<button class="btn primary" onclick="WorkloadBDR.applyCustom()">Aplicar</button>';
    }
    h += '<span class="period-help" id="gen-at"></span><label class="toggle-filter"><input type="checkbox" ' + (state.diasUteis ? 'checked' : '') + ' onchange="WorkloadBDR.toggleDiasUteis(this.checked)"> Mostrar apenas dias úteis</label></div>';

    h += sel('BDR', 'bdr', [''].concat((raw ? raw.team : BDRS_FALLBACK)), state.bdr, 'Todos');
    h += sel('Porte (colaboradores)', 'porte', [''].concat(PORTES), state.porte, 'Todos');
    h += sel('Fonte da inserção', 'fonte', [''].concat(FONTES), state.fonte, 'Todas');
    h += '<div class="filter filter-actions"><button class="btn" onclick="WorkloadBDR.reset()">Limpar filtros</button>' +
      '<button class="btn primary" onclick="WorkloadBDR.load(true)">Atualizar dados</button></div>';
    el.innerHTML = h;
  }
  var BDRS_FALLBACK = [];
  function sel(label, key, options, val, allLabel) {
    var h = '<div class="filter"><label>' + label + '</label><select onchange="WorkloadBDR.setFilter(\'' + key + '\',this.value)">';
    options.forEach(function (o) {
      h += '<option value="' + esc(o) + '"' + (o === val ? ' selected' : '') + '>' + (o === '' ? allLabel : esc(o)) + '</option>';
    });
    return h + '</select></div>';
  }

  // ---------- drill ----------
  function drill(kind) {
    var title = '', rows = null;
    if (kind === 'empresas') { openModal('Empresas inseridas | detalhe', tabelaEmpresas(fCompanies(), fContacts())); return; }
    if (kind === 'contatos') { openModal('Contatos inseridos | detalhe', tabelaContatos(fContacts())); return; }
    if (kind === 'movs') { openModal('Movimentações | detalhe', tabelaMovs(fTransitions())); return; }
    if (kind === 'sql-real') { openModal('SQL real | detalhe', tabelaSqlDeals(fSqlDeals())); return; }
    var map = { efetivo: ['CONNECTED'], qualificado: ['OPEN_DEAL'], desq: ['UNQUALIFIED', 'BAD_TIMING'] };
    var lab = { efetivo: 'Contato efetivo', qualificado: 'Qualificado por status', desq: 'Desqualificado | Timing' };
    if (!map[kind]) { openModal('Detalhe indisponível', '<div class="desc">Métrica sem drill-down configurado.</div>'); return; }
    rows = fTransitions().filter(function (t) { return map[kind].indexOf(t.para) >= 0; });
    openModal(lab[kind] + ' | detalhe', tabelaMovs(rows));
  }
  // ---------- drill de ligações (o "72 do Anderson") ----------
  var CALL_MIN_CONVERSA = 60000;
  var CALL_BUCKETS = [['0s', 0, 1], ['<30s', 1, 30000], ['30s–1min', 30000, 60000],
    ['1–3min', 60000, 180000], ['3–10min', 180000, 600000], ['>10min', 600000, Infinity]];
  function callBucket(ms) {
    var v = ms == null ? 0 : ms;
    for (var i = 0; i < CALL_BUCKETS.length; i++) { if (v >= CALL_BUCKETS[i][1] && v < CALL_BUCKETS[i][2]) return CALL_BUCKETS[i][0]; }
    return '>10min';
  }
  function fmtDur(ms) {
    if (ms == null) return '—';
    var s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    return Math.floor(s / 60) + 'min ' + (s % 60) + 's';
  }
  function callsFor(b) {
    return (raw.activities || []).filter(function (a) { return a.tipo === 'calls' && a.bdr === b; })
      .sort(function (a, b2) { return (a.ts < b2.ts ? 1 : -1); });
  }
  // Corpo do modal: breakdown client-side (instantâneo) + área "para quem" (lazy).
  function renderCallsBody(b, calls, apiCalls) {
    var conv = 0, byDesf = {}, byBk = {};
    calls.forEach(function (c) {
      if (c.duracao_ms != null && c.duracao_ms >= CALL_MIN_CONVERSA) conv++;
      var d = c.desfecho || 'Sem desfecho'; byDesf[d] = (byDesf[d] || 0) + 1;
      var bk = callBucket(c.duracao_ms); byBk[bk] = (byBk[bk] || 0) + 1;
    });
    var n = calls.length, disc = n - conv;
    var h = '<div class="note" style="margin-bottom:1rem"><b>' + n + ' ligações</b> na janela ' + esc(state.since) + ' a ' + esc(state.until) +
      ' — <b>' + conv + ' conversas</b> (' + (n ? Math.round(conv / n * 100) : 0) + '%) · <b>' + disc + ' discagens</b> (&lt;1 min ou sem atender). ' +
      '<span class="muted">Número bruto de ligações infla o esforço; o que vale é a conversa.</span></div>';
    // por desfecho + por duração, lado a lado
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem">';
    function miniTable(title, obj, order) {
      var keys = order || Object.keys(obj).sort(function (a, c) { return obj[c] - obj[a]; });
      var t = '<div><h3 style="margin:0 0 .4rem;font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text2)">' + title + '</h3><table style="width:100%"><tbody>';
      keys.forEach(function (k) { if (obj[k]) t += '<tr><td>' + esc(k) + '</td><td class="right"><b>' + obj[k] + '</b></td></tr>'; });
      return t + '</tbody></table></div>';
    }
    h += miniTable('Por desfecho', byDesf, null);
    h += miniTable('Por duração', byBk, CALL_BUCKETS.map(function (x) { return x[0]; }));
    h += '</div>';
    // lista nominal
    h += '<div class="table-wrap"><table><thead><tr><th>Hora</th><th>Duração</th><th>Desfecho</th><th>Tipo</th><th>Para quem</th></tr></thead><tbody id="calls-detail-rows">';
    var src = apiCalls || calls;
    src.forEach(function (c) {
      var isConv = c.conversa != null ? c.conversa : (c.duracao_ms != null && c.duracao_ms >= CALL_MIN_CONVERSA);
      var quem = apiCalls ? (c.contato ? esc(c.contato) + (c.empresa ? ' <span class="muted">· ' + esc(c.empresa) + '</span>' : '') : '<span class="muted">—</span>')
        : '<span class="muted">carregando…</span>';
      h += '<tr><td>' + (c.ts ? dmhm(c.ts) : '—') + '</td><td>' + fmtDur(c.duracao_ms) + '</td>' +
        '<td>' + esc(c.desfecho || 'Sem desfecho') + '</td>' +
        '<td>' + (isConv ? '<span class="pill" style="background:rgba(46,204,113,.16);color:#2ecc71">conversa</span>' : '<span class="pill muted">discagem</span>') + '</td>' +
        '<td>' + quem + '</td></tr>';
    });
    h += '</tbody></table></div>';
    if (!apiCalls) h += '<div class="desc" id="calls-enrich-note" style="margin-top:.5rem">Buscando "para quem" (contato/empresa)…</div>';
    return h;
  }
  function drillCalls(b) {
    var calls = callsFor(b);
    openModal('Ligações | ' + b + ' | detalhe', renderCallsBody(b, calls, null));
    var expected = 'Ligações | ' + b + ' | detalhe';
    fetch('/api/bdr-workload-calls?bdr=' + encodeURIComponent(b) + '&since=' + state.since + '&until=' + state.until, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        // só atualiza se o modal ainda é o mesmo (usuário não trocou/fechou)
        if (document.getElementById('modal-title').textContent !== expected) return;
        if (d && d.success && d.enriched) {
          document.getElementById('modal-body').innerHTML = renderCallsBody(b, calls, d.calls);
        } else {
          var note = document.getElementById('calls-enrich-note');
          if (note) note.innerHTML = '<span class="muted">"Para quem" indisponível nesta janela — breakdown por desfecho/duração acima permanece válido.</span>';
          document.querySelectorAll('#calls-detail-rows td:last-child .muted').forEach(function (el) { if (el.textContent === 'carregando…') el.textContent = '—'; });
        }
      })
      .catch(function () {
        var note = document.getElementById('calls-enrich-note');
        if (note) note.innerHTML = '<span class="muted">"Para quem" indisponível (erro de rede).</span>';
      });
  }
  function openModal(title, html) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = html;
    document.getElementById('modal-overlay').classList.add('open');
  }
  function closeModal() { document.getElementById('modal-overlay').classList.remove('open'); }

  // ---------- ajuda ----------
  function openAllHelp() {
    var blocks = [
      ['Universo', 'Contatos e empresas cujo dono (hubspot_owner_id) é um dos 13 BDRs do time canônico. Owners duplicados e arquivados são resolvidos por nome + alias.'],
      ['Inserção', 'createdate dentro da janela (fuso America/Sao_Paulo). Fonte via hs_object_source_detail_1: Apollo e Lusha = push do próprio BDR via extensão | Manual = CRM_UI | API interna = chave de automação (não conta como trabalho de BDR; filtre por fonte para excluir).'],
      ['Movimentação', 'Transições de hs_lead_status dentro da janela, extraídas do histórico nativo (propertiesWithHistory). Contato efetivo = CONNECTED | Qualificado por status = OPEN_DEAL | Desqualificado = UNQUALIFIED | Timing ruim = BAD_TIMING. OPEN_DEAL é proxy secundário; SQL real vem de deals no BigQuery.'],
      ['SQL real (deals)', 'KPI principal de qualificação: conta deals SQL no pipeline, via BigQuery, filtrados por BDR e janela. Links abrem /record/0-3/{id}. Sem PII na tabela.'],
      ['Atividades', 'Engagements do HubSpot (calls, emails, communications, notes, tasks, meetings) com hs_timestamp na janela e dono no time. Ligação com conversa = duração ≥ 1 min (proxy; discagens não atendidas têm duração 0). WhatsApp = communications com canal WHATS_APP (captura Treble). Janelas muito longas podem truncar em 9.800 registros por tipo — a página avisa quando o teto é atingido.'],
      ['Ritmo Real de Atividades', 'Stacked area por dia útil (toggle permite incluir fins de semana). Hoje usa HubSpot live; datas anteriores usam histórico BigQuery. Dias sem linha no histórico disponível são tratados como 0 registrado.'],
      ['Comparativos WoW/MoM', 'WoW compara a semana que termina no fim da janela contra os 7 dias anteriores, respeitando o filtro de dias úteis. MoM usa o período anterior equivalente ao tamanho da janela visível. Sem histórico BigQuery, comparativos ficam indisponíveis.'],
      ['Fonte → Resultado', 'Compara BDRs acima vs abaixo da média de uso de Apollo e calcula taxa de SQL real (deals SQL ÷ inserções). É insight correlacional, não causal; exige controlar porte/persona e disciplina de follow-up.'],
      ['Freshness', renderFreshness() + '. Se o BigQuery estiver defasado, a página exibe banner de stale.'],
      ['Limitações declaradas', 'Motivo de desqualificação ainda não existe como propriedade no HubSpot (pendência da spec outbound-hubspot-first). Filtro de fonte não se aplica a movimentações (movimentação não tem fonte de criação). Ligações e e-mails mal registrados não aparecem | o proxy de primeiro retorno é a transição para Contato efetivo.'], 
      ['Reconciliação', 'Todo KPI clicável abre a tabela nominal com exatamente as mesmas linhas contadas no número. A soma dos pequenos é o todo.'],
    ];
    var h = '';
    blocks.forEach(function (b) { h += '<div class="help-block"><b>' + b[0] + '</b><p>' + b[1] + '</p></div>'; });
    document.getElementById('help-body').innerHTML = h;
    document.getElementById('help-drawer').classList.add('open');
    document.getElementById('help-backdrop').classList.add('open');
  }
  var HELP_MAP = {
    'empresas-ins': ['Empresas inseridas', 'Empresas criadas na janela com owner do time. Fonte via hs_object_source_detail_1.'],
    'contatos-ins': ['Contatos inseridos', 'Contatos criados na janela com owner do time, com ou sem hs_lead_status.'],
    'movs-status': ['Movimentações de status', 'Transições de hs_lead_status dentro da janela, extraídas do histórico nativo. OPEN_DEAL fica como proxy secundário de qualificação; SQL real usa deals no BigQuery.'],
    'contato-efetivo': ['Contato efetivo', 'Transições para CONNECTED — o BDR conseguiu falar com o contato.'],
    'qualificado-status': ['Qualificado por status', 'Transições para OPEN_DEAL no contato. IMPORTANTE: não é SQL real por deal. O campo hs_lead_status do contato pode não refletir o estado real do pipeline de deals. SQL real requer consulta separada.'],
    'sql-real': ['SQL real (deals)', 'KPI principal de qualificação: deals SQL no pipeline via BigQuery, filtrados por BDR e janela. Se o histórico estiver indisponível, o painel mostra — e mantém o live HubSpot.'],
    'desqualificado': ['Desqualificado | Timing', 'Transições para UNQUALIFIED ou BAD_TIMING. Motivo específico ainda não disponível como propriedade.'],
    'atividades-reais': ['Ritmo Real de Atividades', 'Atividades reais registradas no HubSpot: hoje vem do HubSpot live; datas anteriores vêm do BigQuery. Ligações reais = duração ≥ 1 min. Comparativos dependem do histórico estendido.'],
  };
  function openHelpFor(key) {
    var block = HELP_MAP[key];
    if (!block) { openAllHelp(); return; }
    openHelpBlock(block[0], block[1]);
  }
  function openHelpBlock(title, text) {
    document.getElementById('help-title').textContent = title;
    document.getElementById('help-body').innerHTML = '<div class="help-block"><b>' + esc(title) + '</b><p>' + esc(text) + '</p></div>';
    document.getElementById('help-drawer').classList.add('open');
    document.getElementById('help-backdrop').classList.add('open');
  }
  function closeHelp() {
    document.getElementById('help-title').textContent = 'Memória de cálculo';
    document.getElementById('help-drawer').classList.remove('open');
    document.getElementById('help-backdrop').classList.remove('open');
  }
  function toggleTheme() {
    var t = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('axenya_theme', t); } catch (e) { }
  }

  // ---------- API pública ----------
  return {
    init: function () { renderFilters(); load(false); },
    load: function (refresh) { load(!!refresh); },
    setPeriod: function (p) {
      state.period = p;
      if (p === 'custom') { renderFilters(); return; }
      load(false);
    },
    applyCustom: function () {
      var s = document.getElementById('f-since').value, u = document.getElementById('f-until').value;
      if (!s || !u) return;
      state.since = s; state.until = u;
      load(false);
    },
    setFilter: function (k, v) { state[k] = v; render(); },
    reset: function () { state.bdr = ''; state.porte = ''; state.fonte = ''; render(); },
    toggleDiasUteis: function (v) { state.diasUteis = !!v; render(); },
    drill: drill, drillCalls: drillCalls, closeModal: closeModal, openAllHelp: openAllHelp, openHelpFor: openHelpFor, closeHelp: closeHelp, toggleTheme: toggleTheme,
  };
})();
window.addEventListener('DOMContentLoaded', function () { WorkloadBDR.init(); });
