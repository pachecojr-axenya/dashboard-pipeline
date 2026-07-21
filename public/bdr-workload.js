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
  var cohort = null;
  var historyError = null;
  var cohortError = null;
  var CHANNELS = [['todos', 'Todos'], ['calls', 'Ligações'], ['emails', 'E-mails'], ['whatsApp', 'WhatsApp'], ['linkedin', 'LinkedIn']];
  var sortBy = 'hoje';
  var sortDir = 'desc';
  var state = { period: 'hoje', since: null, until: null, bdr: '', porte: '', fonte: '', canal: 'todos', diasUteis: true };

  // ---------- datas (America/Sao_Paulo = fuso local dos usuários) ----------
  function iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function periodRange(p) {
    var now = new Date(), s = new Date(now), u = new Date(now);
    if (p === 'ontem') { s.setDate(s.getDate() - 1); u = new Date(s); }
    else if (p === '7d') { s.setDate(s.getDate() - 6); }
    else if (p === '30d') { s.setDate(s.getDate() - 29); } // 30 dias contando hoje
    else if (p === '90d') { s.setDate(s.getDate() - 89); } // 90 dias contando hoje
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
    if (isNaN(d.getTime())) return '—';
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function dmhm(ts) {
    var d = new Date(ts);
    // Defesa: valor não parseável nunca vira "NaN/NaN NaN:NaN" na UI.
    if (isNaN(d.getTime())) return '—';
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + ' ' + hhmm(ts);
  }
  function dmhmFull(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear() + ' ' + hhmm(ts);
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
  function countDiasUteis(since, until) {
    var count = 0;
    eachDate(since, until, function (d) {
      if (isDiaUtil(d)) count++;
    });
    return count;
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
  function passCanal(a) {
    if (!state.canal || state.canal === 'todos') return true;
    return activityBucket(a) === state.canal;
  }
  // atividade não tem empresa nem fonte de criação: só filtro de BDR e canal
  function fActivities() { return (raw.activities || []).filter(function (a) { return passBdr(a) && passCanal(a); }); }
  function historyAvailable() { return !!(history && Array.isArray(history.dailyRows) && Array.isArray(history.sqlDeals)); }
  function fSqlDeals() { return historyAvailable() ? history.sqlDeals.filter(function (d) { return !state.bdr || d.bdr === state.bdr; }) : []; }
  function renderFreshness() {
    var msg = 'Hoje (1 dia) | HubSpot live | Histórico e SQL: ';
    if (!historyAvailable()) return msg + 'BigQuery indisponível' + (historyError ? ' (' + historyError + ')' : '') + ' | Lookback ETL: 365 dias';
    var rec = history.metadata && history.metadata.reconciliation;
    return msg + 'BigQuery atualizado ' + (history.metadata && history.metadata.refreshedAt ? dmhm(history.metadata.refreshedAt) : '—') +
      ' | Lookback ETL: 365 dias' + (rec && rec.matches === false ? ' | ALERTA: SQL não reconciliado' : '');
  }

  function renderWindowContext() {
    var calendarDays = inclusiveCalendarDays(state.since, state.until);
    var businessDays = countDiasUteis(state.since, state.until);
    if (state.diasUteis) return 'Janela: ' + businessDays + ' dias úteis (' + calendarDays + ' dias corridos)';
    return 'Janela: ' + calendarDays + ' dias corridos';
  }

  // ---------- carga ----------
  function load(refresh) {
    var r = state.period === 'custom' ? { since: state.since, until: state.until } : periodRange(state.period);
    state.since = r.since; state.until = r.until;
    document.getElementById('state').classList.remove('hidden');
    document.getElementById('content').classList.add('hidden');
    var url = '/api/bdr-workload?since=' + r.since + '&until=' + r.until + (refresh ? '&refresh=1' : '');
    var histUrl = '/api/bdr-workload-history?since=' + r.since + '&until=' + r.until;
    var cohortUrl = '/api/bdr-cohort-analytics?since=' + r.since + '&until=' + r.until;
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
    var cohortReq = fetch(cohortUrl, { credentials: 'same-origin' })
      .then(function (res) {
        if (res.status === 401) { window.location.href = '/'; throw new Error('login'); }
        return res.json().then(function (data) {
          if (!res.ok || !data.success) throw new Error(data.error || 'Falha ao carregar coortes');
          return data;
        });
      })
      .catch(function (e) {
        if (e.message === 'login') throw e;
        cohortError = e.message || 'Falha ao carregar coortes';
        return null;
      });
    Promise.all([liveReq, histReq, cohortReq])
      .then(function (results) {
        raw = results[0];
        history = results[1];
        cohort = results[2];
        if (history) historyError = null;
        if (cohort) cohortError = null;
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

    var prev = previousKpis();
    var activities = (raw.activities || []).filter(passBdr);
    var notices = renderQualityChecks(activities);
    if (historyError) notices += '<div class="note" style="margin-bottom:1rem"><b>Histórico indisponível:</b> ' + esc(historyError) + '</div>';
    if (historyAvailable() && history.metadata && history.metadata.maxMetricDate && history.metadata.maxMetricDate < state.until) notices += '<div class="note" style="margin-bottom:1rem"><b>Histórico possivelmente defasado:</b> último dia no BigQuery é ' + esc(history.metadata.maxMetricDate) + '.</div>';

    var html = bdrFrozenBanner() + '<section class="note"><b>Fonte dos dados:</b> ' + esc(renderFreshness()) + '. <b>' + esc(renderWindowContext()) + '</b>. Metas vêm de <code>gold.bdr_daily_target</code> e são provisórias/configuráveis. O snapshot BigQuery roda durante o dia; a série de hoje usa HubSpot live para não mostrar atividade parcial.</section>' + notices;

    html += '<section class="level-0"><h2 class="level-title">Visão Executiva</h2>';
    html += executivePulse(activities);
    html += chartRealActivities(activities);
    html += chartChannelComparison(activities);
    html += '</section>';

    html += '<section class="level-1"><h2 class="level-title">👥 Visão de Gestão</h2>';
    html += tabelaAtividades(activities, comps, conts, trans);
    html += '<div class="grid">';
    html += chartPorBdr(comps, conts, trans);
    html += chartInsercoes(conts, trans);
    html += '</div>';
    html += chartFonteResultado(comps, conts, trans);
    html += kpis([
      { label: 'Empresas inseridas', value: comps.length, cls: 'teal', drill: 'empresas', sub: subFontes(comps), help: 'empresas-ins', delta: deltaHtml(comps.length, prev.empresas) },
      { label: 'Contatos inseridos', value: conts.length, cls: 'teal', drill: 'contatos', sub: subFontes(conts), help: 'contatos-ins', delta: deltaHtml(conts.length, prev.contatos) },
      { label: 'SQL real (deals)', value: historyAvailable() ? sqlDeals.length : '—', cls: 'good', drill: 'sql-real', sub: historyAvailable() ? 'deals SQL no pipeline' + (kQualif.length ? ' | proxy OPEN_DEAL ' + kQualif.length : '') : 'histórico BigQuery indisponível', help: 'sql-real', delta: historyAvailable() ? deltaHtml(sqlDeals.length, prev.sql) : '' },
      { label: 'Contato efetivo', value: kEfetivo.length, cls: 'good', drill: 'efetivo', sub: 'transições para Contato efetivo', help: 'contato-efetivo', delta: deltaHtml(kEfetivo.length, prev.efetivo) },
      { label: 'Movimentações de status', value: trans.length, cls: '', drill: 'movs', sub: trans.length ? 'em ' + uniq(trans, 'contato_id') + ' contatos' : 'sem movimentação no recorte', help: 'movs-status', delta: deltaHtml(trans.length, prev.movs) },
      { label: 'Desqualificado | Timing', value: kDesq.length, cls: kDesq.length ? 'bad' : '', drill: 'desq', sub: 'motivos: propriedade pendente no HubSpot', help: 'desqualificado', delta: deltaHtml(kDesq.length, prev.desq) },
    ]);
    html += '</section>';

    html += renderCohortAnalytics();

    if (state.bdr) {
      html += '<section class="level-2"><h2 class="level-title">🎯 Visão do BDR</h2>';
      html += chartBdrDayWaterfall(activities);
      html += '<div class="grid">';
      html += chartPorFonte(comps, conts);
      html += '</div>';
      html += tabelaSqlDeals(sqlDeals);
      html += tabelaMovs(trans);
      html += tabelaEmpresas(comps, conts);
      html += tabelaContatos(conts);
      html += '</section>';
    }

    document.getElementById('content').innerHTML = html;
    document.getElementById('state').classList.add('hidden');
    document.getElementById('content').classList.remove('hidden');
    var gen = document.getElementById('gen-at');
    if (gen) gen.textContent = state.since + ' a ' + state.until + ' | ' + renderWindowContext() + ' | gerado ' + dmhm(raw.generatedAt) + (raw.cached ? ' | cache' : '') + ' | ' + renderFreshness();
  }

  function previousKpis() {
    var days = inclusiveCalendarDays(state.since, state.until), until = shiftIso(state.since, -1), since = shiftIso(state.since, -days);
    function inRange(ts) { var d = iso(new Date(ts)); return d >= since && d <= until; }
    var comps = raw.companiesCreated.filter(function (c) { return inRange(c.criado) && passBdr(c) && passPorte(c) && passFonte(c); });
    var conts = raw.contactsCreated.filter(function (c) { return inRange(c.criado) && passBdr(c) && passPorte(c) && passFonte(c); });
    var trans = raw.transitions.filter(function (t) { return inRange(t.ts) && passBdr(t) && passPorte(t); });
    var sql = historyAvailable() ? history.sqlDeals.filter(function (d) { return d.sql_date >= since && d.sql_date <= until && (!state.bdr || d.bdr === state.bdr); }) : [];
    return {
      empresas: comps.length,
      contatos: conts.length,
      sql: sql.length,
      efetivo: trans.filter(function (t) { return t.para === 'CONNECTED'; }).length,
      movs: trans.length,
      desq: trans.filter(function (t) { return t.para === 'UNQUALIFIED' || t.para === 'BAD_TIMING'; }).length,
    };
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

  function renderQualityChecks(acts) {
    var checks = [];
    var todayIso = iso(new Date());
    var scope = selectedBdrs();
    var rows = aggregateHistoryByDay(state.since, state.until, state.diasUteis, true, acts);
    var sums = sumActivityRows(rows);
    var channelSum = sums.calls + sums.emails + sums.whatsApp + sums.linkedin + sums.meetings;
    if (sums.total !== channelSum) checks.push({ status: 'fail', icon: '!', text: 'Total estrito divergente: total ' + sums.total + ' vs canais ' + channelSum });
    else checks.push({ status: 'pass', icon: '✓', text: 'Total estrito = soma dos cinco canais (' + channelSum + ')' });
    var byBdr = {};
    scope.forEach(function (b) { byBdr[b] = 0; });
    rows.forEach(function (r) {
      if (state.bdr) byBdr[state.bdr] += r.total || 0;
    });
    if (!state.bdr) {
      aggregateBdrCurrent(acts).forEach(function (row) { if (byBdr[row.bdr] != null) byBdr[row.bdr] = selectedTotal(row); });
    }
    var activeBdrs = scope.filter(function (b) { return byBdr[b] > 0; });
    var zeroBdrs = scope.filter(function (b) { return byBdr[b] === 0; });
    checks.push({ status: zeroBdrs.length ? 'warn' : 'pass', icon: zeroBdrs.length ? '!' : '✓', text: 'Cobertura: ' + activeBdrs.length + '/' + scope.length + (state.bdr ? ' BDR filtrado' : ' BDRs canônicos') + ' com atividade' });
    if (historyAvailable()) {
      var closedSince = state.since;
      var closedUntil = state.until >= todayIso ? shiftIso(todayIso, -1) : state.until;
      if (closedUntil >= closedSince) {
        var apiRows = aggregateActsByDay((raw.activities || []).filter(function (a) { return passBdr(a) && passCanal(a); }), closedSince, closedUntil, state.diasUteis);
        var bqRows = aggregateHistoryByDay(closedSince, closedUntil, state.diasUteis, false, []);
        var apiTotal = selectedTotal(sumActivityRows(apiRows));
        var bqTotal = selectedTotal(sumActivityRows(bqRows));
        var recDiff = Math.abs(apiTotal - bqTotal);
        var recPct = bqTotal ? recDiff / bqTotal : (apiTotal ? 1 : 0);
        if (recPct > 0.02) checks.push({ status: 'warn', icon: '!', text: 'API live ' + apiTotal + ' vs BQ ' + bqTotal + ' em dias fechados (' + Math.round(recPct * 100) + '%)' });
        else checks.push({ status: 'pass', icon: '✓', text: 'API live vs BQ reconciliados em dias fechados (' + bqTotal + ')' });
        var missing = bqRows.filter(function (r) { return r.total === 0; }).length;
        checks.push({ status: missing ? 'warn' : 'pass', icon: missing ? '!' : '✓', text: missing ? missing + ' dias úteis fechados zerados no BQ' : 'Sem gaps em dias úteis fechados no BQ' });
      } else {
        var liveToday = selectedTotal(sumActivityRows(aggregateActsByDay(acts, state.since, state.until, state.diasUteis)));
        var bqToday = selectedTotal(sumActivityRows(aggregateHistoryByDay(todayIso, todayIso, false, false, [])));
        checks.push({ status: 'warn', icon: '!', text: 'Hoje informativo: Live ' + liveToday + ' | BQ ' + bqToday + ' até ' + (history.metadata && history.metadata.refreshedAt ? dmhm(history.metadata.refreshedAt) : '—') });
      }
      checks.push({ status: 'warn', icon: '!', text: 'LinkedIn live depende do canal de communications; histórico canônico segue taxonomia gold' });
    } else {
      checks.push({ status: 'warn', icon: '!', text: 'BQ indisponível para double-check' });
    }
    return '<div class="quality-checks">' + checks.map(function (c) {
      return '<div class="check-item ' + c.status + '"><span class="check-icon">' + c.icon + '</span><span class="check-text">' + esc(c.text) + '</span></div>';
    }).join('') + '</div>';
  }

  function aggregateBdrCurrent(acts) {
    var map = {};
    selectedBdrs().forEach(function (b) { map[b] = { bdr: b, calls: 0, emails: 0, whats: 0, whatsApp: 0, linkedin: 0, meetings: 0, total: 0, lastLoad: null }; });
    var todayIso = iso(new Date());
    if (historyAvailable()) {
      history.dailyRows.forEach(function (r) {
        if (r.metric_date < state.since || r.metric_date > state.until) return;
        if (state.diasUteis && !isDiaUtil(new Date(r.metric_date + 'T00:00:00'))) return;
        if (r.metric_date === todayIso) return;
        if (state.bdr && r.owner_name !== state.bdr) return;
        var p = map[r.owner_name]; if (!p) return;
        p.calls += r.calls_total || 0; p.emails += r.emails_sent_total || 0; p.whats += r.whatsapp_total || 0; p.whatsApp = p.whats;
        p.linkedin += r.linkedin_total || 0; p.meetings += r.meetings_total || 0;
        p.total += (r.calls_total || 0) + (r.emails_sent_total || 0) + (r.whatsapp_total || 0) + (r.linkedin_total || 0) + (r.meetings_total || 0);
        p.lastLoad = latestTs(p.lastLoad, r.refreshed_at);
      });
    }
    aggregateActsByDayByBdr(acts, todayIso, todayIso, false).forEach(function (r) {
      var p = map[r.bdr]; if (!p) return;
      p.calls += r.calls; p.emails += r.emails; p.whats += r.whatsApp; p.whatsApp = p.whats; p.linkedin += r.linkedin; p.meetings += r.meetings; p.total += r.total;
      p.lastLoad = latestTs(p.lastLoad, r.lastLoad);
    });
    return Object.keys(map).map(function (b) { return map[b]; });
  }
  function aggregateActsByDayByBdr(acts, since, until, onlyBusinessDays) {
    var map = {};
    acts.forEach(function (a) {
      var d = new Date(a.ts), key = iso(d), b = activityBucket(a);
      if (!b || key < since || key > until || (onlyBusinessDays && !isDiaUtil(d))) return;
      if (!map[a.bdr]) map[a.bdr] = { bdr: a.bdr, calls: 0, emails: 0, whatsApp: 0, linkedin: 0, meetings: 0, total: 0, lastLoad: null };
      map[a.bdr][b]++; map[a.bdr].total++; map[a.bdr].lastLoad = latestTs(map[a.bdr].lastLoad, a.ts);
    });
    return Object.keys(map).map(function (b) { return map[b]; });
  }
  function kpis(items) {
    var h = '<section class="kpis">';
    items.forEach(function (k) {
      var helpKey = k.help || k.drill || 'universo';
      h += '<div class="kpi clickable ' + k.cls + '" onclick="WorkloadBDR.drill(\'' + k.drill + '\')">' +
        '<div class="label"><span>' + esc(k.label) + '</span><span class="calc-btn" onclick="event.stopPropagation();WorkloadBDR.openHelpFor(\'' + helpKey + '\')" title="Ver memória de cálculo">?</span></div>' +
        '<div class="value">' + k.value + (k.delta ? k.delta : '') + '</div>' +
        '<div class="sub">' + esc(k.sub) + '</div></div>';
    });
    return h + '</section>';
  }
  function bdrFrozenBanner() {
    if (!state.bdr) return '';
    return '<section class="note bdr-freeze"><b>BDR congelado:</b> exibindo apenas dados de <b>' + esc(state.bdr) + '</b>. Comparativos, SQL e atividades respeitam este filtro até limpar filtros.</section>';
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
      if (r.date === todayIso && by[r.date]) {
        Object.keys(r).forEach(function (key) { by[r.date][key] = r[key]; });
      }
    });
    return out;
  }
  function sumActivityRows(rows) {
    var s = { calls: 0, callsReal: 0, emails: 0, whatsApp: 0, linkedin: 0, meetings: 0, total: 0 };
    rows.forEach(function (r) { Object.keys(s).forEach(function (k) { s[k] += r[k] || 0; }); });
    return s;
  }
  function targetForBdr(name, canal) {
    if (!historyAvailable() || !history.metadata || !history.metadata.bdrDailyTargets) return 0;
    var t = history.metadata.bdrDailyTargets[name] || null;
    if (!t) return 0;
    if (!canal || canal === 'todos') return t.total || ((t.calls || 0) + (t.emails || 0) + (t.whatsapp || 0) + (t.linkedin || 0) + (t.meetings || 0));
    var key = canal === 'whatsApp' ? 'whatsapp' : canal;
    return t[key] || 0;
  }
  function selectedBdrs() { return state.bdr ? [state.bdr] : (raw && raw.team ? raw.team.slice() : []); }
  function targetForSelection(days) {
    return selectedBdrs().reduce(function (sum, b) { return sum + targetForBdr(b, state.canal) * days; }, 0);
  }
  function businessDaysForRange(s, u) { return state.diasUteis ? countDiasUteis(s, u) : inclusiveCalendarDays(s, u); }
  function targetDaysForRange(s, u) { return countDiasUteis(s, u); }
  function selectedTotal(row) {
    if (!state.canal || state.canal === 'todos') return row.total || 0;
    if (state.canal === 'whatsApp') return row.whatsApp || row.whats || 0;
    return row[state.canal] || 0;
  }
  function brtHourNow() { return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(new Date())); }
  function projectedPace(total) {
    var h = brtHourNow();
    var elapsed = h <= 8 ? 0.25 : (h >= 18 ? 10 : h - 8);
    return Math.round(total / Math.max(0.25, elapsed) * 10);
  }
  function sourceBadgeText() { return state.period === 'hoje' ? '<span class="source-badge live">LIVE</span>' : '<span class="source-badge bq">BQ</span>'; }
  function executivePulse(acts) {
    var isToday = state.period === 'hoje' && state.since === state.until;
    var rows = aggregateHistoryByDay(state.since, state.until, state.diasUteis, true, acts);
    var total = selectedTotal(sumActivityRows(rows));
    var displayDays = businessDaysForRange(state.since, state.until);
    var targetDays = targetDaysForRange(state.since, state.until);
    var target = targetForSelection(targetDays);
    var pct = target ? Math.round(total / target * 100) : null;
    var pace = projectedPace(total);
    var pacePct = target ? Math.round(pace / target * 100) : null;
    var title = isToday ? 'Pulso do Dia ' : 'Pulso do Recorte ';
    var items = isToday ? [
      { label: 'Toques reais hoje', value: total, cls: 'teal', drill: 'atividades', sub: 'Total estrito dos cinco canais | ' + (state.period === 'hoje' ? 'LIVE' : 'BQ'), help: 'atividades-reais', delta: deltaHtml(total, previousActivityBaseline()) },
      { label: '% da meta', value: pct == null ? '—' : pct + '%', cls: pct != null && pct >= 100 ? 'good' : (pct != null && pct < 70 ? 'bad' : 'warn'), drill: 'atividades', sub: target ? total + ' de ' + target + ' toques/dia configurados' : 'Meta não configurada no BQ', help: 'atividades-reais', delta: '' },
      { label: 'Pace projetado', value: pace, cls: pacePct != null && pacePct >= 100 ? 'good' : (pacePct != null && pacePct < 70 ? 'bad' : 'warn'), drill: 'atividades', sub: 'Projeção 08h–18h BRT' + (pacePct == null ? '' : ' | ' + pacePct + '% da meta'), help: 'atividades-reais', delta: '' },
    ] : [
      { label: 'Atividades no recorte', value: total, cls: 'teal', drill: 'atividades', sub: 'Fonte BQ + hoje live quando incluso', help: 'atividades-reais', delta: deltaHtml(total, previousActivityBaseline()) },
      { label: '% da meta do recorte', value: pct == null ? '—' : pct + '%', cls: pct != null && pct >= 100 ? 'good' : (pct != null && pct < 70 ? 'bad' : 'warn'), drill: 'atividades', sub: target ? total + ' de ' + target + ' toques configurados' : 'Meta não configurada no BQ', help: 'atividades-reais', delta: '' },
      { label: state.diasUteis ? 'Média por dia útil' : 'Média por dia corrido', value: displayDays ? Math.round(total / displayDays) : 0, cls: '', drill: 'atividades', sub: displayDays + ' dias no denominador | fonte BQ', help: 'atividades-reais', delta: '' },
    ];
    return '<div class="card span-12"><div class="card-title"><div><h2>' + title + sourceBadgeText() + '</h2><div class="desc">Total estrito: ligações + e-mails enviados + WhatsApp + LinkedIn + reuniões. Selo indica fonte principal e freshness.</div></div></div>' + kpis(items) + '</div>';
  }
  function previousActivityBaseline() {
    var todayIso = iso(new Date());
    if (state.period === 'hoje') {
      var end = shiftIso(todayIso, -1), start = shiftIso(end, -10);
      var rows = aggregateHistoryByDay(start, end, true, false, []);
      var nonZero = rows.slice(-7);
      return Math.round(selectedTotal(sumActivityRows(nonZero)) / Math.max(1, nonZero.length));
    }
    var days = inclusiveCalendarDays(state.since, state.until);
    return selectedTotal(sumActivityRows(aggregateHistoryByDay(shiftIso(state.since, -days), shiftIso(state.since, -1), state.diasUteis, false, [])));
  }
  function latestTs(current, candidate) {
    var c = new Date(candidate).getTime();
    if (!isFinite(c)) return current;
    var p = current ? new Date(current).getTime() : -Infinity;
    return c > p ? candidate : current;
  }
  function bdrDailyTarget() {
    if (!state.bdr || !historyAvailable()) return null;
    var v = targetForBdr(state.bdr, state.canal) * targetDaysForRange(state.since, state.until);
    return v > 0 ? v : null;
  }
  function chartBdrDayWaterfall(acts) {
    if (!state.bdr) return '';
    var rows = aggregateHistoryByDay(state.since, state.until, false, true, acts);
    var s = sumActivityRows(rows);
    var items = [
      ['Ligações', s.calls, 'var(--teal)'],
      ['E-mails', s.emails, 'var(--yellow)'],
      ['WhatsApp', s.whatsApp, 'var(--green)'],
      ['LinkedIn', s.linkedin, 'var(--orange)'],
      ['Reuniões', s.meetings, 'rgba(58,184,183,.72)'],
    ];
    if (state.canal && state.canal !== 'todos') {
      var selectedKey = state.canal === 'whatsApp' ? 'WhatsApp' : (state.canal === 'calls' ? 'Ligações' : (state.canal === 'emails' ? 'E-mails' : (state.canal === 'linkedin' ? 'LinkedIn' : 'Reuniões')));
      items = items.filter(function (item) { return item[0] === selectedKey; });
    }
    var total = items.reduce(function (acc, item) { return acc + item[1]; }, 0);
    var target = bdrDailyTarget();
    var gap = target == null ? null : total - target;
    var max = Math.max(total, target || 0, 1);
    var W = 520, H = 240, baseY = 172, topY = 38, plotH = baseY - topY, barW = 54, startX = 32, gapX = 34;
    function y(v) { return baseY - (v / max * plotH); }
    var scope = state.period === 'hoje' ? 'dia' : 'recorte';
    var h = '<div class="grid"><div class="card span-6"><div class="card-title"><div><h2>Waterfall do ' + scope + ' por canal</h2>' +
      '<div class="desc">Como ' + esc(state.bdr) + ' distribuiu o esforço no ' + scope + ' filtrado; meta real do BQ quando configurada.</div></div>' +
      '<span class="pill">Total: ' + total + '</span></div>';
    h += '<svg class="waterfall-svg area-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Waterfall de atividades por canal do BDR filtrado">';
    h += '<line x1="18" y1="' + baseY + '" x2="500" y2="' + baseY + '"></line>';
    var running = 0;
    items.forEach(function (item, i) {
      var x = startX + i * (barW + gapX), prev = running, next = running + item[1], yy = y(next), hh = Math.max(baseY - yy, item[1] ? 4 : 0);
      if (i > 0) h += '<line x1="' + (x - gapX) + '" y1="' + y(prev) + '" x2="' + x + '" y2="' + y(prev) + '" stroke-dasharray="4 4"></line>';
      h += '<rect x="' + x + '" y="' + yy + '" width="' + barW + '" height="' + hh + '" rx="8" fill="' + item[2] + '"><title>' + esc(item[0]) + ': +' + item[1] + '</title></rect>';
      h += '<text x="' + (x + barW / 2) + '" y="' + (yy - 8) + '" text-anchor="middle" class="wf-val">+' + item[1] + '</text>';
      h += '<text x="' + (x + barW / 2) + '" y="204" text-anchor="middle">' + esc(item[0]) + '</text>';
      running = next;
    });
    var totalX = startX + items.length * (barW + gapX) + 8, totalY = y(total), totalH = Math.max(baseY - totalY, total ? 4 : 0);
    h += '<rect x="' + totalX + '" y="' + totalY + '" width="64" height="' + totalH + '" rx="8" fill="var(--teal)"><title>Total: ' + total + '</title></rect>';
    h += '<text x="' + (totalX + 32) + '" y="' + (totalY - 8) + '" text-anchor="middle" class="wf-val">' + total + '</text><text x="' + (totalX + 32) + '" y="204" text-anchor="middle">Total</text>';
    if (target != null) {
      var ty = y(target);
      h += '<line x1="18" y1="' + ty + '" x2="500" y2="' + ty + '" stroke="var(--text2)" stroke-dasharray="6 5"></line>';
      h += '<text x="500" y="' + (ty - 6) + '" text-anchor="end">Meta: ' + target + '</text>';
    }
    h += '</svg><div class="story-grid"><div class="story-card"><b>Total</b><span>' + total + ' atividades nos canais reais</span></div>';
    if (gap != null) h += '<div class="story-card"><b>Gap</b><span>' + (gap > 0 ? '+' : '') + gap + ' (meta: ' + target + ')</span></div>';
    h += '<div class="story-card"><b>Composição</b><span>' + items.map(function (item) { return item[0] + ' ' + item[1]; }).join(' | ') + '</span></div></div></div></div>';
    return h;
  }
  function deltaPctNumber(now, prev) {
    if (!prev && !now) return 0;
    if (!prev) return null;
    return Math.round((now - prev) / prev * 100);
  }
  function pctDelta(now, prev) {
    var v = deltaPctNumber(now, prev);
    if (v == null) return 's/ base';
    return (v > 0 ? '+' : '') + v + '%';
  }
  function deltaHtml(now, prev) {
    if (!historyAvailable()) return '<span class="kpi-delta muted">—</span>';
    var v = deltaPctNumber(now, prev);
    if (v == null) return '<span class="kpi-delta flat">s/ base</span>';
    var cls = v >= 10 ? 'up' : (v <= -10 ? 'down' : 'flat');
    return '<span class="kpi-delta ' + cls + '">' + variationText(v) + '</span>';
  }
  function cmpText(now, prev, label) {
    if (!historyAvailable()) return '— ' + label + ' · <b>indisponível</b>';
    return now + ' ' + label + ' vs ' + prev + ' no período anterior equivalente · <b>' + deltaHtml(now, prev) + '</b>';
  }
  function shiftIso(value, days) {
    var d = new Date(value + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return iso(d);
  }
  function inclusiveCalendarDays(since, until) {
    return Math.floor((new Date(until + 'T00:00:00') - new Date(since + 'T00:00:00')) / 86400000) + 1;
  }
  function rowStrictTotal(r) {
    var total = (r.calls_total || r.calls || 0) + (r.emails_sent_total || r.emails || 0) + (r.whatsapp_total || r.whatsApp || 0) + (r.linkedin_total || r.linkedin || 0) + (r.meetings_total || r.meetings || 0);
    if (!state.canal || state.canal === 'todos') return total;
    if (state.canal === 'emails') return r.emails_sent_total || r.emails || 0;
    if (state.canal === 'whatsApp') return r.whatsapp_total || r.whatsApp || 0;
    var key = state.canal === 'calls' ? 'calls_total' : state.canal + '_total';
    return r[key] || r[state.canal] || 0;
  }
  function rowTotalByCanal(r) {
    if (!state.canal || state.canal === 'todos') return r.total || 0;
    return r[state.canal] || 0;
  }
  function periodBadgeText(periodKey, periodLabel) {
    var r = periodKey === 'custom' ? { since: state.since, until: state.until } : periodRange(periodKey);
    var calendarDays = inclusiveCalendarDays(r.since, r.until);
    var businessDays = countDiasUteis(r.since, r.until);
    if (periodKey === 'hoje') return 'Hoje | 1 dia';
    if (state.diasUteis) return periodLabel + ' | ' + businessDays + ' dias úteis';
    return periodLabel + ' | ' + calendarDays + ' dias corridos';
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
    if (state.canal && state.canal !== 'todos') {
      rows.forEach(function (r) { r.total = rowTotalByCanal(r); });
      currentPeriod.total = currentPeriod[state.canal] || 0;
      previousPeriod.total = previousPeriod[state.canal] || 0;
    }
    var canalLabel = CHANNELS.filter(function (c) { return c[0] === state.canal; })[0];
    canalLabel = canalLabel ? canalLabel[1] : 'Todos';
    var h = '<div class="grid"><div class="card span-12"><div class="card-title"><div><h2>Ritmo Real de Atividades <span class="calc-btn" onclick="WorkloadBDR.openHelpFor(\'atividades-reais\')" title="Ver memória de cálculo">?</span></h2>' +
      '<div class="desc">Atividades registradas por dia' + (state.diasUteis ? ' útil' : '') + ': ligações, e-mails, WhatsApp, LinkedIn e reuniões. Canal ativo: <b>' + esc(canalLabel) + '</b>. Conversas ≥ 1 min aparecem separadamente na tabela live.</div></div></div>';
    h += '<div class="story-grid"><div class="story-card"><div class="story-head"><b>WoW | ligações registradas</b></div><span>' + cmpText(thisWeek.calls, lastWeek.calls, 'nesta semana') + '</span></div>' +
      '<div class="story-card"><div class="story-head"><b>WoW | e-mails</b></div><span>' + cmpText(thisWeek.emails, lastWeek.emails, 'nesta semana') + '</span></div>' +
      '<div class="story-card"><div class="story-head"><b>Período anterior | atividades</b></div><span>' + cmpText(currentPeriod.total, previousPeriod.total, 'na janela') + '</span></div></div>';
    if (!rows.length) return h + '<div class="desc">Sem dias no recorte após filtro.</div></div></div>';
    var moving = movingAverageRows(rows, 7);
    var max = 1; rows.forEach(function (r, i) { max = Math.max(max, r.total, moving[i] || 0); });
    var W = 1120, H = 260, L = 42, R = 16, T = 18, B = 34, plotW = W - L - R, plotH = H - T - B;
    var keys = [['calls', 'var(--teal)', 'Ligações'], ['emails', 'var(--yellow)', 'E-mails'], ['whatsApp', 'var(--green)', 'WhatsApp'], ['linkedin', 'var(--orange)', 'LinkedIn'], ['meetings', 'rgba(58,184,183,.42)', 'Reuniões']];
    if (state.canal && state.canal !== 'todos') keys = keys.filter(function (k) { return k[0] === state.canal; });
    var cum = rows.map(function () { return 0; });
    function x(i) { return L + (rows.length === 1 ? plotW / 2 : i * plotW / (rows.length - 1)); }
    function y(v) { return T + plotH - (v / max * plotH); }
    h += '<div class="line-legend">' + keys.map(function (k) { return '<span><i style="background:' + k[1] + '"></i>' + k[2] + '</span>'; }).join('') + '<span><i style="background:var(--text);height:2px"></i>Média móvel 7d</span></div>';
    h += '<svg class="area-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Ritmo real de atividades por dia">';
    for (var gy = 0; gy <= 4; gy++) { var yy = T + gy * plotH / 4; h += '<line x1="' + L + '" y1="' + yy + '" x2="' + (W - R) + '" y2="' + yy + '"></line><text x="4" y="' + (yy + 4) + '">' + Math.round(max * (4 - gy) / 4) + '</text>'; }
    keys.forEach(function (k) {
      var top = [], bottom = [];
      rows.forEach(function (r, i) { bottom.push([x(i), y(cum[i])]); cum[i] += r[k[0]] || 0; top.push([x(i), y(cum[i])]); });
      var d = 'M ' + top.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' L ') + ' L ' + bottom.slice().reverse().map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' L ') + ' Z';
      h += '<path class="area-layer" fill="' + k[1] + '" d="' + d + '"><title>' + k[2] + '</title></path>';
    });
    if (moving.length) {
      var md = moving.map(function (v, i) { return (i ? ' L ' : 'M ') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join('');
      h += '<path class="ln" d="' + md + '" stroke="var(--text)" fill="none"><title>Média móvel 7d</title></path>';
    }
    rows.forEach(function (r, i) { if (i % Math.ceil(rows.length / 12) === 0 || i === rows.length - 1) h += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle">' + ddmmFromIso(r.date) + '</text>'; });
    h += '</svg>';
    var zeros = rows.filter(function (r) { return r.total === 0; });
    if (zeros.length) h += '<div class="zero-audit">' + zeros.slice(0, 6).map(function (z) { return '<div class="zero-day"><b>' + ddmmFromIso(z.date) + '</b><br>Nenhuma atividade registrada neste dia útil. ' + (historyAvailable() ? '0 registrado.' : 'Histórico indisponível; pode ser falha de registro/API.') + '</div>'; }).join('') + (zeros.length > 6 ? '<div class="zero-day">+' + (zeros.length - 6) + ' dias úteis zerados</div>' : '') + '</div>';
    return h + '</div></div>';
  }

  function movingAverageRows(rows, windowSize) {
    return rows.map(function (_r, i) {
      var start = Math.max(0, i - windowSize + 1), slice = rows.slice(start, i + 1);
      return slice.reduce(function (sum, r) { return sum + (r.total || 0); }, 0) / Math.max(1, slice.length);
    });
  }
  function channelTotalsForRange(since, until, includeLiveToday, acts) {
    var s = sumActivityRows(aggregateHistoryByDay(since, until, state.diasUteis, includeLiveToday, acts));
    return [
      ['calls', 'Ligações', s.calls], ['emails', 'E-mails', s.emails], ['whatsApp', 'WhatsApp', s.whatsApp], ['linkedin', 'LinkedIn', s.linkedin], ['meetings', 'Reuniões', s.meetings],
    ];
  }
  function chartChannelComparison(acts) {
    var days = inclusiveCalendarDays(state.since, state.until);
    var prevSince = shiftIso(state.since, -days), prevUntil = shiftIso(state.since, -1);
    var current = channelTotalsForRange(state.since, state.until, true, acts);
    var previous = channelTotalsForRange(prevSince, prevUntil, false, acts);
    var prevMap = {}; previous.forEach(function (c) { prevMap[c[0]] = c[2]; });
    if (state.canal && state.canal !== 'todos') current = current.filter(function (c) { return c[0] === state.canal; });
    var total = current.reduce(function (sum, c) { return sum + c[2]; }, 0);
    var max = Math.max(1, current.reduce(function (m, c) { return Math.max(m, c[2], prevMap[c[0]] || 0); }, 0));
    var h = '<div class="grid"><div class="card span-12"><div class="card-title"><div><h2>Comparativo de canais <span class="source-badge bq">BQ/LIVE</span></h2>' +
      '<div class="desc">Atual vs período anterior equivalente, contribuição e delta por canal. Leitura descritiva, sem causalidade.</div></div></div><div class="break-list">';
    current.forEach(function (c) {
      var prev = prevMap[c[0]] || 0, contrib = total ? Math.round(c[2] / total * 100) : 0;
      h += '<div class="break-row" style="grid-template-columns:minmax(120px,1fr) 1fr 92px 90px"><span class="break-name">' + esc(c[1]) + '</span>' +
        '<div class="break-track"><div class="break-fill" style="width:' + Math.round(c[2] / max * 100) + '%"></div></div>' +
        '<span class="break-val">' + c[2] + ' atual | ' + prev + ' ant.</span><span class="right">' + contrib + '% · ' + variationHtml(deltaPctNumber(c[2], prev)) + '</span></div>';
    });
    return h + '</div></div></div>';
  }
  function chartFonteResultado(comps, conts, trans) {
    return '<div class="story-grid"><div class="story-card"><b>Fonte → resultado | leitura suspensa</b><span>Não exibimos correlação Apollo → SQL sem coorte que associe cada deal à fonte, porte e persona do lead. O gráfico de fonte abaixo permanece apenas descritivo.</span></div>' +
      '<div class="story-card"><b>Por que</b><span>Somar empresas e contatos cria denominador heterogêneo; comparar BDRs sem controlar mix gera conclusão enganosa.</span></div>' +
      '<div class="story-card"><b>Gate atual</b><span>A coorte Company×BDR já está ativa na seção analítica abaixo. Fonte→SQL segue suspenso até a origem/persona estar ligada à mesma coorte.</span></div></div>';
  }

  function cohortAvailable() { return !!(cohort && Array.isArray(cohort.effort) && Array.isArray(cohort.penetration) && Array.isArray(cohort.tier)); }
  function cohortRows(key) { return cohortAvailable() ? cohort[key].filter(function (r) { return !state.bdr || r.bdr === state.bdr; }) : []; }
  function pct(v) { return Math.round((Number(v) || 0) * 100); }
  function icText(w) { return w ? 'IC95% ' + pct(w.low) + '–' + pct(w.high) + '%' : 'IC95% —'; }
  function rateCell(row) { return row.sampleSufficient ? '<b>' + pct(row.rate) + '%</b> <span class="muted">n=' + row.cohorts + ' · ' + icText(row.wilson95) + '</span>' : '<span class="muted">amostra insuficiente · n=' + row.cohorts + ' · ' + icText(row.wilson95) + '</span>'; }
  function renderCohortBanner() {
    var m = cohort.metadata || {}, req = cohort.requestedRange || {}, eff = cohort.effectiveRange || {};
    var txt = '<b>Snapshot analítico:</b> data máxima ' + esc(m.latestDataDate || '—') + '. ';
    if (cohort.usedFallback) txt += 'Pedido ' + esc(req.since) + '–' + esc(req.until) + ' | exibindo janela analítica equivalente ' + esc(eff.since) + '–' + esc(eff.until) + ' porque o snapshot vai até ' + esc(m.latestDataDate || '—') + '.';
    else if (cohort.expandedTo30d || (req.until && eff.until && req.until !== eff.until)) txt += 'Pedido ' + esc(req.since) + '–' + esc(req.until) + ' | exibindo janela analítica ' + esc(eff.since) + '–' + esc(eff.until) + ' (snapshot limitado e mínimo de 30 dias).';
    else txt += 'Janela efetiva ' + esc(eff.since || '—') + '–' + esc(eff.until || '—') + '.';
    return '<section class="note cohort-banner">' + txt + '<br><b>Regra estatística:</b> mínimo analítico de 30 dias; toda taxa mostra n e IC95%.<br><b>Filtros aplicados:</b> período e BDR; canal/fonte da inserção não se aplicam a esta camada.</section>';
  }
  function renderEffortCohort() {
    var rows = cohortRows('effort').slice().sort(function (a, b) { return a.effortBandOrder - b.effortBandOrder; });
    if (state.bdr) rows = rows.filter(function (r) { return r.bdr === state.bdr; });
    var bands = ['1', '2-3', '4-6', '7-12', '13+'];
    var agg = {};
    bands.forEach(function (b) { agg[b] = { effortBand: b, effortBandOrder: bands.indexOf(b) + 1, cohorts: 0, converted: 0 }; });
    rows.forEach(function (r) { var a = agg[r.effortBand]; if (a) { a.cohorts += r.cohorts; a.converted += r.converted; } });
    var out = bands.map(function (b) { var a = agg[b], w = wilsonFront(a.converted, a.cohorts); return { effortBand: b, cohorts: a.cohorts, converted: a.converted, rate: w.rate, wilson95: w, sampleSufficient: a.cohorts >= ((cohort.metadata && cohort.metadata.minEffortN) || 30) }; });
    var max = Math.max(1, out.reduce(function (m, r) { return Math.max(m, r.rate); }, 0));
    var h = '<div class="card span-12"><div class="card-title"><div><h2>Associação observacional | esforço real até a data do SQL</h2><div class="desc">Barras por faixa de toques reais até a data do SQL. Correlação ≠ causalidade; toques posteriores ao SQL no mesmo dia podem permanecer por a fonte ter data, não timestamp.</div></div></div><div class="bars cohort-bars">';
    out.forEach(function (r) { h += '<div class="bar-wrap"><div class="bar" style="background:linear-gradient(180deg,var(--teal),rgba(58,184,183,.35));height:' + Math.max(3, Math.round(r.rate / max * 150)) + 'px"><small>' + (r.sampleSufficient ? pct(r.rate) + '%' : 'n insuf.') + '</small></div><span class="bar-label" style="transform:none">' + esc(r.effortBand) + '<br>n=' + r.cohorts + '<br>' + icText(r.wilson95) + '</span></div>'; });
    return h + '</div></div>';
  }
  function wilsonFront(successes, n) {
    var z = 1.959963984540054, s = Number(successes || 0), total = Number(n || 0);
    if (!total) return { low: 0, high: 0, rate: 0 };
    var phat = s / total, denom = 1 + z * z / total, center = (phat + z * z / (2 * total)) / denom, margin = z * Math.sqrt((phat * (1 - phat) + z * z / (4 * total)) / total) / denom;
    return { low: Math.max(0, center - margin), high: Math.min(1, center + margin), rate: phat };
  }
  function renderPenetrationCohort() {
    var rows = cohortRows('penetration');
    var total = state.bdr ? rows[0] : rows.filter(function (r) { return r.isAll; })[0];
    if (!total) total = { companiesObserved: 0, companiesReal: 0, contactsObserved: 0, contactsReal: 0, medianDepth: 0, buckets: { '0': 0, '1': 0, '2-3': 0, '4+': 0 } };
    var med = total.medianDepth || 0;
    var warn = total.companiesObserved < ((cohort.metadata && cohort.metadata.minPenetrationCompanies) || 20) ? '<div class="desc">amostra insuficiente para leitura comparativa robusta.</div>' : '';
    return '<div class="card span-6"><div class="card-title"><div><h2>Penetração observada | empresa e contato</h2><div class="desc">Denominador = observado no snapshot, não carteira total/elegíveis.</div></div></div>' + warn + '<div class="story-grid"><div class="story-card"><b>Empresas com toque real</b><span>' + total.companiesReal + ' / ' + total.companiesObserved + '</span></div><div class="story-card"><b>Contatos reais</b><span>' + total.contactsReal + ' / ' + total.contactsObserved + '</span></div><div class="story-card"><b>Mediana profundidade</b><span>' + med.toFixed(1) + ' toques reais</span></div></div><div class="break-list">' + ['0', '1', '2-3', '4+'].map(function (k) { return '<div class="break-row"><span class="break-name">bucket ' + k + '</span><div class="break-track"><div class="break-fill" style="width:' + (total.companiesObserved ? Math.round(total.buckets[k] / total.companiesObserved * 100) : 0) + '%"></div></div><span class="break-val">' + total.buckets[k] + '</span></div>'; }).join('') + '</div></div>';
  }
  function renderTierCohort() {
    var rows = cohortRows('tier');
    var byPorte = {};
    rows.forEach(function (r) { var key = (r.porte || 'desconhecido').toLowerCase(); if (!byPorte[key]) byPorte[key] = { porte: key, cohorts: 0, converted: 0 }; byPorte[key].cohorts += r.cohorts || 0; byPorte[key].converted += r.converted || 0; });
    rows = Object.keys(byPorte).map(function (key) { var r = byPorte[key], w = wilsonFront(r.converted, r.cohorts); r.rate = w.rate; r.wilson95 = w; r.sampleSufficient = r.cohorts >= ((cohort.metadata && cohort.metadata.minTierN) || 20); return r; });
    var total = rows.reduce(function (a, r) { a.cohorts += r.cohorts || 0; if ((r.porte || '').toLowerCase() !== 'desconhecido') a.known += r.cohorts || 0; return a; }, { cohorts: 0, known: 0 });
    rows.sort(function (a, b) { return (b.cohorts || 0) - (a.cohorts || 0); });
    var h = '<div class="card span-6"><div class="card-title"><div><h2>Conversão empresa→SQL por porte | 30d</h2><div class="desc">Taxa descritiva por porte; desconhecido explícito. Cobertura de porte: ' + (total.cohorts ? Math.round(total.known / total.cohorts * 100) : 0) + '%.</div></div></div><div class="break-list">';
    if (!rows.length) h += '<div class="desc">Sem coortes no recorte.</div>';
    rows.forEach(function (r) { h += '<div class="break-row" style="grid-template-columns:minmax(120px,1fr) 1fr 220px"><span class="break-name">' + esc(r.porte || 'desconhecido') + '</span><div class="break-track"><div class="break-fill" style="width:' + pct(r.rate) + '%"></div></div><span class="break-val">' + rateCell(r) + '</span></div>'; });
    return h + '</div></div>';
  }
  function renderCohortAnalytics() {
    if (!cohortAvailable()) return '<section class="level-advanced"><h2 class="level-title">Inteligência de Coorte | snapshot analítico</h2><div class="card span-12"><div class="card-title"><div><h2>Camada indisponível</h2><div class="desc">Não foi possível carregar /api/bdr-cohort-analytics. O restante do dashboard permanece operacional.</div></div></div><div class="note">' + esc(cohortError || 'Falha desconhecida') + '</div></div></section>';
    return '<section class="level-advanced"><h2 class="level-title">Inteligência de Coorte | snapshot analítico</h2>' + renderCohortBanner() + '<div class="grid">' + renderEffortCohort() + renderPenetrationCohort() + renderTierCohort() + '</div></section>';
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
    var por = {};
    selectedBdrs().forEach(function (b) {
      por[b] = { hoje: 0, meta: 0, pctMeta: null, delta7d: null, calls: 0, emails: 0, whats: 0, linkedin: 0, meetings: 0, lastLoad: null };
    });
    aggregateBdrCurrent(acts).forEach(function (r) {
      var p = por[r.bdr]; if (!p) return;
      p.calls = r.calls; p.emails = r.emails; p.whats = r.whats; p.linkedin = r.linkedin; p.meetings = r.meetings; p.hoje = selectedTotal(r); p.lastLoad = r.lastLoad;
    });
    comps.forEach(function (c) { if (por[c.bdr]) por[c.bdr].lastLoad = latestTs(por[c.bdr].lastLoad, c.criado); });
    conts.forEach(function (c) { if (por[c.bdr]) por[c.bdr].lastLoad = latestTs(por[c.bdr].lastLoad, c.criado); });
    trans.forEach(function (t) { if (por[t.bdr]) por[t.bdr].lastLoad = latestTs(por[t.bdr].lastLoad, t.ts); });
    var periodDays = inclusiveCalendarDays(state.since, state.until);
    var prevSince = state.period === 'hoje' ? shiftIso(state.since, -10) : shiftIso(state.since, -periodDays);
    var prevUntil = shiftIso(state.since, -1);
    var prevByBdr = {};
    if (historyAvailable()) {
      history.dailyRows.forEach(function (r) {
        if (r.metric_date < prevSince || r.metric_date > prevUntil) return;
        if (state.diasUteis && !isDiaUtil(new Date(r.metric_date + 'T00:00:00'))) return;
        if (state.bdr && r.owner_name !== state.bdr) return;
        if (!prevByBdr[r.owner_name]) prevByBdr[r.owner_name] = { total: 0, days: {} };
        prevByBdr[r.owner_name].total += rowStrictTotal(r);
        prevByBdr[r.owner_name].days[r.metric_date] = 1;
      });
    }
    var days = targetDaysForRange(state.since, state.until);
    selectedBdrs().forEach(function (b) {
      var p = por[b];
      p.meta = targetForBdr(b, state.canal) * days;
      p.pctMeta = p.meta ? Math.round(p.hoje / p.meta * 100) : null;
      var prev = prevByBdr[b] || { total: 0, days: {} };
      var baseline = state.period === 'hoje' ? Math.round(prev.total / Math.max(1, Math.min(7, Object.keys(prev.days).length))) : prev.total;
      p.delta7d = deltaPctNumber(p.hoje, baseline);
      if (!p.lastLoad && raw.generatedAt) p.lastLoad = raw.generatedAt;
    });
    var rows = selectedBdrs().slice().sort(function (a, b) {
      var pa = por[a], pb = por[b], va = sortValue(pa, a), vb = sortValue(pb, b);
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
    var totals = { hoje: 0, meta: 0, calls: 0, emails: 0, whats: 0, linkedin: 0, meetings: 0, lastLoad: null };
    rows.forEach(function (b) {
      var p = por[b];
      totals.hoje += p.hoje; totals.meta += p.meta; totals.calls += p.calls; totals.emails += p.emails; totals.whats += p.whats; totals.linkedin += p.linkedin; totals.meetings += p.meetings;
      totals.lastLoad = latestTs(totals.lastLoad, p.lastLoad);
    });
    totals.pctMeta = totals.meta ? Math.round(totals.hoje / totals.meta * 100) : null;
    totals.delta7d = deltaPctNumber(totals.hoje, Object.keys(prevByBdr).reduce(function (sum, b) { return sum + (prevByBdr[b] ? prevByBdr[b].total : 0); }, 0));

    var colLabel = state.period === 'hoje' ? 'Hoje' : 'Recorte';
    var h = '<div class="grid"><div class="card span-12"><div class="card-title"><div><h2>Ranking de BDRs | atividades reais ' + sourceBadgeText() + '</h2>' +
      '<div class="desc">Clique no cabeçalho para ordenar. ' + colLabel + ' = total estrito nos cinco canais; meta vem de gold.bdr_daily_target por BDR/canal × dias no recorte; Δ compara baseline real e mostra s/ base quando baseline é zero.</div></div>' +
      '<span class="pill">' + totals.hoje + ' atividades</span></div>';
    if (!totals.hoje) return h + '<div class="desc">Sem atividades registradas no recorte.</div></div></div>';
    h += '<div class="table-wrap"><table><thead><tr>' +
      sortTh('bdr', 'BDR', '') + sortTh('hoje', colLabel, 'right') + sortTh('meta', 'Meta', 'right') + sortTh('pctMeta', '% Meta', 'right') + sortTh('delta7d', 'Δ', 'right') +
      sortTh('calls', 'Ligações', 'right') + sortTh('emails', 'E-mails', 'right') + sortTh('whats', 'WhatsApp', 'right') + sortTh('linkedin', 'LinkedIn', 'right') + sortTh('meetings', 'Reuniões', 'right') + sortTh('lastLoad', 'Última carga', '') +
      '</tr></thead><tbody>';
    rows.forEach(function (b) {
      var p = por[b];
      h += '<tr><td>' + esc(b) + '</td><td class="right"><b>' + p.hoje + '</b></td><td class="right">' + (p.meta || '—') + '</td><td class="right">' + (p.pctMeta == null ? '—' : p.pctMeta + '%') + '</td><td class="right">' + variationHtml(p.delta7d) + '</td>' +
        '<td class="right">' + (p.calls ? '<span class="calls-link" onclick="WorkloadBDR.drillCalls(\'' + b + '\')" title="Ver detalhe das ligações" style="cursor:pointer;color:var(--teal);text-decoration:underline dotted;text-underline-offset:2px">' + p.calls + '</span>' : '0') + '</td>' +
        '<td class="right">' + p.emails + '</td><td class="right">' + p.whats + '</td><td class="right">' + p.linkedin + '</td><td class="right">' + p.meetings + '</td><td class="nowrap">' + dmhmFull(p.lastLoad) + '</td></tr>';
    });
    return h + '</tbody><tfoot><tr><td>Total</td><td class="right">' + totals.hoje + '</td><td class="right">' + (totals.meta || '—') + '</td><td class="right">' + (totals.pctMeta == null ? '—' : totals.pctMeta + '%') + '</td><td class="right">' + variationHtml(totals.delta7d) + '</td><td class="right">' + totals.calls + '</td><td class="right">' + totals.emails + '</td><td class="right">' + totals.whats + '</td><td class="right">' + totals.linkedin + '</td><td class="right">' + totals.meetings + '</td><td class="nowrap">' + dmhmFull(totals.lastLoad) + '</td></tr></tfoot></table></div></div></div>';
  }
  function sortValue(p, bdr) {
    if (sortBy === 'bdr') return bdr || '';
    if (sortBy === 'lastLoad') return p.lastLoad ? new Date(p.lastLoad).getTime() : 0;
    return p[sortBy] || 0;
  }
  function sortTh(col, label, cls) {
    var active = sortBy === col;
    return '<th' + (cls ? ' class="' + cls + '"' : '') + ' onclick="WorkloadBDR.sortTable(\'' + col + '\')">' + esc(label) + '<span class="sort-indicator' + (active ? ' active' : '') + '">' + (active ? (sortDir === 'asc' ? '▲' : '▼') : '↕') + '</span></th>';
  }
  function variationText(v) {
    if (v == null) return 's/ base';
    var arrow = v >= 10 ? '▲' : (v <= -10 ? '▼' : '→');
    return arrow + ' ' + (v > 0 ? '+' : '') + v + '%';
  }
  function variationHtml(v) {
    if (v == null) return '<span class="delta-arrow flat">s/ base</span>';
    var cls = v >= 10 ? 'up' : (v <= -25 ? 'down strong' : (v <= -10 ? 'down' : 'flat'));
    return '<span class="delta-arrow ' + cls + '">' + variationText(v) + '</span>';
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
    var periods = [['hoje', 'Hoje'], ['ontem', 'Ontem'], ['7d', 'Últimos 7 dias'], ['30d', 'Últimos 30 dias'], ['90d', 'Últimos 90 dias'], ['semana', 'Semana atual'], ['mes', 'Mês atual'], ['custom', 'Período custom']];
    var h = '<div class="periodbar"><span class="period-label">Período</span>';
    periods.forEach(function (p) {
      var src = p[0] === 'hoje' ? ['LIVE', 'live'] : ['BQ', 'bq'];
      var badgeText = periodBadgeText(p[0], p[1]);
      h += '<button class="period-chip' + (state.period === p[0] ? ' active' : '') + '" onclick="WorkloadBDR.setPeriod(\'' + p[0] + '\')">' + p[1] + ' <span class="source-badge ' + src[1] + '" title="' + esc(badgeText) + '">' + src[0] + ': ' + esc(badgeText) + '</span></button>';
    });
    if (state.period === 'custom') {
      h += '<input type="date" id="f-since" value="' + (state.since || '') + '" style="width:auto;background:var(--card2);border:1px solid var(--border);color:var(--text);border-radius:10px;padding:.4rem .5rem">' +
        '<input type="date" id="f-until" value="' + (state.until || '') + '" style="width:auto;background:var(--card2);border:1px solid var(--border);color:var(--text);border-radius:10px;padding:.4rem .5rem">' +
        '<button class="btn primary" onclick="WorkloadBDR.applyCustom()">Aplicar</button>';
    }
    h += '<span class="period-help" id="gen-at"></span><label class="toggle-filter"><input type="checkbox" ' + (state.diasUteis ? 'checked' : '') + ' onchange="WorkloadBDR.toggleDiasUteis(this.checked)"> Mostrar apenas dias úteis</label></div>';
    h += '<div class="periodbar channelbar"><span class="period-label">Canal</span>';
    CHANNELS.forEach(function (c) {
      h += '<button class="period-chip channel-chip' + (state.canal === c[0] ? ' active' : '') + '" onclick="WorkloadBDR.setChannel(\'' + c[0] + '\')">' + c[1] + '</button>';
    });
    h += '</div>';

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
    fetch('/api/bdr-workload-calls?detail=1&limit=50&page=1&bdr=' + encodeURIComponent(b) + '&since=' + state.since + '&until=' + state.until, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        // só atualiza se o modal ainda é o mesmo (usuário não trocou/fechou)
        if (document.getElementById('modal-title').textContent !== expected) return;
        if (d && d.success && d.enriched) {
          document.getElementById('modal-body').innerHTML = renderCallsBody(b, calls, d.calls || []);
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
  var modalFocusBefore = null;
  document.addEventListener('keydown', function (event) {
    var overlay = document.getElementById('modal-overlay');
    if (!overlay || !overlay.classList.contains('open')) return;
    if (event.key === 'Escape') { event.preventDefault(); closeModal(); return; }
    if (event.key !== 'Tab') return;
    var modal = overlay.querySelector('.modal');
    var focusable = modal.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  function openModal(title, html) {
    modalFocusBefore = document.activeElement;
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = html;
    document.getElementById('modal-overlay').classList.add('open');
    window.setTimeout(function () { var close = document.querySelector('#modal-overlay .modal-hdr button'); if (close) close.focus(); }, 0);
  }
  function closeModal() { document.getElementById('modal-overlay').classList.remove('open'); if (modalFocusBefore && modalFocusBefore.focus) modalFocusBefore.focus(); }

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
      ['Fonte → Resultado', 'Leitura suspensa até existir coorte contato → deal SQL com controle de porte, persona e tamanho da amostra. Fonte é exibida apenas de forma descritiva.'],
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
    setChannel: function (v) { state.canal = v || 'todos'; render(); },
    reset: function () { state.bdr = ''; state.porte = ''; state.fonte = ''; state.canal = 'todos'; render(); },
    toggleDiasUteis: function (v) { state.diasUteis = !!v; render(); },
    sortTable: function (col) {
      if (sortBy === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortBy = col; sortDir = 'desc'; }
      render();
    },
    drill: drill, drillCalls: drillCalls, closeModal: closeModal, openAllHelp: openAllHelp, openHelpFor: openHelpFor, closeHelp: closeHelp, toggleTheme: toggleTheme,
  };
})();
window.addEventListener('DOMContentLoaded', function () {
  var q = new URLSearchParams(location.search);
  if (q.get('workload') === 'v1' || window.BDR_WORKLOAD_FORCE_V1) { WorkloadBDR.init(); return; }
  // Rede de segurança: se o asset v2 faltar ou tiver erro de parse, a página não
  // fica presa no loading. O asset v2 marca presença antes de iniciar o config gate.
  window.setTimeout(function () {
    if (window.BDR_WORKLOAD_V2_ASSET_LOADED) return;
    if (window.WorkloadBDRRouter) WorkloadBDRRouter.setMode('v1');
    WorkloadBDR.init();
  }, 1200);
});
