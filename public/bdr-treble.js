(function () {
  'use strict';

  var state = { raw: null, rows: [], filters: loadFilters(), tab: 'overview' };

  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { return Number(n || 0).toLocaleString('pt-BR'); }
  function pct(v) { return v == null ? 'Não medido' : (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'; }
  function realDeliveryLabel(s) {
    if (!s.deliveryAnalyticsAvailable) return 'Analytics off';
    if (!s.deploymentFailures) return 'Em coleta';
    return pct(s.realObservedDeliveryRate);
  }
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
    var periods = [['30', '30d'], ['90', '90d'], ['180', '180d'], ['365', '365d']];
    var h = '<div class="periodbar"><span class="period-label">Período</span>';
    periods.forEach(function (p) { h += '<button class="period-chip' + (state.filters.days === p[0] ? ' active' : '') + '" data-days="' + p[0] + '">' + p[1] + '</button>'; });
    h += '<span class="muted">Fonte primária Treble API | cache 10 min</span></div>';
    h += '<div class="filter"><label>BDR inferido</label><select id="f-bdr">' + opts(unique(state.rows, 'bdr'), state.filters.bdr, 'Todos') + '</select></div>';
    h += '<div class="filter"><label>Flow Treble</label><select id="f-flow">' + opts(unique(state.rows, 'flow'), state.filters.flow, 'Todos') + '</select></div>';
    h += '<div class="filter"><label>Família de copy</label><select id="f-family">' + opts(unique(state.rows, 'family'), state.filters.family, 'Todas') + '</select></div>';
    h += '<div class="filter"><label>Público inferido</label><select id="f-audience">' + opts(unique(state.rows, 'audience'), state.filters.audience, 'Todos') + '</select></div>';
    h += '<div class="filter"><label>Motivo observado</label><select id="f-reason">' + opts(unique(state.rows, 'reasonLabel'), state.filters.reason, 'Todos') + '</select></div>';
    h += '<div class="filter"><label>Busca</label><input id="f-q" value="' + esc(state.filters.q) + '" placeholder="flow, BDR, motivo ou copy"></div>';
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
      if (r.read) s.read++;
      if (r.replied) s.replied++;
      if (r.reason !== 'responded') s.failures++;
      if (r.reason === 'not_delivered') s.notDelivered++;
      if (r.reason === 'delivered_not_read') s.deliveredNotRead++;
      if (r.reason === 'read_no_reply') s.readNoReply++;
      if (r.reason === 'no_history') s.noHistory++;
    });
    s.deliveryRate = s.sent ? s.delivered / s.sent : null;
    s.readRate = s.delivered ? s.read / s.delivered : null;
    s.responseRate = s.sent ? s.replied / s.sent : null;
    s.failureRate = s.sessions ? s.failures / s.sessions : null;
    s.people = Object.keys(people).length;
    return s;
  }

  function group(rows, field) {
    var map = {};
    rows.forEach(function (r) {
      var k = r[field] || 'Sem dado';
      if (!map[k]) map[k] = { key: k, label: k, sessions: 0, sent: 0, delivered: 0, read: 0, replied: 0, failures: 0, reasons: {}, samples: [], people: {} };
      var a = map[k];
      a.sessions++;
      if (r.sent) a.sent++;
      if (r.delivered) a.delivered++;
      if (r.read) a.read++;
      if (r.replied) a.replied++;
      if (r.reason !== 'responded') a.failures++;
      a.reasons[r.reasonLabel] = (a.reasons[r.reasonLabel] || 0) + 1;
      if (r.person) a.people[r.person] = true;
      if (a.samples.length < 2 && r.copy) a.samples.push(r.copy);
    });
    return Object.keys(map).map(function (k) {
      var a = map[k];
      var top = Object.keys(a.reasons).map(function (x) { return { label: x, count: a.reasons[x] }; }).sort(function (x, y) { return y.count - x.count; })[0] || { label: 'Sem dado', count: 0 };
      a.deliveryRate = a.sent ? a.delivered / a.sent : null;
      a.readRate = a.delivered ? a.read / a.delivered : null;
      a.responseRate = a.sent ? a.replied / a.sent : null;
      a.failureRate = a.sessions ? a.failures / a.sessions : null;
      a.peopleCount = Object.keys(a.people).length;
      a.topReason = top;
      return a;
    }).sort(function (a, b) { return b.sessions - a.sessions || a.label.localeCompare(b.label); });
  }

  function kpi(label, value, sub, kind, drill) {
    return '<div class="kpi ' + (kind || '') + (drill ? ' clickable" data-drill-kind="' + esc(drill) + '"' : '"') + '><div class="label">' + esc(label) + '</div><div class="value">' + esc(value) + '</div><div class="sub">' + esc(sub) + '</div></div>';
  }

  function funnel(s) {
    var steps = [
      ['Sessões', s.sessions, 'Universo analisado'],
      ['Enviadas', s.sent, 'HSM ou mensagem de saída'],
      ['Entregues (sessões)', s.delivered, pct(s.deliveryRate) + ' | só sessions/history'],
      ['Lidas', s.read, pct(s.readRate)],
      ['Respondidas', s.replied, pct(s.responseRate)]
    ];
    var max = Math.max(s.sessions, 1);
    return '<div class="card span-12"><div class="card-title"><div><h2>Funil Treble | sessions materializadas</h2><div class="desc">Entrega aqui significa delivered_at dentro de history. Falhas de deployment ficam fora deste denominador até ingerirmos deployment.failure.</div></div></div>' + steps.map(function (x) {
      return '<div class="bar-row"><div class="bar-name">' + esc(x[0]) + '<div class="muted">' + esc(x[2]) + '</div></div><div class="bar-track"><div class="bar-fill" style="width:' + Math.max(2, Math.round(x[1] / max * 100)) + '%"></div></div><div class="bar-val">' + fmt(x[1]) + '</div></div>';
    }).join('') + '</div>';
  }

  function reasonCards(rows) {
    var reasons = group(rows, 'reasonLabel');
    return '<div class="grid">' + reasons.slice(0, 6).map(function (r) {
      var sample = r.samples[0] || 'Sem exemplo de copy outbound';
      return '<div class="card span-4 clickable-row" data-drill-field="reasonLabel" data-drill-value="' + esc(r.label) + '"><div class="card-title"><div><h2>' + esc(r.label) + '</h2><div class="desc">' + fmt(r.sessions) + ' sessões | ' + pct(r.failureRate) + ' do filtro</div></div></div><p class="muted">Ação: ' + esc(actionForReason(r.label)) + '</p><p style="margin-top:.75rem">' + esc(sample) + '</p></div>';
    }).join('') + '</div>';
  }

  function actionForReason(label) {
    if (/Sem evidência de entrega/.test(label)) return 'Verificar HSM, linha, opt-in e qualidade da base';
    if (/Entregue, não lida/.test(label)) return 'Testar horário, primeira linha e remetente';
    if (/Lida, sem resposta/.test(label)) return 'Reduzir fricção do CTA e testar pergunta mais direta';
    if (/Sem resposta/.test(label)) return 'Criar follow-up específico por persona';
    if (/Respondeu/.test(label)) return 'Replicar copy e cadência vencedora';
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
      return '<div class="bar-row clickable-row" data-drill-field="' + esc(field) + '" data-drill-value="' + esc(r.label) + '"><div class="bar-name">' + esc(r.label) + '<div class="muted">Pessoas ' + fmt(r.peopleCount || 0) + ' | Entrega sessions ' + pct(r.deliveryRate) + ' | Resp. ' + pct(r.responseRate) + ' | gargalo: ' + esc(r.topReason.label) + '</div></div><div class="bar-track"><div class="bar-fill ' + (r.failures ? 'bad' : '') + '" style="width:' + Math.max(2, Math.round(val / max * 100)) + '%"></div></div><div class="bar-val">' + fmt(val) + '</div><div class="bar-val">' + fmt(r.replied) + ' resp.</div></div>';
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
      '<div class="story-card"><b>O que aconteceu</b><span>' + fmt(s.sessions) + ' sessões analisadas | ' + fmt(s.sent) + ' com envio | ' + fmt(s.replied) + ' com resposta.</span></div>' +
      '<div class="story-card"><b>Entrega real observada</b><span>' + fmt(s.deploymentFailures || 0) + ' falhas deployment capturadas | taxa ' + esc(realDeliveryLabel(s)) + '.</span></div>' +
      '<div class="story-card"><b>Quem mais usou</b><span>' + (topBdr ? esc(topBdr.label) + ' | ' + fmt(topBdr.sessions) + ' sessões | resposta ' + pct(topBdr.responseRate) + '.' : 'Ainda sem volume por BDR.') + '</span></div>' +
      '<div class="story-card"><b>Próxima ação</b><span>' + (worst ? 'Atacar gargalo de ' + esc(worst.label) + ': ' + esc(worst.topReason.label) + '.' : 'Padronizar nomenclatura dos flows e rodar mais volume.') + '</span></div></div>';
    var kpis = '<div class="kpis">' +
      kpi('Sessões', fmt(s.sessions), 'Treble API | período filtrado', 'teal', 'all') +
      kpi('Pessoas', fmt(s.people), 'Contatos anonimizados | sem telefone', 'teal', 'all') +
      kpi('Entrega real obs.', realDeliveryLabel(s), s.deploymentFailures ? 'Entregues ÷ (enviadas + failures)' : 'Aguardando failure webhook real', s.deliveryAnalyticsAvailable ? 'warn' : 'bad') +
      kpi('Entrega (sessions)', fmt(s.delivered), 'Somente sessions/history = ' + pct(s.deliveryRate), s.delivered ? 'warn' : 'warn', 'delivered') +
      kpi('Lidas', fmt(s.read), 'Leitura ÷ entregues = ' + pct(s.readRate), s.read ? 'good' : 'warn', 'read') +
      kpi('Respondidas', fmt(s.replied), 'Resposta ÷ enviadas = ' + pct(s.responseRate), 'good', 'responded') +
      kpi('Falhas deployment', fmt(s.deploymentFailures || 0), s.deliveryAnalyticsAvailable ? 'Webhook interno capturado' : 'Analytics indisponível', (s.deploymentFailures || 0) ? 'bad' : 'warn') +
      kpi('Lida sem resposta', fmt(s.readNoReply), 'Copy/CTA não converteu', s.readNoReply ? 'warn' : 'good', 'read_no_reply') + '</div>';
    return story + kpis + '<div class="grid">' + funnel(s) + '<div class="card span-6"><div class="card-title"><div><h2>Flows | ranking de resposta</h2><div class="desc">Labels reais da Treble | clique para detalhes.</div></div></div>' + barRows(byFlow, 'flow', 12, 'sessions') + '</div><div class="card span-6"><div class="card-title"><div><h2>Famílias de copy</h2><div class="desc">Agrupamento por nome do flow | ajuda a decidir próxima abordagem.</div></div></div>' + barRows(byFamily, 'family', 8, 'sessions') + '</div></div>';
  }

  function renderBdrs(rows) {
    var byBdr = group(rows, 'bdr');
    var h = '<div class="grid"><div class="card span-12"><div class="card-title"><div><h2>BDRs | uso, entrega em sessions e resposta</h2><div class="desc">Entrega aqui é scoped a sessions/history; não é delivery real de deployment.</div></div></div><div class="table-wrap"><table><thead><tr><th>BDR</th><th>Sessões</th><th>Pessoas</th><th>Entregues</th><th>Tx entrega sessions</th><th>Lidas</th><th>Respondidas</th><th>Tx resposta</th><th>Gargalo principal</th><th>Público dominante</th></tr></thead><tbody>';
    byBdr.forEach(function (b) {
      var br = rows.filter(function (m) { return m.bdr === b.label; });
      h += '<tr class="clickable-row" data-drill-field="bdr" data-drill-value="' + esc(b.label) + '"><td><b>' + esc(b.label) + '</b></td><td>' + fmt(b.sessions) + '</td><td>' + fmt(b.peopleCount || 0) + '</td><td>' + fmt(b.delivered) + '</td><td>' + pct(b.deliveryRate) + '</td><td>' + fmt(b.read) + '</td><td>' + fmt(b.replied) + '</td><td>' + pct(b.responseRate) + '</td><td>' + esc(b.topReason.label) + '</td><td>' + esc(topFor(br, 'audience')) + '</td></tr>';
    });
    return h + '</tbody></table></div></div><div class="card span-12"><div class="card-title"><div><h2>Ranking visual por BDR</h2><div class="desc">Volume primeiro | taxa de resposta como qualidade.</div></div></div>' + barRows(byBdr, 'bdr', 20, 'sessions') + '</div></div>';
  }

  function renderTimeline(rows) {
    var byDay = group(rows, 'createdDay').filter(function (d) { return d.key && d.key !== 'Sem data'; }).sort(function (a, b) { return String(a.key).localeCompare(String(b.key)); });
    var failuresByDay = {};
    (((state.raw || {}).deliveryAnalytics || {}).byDay || []).forEach(function (d) { failuresByDay[d.day] = Number(d.deploymentFailures || 0); });
    byDay.forEach(function (d) { d.deploymentFailures = failuresByDay[d.key] || 0; });
    if (!byDay.length) return '<div class="card span-12"><div class="muted">Sem datas no filtro.</div></div>';
    var w = 980, h = 340, padL = 54, padR = 26, padT = 24, padB = 50;
    var max = Math.max.apply(null, byDay.map(function (d) { return Math.max(d.sent, d.delivered, d.read, d.replied, d.deploymentFailures || 0, d.sessions); }).concat([1]));
    var x = function (i) { return padL + (byDay.length === 1 ? 0 : i * (w - padL - padR) / (byDay.length - 1)); };
    var y = function (v) { return padT + (h - padT - padB) * (1 - (v / max)); };
    function points(metric) { return byDay.map(function (d, i) { return x(i).toFixed(1) + ',' + y(d[metric] || 0).toFixed(1); }).join(' '); }
    function line(metric, color, label) { return '<polyline fill="none" stroke="' + color + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="' + points(metric) + '"><title>' + esc(label) + '</title></polyline>'; }
    function dots(metric, color, label) { return byDay.map(function (d, i) { return '<circle class="clickable-row" data-drill-field="createdDay" data-drill-value="' + esc(d.key) + '" cx="' + x(i).toFixed(1) + '" cy="' + y(d[metric] || 0).toFixed(1) + '" r="4" fill="' + color + '"><title>' + esc(label + ' | ' + d.key + ': ' + fmt(d[metric] || 0)) + '</title></circle>'; }).join(''); }
    var grid = [0, .25, .5, .75, 1].map(function (p) { var yy = padT + (h - padT - padB) * p; var val = Math.round(max * (1 - p)); return '<line x1="' + padL + '" x2="' + (w - padR) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '" stroke="rgba(255,255,255,.10)"/><text x="8" y="' + (yy + 4).toFixed(1) + '" fill="currentColor" opacity=".65" font-size="12">' + fmt(val) + '</text>'; }).join('');
    var labels = byDay.map(function (d, i) { if (byDay.length > 18 && i % Math.ceil(byDay.length / 10) !== 0 && i !== byDay.length - 1) return ''; return '<text x="' + x(i).toFixed(1) + '" y="' + (h - 18) + '" fill="currentColor" opacity=".65" font-size="11" text-anchor="middle">' + esc(d.key.slice(5).split('-').reverse().join('/')) + '</text>'; }).join('');
    var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" role="img" aria-label="Linha do tempo Treble por dia" style="overflow:visible">' + grid + labels + line('sent', '#3ab8b7', 'Enviadas') + line('delivered', '#3fb950', 'Entregues em sessions') + line('read', '#e3b341', 'Lidas') + line('replied', '#f85149', 'Respondidas') + line('deploymentFailures', '#ff7b72', 'Falhas deployment') + dots('sent', '#3ab8b7', 'Enviadas') + dots('delivered', '#3fb950', 'Entregues em sessions') + dots('read', '#e3b341', 'Lidas') + dots('replied', '#f85149', 'Respondidas') + dots('deploymentFailures', '#ff7b72', 'Falhas deployment') + '</svg>';
    var legend = '<div class="story-grid"><div class="story-card"><b style="color:#3ab8b7">Enviadas</b><span>mensagens de saída em sessions</span></div><div class="story-card"><b style="color:#3fb950">Entregues em sessions</b><span>delivered_at dentro de history</span></div><div class="story-card"><b style="color:#e3b341">Lidas</b><span>read_at dentro de history</span></div><div class="story-card"><b style="color:#f85149">Respondidas</b><span>mensagem USER na sessão</span></div><div class="story-card"><b style="color:#ff7b72">Falhas deployment</b><span>webhook deployment.failure</span></div></div>';
    var note = '<section class="note"><b>Importante:</b> linha verde continua sendo entrega em sessions; a linha vermelha traz falhas reais capturadas via <code>deployment.failure</code>. A taxa real observada cruza as duas fontes.</section>';
    return '<div class="grid"><div class="card span-12"><div class="card-title"><div><h2>Linha do tempo | gráfico de linha</h2><div class="desc">Tendência diária de enviadas, entregues em sessions, lidas, respondidas e falhas reais capturadas. Clique em um ponto para abrir o dia.</div></div></div>' + svg + legend + '</div><div class="card span-12"><div class="card-title"><div><h2>Resumo por dia</h2><div class="desc">Tabela compacta de apoio ao gráfico.</div></div></div><div class="table-wrap"><table><thead><tr><th>Dia</th><th>Enviadas</th><th>Entregues sessions</th><th>Falhas deployment</th><th>Lidas</th><th>Respondidas</th><th>Tx resposta</th></tr></thead><tbody>' + byDay.map(function (d) { return '<tr class="clickable-row" data-drill-field="createdDay" data-drill-value="' + esc(d.key) + '"><td>' + esc(day(d.key)) + '</td><td>' + fmt(d.sent) + '</td><td>' + fmt(d.delivered) + '</td><td>' + fmt(d.deploymentFailures || 0) + '</td><td>' + fmt(d.read) + '</td><td>' + fmt(d.replied) + '</td><td>' + pct(d.responseRate) + '</td></tr>'; }).join('') + '</tbody></table></div></div></div>' + note;
  }

  function renderAudience(rows) {
    var byAudience = group(rows, 'audience');
    var bySemantic = group(rows, 'semanticGroup');
    var byPerson = group(rows, 'person');
    return '<div class="grid"><div class="card span-6"><div class="card-title"><div><h2>Público inferido</h2><div class="desc">Heurística por flow e copy | útil para segmentar abordagem.</div></div></div>' + barRows(byAudience, 'audience', 12, 'sessions') + '</div><div class="card span-6"><div class="card-title"><div><h2>Agrupamento semântico</h2><div class="desc">Família | público | motivo observado.</div></div></div>' + barRows(bySemantic, 'semanticGroup', 12, 'failures') + '</div><div class="card span-12"><div class="card-title"><div><h2>Pessoas anonimizadas</h2><div class="desc">Não expõe telefone | identifica recorrência por contato no recorte.</div></div></div>' + barRows(byPerson, 'person', 30, 'sessions') + '</div></div>';
  }

  function renderApiMap() {
    var meta = state.raw && state.raw.meta ? state.raw.meta : {};
    var map = state.raw && state.raw.apiMap ? state.raw.apiMap : [];
    var h = '<div class="grid"><div class="card span-12"><div class="card-title"><div><h2>Arquitetura API | chamadas e retornos</h2><div class="desc">Mapa operacional do que o dashboard puxa da Treble em modo read-only.</div></div></div><div class="table-wrap"><table><thead><tr><th>#</th><th>Método</th><th>Endpoint</th><th>Para quê</th><th>Retorno usado</th><th>Uso no painel</th></tr></thead><tbody>';
    map.forEach(function (m) { h += '<tr><td>' + esc(m.step) + '</td><td>' + esc(m.method) + '</td><td><code>' + esc(m.endpoint) + '</code></td><td>' + esc(m.purpose) + '</td><td>' + esc(m.returns) + '</td><td>' + esc(m.usedFor) + '</td></tr>'; });
    h += '</tbody></table></div></div><div class="card span-6"><div class="card-title"><div><h2>Cobertura desta consulta</h2><div class="desc">Quanto foi escaneado no Vercel.</div></div></div><p>Flows escaneados: <b>' + fmt(meta.flowsScanned) + '</b></p><p>Sessões encontradas: <b>' + fmt(meta.sessionsFound) + '</b></p><p>Sessões analisadas: <b>' + fmt(meta.sessionsAnalyzed) + '</b></p><p>Páginas por flow: <b>' + fmt(meta.sessionPagesPerFlow) + '</b></p><p>Limite de histories: <b>' + fmt(meta.maxHistories) + '</b></p></div><div class="card span-6"><div class="card-title"><div><h2>Limites transparentes</h2><div class="desc">O que ainda não é bruto da Meta.</div></div></div>' + (meta.limitations || []).map(function (x) { return '<p class="muted">' + esc(x) + '</p>'; }).join('') + '</div></div>';
    return h;
  }

  function renderReasons(rows) {
    var byFlow = group(rows, 'flow').sort(function (a, b) { return b.failures - a.failures || b.sessions - a.sessions; });
    return reasonCards(rows) + '<div class="grid"><div class="card span-12"><div class="card-title"><div><h2>Mapa de gargalos por flow</h2><div class="desc">Mostra o motivo principal em linguagem operacional.</div></div></div>' + barRows(byFlow, 'flow', 20, 'failures') + '</div></div>' + renderTable(rows.slice(0, 80), true);
  }

  function renderTable(rows, compact) {
    var h = '<div class="card span-12"><div class="card-title"><div><h2>Detalhe operacional | sessões e copy</h2><div class="desc">Sem telefone, email, documento, session_id ou payload bruto | inbound ocultado.</div></div></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Pessoa</th><th>BDR inferido</th><th>Público</th><th>Flow</th><th>Família</th><th>Motivo</th><th>Copy outbound redigida</th><th>Ação sugerida</th></tr></thead><tbody>';
    rows.slice(0, compact ? 80 : 300).forEach(function (m) {
      h += '<tr><td class="nowrap">' + day(m.createdAt) + '</td><td>' + esc(m.person || '—') + '</td><td>' + esc(m.bdr) + '<div class="muted">' + esc(m.bdrSource) + '</div></td><td>' + esc(m.audience || '—') + '</td><td>' + esc(m.flow) + '</td><td>' + esc(m.family) + '</td><td><span class="pill ' + severityClass(m.severity) + '">' + esc(m.reasonLabel) + '</span><div class="muted">' + esc(m.nonDeliveryReason || '') + '</div></td><td>' + esc(m.copy || '—') + '</td><td>' + esc(m.action || '—') + '</td></tr>';
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
    var meta = state.raw && state.raw.meta ? state.raw.meta : {};
    var warn = meta.sessionsTruncated ? ' | amostra truncada: aumente com cuidado ou reduza o período' : '';
    var flags = '<div class="note"><b>Fonte:</b> ' + esc(meta.source || 'Treble API') + ' | sessões analisadas ' + esc(meta.sessionsAnalyzed || realRows.length) + ' de ' + esc(meta.sessionsFound || realRows.length) + ' | linhas diagnósticas ' + esc(meta.diagnosticRows || 0) + warn + '. <b>Labels:</b> BDR, público e família são inferidos do nome do flow/copy.</div>';
    var tabs = '<div class="tabs"><button class="tab ' + (state.tab === 'overview' ? 'active' : '') + '" onclick="BdrTreble.tab(\'overview\')">Visão executiva</button><button class="tab ' + (state.tab === 'bdrs' ? 'active' : '') + '" onclick="BdrTreble.tab(\'bdrs\')">Por BDR</button><button class="tab ' + (state.tab === 'timeline' ? 'active' : '') + '" onclick="BdrTreble.tab(\'timeline\')">Linha do tempo</button><button class="tab ' + (state.tab === 'audience' ? 'active' : '') + '" onclick="BdrTreble.tab(\'audience\')">Público e pessoas</button><button class="tab ' + (state.tab === 'reasons' ? 'active' : '') + '" onclick="BdrTreble.tab(\'reasons\')">Falhas e motivos</button><button class="tab ' + (state.tab === 'detail' ? 'active' : '') + '" onclick="BdrTreble.tab(\'detail\')">Mensagem real</button><button class="tab ' + (state.tab === 'api' ? 'active' : '') + '" onclick="BdrTreble.tab(\'api\')">Arquitetura API</button></div>';
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
      setState('loading', 'Carregando Treble', 'Buscando flows, sessões e histórico diretamente na API Treble');
      var url = '/api/bdr-treble?days=' + encodeURIComponent(state.filters.days || '90') + (refresh ? '&refresh=true' : '');
      fetch(url, { credentials: 'include' }).then(function (r) { if (!r.ok) throw new Error(r.status === 401 ? 'Não autorizado. Faça login novamente.' : 'Erro HTTP ' + r.status); return r.json(); })
        .then(function (json) { if (!json.success) throw new Error(json.error || 'Resposta inválida'); state.raw = json; state.rows = json.messages || []; render(); })
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
      modal('Sessões | ' + kind + ' | ' + fmt(rows.length), rows);
    },
    drillGroup: function (field, value) {
      var map = { flow: 'flow', bdr: 'bdr', family: 'family', audience: 'audience', semanticGroup: 'semanticGroup', person: 'person', reasonLabel: 'reasonLabel', createdDay: 'createdDay' };
      var f = map[field] || field;
      var rows = filtered().filter(function (m) { return String(m[f] || '') === String(value || ''); });
      modal(field + ' | ' + value + ' | ' + fmt(rows.length), rows);
    },
    closeModal: function () { $('modal-overlay').classList.remove('open'); },
    openHelp: function () {
      $('help-body').innerHTML = '<div class="help-block"><b>Fonte</b><p>Fonte primária: API Treble polls, sessions e history + analytics interno de deployment.failure. HubSpot não define o diagnóstico.</p></div><div class="help-block"><b>Entrega real observada</b><p>Taxa = entregues em sessions ÷ (enviadas em sessions + falhas deployment capturadas). Ainda depende de todos os eventos serem enviados pela Treble.</p></div><div class="help-block"><b>Timeline</b><p>A aba Linha do tempo usa gráfico de linha para enviadas, entregues em sessions, lidas, respondidas e falhas deployment.</p></div><div class="help-block"><b>Resposta</b><p>Resposta = sessão com mensagem USER após envio. A taxa é respondidas ÷ enviadas em history.</p></div><div class="help-block"><b>Privacidade</b><p>Sem telefone, email, documento, session_id ou payload bruto. Copy outbound é redigida por heurística e inbound fica ocultado.</p></div>';
      $('help-backdrop').classList.add('open'); $('help-drawer').classList.add('open');
    },
    closeHelp: function () { $('help-backdrop').classList.remove('open'); $('help-drawer').classList.remove('open'); }
  };

  window.BdrTreble = api;
  window.addEventListener('DOMContentLoaded', function () { api.load(false); });
})();
