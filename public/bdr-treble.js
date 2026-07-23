(function () {
  'use strict';

  var state = {
    raw: null,
    rows: [],
    totalRows: 0,
    filters: loadFilters(),
    tab: 'overview',
    dwMode: true
  };

  function $(id) {
    return document.getElementById(id);
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmt(n) {
    return Number(n || 0).toLocaleString('pt-BR');
  }

  function pct(v) {
    if (v == null) return 'Não medido';
    return (Number(v) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
  }

  function pctNum(n) {
    if (n == null) return 'Não medido';
    return Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
  }

  function day(v) {
    return v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—';
  }

  function todayIso() {
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    var m = {};
    parts.forEach(function (x) { m[x.type] = x.value; });
    return m.year + '-' + m.month + '-' + m.day;
  }

  function statusClass(group) {
    if (group === 'delivered') return 'good';
    if (group === 'processed_unconfirmed') return 'warn';
    if (group === 'not_delivered') return 'bad';
    return 'teal';
  }

  function sourceBadge(source) {
    if (source === 'direct') return 'direto';
    if (source === 'flow_rule') return 'regra do flow (construtor)';
    if (source === 'flow_inference') return 'inferido do flow';
    return 'não identificado';
  }

  function loadFilters() {
    try {
      var old = JSON.parse(localStorage.getItem('bdr_treble_filters_v3') || '{}');
      var saved = JSON.parse(localStorage.getItem('bdr_treble_filters_v4') || '{}');
      return {
        preset: saved.preset || old.preset || 'today',
        from: saved.from || todayIso(),
        to: saved.to || todayIso(),
        agent: saved.agent || old.bdr || '',
        flow: saved.flow || old.flow || '',
        status: saved.status || '',
        q: saved.q || old.q || ''
      };
    } catch (e) {
      return { preset: 'today', from: todayIso(), to: todayIso(), agent: '', flow: '', status: '', q: '' };
    }
  }

  function saveFilters() {
    try {
      localStorage.setItem('bdr_treble_filters_v4', JSON.stringify(state.filters));
    } catch (e) {}
  }

  function setState(type, title, text) {
    var el = $('state');
    var content = $('content');
    if (content) content.classList.add('hidden');
    if (!el) return;

    el.classList.remove('hidden');
    el.innerHTML = (type === 'loading' ? '<div class="spinner"></div>' : '') +
      '<strong>' + esc(title) + '</strong>' + esc(text || '');
  }

  function unique(rows, field) {
    var seen = {};
    var out = [];
    rows.forEach(function (m) {
      var v = m[field] || '';
      if (v && !seen[v]) {
        seen[v] = true;
        out.push(v);
      }
    });
    return out.sort(function (a, b) { return String(a).localeCompare(String(b)); });
  }

  function activeFilterLine(visible, total) {
    var range = (state.raw || {}).dateRange || {};
    var parts = ['Período: ' + (range.label || state.filters.preset || 'Hoje')];
    if (state.filters.agent) parts.push('Agente: ' + state.filters.agent);
    if (state.filters.flow) parts.push('Flow: ' + state.filters.flow);
    if (state.filters.status) parts.push('Status: ' + state.filters.status);
    if (state.filters.q) parts.push('Busca: ' + state.filters.q);
    parts.push('mostrando ' + fmt(visible) + ' de ' + fmt(total) + ' tentativas');
    return parts.join(' | ');
  }

  function renderFilters() {
    var el = $('filters');
    if (!el) return;

    var presets = [
      ['today', 'Hoje'],
      ['yesterday', 'Ontem'],
      ['7d', '7d'],
      ['30d', '30d'],
      ['90d', '90d']
    ];

    var h = '<div class="periodbar" aria-live="polite"><span class="period-label">Período</span>';
    presets.forEach(function (p) {
      h += '<button class="period-chip' + (state.filters.preset === p[0] ? ' active' : '') +
        '" data-preset="' + p[0] + '">' + p[1] + '</button>';
    });
    h += '<span class="muted" id="active-period">' +
      esc(activeFilterLine(filtered().length, state.totalRows || state.rows.length)) + '</span></div>';

    h += '<div class="filter"><label for="f-from">Data inicial</label>' +
      '<input type="date" id="f-from" value="' + esc(state.filters.from) + '"></div>';
    h += '<div class="filter"><label for="f-to">Data final</label>' +
      '<input type="date" id="f-to" value="' + esc(state.filters.to) + '"></div>';
    h += '<div class="filter"><label for="f-apply">Intervalo customizado</label>' +
      '<button class="btn primary" id="f-apply">Aplicar</button></div>';

    function opts(values, selected, allLabel) {
      var x = '<option value="">' + esc(allLabel) + '</option>';
      values.forEach(function (v) {
        x += '<option value="' + esc(v) + '"' + (String(v) === String(selected) ? ' selected' : '') + '>' + esc(v) + '</option>';
      });
      return x;
    }

    h += '<div class="filter"><label for="f-agent">Agente</label><select id="f-agent">' +
      opts(unique(state.rows, 'agent'), state.filters.agent, 'Todos') + '</select></div>';
    h += '<div class="filter"><label for="f-flow">Flow</label><select id="f-flow">' +
      opts(unique(state.rows, 'flow'), state.filters.flow, 'Todos') + '</select></div>';
    h += '<div class="filter"><label for="f-status">Status</label><select id="f-status">' +
      opts(unique(state.rows, 'statusLabel'), state.filters.status, 'Todos') + '</select></div>';
    h += '<div class="filter"><label for="f-q">Busca</label>' +
      '<input id="f-q" value="' + esc(state.filters.q) + '" placeholder="flow, agente, status"></div>';
    h += '<div class="filter" style="display:flex;align-items:end;gap:.5rem">' +
      '<button class="btn" id="f-clear">Limpar</button><button class="btn primary" id="f-refresh">Refresh</button></div>';

    el.innerHTML = h;

    Array.prototype.forEach.call(el.querySelectorAll('.period-chip'), function (b) {
      b.onclick = function () {
        state.filters.preset = b.getAttribute('data-preset');
        saveFilters();
        api.load(false);
      };
    });

    $('f-apply').onclick = function () {
      state.filters.preset = 'custom';
      state.filters.from = $('f-from').value;
      state.filters.to = $('f-to').value;
      saveFilters();
      api.load(false);
    };

    function bind(id, key) {
      var x = $(id);
      if (x) {
        x.onchange = function () {
          state.filters[key] = x.value;
          saveFilters();
          render();
        };
      }
    }

    bind('f-agent', 'agent');
    bind('f-flow', 'flow');
    bind('f-status', 'status');

    $('f-q').oninput = function () {
      state.filters.q = this.value;
      saveFilters();
      render();
    };
    $('f-clear').onclick = function () {
      state.filters.agent = '';
      state.filters.flow = '';
      state.filters.status = '';
      state.filters.q = '';
      saveFilters();
      render();
    };
    $('f-refresh').onclick = function () { api.load(true); };
  }

  function filtered() {
    var q = String(state.filters.q || '').toLowerCase();
    return state.rows.filter(function (m) {
      if (state.filters.agent && m.agent !== state.filters.agent) return false;
      if (state.filters.flow && m.flow !== state.filters.flow) return false;
      if (state.filters.status && m.statusLabel !== state.filters.status) return false;
      if (q && [m.flow, m.agent, m.status, m.statusLabel, m.audience, m.action].join(' ').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function summarize(rows) {
    var s = { attempts: rows.length, delivered: 0, notDelivered: 0, replied: 0, flows: {}, agents: {} };
    rows.forEach(function (r) {
      if (r.delivered) s.delivered += 1;
      else s.notDelivered += 1;
      if (r.replied) s.replied += 1;
      s.flows[r.flow] = true;
      if (r.agent && r.agent !== 'Não identificado') s.agents[r.agent] = true;
    });
    s.deliveryRate = s.attempts ? s.delivered / s.attempts : null;
    s.responseRate = s.attempts ? s.replied / s.attempts : null;
    s.flowsCount = Object.keys(s.flows).length;
    s.agentsCount = Object.keys(s.agents).length;
    return s;
  }

  function attributionCoverage(rows) {
    var total = rows.length;
    var direct = 0;
    var rule = 0;
    var inferred = 0;
    var unknown = 0;
    rows.forEach(function (r) {
      if (r.agentSource === 'direct') direct += 1;
      else if (r.agentSource === 'flow_rule') rule += 1;
      else if (r.agentSource === 'flow_inference') inferred += 1;
      else unknown += 1;
    });
    return {
      total: total,
      direct: direct,
      rule: rule,
      inferred: inferred,
      unknown: unknown,
      directPct: total ? direct / total * 100 : null,
      rulePct: total ? rule / total * 100 : null,
      inferredPct: total ? inferred / total * 100 : null,
      unknownPct: total ? unknown / total * 100 : null
    };
  }

  function groupStatus(rows) {
    var m = {};
    rows.forEach(function (r) {
      var k = r.status;
      m[k] = m[k] || {
        status: k,
        statusLabel: r.statusLabel,
        statusGroup: r.statusGroup,
        action: r.action,
        count: 0,
        delivered: 0,
        replied: 0
      };
      m[k].count += 1;
      if (r.delivered) m[k].delivered += 1;
      if (r.replied) m[k].replied += 1;
    });
    return Object.keys(m).map(function (k) {
      m[k].pct = rows.length ? m[k].count / rows.length : 0;
      return m[k];
    }).sort(function (a, b) { return b.count - a.count; });
  }

  function majoritySource(a) {
    var rows = [
      { key: 'direct', value: a.direct },
      { key: 'flow_inference', value: a.inferred },
      { key: 'unknown', value: a.unknown }
    ].sort(function (x, y) { return y.value - x.value; });
    return rows[0].key;
  }

  function groupAgent(rows) {
    var m = {};
    rows.forEach(function (r) {
      var k = r.agent || 'Não identificado';
      m[k] = m[k] || {
        agent: k,
        attempts: 0,
        delivered: 0,
        replied: 0,
        notDelivered: 0,
        flows: {},
        direct: 0,
        inferred: 0,
        unknown: 0,
        rule: 0
      };
      m[k].attempts += 1;
      if (r.delivered) m[k].delivered += 1;
      else m[k].notDelivered += 1;
      if (r.replied) m[k].replied += 1;
      m[k].flows[r.flow] = true;
      if (r.agentSource === 'direct') m[k].direct += 1;
      else if (r.agentSource === 'flow_rule') m[k].rule += 1;
      else if (r.agentSource === 'flow_inference') m[k].inferred += 1;
      else m[k].unknown += 1;
    });
    return Object.keys(m).map(function (k) {
      var a = m[k];
      a.flowsCount = Object.keys(a.flows).length;
      a.deliveryRate = a.attempts ? a.delivered / a.attempts : null;
      a.responseRate = a.attempts ? a.replied / a.attempts : null;
      a.mainSource = majoritySource(a);
      return a;
    }).sort(function (a, b) { return b.attempts - a.attempts; });
  }

  function kpi(label, value, sub, kind, extraClass) {
    return '<div class="kpi ' + (kind || '') + ' ' + (extraClass || '') + '">' +
      '<div class="label">' + esc(label) + '</div>' +
      '<div class="value">' + esc(value) + '</div>' +
      '<div class="sub">' + esc(sub) + '</div></div>';
  }

  function headline(s) {
    var label = ((state.raw || {}).dateRange || {}).label || (state.dwMode ? 'Hoje' : 'Fallback REST');
    return '<section class="hero-headline" aria-live="polite"><b>' + esc(label) + ':</b> ' +
      fmt(s.attempts) + ' tentativas | ' + pct(s.deliveryRate) + ' entregues | ' + pct(s.responseRate) + ' responderam</section>';
  }

  function funnelDeltas(s) {
    var deliveredLoss = s.attempts - s.delivered;
    var responseLoss = s.delivered - s.replied;
    var max = Math.max(s.attempts, 1);
    var steps = [
      { label: 'Tentativas', value: s.attempts, cls: 'teal' },
      { label: 'Entregues', value: s.delivered, cls: 'good', loss: deliveredLoss, lossBase: s.attempts },
      { label: 'Respondidas', value: s.replied, cls: 'warn', loss: responseLoss, lossBase: s.delivered }
    ];
    return '<div class="card span-12"><div class="card-title"><div><h2>Funil de entrega e resposta</h2>' +
      '<div class="desc">Deltas absolutos e percentuais entre etapas. Leitura não entra porque a fonte não mede.</div></div></div>' +
      steps.map(function (x, idx) {
        var delta = idx === 0 ? 'Base do período' : ('Perda: ' + fmt(x.loss) + ' | ' + pct(x.lossBase ? x.loss / x.lossBase : null));
        return '<div class="funnel-row"><div class="funnel-name"><b>' + esc(x.label) + '</b><span>' + esc(delta) + '</span></div>' +
          '<div class="funnel-track"><div class="funnel-fill ' + x.cls + '" style="width:' + Math.max(2, Math.round(x.value / max * 100)) + '%"></div></div>' +
          '<div class="funnel-value">' + fmt(x.value) + '</div></div>';
      }).join('') + '</div>';
  }

  function statusComposition(rows) {
    var by = groupStatus(rows);
    if (!by.length) return '';
    var displayPcts = by.map(function (x) {
      return Math.round(x.pct * 1000) / 10;
    });
    var roundedTotal = displayPcts.reduce(function (sum, value) { return sum + value; }, 0);
    displayPcts[0] = Math.round((displayPcts[0] + (100 - roundedTotal)) * 10) / 10;
    var bars = by.map(function (x) {
      return '<div class="stack-seg ' + statusClass(x.statusGroup) + '" style="width:' + Math.max(1, x.pct * 100) + '%" title="' +
        esc(x.statusLabel + ' | ' + fmt(x.count) + ' | ' + pct(x.pct)) + '"></div>';
    }).join('');
    var trs = by.map(function (x, index) {
      return '<tr><td><span class="pill ' + statusClass(x.statusGroup) + '" title="' + esc(x.action) + '">' + esc(x.statusLabel) +
        '</span><div class="muted">' + esc(x.status) + '</div></td><td>' + fmt(x.count) + '</td><td>' +
        displayPcts[index].toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%</td><td>' +
        fmt(x.delivered) + '</td><td>' + fmt(x.replied) + '</td><td>' + esc(x.action) + '</td></tr>';
    }).join('');
    return '<div class="card span-12"><div class="card-title"><div><h2>Composição 100% por status bruto</h2>' +
      '<div class="desc">Total e percentual por status real. Resposta pode entrar no funil como entregue, mas o status bruto continua preservado.</div></div></div>' +
      '<div class="stack100">' + bars + '</div><div class="table-wrap"><table><thead><tr><th>Status</th><th>Total</th><th>%</th>' +
      '<th>Entregues no funil</th><th>Respondidas</th><th>Ação</th></tr></thead><tbody>' + trs + '</tbody></table></div></div>';
  }

  function agentRanking(rows) {
    var by = groupAgent(rows);
    var coverage = attributionCoverage(rows);
    var note = 'Cobertura no filtro: direto ' + pctNum(coverage.directPct) +
      ' | inferido ' + pctNum(coverage.inferredPct) + ' | não identificado ' + pctNum(coverage.unknownPct) +
      '. Inferência vem do nome do flow.';
    var trs = by.map(function (a) {
      return '<tr class="clickable-row" data-drill-field="agent" data-drill-value="' + esc(a.agent) + '"><td><b>' + esc(a.agent) +
        '</b><div><span class="pill teal">' + esc(sourceBadge(a.mainSource)) + '</span></div></td><td>' + fmt(a.attempts) + '</td><td>' +
        fmt(a.delivered) + '</td><td>' + fmt(a.notDelivered) + '</td><td>' + fmt(a.replied) + '</td><td>' + pct(a.deliveryRate) + '</td><td>' +
        pct(a.responseRate) + '</td><td>' + fmt(a.flowsCount) + '</td></tr>';
    }).join('');
    return '<div class="card span-12"><div class="card-title"><div><h2>Quem tentou enviar</h2><div class="desc">' + esc(note) +
      '</div></div></div><div class="table-wrap"><table><thead><tr><th>Agente</th><th>Tentativas</th><th>Entregues</th><th>Não entregues</th>' +
      '<th>Respondidas</th><th>Tx entrega</th><th>Tx resposta</th><th>Flows</th></tr></thead><tbody>' + trs + '</tbody></table></div></div>';
  }

  function timeline(rows) {
    var m = {};
    rows.forEach(function (r) {
      var k = r.createdDay || 'Sem data';
      m[k] = m[k] || { day: k, sent: 0, delivered: 0, notDelivered: 0, replied: 0 };
      m[k].sent += 1;
      if (r.delivered) m[k].delivered += 1;
      else m[k].notDelivered += 1;
      if (r.replied) m[k].replied += 1;
    });
    var arr = Object.keys(m).sort().map(function (k) { return m[k]; });
    if (!arr.length) return '<div class="card span-12"><div class="muted">Sem datas no filtro.</div></div>';

    var w = 980;
    var h = 340;
    var padL = 58;
    var padR = 24;
    var padT = 30;
    var padB = 54;
    var max = Math.max.apply(null, arr.map(function (d) {
      return Math.max(d.sent, d.delivered, d.notDelivered, d.replied);
    }).concat([1]));
    function x(i) { return padL + (arr.length === 1 ? 0 : i * (w - padL - padR) / (arr.length - 1)); }
    function y(v) { return padT + (h - padT - padB) * (1 - (v / max)); }
    function points(metric) {
      return arr.map(function (d, i) { return x(i).toFixed(1) + ',' + y(d[metric] || 0).toFixed(1); }).join(' ');
    }
    function line(metric, color, label) {
      return '<polyline fill="none" stroke="' + color + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="' +
        points(metric) + '"><title>' + esc(label) + '</title></polyline>';
    }
    function dots(metric, color, label) {
      return arr.map(function (d, i) {
        return '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(d[metric] || 0).toFixed(1) + '" r="4" fill="' + color + '">' +
          '<title>' + esc(label + ' | ' + d.day + ': ' + fmt(d[metric] || 0)) + '</title></circle>';
      }).join('');
    }
    var grid = [0, 0.25, 0.5, 0.75, 1].map(function (p) {
      var yy = padT + (h - padT - padB) * p;
      var val = Math.round(max * (1 - p));
      return '<line x1="' + padL + '" x2="' + (w - padR) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) +
        '" stroke="rgba(255,255,255,.10)"/><text x="8" y="' + (yy + 4).toFixed(1) + '" fill="currentColor" opacity=".65" font-size="12">' +
        fmt(val) + '</text>';
    }).join('');
    var labels = arr.map(function (d, i) {
      if (arr.length > 18 && i % Math.ceil(arr.length / 10) !== 0 && i !== arr.length - 1) return '';
      return '<text x="' + x(i).toFixed(1) + '" y="' + (h - 18) + '" fill="currentColor" opacity=".65" font-size="11" text-anchor="middle">' +
        esc(d.day.slice(5).split('-').reverse().join('/')) + '</text>';
    }).join('');
    var svg = '<svg class="timeline-chart" viewBox="0 0 ' + w + ' ' + h + '" width="100%" role="img" aria-labelledby="tl-title tl-desc">' +
      '<title id="tl-title">Linha do tempo Treble por dia</title><desc id="tl-desc">Eixo Y em tentativas por dia. Linhas: tentativas, entregues, não entregues e respondidas.</desc>' +
      grid + labels + line('sent', '#3AB8B7', 'Tentativas') + line('delivered', '#2EA043', 'Entregues') +
      line('notDelivered', '#F85149', 'Não entregues') + line('replied', '#B08800', 'Respondidas') +
      dots('sent', '#3AB8B7', 'Tentativas') + dots('delivered', '#2EA043', 'Entregues') +
      dots('notDelivered', '#F85149', 'Não entregues') + dots('replied', '#B08800', 'Respondidas') + '</svg>';
    var legend = '<div class="legend-row"><span><i style="background:#3AB8B7"></i>Tentativas</span><span><i style="background:#2EA043"></i>Entregues</span>' +
      '<span><i style="background:#F85149"></i>Não entregues</span><span><i style="background:#B08800"></i>Respondidas</span></div>';
    var table = '<div class="table-wrap"><table><thead><tr><th>Dia</th><th>Tentativas</th><th>Entregues</th><th>Não entregues</th><th>Respondidas</th></tr></thead><tbody>' +
      arr.map(function (d) {
        return '<tr><td>' + esc(day(d.day)) + '</td><td>' + fmt(d.sent) + '</td><td>' + fmt(d.delivered) + '</td><td>' +
          fmt(d.notDelivered) + '</td><td>' + fmt(d.replied) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    return '<div class="card span-12"><div class="card-title"><div><h2>Linha do tempo</h2><div class="desc">Tendência diária sem métrica de leitura.</div></div></div>' +
      svg + legend + table + '</div>';
  }

  function renderOverview(rows, s) {
    var agents = groupAgent(rows);
    var statuses = groupStatus(rows);
    var leader = agents[0];
    var identifiedLeader = agents.filter(function (agent) {
      return agent.agent !== 'Não identificado';
    })[0];
    var gargalo = statuses.filter(function (x) { return x.statusGroup !== 'delivered'; })[0] || statuses[0];
    var fallbackNote = state.dwMode ? '' : '<div class="note"><b>Fallback REST | últimos 30 dias:</b> filtros de data exatos não se aplicam nesta fonte legada.</div>';
    var whoTried;
    if (!leader) {
      whoTried = 'Sem agente identificado.';
    } else if (leader.agent === 'Não identificado') {
      whoTried = fmt(leader.attempts) + ' tentativas sem agente identificado.' +
        (identifiedLeader ? ' Entre os identificados, ' + identifiedLeader.agent + ' liderou com ' + fmt(identifiedLeader.attempts) + '.' : '');
    } else {
      whoTried = leader.agent + ' liderou com ' + fmt(leader.attempts) + ' tentativas.';
    }
    var story = '<div class="story-grid context-grid"><div class="story-card"><b>Quem tentou</b><span>' +
      esc(whoTried) + '</span></div>' +
      '<div class="story-card"><b>Por que quebrou</b><span>' + (gargalo ? esc(gargalo.statusLabel) + ' concentrou ' + fmt(gargalo.count) + ' casos.' : 'Sem quebras.') + '</span></div>' +
      '<div class="story-card"><b>Ação</b><span>' + (gargalo ? esc(gargalo.action) : 'Replicar flows com resposta.') + '</span></div></div>';
    var kpis = '<div class="kpis hierarchy-kpis">' +
      kpi('Tentativas', fmt(s.attempts), 'Hero do período', 'teal', 'hero-kpi') +
      kpi('Entregues', fmt(s.delivered), pct(s.deliveryRate) + ' das tentativas', 'good', 'secondary-kpi') +
      kpi('Não entregues', fmt(s.notDelivered), pct(s.attempts ? s.notDelivered / s.attempts : null) + ' das tentativas', 'bad', 'secondary-kpi') +
      kpi('Respondidas', fmt(s.replied), pct(s.responseRate) + ' das tentativas',
        s.responseRate >= 0.10 ? 'good' : (s.responseRate >= 0.03 ? 'warn' : 'bad'), 'secondary-kpi') +
      '</div>';
    return headline(s) + fallbackNote + kpis + story + '<div class="grid">' + funnelDeltas(s) + statusComposition(rows) + agentRanking(rows) + '</div>';
  }

  function renderStatus(rows) {
    return '<div class="grid">' + statusComposition(rows) + '</div>';
  }

  function renderFailures(rows) {
    var fail = rows.filter(function (r) { return r.statusGroup !== 'delivered'; });
    return '<div class="grid">' + statusComposition(fail) + renderTable(fail, true) + '</div>';
  }

  function renderAudience(rows) {
    var flows = unique(rows, 'flow').map(function (f) {
      var n = rows.filter(function (r) { return r.flow === f; }).length;
      return '<tr><td>' + esc(f) + '</td><td>' + fmt(n) + '</td></tr>';
    }).join('');
    return '<div class="card span-12"><div class="card-title"><div><h2>Público e flows</h2>' +
      '<div class="desc">Sem pessoa/telefone no modo DW; público é inferido pelo nome do flow.</div></div></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Flow</th><th>Tentativas</th></tr></thead><tbody>' + flows + '</tbody></table></div></div>';
  }

  function renderTable(rows, compact) {
    var limit = compact ? 80 : 300;
    var truncationNote = rows.length > limit
      ? '<div class="note"><b>Detalhe parcial:</b> mostrando ' + fmt(limit) + ' de ' + fmt(rows.length) + ' tentativas. Aplique filtros para reduzir o recorte.</div>'
      : '';
    return '<div class="card span-12"><div class="card-title"><div><h2>Detalhe DW sem PII</h2>' +
      '<div class="desc">Uma linha por tentativa real; sem telefone, email, conteúdo ou IDs sensíveis.</div></div></div>' +
      truncationNote +
      '<div class="table-wrap"><table><thead><tr><th>Data</th><th>Agente</th><th>Flow</th><th>Status</th><th>Ação</th></tr></thead><tbody>' +
      rows.slice(0, limit).map(function (m) {
        return '<tr><td class="nowrap">' + esc(day(m.createdDay)) + '</td><td>' + esc(m.agent) + '<div class="muted">' + esc(sourceBadge(m.agentSource)) + '</div></td>' +
          '<td>' + esc(m.flow) + '</td><td><span class="pill ' + statusClass(m.statusGroup) + '" title="' + esc(m.action) + '">' + esc(m.statusLabel) +
          '</span><div class="muted">' + esc(m.status) + '</div></td><td>' + esc(m.action || '—') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  function renderApiMap(rows) {
    var meta = (state.raw || {}).meta || {};
    var map = (state.raw || {}).apiMap || [];
    var cov = attributionCoverage(rows);
    return '<div class="grid"><div class="card span-12"><div class="card-title"><div><h2>Arquitetura API</h2>' +
      '<div class="desc">Browser → Auth → API → ClickHouse → sanitização → UI.</div></div></div>' +
      '<div class="table-wrap"><table><thead><tr><th>#</th><th>Camada</th><th>Endpoint</th><th>Objetivo</th><th>Retorno</th><th>Uso</th></tr></thead><tbody>' +
      map.map(function (m) {
        return '<tr><td>' + esc(m.step) + '</td><td>' + esc(m.method) + '</td><td><code>' + esc(m.endpoint) + '</code></td><td>' +
          esc(m.purpose) + '</td><td>' + esc(m.returns) + '</td><td>' + esc(m.usedFor) + '</td></tr>';
      }).join('') + '</tbody></table></div></div><div class="card span-6"><h2>Contrato de métricas</h2><p>' + esc(meta.metricContract || '') +
      '</p><p>Timezone: <b>' + esc(meta.timezone || 'America/Sao_Paulo') + '</b></p><p>Freshness: <b>' + esc(meta.freshness || 'cache 10 min') +
      '</b></p><p>Privacidade: ' + esc(meta.privacy || '') + '</p></div><div class="card span-6"><h2>Qualidade da atribuição no filtro</h2>' +
      '<p>Direto: <b>' + pctNum(cov.directPct) + '</b></p><p>Regra do flow (construtor): <b>' + pctNum(cov.rulePct) + '</b></p><p>Inferido do flow: <b>' + pctNum(cov.inferredPct) + '</b></p>' +
      '<p>Não identificado: <b>' + pctNum(cov.unknownPct) + '</b></p>' +
      (meta.limitations || []).map(function (x) { return '<p class="muted">' + esc(x) + '</p>'; }).join('') + '</div></div>';
  }

  function render() {
    var rows = filtered();
    renderFilters();

    var content = $('content');
    var stateEl = $('state');
    if (!rows.length) {
      setState('empty', 'Sem dados no filtro', 'Ajuste período ou filtros.');
      return;
    }

    var s = summarize(rows);
    var flags = '<div class="active-filters-line" aria-live="polite">' + esc(activeFilterLine(rows.length, state.totalRows || state.rows.length)) + '</div>';
    var tabs = '<div class="tabs"><button class="tab ' + (state.tab === 'overview' ? 'active' : '') + '" onclick="BdrTreble.tab(\'overview\')">Resumo</button>' +
      '<button class="tab ' + (state.tab === 'agents' ? 'active' : '') + '" onclick="BdrTreble.tab(\'agents\')">Quem enviou</button>' +
      '<button class="tab ' + (state.tab === 'status' ? 'active' : '') + '" onclick="BdrTreble.tab(\'status\')">Status</button>' +
      '<button class="tab ' + (state.tab === 'failures' ? 'active' : '') + '" onclick="BdrTreble.tab(\'failures\')">Falhas</button>' +
      '<button class="tab ' + (state.tab === 'timeline' ? 'active' : '') + '" onclick="BdrTreble.tab(\'timeline\')">Linha do tempo</button>' +
      '<button class="tab ' + (state.tab === 'audience' ? 'active' : '') + '" onclick="BdrTreble.tab(\'audience\')">Público</button>' +
      '<button class="tab ' + (state.tab === 'detail' ? 'active' : '') + '" onclick="BdrTreble.tab(\'detail\')">Detalhe</button>' +
      '<button class="tab ' + (state.tab === 'api' ? 'active' : '') + '" onclick="BdrTreble.tab(\'api\')">Arquitetura API</button></div>';
    var body;
    if (state.tab === 'agents') body = '<div class="grid">' + agentRanking(rows) + '</div>';
    else if (state.tab === 'status') body = renderStatus(rows);
    else if (state.tab === 'failures') body = renderFailures(rows);
    else if (state.tab === 'timeline') body = '<div class="grid">' + timeline(rows) + '</div>';
    else if (state.tab === 'audience') body = '<div class="grid">' + renderAudience(rows) + '</div>';
    else if (state.tab === 'detail') body = '<div class="grid">' + renderTable(rows, false) + '</div>';
    else if (state.tab === 'api') body = renderApiMap(rows);
    else body = renderOverview(rows, s);

    if (stateEl) stateEl.classList.add('hidden');
    content.classList.remove('hidden');
    content.innerHTML = flags + tabs + body + '<div class="footer-note">Segurança, PII e memória de cálculo ficam no botão de ajuda.</div>';
    bindDrills(content);
  }

  function bindDrills(root) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-drill-field]'), function (el) {
      el.addEventListener('click', function () {
        api.drillGroup(el.getAttribute('data-drill-field'), el.getAttribute('data-drill-value'));
      });
    });
  }

  function modal(title, rows) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = '<div class="grid">' + renderTable(rows, false) + '</div>';
    $('modal-overlay').classList.add('open');
  }

  function normalizeRestRows(json) {
    var rows = json.messages || [];
    return rows.map(function (r) {
      var delivered = !!r.delivered;
      var replied = !!r.replied;
      var rawStatus = delivered ? 'DELIVERED' : (r.nonDeliveryReason || r.reason || 'REST_UNCONFIRMED');
      return {
        flow: r.flow || 'Flow REST',
        pollId: r.pollId || '',
        createdAt: r.createdAt || r.created_at || '',
        createdDay: String(r.createdDay || r.createdAt || '').slice(0, 10),
        agent: r.agent || r.bdr || 'Não identificado',
        agentSource: r.agentSource || 'flow_inference',
        agentConfidence: r.agentConfidence || 0.5,
        bdr: r.agent || r.bdr || 'Não identificado',
        bdrSource: 'Fallback REST normalizado',
        family: r.family || 'REST',
        audience: r.audience || 'Público geral',
        semanticGroup: r.semanticGroup || 'REST',
        sent: r.sent !== false,
        delivered: delivered,
        replied: replied,
        read: false,
        readAvailable: false,
        status: rawStatus,
        statusLabel: delivered ? 'Entregue' : 'Não confirmado no REST',
        statusGroup: delivered ? 'delivered' : 'unknown',
        reason: delivered ? (replied ? 'responded' : 'delivered_no_reply') : 'unknown',
        reasonLabel: delivered ? (replied ? 'Respondeu' : 'Entregue, sem resposta') : 'Não confirmado no REST',
        severity: delivered ? 'good' : 'teal',
        action: 'Fallback REST: usar somente como contingência; datas exatas não garantidas.',
        nonDeliveryReason: delivered ? '' : rawStatus,
        diagnostic: false
      };
    });
  }

  function shouldFallback(status) {
    return status >= 500 || status === 0;
  }

  function humanRangeError(error) {
    var map = {
      invalid_custom_date: 'Data customizada inválida. Use início e fim no formato AAAA-MM-DD.',
      invalid_custom_order: 'Intervalo inválido: a data inicial precisa ser anterior ou igual à final.',
      date_range_too_large: 'Intervalo máximo permitido: 90 dias.',
      invalid_preset: 'Preset de período inválido.'
    };
    return map[error] || 'Intervalo inválido.';
  }

  function syncDateInputs(dateRange) {
    if (!dateRange) return;
    state.filters.from = dateRange.from || state.filters.from;
    state.filters.to = dateRange.to || state.filters.to;
    if (dateRange.preset) state.filters.preset = dateRange.preset;
    saveFilters();
  }

  function loadRestFallback(url) {
    return fetch(url, { credentials: 'include' }).then(function (response) {
      if (!response.ok) {
        throw new Error(response.status === 401
          ? 'Não autorizado. Faça login novamente.'
          : 'Fallback REST falhou com HTTP ' + response.status);
      }
      return response.json();
    }).then(function (json) {
      json.source = 'treble_rest_fallback';
      json.dateRange = {
        preset: 'fallback_30d',
        label: 'Fallback REST | últimos 30 dias'
      };
      json.meta = json.meta || {};
      json.meta.sourceLabel = 'Fallback REST | últimos 30 dias';
      json.meta.metricContract = 'Fallback REST normalizado para o shape V2; filtros de data exatos não são garantidos.';
      json.meta.privacy = 'Payload normalizado sem telefone/email exibidos na UI.';
      json.apiMap = json.apiMap || [];
      json.messages = normalizeRestRows(json);
      return json;
    });
  }

  var api = {
    load: function (refresh) {
      setState('loading', 'Carregando Treble', 'Buscando dados do Treble Data Warehouse');
      var f = state.filters;
      var dwUrl = '/api/bdr-treble-dw?preset=' + encodeURIComponent(f.preset || 'today') +
        (f.preset === 'custom' ? '&from=' + encodeURIComponent(f.from || '') + '&to=' + encodeURIComponent(f.to || '') : '') +
        (refresh ? '&refresh=true' : '');
      var fallbackUrl = '/api/bdr-treble?days=30' + (refresh ? '&refresh=true' : '');

      fetch(dwUrl, { credentials: 'include' }).then(function (r) {
        if (r.ok) return r.json();
        if (r.status === 400) {
          return r.json().catch(function () { return { error: 'invalid_preset' }; }).then(function (body) {
            var error = new Error(humanRangeError(body.error));
            error.noFallback = true;
            throw error;
          });
        }
        if (r.status === 401 || r.status === 403) {
          var authError = new Error('Não autorizado. Faça login novamente.');
          authError.noFallback = true;
          throw authError;
        }
        if (!shouldFallback(r.status)) {
          var unexpected = new Error('Erro HTTP ' + r.status);
          unexpected.noFallback = true;
          throw unexpected;
        }
        throw new Error('dw_server_error');
      }).catch(function (error) {
        if (error && error.noFallback) throw error;
        return loadRestFallback(fallbackUrl);
      }).then(function (json) {
        if (!json.success) throw new Error(json.error || json.message || 'Resposta inválida');
        state.raw = json;
        state.dwMode = json.source === 'treble_data_warehouse';
        state.rows = json.messages || [];
        state.totalRows = state.rows.length;
        if (state.dwMode) syncDateInputs(json.dateRange);
        render();
      }).catch(function (e) {
        setState('error', 'Erro ao carregar Treble', e.message || 'Falha desconhecida.');
      });
    },
    tab: function (name) {
      state.tab = name;
      render();
    },
    toggleTheme: function () {
      var html = document.documentElement;
      var light = html.getAttribute('data-theme') === 'light';
      html.setAttribute('data-theme', light ? 'dark' : 'light');
      try { localStorage.setItem('axenya_theme', light ? 'dark' : 'light'); } catch (e) {}
    },
    drillGroup: function (field, value) {
      var rows = filtered().filter(function (m) { return String(m[field] || '') === String(value || ''); });
      modal(field + ' | ' + value + ' | ' + fmt(rows.length), rows);
    },
    closeModal: function () {
      $('modal-overlay').classList.remove('open');
    },
    openHelp: function () {
      $('help-body').innerHTML = '<div class="help-block"><b>Fonte</b><p>ClickHouse Treble, fact_deployment_status, via API server-side autenticada.</p></div>' +
        '<div class="help-block"><b>Entrega</b><p>Entregue = timestamp_delivered válido ou status DELIVERED. Resposta válida entra no funil como entregue, mas não muda o status bruto.</p></div>' +
        '<div class="help-block"><b>Atribuição</b><p>Direta por origin_id=dim_agents.id; quando não há match, inferência pelo nome do flow; origin_id nunca é exposto ao browser.</p></div>' +
        '<div class="help-block"><b>Leitura</b><p>Indisponível nesta fato.</p></div><div class="help-block"><b>Privacidade</b><p>Sem telefone, email, conteúdo, origin_id ou IDs sensíveis.</p></div>';
      $('help-backdrop').classList.add('open');
      $('help-drawer').classList.add('open');
    },
    closeHelp: function () {
      $('help-backdrop').classList.remove('open');
      $('help-drawer').classList.remove('open');
    },
    _test: {
      shouldFallback: shouldFallback,
      humanRangeError: humanRangeError
    }
  };

  window.BdrTreble = api;
  window.addEventListener('DOMContentLoaded', function () { api.load(false); });
})();
