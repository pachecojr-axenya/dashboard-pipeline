(function () {
  'use strict';

  var state = { raw: null, rows: [], filters: loadFilters(), tab: 'overview' };

  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { return Number(n || 0).toLocaleString('pt-BR'); }
  function pct(v) { return v == null ? 'Não medido' : (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'; }
  function realDeliveryLabel(s) {
    if (!s.deliveryAnalyticsAvailable) return 'Analytics off';
    if (!s.realObservedAttempts) return 'Sem tentativas';
    return pct(s.realObservedDeliveryRate);
  }
  function unitLabel() { return state.dwMode ? 'tentativas' : 'sessões'; }
  function personLabel() { return state.dwMode ? 'Flows' : 'Pessoas'; }
  function sourceLabel() { return state.dwMode ? 'ClickHouse Treble | fact_deployment_status' : 'Treble API | sessions/history'; }
  function day(v) { return v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—'; }
  function severityClass(v) { return v === 'danger' ? 'bad' : (v === 'warning' ? 'warn' : (v === 'success' ? 'good' : 'teal')); }

  function loadFilters() {
    try {
      var saved = JSON.parse(localStorage.getItem('bdr_treble_filters_v3') || '{}');
      return { days: saved.days || '30', bdr: saved.bdr || '', flow: saved.flow || '', family: saved.family || '', audience: saved.audience || '', reason: saved.reason || '', q: saved.q || '' };
    } catch (e) {
      return { days: '30', bdr: '', flow: '', family: '', audience: '', reason: '', q: '' };
    }
  }
  function saveFilters() { try { localStorage.setItem('bdr_treble_filters_v3', JSON.stringify(state.filters)); } catch (e) {} }

  function setState(type, title, text) {
    var el = $('state'), content = $('content');
    if (content) content.classList.add('hidden');
    if (!el) return;
    el.classList.remove('hidden');
    el.innerHTML = (type === 'loading' ? '<div class="spinner"></div>' : '') + '<strong>' + esc(title) + '</strong>' + esc(text || '');
  }

  function unique(rows, field) {
    var seen = {}, out = [];
    rows.forEach(function (m) { var v = m[field] || ''; if (v && !seen[v]) { seen[v] = true; out.push(v); } });
    return out.sort(function (a, b) { return String(a).localeCompare(String(b)); });
  }

  function renderFilters() {
    var el = $('filters'); if (!el) return;
    function opts(values, selected, allLabel) {
      var h = '<option value="">' + esc(allLabel) + '</option>';
      values.forEach(function (v) { h += '<option value="' + esc(v) + '"' + (String(v) === String(selected) ? ' selected' : '') + '>' + esc(v) + '</option>'; });
      return h;
    }
    var periods = [['7', '7d'], ['30', '30d'], ['90', '90d']];
    var h = '<div class="periodbar"><span class="period-label">Período</span>';
    periods.forEach(function (p) { h += '<button class="period-chip' + (state.filters.days === p[0] ? ' active' : '') + '" data-days="' + p[0] + '">' + p[1] + '</button>'; });
    h += '<span class="muted">Fonte primária ' + esc(state.dwMode ? 'ClickHouse Treble | retenção 90d' : 'Treble API REST') + ' | cache 10 min</span></div>';
    h += '<div class="filter"><label>BDR inferido</label><select id="f-bdr">' + opts(unique(state.rows, 'bdr'), state.filters.bdr, 'Todos') + '</select></div>';
    h += '<div class="filter"><label>Flow Treble</label><select id="f-flow">' + opts(unique(state.rows, 'flow'), state.filters.flow, 'Todos') + '</select></div>';
    h += '<div class="filter"><label>Família de abordagem</label><select id="f-family">' + opts(unique(state.rows, 'family'), state.filters.family, 'Todas') + '</select></div>';
    h += '<div class="filter"><label>Público inferido</label><select id="f-audience">' + opts(unique(state.rows, 'audience'), state.filters.audience, 'Todos') + '</select></div>';
    h += '<div class="filter"><label>Motivo observado</label><select id="f-reason">' + opts(unique(state.rows, 'reasonLabel'), state.filters.reason, 'Todos') + '</select></div>';
    h += '<div class="filter"><label>Busca</label><input id="f-q" value="' + esc(state.filters.q) + '" placeholder="flow, BDR, público ou motivo"></div>';
    h += '<div class="filter" style="display:flex;align-items:end;gap:.5rem"><button class="btn" id="f-clear">Limpar</button><button class="btn primary" id="f-refresh">Refresh</button></div>';
    el.innerHTML = h;
    function bind(id, key) { var x = $(id); if (x) x.onchange = function () { state.filters[key] = x.value; saveFilters(); render(); }; }
    bind('f-bdr', 'bdr'); bind('f-flow', 'flow'); bind('f-family', 'family'); bind('f-audience', 'audience'); bind('f-reason', 'reason');
    $('f-q').oninput = function () { state.filters.q = this.value; saveFilters(); render(); };
    $('f-clear').onclick = function () { state.filters = { days: state.filters.days, bdr: '', flow: '', family: '', audience: '', reason: '', q: '' }; saveFilters(); render(); };
    $('f-refresh').onclick = function () { api.load(true); };
    Array.prototype.forEach.call(el.querySelectorAll('.period-chip'), function (b) { b.onclick = function () { state.filters.days = b.getAttribute('data-days'); saveFilters(); api.load(false); }; });
  }

  function filtered() {
    var q = String(state.filters.q || '').toLowerCase();
    return state.rows.filter(function (m) {
      if (state.filters.bdr && m.bdr !== state.filters.bdr) return false;
      if (state.filters.flow && m.flow !== state.filters.flow) return false;
      if (state.filters.family && m.family !== state.filters.family) return false;
      if (state.filters.audience && m.audience !== state.filters.audience) return false;
      if (state.filters.reason && m.reasonLabel !== state.filters.reason) return false;
      if (q) {
        var hay = [m.flow, m.bdr, m.family, m.audience, m.semanticGroup, m.person, m.reasonLabel, m.nonDeliveryReason, m.action, m.copy].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function actualRows(rows) {
    return rows.filter(function (r) { return !r.diagnostic; });
  }

  function summarize(rows) {
    var people = {};
    var s = { sessions: rows.length, sent: 0, delivered: 0, read: 0, replied: 0, failures: 0, notDelivered: 0, deliveredNotRead: 0, readNoReply: 0, noHistory: 0, people: 0 };
    rows.forEach(function (r) {
      if (r.person) people[r.person] = true;
      if (r.sent) s.sent++;
      if (r.delivered) s.delivered++;
      if (r.read && r.readAvailable !== false) s.read++;
      if (r.replied) s.replied++;
      if (state.dwMode ? !r.delivered : r.reason !== 'responded') s.failures++;
      if (r.reason === 'not_delivered') s.notDelivered++;
      if (r.reason === 'delivered_not_read') s.deliveredNotRead++;
      if (r.reason === 'read_no_reply') s.readNoReply++;
      if (r.reason === 'no_history') s.noHistory++;
    });
    s.deliveryRate = s.sent ? s.delivered / s.sent : null;
    s.readMetricAvailable = rows.some(function (r) { return r.readAvailable !== false; });
    s.readRate = s.readMetricAvailable && s.delivered ? s.read / s.delivered : null;
    s.responseRate = s.sent ? s.replied / s.sent : null;
    s.failureRate = s.sessions ? s.failures / s.sessions : null;
    s.people = Object.keys(people).length;
    return s;
  }

  function group(rows, field) {
    var map = {};
    rows.forEach(function (r) {
      var k = r[field] || 'Sem dado';
      if (!map[k]) map[k] = { key: k, label: k, sessions: 0, sent: 0, delivered: 0, read: 0, replied: 0, failures: 0, reasons: {}, samples: [], people: {}, flows: {} };
      var a = map[k];
      a.sessions++;
      if (r.sent) a.sent++;
      if (r.delivered) a.delivered++;
      if (r.read && r.readAvailable !== false) a.read++;
      if (r.replied) a.replied++;
      if (state.dwMode ? !r.delivered : r.reason !== 'responded') a.failures++;
      a.reasons[r.reasonLabel] = (a.reasons[r.reasonLabel] || 0) + 1;
      if (r.person) a.people[r.person] = true;
      if (r.flow) a.flows[r.flow] = true;
      if (a.samples.length < 2 && r.copy) a.samples.push(r.copy);
    });
    return Object.keys(map).map(function (k) {
      var a = map[k];
      var top = Object.keys(a.reasons).map(function (x) { return { label: x, count: a.reasons[x] }; }).sort(function (x, y) { return y.count - x.count; })[0] || { label: 'Sem dado', count: 0 };
      a.deliveryRate = a.sent ? a.delivered / a.sent : null;
      a.readMetricAvailable = rows.some(function (r) { return r[field] === a.key && r.readAvailable !== false; });
      a.readRate = a.readMetricAvailable && a.delivered ? a.read / a.delivered : null;
      a.responseRate = a.sent ? a.replied / a.sent : null;
      a.failureRate = a.sessions ? a.failures / a.sessions : null;
      a.peopleCount = Object.keys(a.people).length;
      a.flowsCount = Object.keys(a.flows).length;
      a.topReason = top;
      return a;
    }).sort(function (a, b) { return b.sessions - a.sessions || a.label.localeCompare(b.label); });
  }

  function kpi(label, value, sub, kind, drill) {
    return '<div class="kpi ' + (kind || '') + (drill ? ' clickable" data-drill-kind="' + esc(drill) + '"' : '"') + '><div class="label">' + esc(label) + '</div><div class="value">' + esc(value) + '</div><div class="sub">' + esc(sub) + '</div></div>';
  }

  function funnel(s) {
    var steps = [
      [state.dwMode ? 'Tentativas' : 'Sessões', s.sessions, 'Universo analisado'],
      ['Enviadas', s.sent, 'Tentativas reais de deployment'],
      ['Entregues', s.delivered, pct(s.deliveryRate) + ' | fact_deployment_status']
    ];
    if (s.readMetricAvailable) steps.push(['Lidas', s.read, pct(s.readRate)]);
    steps.push(['Respondidas', s.replied, pct(s.responseRate)]);
    var max = Math.max(s.sessions, 1);
    var title = state.dwMode ? 'Funil Treble | deployments reais' : 'Funil Treble | sessions materializadas';
    var desc = state.dwMode ? 'Entrega vem de timestamp_delivered válido ou status DELIVERED; resposta válida também implica entrega para consistência do funil.' : 'Entrega aqui significa delivered_at dentro de history. Falhas de deployment ficam fora deste denominador até ingerirmos deployment.failure.';
    return '<div class="card span-12"><div class="card-title"><div><h2>' + esc(title) + '</h2><div class="desc">' + esc(desc) + '</div></div></div>' + steps.map(function (x) {
      return '<div class="bar-row"><div class="bar-name">' + esc(x[0]) + '<div class="muted">' + esc(x[2]) + '</div></div><div class="bar-track"><div class="bar-fill" style="width:' + Math.max(2, Math.round(x[1] / max * 100)) + '%"></div></div><div class="bar-val">' + fmt(x[1]) + '</div></div>';
    }).join('') + '</div>';
  }

  function reasonCards(rows) {
    var reasons = group(rows, 'reasonLabel');
    return '<div class="grid">' + reasons.slice(0, 6).map(function (r) {
      var sample = state.dwMode ? 'Sem conteúdo/copy exposto no DW' : (r.samples[0] || 'Sem exemplo de copy outbound');
      return '<div class="card span-4 clickable-row" data-drill-field="reasonLabel" data-drill-value="' + esc(r.label) + '"><div class="card-title"><div><h2>' + esc(r.label) + '</h2><div class="desc">' + fmt(r.sessions) + ' ' + esc(unitLabel()) + ' | ' + pct(r.failureRate) + ' do filtro</div></div></div><p class="muted">Ação: ' + esc(actionForReason(r.label)) + '</p><p style="margin-top:.75rem">' + esc(sample) + '</p></div>';
    }).join('') + '</div>';
  }

  function actionForReason(label) {
    if (/Sem evidência de entrega|Não entregue/.test(label)) return 'Verificar HSM, linha, opt-in e qualidade da base';
    if (/Entregue, não lida/.test(label)) return 'Testar horário, primeira linha e remetente';
    if (/Lida, sem resposta/.test(label)) return 'Reduzir fricção do CTA e testar pergunta mais direta';
    if (/Sem resposta/.test(label)) return 'Criar follow-up específico por persona';
    if (/Respondeu/.test(label)) return 'Replicar abordagem e cadência vencedora';
    return 'Auditar configuração e captura do flow';
  }

  function topFor(rows, field) {
    var g = group(rows, field);
    return g[0] ? g[0].label + ' (' + fmt(g[0].sessions) + ')' : 'Sem dado';
  }

  function barRows(rows, field, limit, metric) {
    if (!rows.length) return '<div class="muted">Sem dados no filtro.</div>';
    var max = Math.max.apply(null, rows.map(function (r) { return metric === 'failures' ? r.failures : r.sessions; }).concat([1]));
    return rows.slice(0, limit || 12).map(function (r) {
      var val = metric === 'failures' ? r.failures : r.sessions;
      return '<div class="bar-row clickable-row" data-drill-field="' + esc(field) + '" data-drill-value="' + esc(r.label) + '"><div class="bar-name">' + esc(r.label) + '<div class="muted">' + esc(personLabel()) + ' ' + fmt(state.dwMode ? (r.flowsCount || 0) : (r.peopleCount || 0)) + ' | Entrega ' + pct(r.deliveryRate) + ' | Resp. ' + pct(r.responseRate) + ' | gargalo: ' + esc(r.topReason.label) + '</div></div><div class="bar-track"><div class="bar-fill ' + (r.failures ? 'bad' : '') + '" style="width:' + Math.max(2, Math.round(val / max * 100)) + '%"></div></div><div class="bar-val">' + fmt(val) + '</div><div class="bar-val">' + fmt(r.replied) + ' resp.</div></div>';
    }).join('');
  }

  function renderOverview(rows, s) {
    var byFlow = group(rows, 'flow');
    var byFamily = group(rows, 'family');
    var byBdr = group(rows, 'bdr');
    var best = byFlow.filter(function (r) { return r.sent >= 3; }).sort(function (a, b) { return (b.responseRate || 0) - (a.responseRate || 0); })[0];
    var worst = byFlow.filter(function (r) { return r.sessions >= 3; }).sort(function (a, b) { return b.failures - a.failures; })[0];
    var topBdr = byBdr[0];
    var story = '<div class="story-grid">' +
      '<div class="story-card"><b>O que aconteceu</b><span>' + fmt(s.sessions) + ' ' + esc(unitLabel()) + ' analisadas | ' + fmt(s.sent) + ' enviadas | ' + fmt(s.replied) + ' com resposta.</span></div>' +
      '<div class="story-card"><b>Entrega real observada</b><span>' + fmt(s.deploymentFailures || 0) + ' não entregues | taxa ' + esc(realDeliveryLabel(s)) + '.</span></div>' +
      '<div class="story-card"><b>Quem mais usou</b><span>' + (topBdr ? esc(topBdr.label) + ' | ' + fmt(topBdr.sessions) + ' ' + esc(unitLabel()) + ' | resposta ' + pct(topBdr.responseRate) + '.' : 'Ainda sem volume por BDR.') + '</span></div>' +
      '<div class="story-card"><b>Próxima ação</b><span>' + (worst ? 'Atacar gargalo de ' + esc(worst.label) + ': ' + esc(worst.topReason.label) + '.' : 'Padronizar nomenclatura dos flows e rodar mais volume.') + '</span></div></div>';
    var kpis = '<div class="kpis">' +
      kpi(state.dwMode ? 'Tentativas' : 'Sessões', fmt(s.sessions), sourceLabel() + ' | período filtrado', 'teal', 'all') +
      (state.dwMode ? kpi('Flows', fmt(byFlow.length), 'Sem pessoa, telefone ou identificador sensível', 'teal', 'all') : kpi('Pessoas', fmt(s.people), 'Contatos anonimizados | sem telefone', 'teal', 'all')) +
      kpi('Entrega real obs.', realDeliveryLabel(s), 'Entregues ÷ enviadas | não entregues: ' + fmt(s.deploymentFailures || 0), s.deliveryAnalyticsAvailable ? 'warn' : 'bad') +
      kpi('Entrega', fmt(s.delivered), 'ClickHouse fact_deployment_status = ' + pct(s.deliveryRate), s.delivered ? 'warn' : 'warn', 'delivered') +
      (s.readMetricAvailable ? kpi('Lidas', fmt(s.read), 'Leitura ÷ entregues = ' + pct(s.readRate), s.read ? 'good' : 'warn', 'read') : kpi('Leitura', 'Indisponível', 'Não existe métrica confiável nesta fato', 'teal')) +
      kpi('Respondidas', fmt(s.replied), 'Resposta ÷ enviadas = ' + pct(s.responseRate), 'good', 'responded') +
      kpi(state.dwMode ? 'Não entregues' : 'Falhas deployment', fmt(s.deploymentFailures || 0), state.dwMode ? 'Tentativas sem evidência de entrega' : (s.deliveryAnalyticsAvailable ? 'Webhook interno capturado' : 'Analytics indisponível'), (s.deploymentFailures || 0) ? 'bad' : 'warn') +
      (state.dwMode ? '' : kpi('Lida sem resposta', fmt(s.readNoReply), 'Copy/CTA não converteu', s.readNoReply ? 'warn' : 'good', 'read_no_reply')) + '</div>';
    return story + kpis + '<div class="grid">' + funnel(s) + renderDeploymentReport(rows) + '<div class="card span-6"><div class="card-title"><div><h2>Flows | ranking de resposta</h2><div class="desc">Labels reais da Treble | clique para detalhes.</div></div></div>' + barRows(byFlow, 'flow', 12, 'sessions') + '</div><div class="card span-6"><div class="card-title"><div><h2>Famílias de abordagem</h2><div class="desc">Agrupamento inferido pelo nome do flow.</div></div></div>' + barRows(byFamily, 'family', 8, 'sessions') + '</div></div>';
  }

  function deploymentRowsFromEvents(events) {
    var map = {};
    events.forEach(function (m) {
      var key = (m.createdDay || day(m.createdAt)) + '|' + (m.flow || 'Flow sem nome');
      if (!map[key]) map[key] = { day: m.createdDay || String(m.createdAt || '').slice(0, 10), name: m.flow || 'Flow sem nome', conversationId: m.pollId || '', sent: 0, delivered: 0, deploymentFailures: 0, responded: 0, failureReasons: {} };
      var row = map[key];
      if (m.sent) row.sent++;
      if (m.delivered) row.delivered++; else {
        row.deploymentFailures++;
        var reason = m.nonDeliveryReason || 'UNKNOWN';
        row.failureReasons[reason] = (row.failureReasons[reason] || 0) + 1;
      }
      if (m.replied) row.responded++;
    });
    return Object.keys(map).map(function (key) { return map[key]; }).sort(function (a, b) { return String(b.day).localeCompare(String(a.day)) || b.sent - a.sent; });
  }

  function renderDeploymentReport(filteredRows) {
    var report = (state.raw && state.raw.deploymentReport) || {};
    var rows = state.dwMode ? deploymentRowsFromEvents(filteredRows || []) : (report.byConversationDay || []);
    if (!report.available || !rows.length) return '<div class="card span-12"><div class="card-title"><div><h2>Deployments HSM | relatório Treble</h2><div class="desc">Relatório por conversa/dia indisponível nesta fonte.</div></div></div></div>';
    var h = '<div class="card span-12"><div class="card-title"><div><h2>Deployments HSM | relatório Treble</h2><div class="desc">Tentativas, entregas, respostas e motivos de não entrega por flow/dia. Sem telefone ou payload bruto.</div></div></div><div class="table-wrap"><table><thead><tr><th>Dia</th><th>Flow</th><th>Enviados</th><th>Entregues</th><th>Não entregues</th><th>Respostas</th><th>Tx entrega real</th><th>Motivos</th></tr></thead><tbody>';
    rows.slice(0, 40).forEach(function (r) {
      var rate = r.sent ? r.delivered / r.sent : null;
      var reasons = Object.keys(r.failureReasons || {}).map(function (k) { return k + ': ' + r.failureReasons[k]; }).join(' | ');
      h += '<tr><td>' + esc(day(r.day)) + '</td><td>' + esc(r.name || ('Flow ' + r.conversationId)) + '<div class="muted">ID ' + esc(r.conversationId || '') + '</div></td><td>' + fmt(r.sent) + '</td><td>' + fmt(r.delivered) + '</td><td>' + fmt(r.deploymentFailures) + '</td><td>' + fmt(r.responded) + '</td><td>' + pct(rate) + '</td><td>' + esc(reasons || '—') + '</td></tr>';
    });
    return h + '</tbody></table></div></div>';
  }

  function renderBdrs(rows) {
    var byBdr = group(rows, 'bdr');
    var readAvailable = rows.some(function (r) { return r.readAvailable !== false; });
    var h = '<div class="grid"><div class="card span-12"><div class="card-title"><div><h2>BDRs | uso, entrega e resposta</h2><div class="desc">Entrega vem da fato de deployment quando ClickHouse está ativo; leitura só aparece se disponível.</div></div></div><div class="table-wrap"><table><thead><tr><th>BDR</th><th>' + esc(state.dwMode ? 'Tentativas' : 'Sessões') + '</th><th>' + esc(personLabel()) + '</th><th>Entregues</th><th>Tx entrega</th>' + (readAvailable ? '<th>Lidas</th>' : '') + '<th>Respondidas</th><th>Tx resposta</th><th>Gargalo principal</th><th>Público dominante</th></tr></thead><tbody>';
    byBdr.forEach(function (b) {
      var br = rows.filter(function (m) { return m.bdr === b.label; });
      h += '<tr class="clickable-row" data-drill-field="bdr" data-drill-value="' + esc(b.label) + '"><td><b>' + esc(b.label) + '</b></td><td>' + fmt(b.sessions) + '</td><td>' + fmt(state.dwMode ? (b.flowsCount || 0) : (b.peopleCount || 0)) + '</td><td>' + fmt(b.delivered) + '</td><td>' + pct(b.deliveryRate) + '</td>' + (readAvailable ? '<td>' + fmt(b.read) + '</td>' : '') + '<td>' + fmt(b.replied) + '</td><td>' + pct(b.responseRate) + '</td><td>' + esc(b.topReason.label) + '</td><td>' + esc(topFor(br, 'audience')) + '</td></tr>';
    });
    return h + '</tbody></table></div></div><div class="card span-12"><div class="card-title"><div><h2>Ranking visual por BDR</h2><div class="desc">Volume primeiro | taxa de resposta como qualidade.</div></div></div>' + barRows(byBdr, 'bdr', 20, 'sessions') + '</div></div>';
  }

  function renderTimeline(rows) {
    var byDay = group(rows, 'createdDay').filter(function (d) { return d.key && d.key !== 'Sem data'; }).sort(function (a, b) { return String(a.key).localeCompare(String(b.key)); });
    var failuresByDay = {};
    (((state.raw || {}).deliveryAnalytics || {}).byDay || []).forEach(function (d) { failuresByDay[d.day] = Number(d.deploymentFailures || 0); });
    (((state.raw || {}).deploymentReport || {}).byDay || []).forEach(function (d) { failuresByDay[d.day] = Number(d.deploymentFailures || 0); });
    byDay.forEach(function (d) { d.deploymentFailures = failuresByDay[d.key] || 0; });
    if (!byDay.length) return '<div class="card span-12"><div class="muted">Sem datas no filtro.</div></div>';
    var w = 980, h = 340, padL = 54, padR = 26, padT = 24, padB = 50;
    var readAvailable = rows.some(function (r) { return r.readAvailable !== false; });
    var max = Math.max.apply(null, byDay.map(function (d) { return Math.max(d.sent, d.delivered, readAvailable ? d.read : 0, d.replied, d.deploymentFailures || 0, d.sessions); }).concat([1]));
    var x = function (i) { return padL + (byDay.length === 1 ? 0 : i * (w - padL - padR) / (byDay.length - 1)); };
    var y = function (v) { return padT + (h - padT - padB) * (1 - (v / max)); };
    function points(metric) { return byDay.map(function (d, i) { return x(i).toFixed(1) + ',' + y(d[metric] || 0).toFixed(1); }).join(' '); }
    function line(metric, color, label) { return '<polyline fill="none" stroke="' + color + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="' + points(metric) + '"><title>' + esc(label) + '</title></polyline>'; }
    function dots(metric, color, label) { return byDay.map(function (d, i) { return '<circle class="clickable-row" data-drill-field="createdDay" data-drill-value="' + esc(d.key) + '" cx="' + x(i).toFixed(1) + '" cy="' + y(d[metric] || 0).toFixed(1) + '" r="4" fill="' + color + '"><title>' + esc(label + ' | ' + d.key + ': ' + fmt(d[metric] || 0)) + '</title></circle>'; }).join(''); }
    var grid = [0, .25, .5, .75, 1].map(function (p) { var yy = padT + (h - padT - padB) * p; var val = Math.round(max * (1 - p)); return '<line x1="' + padL + '" x2="' + (w - padR) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '" stroke="rgba(255,255,255,.10)"/><text x="8" y="' + (yy + 4).toFixed(1) + '" fill="currentColor" opacity=".65" font-size="12">' + fmt(val) + '</text>'; }).join('');
    var labels = byDay.map(function (d, i) { if (byDay.length > 18 && i % Math.ceil(byDay.length / 10) !== 0 && i !== byDay.length - 1) return ''; return '<text x="' + x(i).toFixed(1) + '" y="' + (h - 18) + '" fill="currentColor" opacity=".65" font-size="11" text-anchor="middle">' + esc(d.key.slice(5).split('-').reverse().join('/')) + '</text>'; }).join('');
    var readLine = readAvailable ? line('read', '#e3b341', 'Lidas') + dots('read', '#e3b341', 'Lidas') : '';
    var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" role="img" aria-label="Linha do tempo Treble por dia" style="overflow:visible">' + grid + labels + line('sent', '#3ab8b7', 'Enviadas') + line('delivered', '#3fb950', 'Entregues') + readLine + line('replied', '#f85149', 'Respondidas') + line('deploymentFailures', '#ff7b72', 'Falhas deployment') + dots('sent', '#3ab8b7', 'Enviadas') + dots('delivered', '#3fb950', 'Entregues') + dots('replied', '#f85149', 'Respondidas') + dots('deploymentFailures', '#ff7b72', 'Falhas deployment') + '</svg>';
    var legend = '<div class="story-grid"><div class="story-card"><b style="color:#3ab8b7">Enviadas</b><span>tentativas de deployment</span></div><div class="story-card"><b style="color:#3fb950">Entregues</b><span>fact_deployment_status</span></div>' + (readAvailable ? '<div class="story-card"><b style="color:#e3b341">Lidas</b><span>métrica disponível na fonte ativa</span></div>' : '<div class="story-card"><b>Leitura</b><span>indisponível nesta fato ClickHouse</span></div>') + '<div class="story-card"><b style="color:#f85149">Respondidas</b><span>timestamp_responded válido</span></div><div class="story-card"><b style="color:#ff7b72">Falhas deployment</b><span>status não entregue</span></div></div>';
    var note = state.dwMode ? '<section class="note"><b>Importante:</b> no modo ClickHouse, não entregues são tentativas sem timestamp/status de entrega. Leitura não está disponível nesta fato.</section>' : '<section class="note"><b>Importante:</b> linha verde continua sendo entrega em sessions; a linha vermelha traz falhas reais capturadas via <code>deployment.failure</code>. A taxa real observada cruza as duas fontes.</section>';
    return '<div class="grid"><div class="card span-12"><div class="card-title"><div><h2>Linha do tempo | gráfico de linha</h2><div class="desc">Tendência diária de enviadas, entregues, respondidas e falhas. Clique em um ponto para abrir o dia.</div></div></div>' + svg + legend + '</div><div class="card span-12"><div class="card-title"><div><h2>Resumo por dia</h2><div class="desc">Tabela compacta de apoio ao gráfico.</div></div></div><div class="table-wrap"><table><thead><tr><th>Dia</th><th>Enviadas</th><th>Entregues</th><th>Falhas deployment</th>' + (readAvailable ? '<th>Lidas</th>' : '') + '<th>Respondidas</th><th>Tx resposta</th></tr></thead><tbody>' + byDay.map(function (d) { return '<tr class="clickable-row" data-drill-field="createdDay" data-drill-value="' + esc(d.key) + '"><td>' + esc(day(d.key)) + '</td><td>' + fmt(d.sent) + '</td><td>' + fmt(d.delivered) + '</td><td>' + fmt(d.deploymentFailures || 0) + '</td>' + (readAvailable ? '<td>' + fmt(d.read) + '</td>' : '') + '<td>' + fmt(d.replied) + '</td><td>' + pct(d.responseRate) + '</td></tr>'; }).join('') + '</tbody></table></div></div></div>' + note;
  }

  function renderAudience(rows) {
    var byAudience = group(rows, 'audience');
    var bySemantic = group(rows, 'semanticGroup');
    var byPerson = group(rows, state.dwMode ? 'flow' : 'person');
    return '<div class="grid"><div class="card span-6"><div class="card-title"><div><h2>Público inferido</h2><div class="desc">Heurística por flow' + (state.dwMode ? '' : ' e copy') + ' | útil para segmentar abordagem.</div></div></div>' + barRows(byAudience, 'audience', 12, 'sessions') + '</div><div class="card span-6"><div class="card-title"><div><h2>Agrupamento semântico</h2><div class="desc">Família | público | motivo observado.</div></div></div>' + barRows(bySemantic, 'semanticGroup', 12, 'failures') + '</div><div class="card span-12"><div class="card-title"><div><h2>' + esc(state.dwMode ? 'Flows' : 'Pessoas anonimizadas') + '</h2><div class="desc">' + esc(state.dwMode ? 'Sem pessoa ou identificador sensível no payload.' : 'Não expõe telefone | identifica recorrência por contato no recorte.') + '</div></div></div>' + barRows(byPerson, state.dwMode ? 'flow' : 'person', 30, 'sessions') + '</div></div>';
  }

  function renderApiMap() {
    var meta = state.raw && state.raw.meta ? state.raw.meta : {};
    var map = state.raw && state.raw.apiMap ? state.raw.apiMap : [];
    var h = '<div class="grid"><div class="card span-12"><div class="card-title"><div><h2>Arquitetura API | chamadas e retornos</h2><div class="desc">Mapa operacional do que o dashboard puxa da Treble em modo read-only.</div></div></div><div class="table-wrap"><table><thead><tr><th>#</th><th>Método</th><th>Endpoint</th><th>Para quê</th><th>Retorno usado</th><th>Uso no painel</th></tr></thead><tbody>';
    map.forEach(function (m) { h += '<tr><td>' + esc(m.step) + '</td><td>' + esc(m.method) + '</td><td><code>' + esc(m.endpoint) + '</code></td><td>' + esc(m.purpose) + '</td><td>' + esc(m.returns) + '</td><td>' + esc(m.usedFor) + '</td></tr>'; });
    h += '</tbody></table></div></div><div class="card span-6"><div class="card-title"><div><h2>Cobertura desta consulta</h2><div class="desc">Quanto foi escaneado no Vercel.</div></div></div>';
    if (state.dwMode) h += '<p>Fonte: <b>' + esc(meta.sourceLabel || meta.source || 'ClickHouse') + '</b></p><p>Período: <b>' + fmt(meta.periodDays || state.filters.days) + ' dias</b></p><p>Linhas retornadas: <b>' + fmt(meta.rowsReturned || 0) + '</b></p><p>Limite: <b>' + fmt(meta.rowLimit || 10000) + '</b></p><p>Truncado: <b>' + esc(meta.rowsTruncated ? 'sim' : 'não') + '</b></p>';
    else h += '<p>Flows escaneados: <b>' + fmt(meta.flowsScanned) + '</b></p><p>Sessões encontradas: <b>' + fmt(meta.sessionsFound) + '</b></p><p>Sessões analisadas: <b>' + fmt(meta.sessionsAnalyzed) + '</b></p><p>Páginas por flow: <b>' + fmt(meta.sessionPagesPerFlow) + '</b></p><p>Limite de histories: <b>' + fmt(meta.maxHistories) + '</b></p>';
    h += '</div><div class="card span-6"><div class="card-title"><div><h2>Limites transparentes</h2><div class="desc">O que ainda não é bruto da Meta.</div></div></div>' + (meta.limitations || []).map(function (x) { return '<p class="muted">' + esc(x) + '</p>'; }).join('') + '</div></div>';
    return h;
  }

  function renderReasons(rows) {
    var byFlow = group(rows, 'flow').sort(function (a, b) { return b.failures - a.failures || b.sessions - a.sessions; });
    return reasonCards(rows) + '<div class="grid"><div class="card span-12"><div class="card-title"><div><h2>Mapa de gargalos por flow</h2><div class="desc">Mostra o motivo principal em linguagem operacional.</div></div></div>' + barRows(byFlow, 'flow', 20, 'failures') + '</div></div>' + renderTable(rows.slice(0, 80), true);
  }

  function renderTable(rows, compact) {
    var h;
    if (state.dwMode) {
      h = '<div class="card span-12"><div class="card-title"><div><h2>Detalhe operacional | deployments</h2><div class="desc">Uma linha por tentativa real | sem telefone, conteúdo ou identificador sensível.</div></div></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>BDR inferido</th><th>Público</th><th>Flow</th><th>Família</th><th>Resultado</th><th>Ação sugerida</th></tr></thead><tbody>';
    } else {
      h = '<div class="card span-12"><div class="card-title"><div><h2>Detalhe operacional | sessões e copy</h2><div class="desc">Sem telefone, email, documento, session_id ou payload bruto | inbound ocultado.</div></div></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Pessoa</th><th>BDR inferido</th><th>Público</th><th>Flow</th><th>Família</th><th>Motivo</th><th>Copy outbound redigida</th><th>Ação sugerida</th></tr></thead><tbody>';
    }
    rows.slice(0, compact ? 80 : 300).forEach(function (m) {
      if (state.dwMode) h += '<tr><td class="nowrap">' + day(m.createdAt) + '</td><td>' + esc(m.bdr) + '<div class="muted">' + esc(m.bdrSource) + '</div></td><td>' + esc(m.audience || '—') + '</td><td>' + esc(m.flow) + '</td><td>' + esc(m.family) + '</td><td><span class="pill ' + severityClass(m.severity) + '">' + esc(m.reasonLabel) + '</span><div class="muted">' + esc(m.nonDeliveryReason || '') + '</div></td><td>' + esc(m.action || '—') + '</td></tr>';
      else h += '<tr><td class="nowrap">' + day(m.createdAt) + '</td><td>' + esc(m.person || '—') + '</td><td>' + esc(m.bdr) + '<div class="muted">' + esc(m.bdrSource) + '</div></td><td>' + esc(m.audience || '—') + '</td><td>' + esc(m.flow) + '</td><td>' + esc(m.family) + '</td><td><span class="pill ' + severityClass(m.severity) + '">' + esc(m.reasonLabel) + '</span><div class="muted">' + esc(m.nonDeliveryReason || '') + '</div></td><td>' + esc(m.copy || '—') + '</td><td>' + esc(m.action || '—') + '</td></tr>';
    });
    return h + '</tbody></table></div></div>';
  }

  function render() {
    renderFilters();
    var rows = filtered();
    var realRows = actualRows(rows);
    var content = $('content'), stateEl = $('state');
    if (!rows.length) { setState('empty', 'Sem dados no filtro', 'Ajuste período ou filtros.'); return; }
    var s = summarize(realRows);
    var serverSummary = (state.raw && state.raw.summary) || {};
    s.deploymentFailures = state.dwMode ? s.failures : Number(serverSummary.deploymentFailures || 0);
    s.realObservedAttempts = state.dwMode ? s.sent : Number(serverSummary.realObservedAttempts || 0);
    s.realObservedDeliveryRate = state.dwMode ? (s.sent ? s.delivered / s.sent : null) : (serverSummary.realObservedDeliveryRate == null ? null : Number(serverSummary.realObservedDeliveryRate));
    s.deliveryAnalyticsAvailable = state.dwMode ? true : !!serverSummary.deliveryAnalyticsAvailable;
    s.deliveryAnalyticsStatus = serverSummary.deliveryAnalyticsStatus || 'unavailable';
    var meta = state.raw && state.raw.meta ? state.raw.meta : {};
    var warn = meta.sessionsTruncated ? ' | amostra truncada: aumente com cuidado ou reduza o período' : '';
    var flags = state.dwMode
      ? '<div class="note"><b>Fonte:</b> ' + esc(meta.source || 'Treble Data Warehouse') + ' | tentativas analisadas ' + esc(realRows.length) + ' | período ' + esc(meta.periodDays || state.filters.days) + ' dias' + warn + '. <b>Labels:</b> BDR, público e família são inferidos do nome do flow.</div>'
      : '<div class="note"><b>Fonte:</b> ' + esc(meta.source || 'Treble API') + ' | sessões analisadas ' + esc(meta.sessionsAnalyzed || realRows.length) + ' de ' + esc(meta.sessionsFound || realRows.length) + ' | linhas diagnósticas ' + esc(meta.diagnosticRows || 0) + warn + '. <b>Labels:</b> BDR, público e família são inferidos do nome do flow/copy.</div>';
    var tabs = '<div class="tabs"><button class="tab ' + (state.tab === 'overview' ? 'active' : '') + '" onclick="BdrTreble.tab(\'overview\')">Visão executiva</button><button class="tab ' + (state.tab === 'bdrs' ? 'active' : '') + '" onclick="BdrTreble.tab(\'bdrs\')">Por BDR</button><button class="tab ' + (state.tab === 'timeline' ? 'active' : '') + '" onclick="BdrTreble.tab(\'timeline\')">Linha do tempo</button><button class="tab ' + (state.tab === 'audience' ? 'active' : '') + '" onclick="BdrTreble.tab(\'audience\')">' + esc(state.dwMode ? 'Público e flows' : 'Público e pessoas') + '</button><button class="tab ' + (state.tab === 'reasons' ? 'active' : '') + '" onclick="BdrTreble.tab(\'reasons\')">Falhas e motivos</button><button class="tab ' + (state.tab === 'detail' ? 'active' : '') + '" onclick="BdrTreble.tab(\'detail\')">' + esc(state.dwMode ? 'Detalhe dos envios' : 'Mensagem real') + '</button><button class="tab ' + (state.tab === 'api' ? 'active' : '') + '" onclick="BdrTreble.tab(\'api\')">Arquitetura API</button></div>';
    var body;
    if (state.tab === 'bdrs') body = renderBdrs(realRows);
    else if (state.tab === 'timeline') body = renderTimeline(realRows);
    else if (state.tab === 'audience') body = renderAudience(realRows);
    else if (state.tab === 'reasons') body = renderReasons(rows);
    else if (state.tab === 'detail') body = renderTable(rows, false);
    else if (state.tab === 'api') body = renderApiMap();
    else body = renderOverview(realRows, s);
    if (stateEl) stateEl.classList.add('hidden');
    content.classList.remove('hidden');
    content.innerHTML = flags + tabs + body;
    bindDrills(content);
  }

  function bindDrills(root) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-drill-kind]'), function (el) { el.addEventListener('click', function () { api.drill(el.getAttribute('data-drill-kind')); }); });
    Array.prototype.forEach.call(root.querySelectorAll('[data-drill-field]'), function (el) { el.addEventListener('click', function () { api.drillGroup(el.getAttribute('data-drill-field'), el.getAttribute('data-drill-value')); }); });
  }

  function modal(title, rows) { $('modal-title').textContent = title; $('modal-body').innerHTML = renderTable(rows, false); $('modal-overlay').classList.add('open'); }

  var api = {
    load: function (refresh) {
      setState('loading', 'Carregando Treble', 'Buscando dados do Treble Data Warehouse');
      // Try Data Warehouse endpoint first (faster, 1 query vs 100+ API calls)
      var dwUrl = '/api/bdr-treble-dw?days=' + encodeURIComponent(state.filters.days || '30') + (refresh ? '&refresh=true' : '');
      var fallbackUrl = '/api/bdr-treble?days=' + encodeURIComponent(state.filters.days || '90') + (refresh ? '&refresh=true' : '');
      
      fetch(dwUrl, { credentials: 'include' }).then(function (r) {
        if (!r.ok) {
          // Fallback to original API if DW fails
          console.log('[bdr-treble] DW endpoint failed, falling back to API REST');
          return fetch(fallbackUrl, { credentials: 'include' }).then(function (r2) {
            if (!r2.ok) throw new Error(r2.status === 401 ? 'Não autorizado. Faça login novamente.' : 'Erro HTTP ' + r2.status);
            return r2.json();
          });
        }
        return r.json();
      })
      .then(function (json) {
        if (!json.success && json.error === 'data_warehouse_error') {
          // DW error, try fallback
          console.log('[bdr-treble] DW error, falling back to API REST');
          return fetch(fallbackUrl, { credentials: 'include' }).then(function (r) {
            if (!r.ok) throw new Error(r.status === 401 ? 'Não autorizado. Faça login novamente.' : 'Erro HTTP ' + r.status);
            return r.json();
          });
        }
        if (!json.success) throw new Error(json.error || json.message || 'Resposta inválida');
        return json;
      })
      .then(function (json) {
        state.raw = json;
        if (json.source === 'treble_data_warehouse') {
          state.rows = json.messages || [];
          state.dwMode = true;
        } else {
          state.rows = json.messages || [];
          state.dwMode = false;
        }
        render();
      })
      .catch(function (e) { setState('error', 'Erro ao carregar Treble', e.message || 'Falha desconhecida.'); });
    },
    tab: function (name) { state.tab = name; render(); },
    toggleTheme: function () { var html = document.documentElement; var light = html.getAttribute('data-theme') === 'light'; html.setAttribute('data-theme', light ? 'dark' : 'light'); try { localStorage.setItem('axenya_theme', light ? 'dark' : 'light'); } catch (e) {} },
    drill: function (kind) {
      var rows = filtered();
      if (kind === 'delivered') rows = rows.filter(function (m) { return m.delivered; });
      else if (kind === 'read') rows = rows.filter(function (m) { return m.read; });
      else if (kind === 'responded') rows = rows.filter(function (m) { return m.replied; });
      else if (kind !== 'all') rows = rows.filter(function (m) { return m.reason === kind; });
      modal((state.dwMode ? 'Tentativas' : 'Sessões') + ' | ' + kind + ' | ' + fmt(rows.length), rows);
    },
    drillGroup: function (field, value) {
      var map = { flow: 'flow', bdr: 'bdr', family: 'family', audience: 'audience', semanticGroup: 'semanticGroup', person: 'person', reasonLabel: 'reasonLabel', createdDay: 'createdDay' };
      var f = map[field] || field;
      var rows = filtered().filter(function (m) { return String(m[f] || '') === String(value || ''); });
      modal(field + ' | ' + value + ' | ' + fmt(rows.length), rows);
    },
    closeModal: function () { $('modal-overlay').classList.remove('open'); },
    openHelp: function () {
      $('help-body').innerHTML = state.dwMode
        ? '<div class="help-block"><b>Fonte</b><p>Fonte primária: ClickHouse Treble, tabela fact_deployment_status.</p></div><div class="help-block"><b>Entrega</b><p>Taxa = tentativas com timestamp de entrega ou status DELIVERED ÷ total de tentativas. Uma resposta válida também implica entrega para manter o funil consistente.</p></div><div class="help-block"><b>Leitura</b><p>Não existe sinal confiável de leitura nesta tabela; por isso o painel mostra a métrica como indisponível.</p></div><div class="help-block"><b>Resposta</b><p>Resposta = timestamp_responded válido. A taxa é respondidas ÷ enviadas.</p></div><div class="help-block"><b>Privacidade</b><p>Sem telefone, conteúdo, documento ou identificador sensível no payload.</p></div>'
        : '<div class="help-block"><b>Fonte</b><p>Fallback: API Treble polls, sessions e history + analytics interno de deployment.failure.</p></div><div class="help-block"><b>Entrega real observada</b><p>Taxa = entregues em sessions ÷ (enviadas em sessions + falhas deployment capturadas).</p></div><div class="help-block"><b>Timeline</b><p>A aba Linha do tempo usa enviadas, entregues, lidas, respondidas e falhas deployment.</p></div><div class="help-block"><b>Privacidade</b><p>Sem telefone, email, documento, session_id ou payload bruto.</p></div>';
      $('help-backdrop').classList.add('open'); $('help-drawer').classList.add('open');
    },
    closeHelp: function () { $('help-backdrop').classList.remove('open'); $('help-drawer').classList.remove('open'); }
  };

  window.BdrTreble = api;
  window.addEventListener('DOMContentLoaded', function () { api.load(false); });
})();
