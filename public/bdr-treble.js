(function () {
  'use strict';

  var state = {
    raw: null,
    rows: [],
    totalRows: 0,
    filters: loadFilters(),
    tab: 'overview',
    dwMode: true,
    range: null,
    droppedFilters: []
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

  function shiftIso(iso, deltaDays) {
    var ms = Date.parse(String(iso) + 'T00:00:00Z');
    if (isNaN(ms)) return iso;
    return new Date(ms + deltaDays * 86400000).toISOString().slice(0, 10);
  }

  function diffDaysInclusive(fromIso, toIso) {
    var a = Date.parse(String(fromIso) + 'T00:00:00Z');
    var b = Date.parse(String(toIso) + 'T00:00:00Z');
    if (isNaN(a) || isNaN(b)) return 1;
    return Math.round((b - a) / 86400000) + 1;
  }

  // Espelha resolveDateRange do backend. Existe para o fallback REST conseguir
  // honrar o período escolhido mesmo quando o DW nem respondeu.
  function resolveClientRange(f) {
    var today = todayIso();
    var preset = (f && f.preset) || 'today';
    if (preset === 'yesterday') {
      var y = shiftIso(today, -1);
      return { preset: preset, from: y, to: y, label: 'Ontem' };
    }
    if (preset === '7d' || preset === '30d' || preset === '90d') {
      var n = parseInt(preset, 10);
      return { preset: preset, from: shiftIso(today, -(n - 1)), to: today, label: 'Últimos ' + n + ' dias' };
    }
    if (preset === 'custom') {
      var from = f.from || today;
      var to = f.to || today;
      return { preset: preset, from: from, to: to, label: day(from) + ' a ' + day(to) };
    }
    return { preset: 'today', from: today, to: today, label: 'Hoje' };
  }

  // O REST só sabe "últimos N dias a partir de agora"; pedimos a janela que
  // cobre o início do período e recortamos o excedente no cliente.
  function fallbackDaysForRange(range) {
    var n = diffDaysInclusive(range.from, todayIso());
    return Math.max(1, Math.min(365, n));
  }

  function clipRowsToRange(rows, range) {
    if (!range) return rows;
    return rows.filter(function (r) {
      var d = String(r.createdDay || '').slice(0, 10);
      return d && d >= range.from && d <= range.to;
    });
  }

  function humanAge(minutes) {
    if (minutes == null) return 'idade desconhecida';
    if (minutes < 60) return minutes + ' min';
    var hours = Math.floor(minutes / 60);
    if (hours < 48) return hours + 'h';
    return Math.floor(hours / 24) + ' dias';
  }

  function dateTimeBr(iso) {
    if (!iso) return '—';
    var s = String(iso);
    var d = s.slice(0, 10).split('-').reverse().join('/');
    var t = s.slice(11, 16);
    return t ? d + ' ' + t : d;
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
      var old = JSON.parse(localStorage.getItem('bdr_treble_filters_v4') || '{}');
      var saved = JSON.parse(localStorage.getItem('bdr_treble_filters_v5') || '{}');
      return {
        preset: saved.preset || old.preset || 'today',
        from: saved.from || todayIso(),
        to: saved.to || todayIso(),
        agent: saved.agent || old.agent || '',
        flow: saved.flow || old.flow || '',
        status: saved.status || old.status || '',
        origin: saved.origin || '',
        hsm: saved.hsm || '',
        q: saved.q || old.q || ''
      };
    } catch (e) {
      return { preset: 'today', from: todayIso(), to: todayIso(), agent: '', flow: '', status: '', origin: '', hsm: '', q: '' };
    }
  }

  function saveFilters() {
    try {
      localStorage.setItem('bdr_treble_filters_v5', JSON.stringify(state.filters));
    } catch (e) {}
  }

  function setState(type, title, text, extraHtml) {
    var el = $('state');
    var content = $('content');
    if (content) content.classList.add('hidden');
    if (!el) return;

    el.classList.remove('hidden');
    if (type === 'loading') {
      el.innerHTML = '<div class="spinner"></div><strong>' + esc(title) + '</strong>' + esc(text || '');
    } else {
      el.innerHTML = (extraHtml || '') + '<strong>' + esc(title) + '</strong>' + esc(text || '');
    }
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

  function activeFieldFilters() {
    var parts = [];
    if (state.filters.agent) parts.push('Agente: ' + state.filters.agent);
    if (state.filters.flow) parts.push('Flow: ' + state.filters.flow);
    if (state.filters.status) parts.push('Status: ' + state.filters.status);
    if (state.filters.origin) parts.push('Origem: ' + state.filters.origin);
    if (state.filters.hsm) parts.push('Template: ' + state.filters.hsm);
    if (state.filters.q) parts.push('Busca: ' + state.filters.q);
    return parts;
  }

  function activeFilterLine(visible, total) {
    var range = state.range || {};
    var parts = ['Período: ' + (range.label || state.filters.preset || 'Hoje')];
    parts = parts.concat(activeFieldFilters());
    parts.push('mostrando ' + fmt(visible) + ' de ' + fmt(total) + ' tentativas');
    return parts.join(' | ');
  }

  // Filtro salvo no localStorage sobrevive à troca de período e some do <select>
  // quando o valor não existe mais (nenhuma option marcada => browser mostra
  // "Todos"), mas continua cortando as linhas. Resultado: tela vazia sem causa
  // visível. Aqui o filtro órfão é descartado e o descarte é anunciado.
  function pruneGhostFilters(rows) {
    var pairs = [['agent', 'agent'], ['flow', 'flow'], ['status', 'statusLabel'], ['origin', 'originLabel'], ['hsm', 'hsm']];
    var dropped = [];
    pairs.forEach(function (pair) {
      var want = state.filters[pair[0]];
      if (!want) return;
      var exists = rows.some(function (r) { return String(r[pair[1]] || '') === String(want); });
      if (!exists) {
        dropped.push(pair[0] + ' = ' + want);
        state.filters[pair[0]] = '';
      }
    });
    if (dropped.length) saveFilters();
    return dropped;
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
    h += '<div class="filter"><label for="f-origin">Origem</label><select id="f-origin">' +
      opts(unique(state.rows, 'originLabel'), state.filters.origin, 'Todas') + '</select></div>';
    h += '<div class="filter"><label for="f-hsm">Template</label><select id="f-hsm">' +
      opts(unique(state.rows, 'hsm'), state.filters.hsm, 'Todos') + '</select></div>';
    h += '<div class="filter"><label for="f-q">Busca</label>' +
      '<input id="f-q" value="' + esc(state.filters.q) + '" placeholder="flow, agente, status, template"></div>';
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
    bind('f-origin', 'origin');
    bind('f-hsm', 'hsm');

    $('f-q').oninput = function () {
      state.filters.q = this.value;
      saveFilters();
      render();
    };
    $('f-clear').onclick = function () {
      state.filters.agent = '';
      state.filters.flow = '';
      state.filters.status = '';
      state.filters.origin = '';
      state.filters.hsm = '';
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
      if (state.filters.origin && m.originLabel !== state.filters.origin) return false;
      if (state.filters.hsm && m.hsm !== state.filters.hsm) return false;
      if (q && [m.flow, m.agent, m.status, m.statusLabel, m.audience, m.action, m.hsm, m.originLabel]
        .join(' ').toLowerCase().indexOf(q) < 0) return false;
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
      { key: 'flow_rule', value: a.rule },
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

  // Duração legível. Segundo cru em tabela de latência é ilegível a partir de
  // uns poucos minutos, e a leitura que interessa (p50 de 10s vs p90 de 35s)
  // morre no meio de cinco dígitos.
  function dur(sec) {
    if (sec == null) return 'Não medido';
    var n = Number(sec);
    if (!isFinite(n) || n < 0) return 'Não medido';
    if (n < 60) return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + 's';
    if (n < 3600) return Math.round(n / 60) + ' min';
    if (n < 86400) return Math.round(n / 3600) + 'h';
    return Math.round(n / 86400) + ' dias';
  }

  function durHours(h) {
    if (h == null) return 'Não medido';
    var n = Number(h);
    if (!isFinite(n) || n < 0) return 'Não medido';
    if (n < 24) return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + 'h';
    return Math.round(n / 24) + ' dias';
  }

  function plural(n, singular, pluralForm) {
    return fmt(n) + ' ' + (Math.abs(Number(n)) === 1 ? singular : pluralForm);
  }

  function ratesOf(o) {
    o.deliveryRate = o.attempts ? o.delivered / o.attempts : null;
    o.responseRate = o.attempts ? o.replied / o.attempts : null;
    return o;
  }

  function bucketOf(map, key, seed) {
    map[key] = map[key] || Object.assign({ attempts: 0, delivered: 0, notDelivered: 0, replied: 0 }, seed || {});
    return map[key];
  }

  function tally(t, r) {
    t.attempts += 1;
    if (r.delivered) t.delivered += 1;
    else t.notDelivered += 1;
    if (r.replied) t.replied += 1;
  }

  function groupOrigin(rows) {
    var m = {};
    rows.forEach(function (r) {
      var t = bucketOf(m, r.origin || 'DESCONHECIDA', {
        origin: r.origin || 'DESCONHECIDA',
        label: r.originLabel || r.origin || 'Origem desconhecida',
        description: r.originDescription || '',
        manual: !!r.originManual,
        flows: {},
        leads: {}
      });
      tally(t, r);
      t.flows[r.flow] = true;
      if (r.leadKey) t.leads[r.leadKey] = true;
    });
    return Object.keys(m).map(function (k) {
      var o = m[k];
      o.flowsCount = Object.keys(o.flows).length;
      o.leadsCount = Object.keys(o.leads).length;
      delete o.flows;
      delete o.leads;
      return ratesOf(o);
    }).sort(function (a, b) { return b.attempts - a.attempts; });
  }

  var ATTEMPT_ORDER = ['1', '2', '3', '4+'];

  function groupAttempt(rows) {
    var m = {};
    rows.forEach(function (r) {
      var key = r.attemptBucket || '1';
      var t = bucketOf(m, key, { bucket: key, label: r.attemptBucketLabel || key, gaps: [] });
      tally(t, r);
      if (r.gapPrevHours != null) t.gaps.push(r.gapPrevHours);
    });
    return ATTEMPT_ORDER.filter(function (k) { return m[k]; }).map(function (k) {
      var o = m[k];
      o.gaps.sort(function (a, b) { return a - b; });
      o.gapMedian = o.gaps.length ? o.gaps[Math.max(0, Math.ceil(0.5 * o.gaps.length) - 1)] : null;
      delete o.gaps;
      return ratesOf(o);
    });
  }

  function leadStats(rows) {
    var byLead = {};
    rows.forEach(function (r) {
      var k = r.leadKey || 'sem-chave';
      byLead[k] = byLead[k] || { leadKey: k, attemptsInPeriod: 0, attemptsAllTime: r.leadAttemptsTotal || 1, delivered: 0, replied: 0, flows: {}, outlier: !!r.leadOutlier };
      var l = byLead[k];
      l.attemptsInPeriod += 1;
      l.attemptsAllTime = Math.max(l.attemptsAllTime, r.leadAttemptsTotal || 1);
      if (r.delivered) l.delivered += 1;
      if (r.replied) l.replied += 1;
      l.flows[r.flow] = true;
    });
    var leads = Object.keys(byLead).map(function (k) {
      var l = byLead[k];
      l.flowsCount = Object.keys(l.flows).length;
      delete l.flows;
      return l;
    });
    var re = leads.filter(function (l) { return l.attemptsInPeriod > 1; });
    var out = leads.filter(function (l) { return l.outlier; });
    return {
      uniqueLeads: leads.length,
      attempts: rows.length,
      attemptsPerLead: leads.length ? rows.length / leads.length : null,
      reattempted: re.length,
      reattemptedPct: leads.length ? re.length / leads.length : null,
      outlierLeads: out.length,
      outlierAttempts: out.reduce(function (s, l) { return s + l.attemptsInPeriod; }, 0),
      top: leads.sort(function (a, b) {
        return b.attemptsInPeriod - a.attemptsInPeriod || b.attemptsAllTime - a.attemptsAllTime;
      }).slice(0, 15)
    };
  }

  function quantile(values, p) {
    var s = values.filter(function (v) { return v != null; }).sort(function (a, b) { return a - b; });
    if (!s.length) return null;
    return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
  }

  function latencyStats(rows) {
    function block(field) {
      var vals = rows.map(function (r) { return r[field]; }).filter(function (v) { return v != null; });
      return { n: vals.length, p50: quantile(vals, 0.5), p90: quantile(vals, 0.9), max: vals.length ? Math.max.apply(null, vals) : null };
    }
    return {
      delivery: block('deliveryLagSec'),
      response: block('responseLagSec'),
      gap: block('gapPrevHours')
    };
  }

  function groupHsm(rows) {
    var m = {};
    var matched = 0;
    rows.forEach(function (r) {
      if (!r.hsmMatched) return;
      matched += 1;
      var t = bucketOf(m, r.hsm, { hsm: r.hsm, hsmStatus: r.hsmStatus, hsmCategory: r.hsmCategory, hsmType: r.hsmType, flows: {} });
      tally(t, r);
      t.flows[r.flow] = true;
    });
    var list = Object.keys(m).map(function (k) {
      var o = m[k];
      o.flowsCount = Object.keys(o.flows).length;
      delete o.flows;
      return ratesOf(o);
    }).sort(function (a, b) { return b.attempts - a.attempts; });
    return { matched: matched, total: rows.length, rows: list };
  }

  function groupErrors(rows) {
    var fails = rows.filter(function (r) { return r.statusGroup !== 'delivered'; });
    var m = {};
    fails.forEach(function (r) {
      m[r.status] = m[r.status] || {
        status: r.status,
        statusLabel: r.statusLabel,
        statusGroup: r.statusGroup,
        action: r.action,
        count: 0,
        withTimestamp: 0,
        flows: {},
        hsmStatuses: {}
      };
      var e = m[r.status];
      e.count += 1;
      if (r.failedAt) e.withTimestamp += 1;
      e.flows[r.flow] = (e.flows[r.flow] || 0) + 1;
      if (r.hsmStatus) e.hsmStatuses[r.hsmStatus] = (e.hsmStatuses[r.hsmStatus] || 0) + 1;
    });
    var list = Object.keys(m).map(function (k) {
      var e = m[k];
      var flows = Object.keys(e.flows).map(function (f) { return { flow: f, count: e.flows[f] }; })
        .sort(function (a, b) { return b.count - a.count; });
      e.topFlows = flows.slice(0, 5);
      e.flowsCount = flows.length;
      e.concentration = flows.length ? flows[0].count / e.count : null;
      e.hsmStatusList = Object.keys(e.hsmStatuses).map(function (s) { return s + ' (' + e.hsmStatuses[s] + ')'; });
      delete e.flows;
      delete e.hsmStatuses;
      return e;
    }).sort(function (a, b) { return b.count - a.count; });
    return { total: fails.length, base: rows.length, withTimestamp: fails.filter(function (r) { return !!r.failedAt; }).length, rows: list };
  }

  function kpi(label, value, sub, kind, extraClass) {
    return '<div class="kpi ' + (kind || '') + ' ' + (extraClass || '') + '">' +
      '<div class="label">' + esc(label) + '</div>' +
      '<div class="value">' + esc(value) + '</div>' +
      '<div class="sub">' + esc(sub) + '</div></div>';
  }

  function headline(s) {
    var label = (state.range || {}).label || 'Período selecionado';
    if (!state.dwMode) label += ' | fallback REST';
    return '<section class="hero-headline" aria-live="polite"><b>' + esc(label) + ':</b> ' +
      fmt(s.attempts) + ' tentativas | ' + pct(s.deliveryRate) + ' entregues | ' + pct(s.responseRate) + ' responderam</section>';
  }

  // Frescor é do WAREHOUSE, não do recorte. Um período sem linhas não vira
  // "dado velho": as duas informações são mostradas separadas para o leitor não
  // confundir "ninguém disparou" com "a ingestão parou".
  function buildFreshnessNoteHtml(raw) {
    var w = (raw || {}).warehouse;
    if (!w) return '';
    if (!w.latestEventAt) {
      return '<div class="note warn"><b>Warehouse sem eventos:</b> a fato de deployments não tem nenhuma linha. ' +
        'Checar ingestão da Treble antes de ler qualquer número desta tela.</div>';
    }
    var quando = dateTimeBr(w.latestEventAt);
    var idade = humanAge(w.ageMinutes);
    if (w.hardStale) {
      return '<div class="note warn"><b>Ingestão possivelmente parada:</b> o último disparo registrado no warehouse é de ' +
        esc(quando) + ' (há ' + esc(idade) + '). Períodos mais recentes que isso aparecem vazios porque o dado ainda não chegou, não porque o número é zero.</div>';
    }
    if (w.stale) {
      return '<div class="note"><b>Frescor:</b> último disparo registrado em ' + esc(quando) + ' (há ' + esc(idade) +
        '). A latência normal de ingestão da Treble vai até 3h.</div>';
    }
    return '<div class="note"><b>Frescor:</b> último disparo registrado em ' + esc(quando) + ' (há ' + esc(idade) + ').</div>';
  }

  function buildDroppedFilterNoteHtml(dropped) {
    if (!dropped || !dropped.length) return '';
    return '<div class="note"><b>Filtros descartados:</b> ' + esc(dropped.join(' | ')) +
      '. Esses valores não existem no período carregado e foram limpos para não zerar a tela em silêncio.</div>';
  }

  function buildFallbackNoteHtml(raw, dwMode) {
    raw = raw || {};
    var out = '';
    out += buildFreshnessNoteHtml(raw);
    if (raw.fallbackNote) {
      out += '<div class="note warn"><b>Aviso de fonte de dados:</b> ' + esc(raw.fallbackNote) + '</div>';
    } else if (!dwMode) {
      out += '<div class="note warn"><b>Fallback REST:</b> fonte legada de contingência, com contrato de métrica diferente do warehouse.</div>';
    }
    if (raw.rowsTruncated === true) {
      out += '<div class="note warn"><b>Alerta:</b> resultado truncado pelo limite de linhas do servidor (rowsTruncated=true); os totais exibidos podem não representar 100% do período selecionado.</div>';
    }
    if (raw.meta && raw.meta.flowsTruncated === true) {
      out += '<div class="note warn"><b>Alerta:</b> a Treble tem ' + esc(raw.meta.flowsTotal) + ' flows e a varredura leu ' +
        esc(raw.meta.flowsScanned) + '; os totais estão incompletos.</div>';
    }
    return out;
  }

  function renderFallbackNote() {
    return buildDroppedFilterNoteHtml(state.droppedFilters) + buildFallbackNoteHtml(state.raw, state.dwMode);
  }

  // Vazio tem duas causas distintas e a tela precisa dizer QUAL: período sem
  // disparo (resposta legítima) ou filtro de campo cortando tudo.
  function composeEmptyState(raw, dwMode, range, activeFieldFilters) {
    var label = (range && range.label) || 'período selecionado';
    var noteHtml = buildDroppedFilterNoteHtml((raw || {}).droppedFilters) + buildFallbackNoteHtml(raw, dwMode);
    if (activeFieldFilters && activeFieldFilters.length) {
      return {
        type: 'empty',
        title: 'Nenhuma tentativa com os filtros aplicados',
        text: 'Ativos: ' + activeFieldFilters.join(' | ') + '. Use Limpar para voltar ao período inteiro.',
        noteHtml: noteHtml
      };
    }
    return {
      type: 'empty',
      title: 'Nenhuma tentativa de disparo em ' + label,
      text: 'Zero é a resposta do período — a tela não trocou de fonte nem ampliou o intervalo.',
      noteHtml: noteHtml
    };
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
      '<div class="desc">Deltas absolutos e percentuais entre etapas. Leitura fica fora deste funil porque a fato de deployment não a mede | ' +
      'ela existe em outra fato e tem aba própria, com cobertura menor.</div></div></div>' +
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
    var whoTried;
    if (!leader) {
      whoTried = 'Sem agente identificado.';
    } else if (leader.agent === 'Não identificado') {
      whoTried = fmt(leader.attempts) + ' tentativas sem agente identificado.' +
        (identifiedLeader ? ' Entre os identificados, ' + identifiedLeader.agent + ' liderou com ' + fmt(identifiedLeader.attempts) + '.' : '');
    } else {
      whoTried = leader.agent + ' liderou com ' + fmt(leader.attempts) + ' tentativas.';
    }
    var origins = groupOrigin(rows);
    var manualAttempts = rows.filter(function (r) { return r.originManual; }).length;
    var lead = leadStats(rows);
    var lat = latencyStats(rows);
    var parity = (state.raw || {}).parity;
    var originText = state.dwMode && origins.length
      ? origins[0].label + ' respondeu por ' + pct(rows.length ? origins[0].attempts / rows.length : null) +
        ' das tentativas | ' + pct(rows.length ? manualAttempts / rows.length : null) + ' saiu de operação manual.'
      : 'Origem não disponível nesta fonte.';
    var leadText = state.dwMode
      ? fmt(lead.uniqueLeads) + ' pessoas distintas' +
        (lead.attemptsPerLead ? ' | ' + lead.attemptsPerLead.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' tentativas por lead' : '') +
        (lead.outlierLeads ? ' | ' + fmt(lead.outlierAttempts) + ' tentativas vêm de número com cara de teste' : '')
      : 'Grão de lead não disponível nesta fonte.';
    var latText = state.dwMode && lat.delivery.n
      ? 'Entrega em ' + dur(lat.delivery.p50) + ' na mediana' +
        (lat.response.n ? ' | resposta ' + dur(lat.response.p50) + ' depois de entregue' : '')
      : 'Latência não disponível nesta fonte.';
    var parityText = parity && parity.available
      ? (parity.verdict === 'ok'
        ? 'Pré-agregado da Treble concorda com a fato.'
        : 'Pré-agregado DISCORDA da fato em ' + parity.worstMetric + '.')
      : 'Sem segundo caminho nesta carga.';
    var story = '<div class="story-grid context-grid"><div class="story-card"><b>Quem tentou</b><span>' +
      esc(whoTried) + '</span></div>' +
      '<div class="story-card"><b>De onde saiu</b><span>' + esc(originText) + '</span></div>' +
      '<div class="story-card"><b>Quantas pessoas</b><span>' + esc(leadText) + '</span></div>' +
      '<div class="story-card"><b>Por que quebrou</b><span>' + (gargalo ? esc(gargalo.statusLabel) + ' concentrou ' + fmt(gargalo.count) + ' casos.' : 'Sem quebras.') + '</span></div>' +
      '<div class="story-card"><b>Quanto demorou</b><span>' + esc(latText) + '</span></div>' +
      '<div class="story-card"><b>Ação</b><span>' + (gargalo ? esc(gargalo.action) : 'Replicar flows com resposta.') + '</span></div>' +
      '<div class="story-card"><b>Prova independente</b><span>' + esc(parityText) + '</span></div></div>';
    var kpis = '<div class="kpis hierarchy-kpis">' +
      kpi('Tentativas', fmt(s.attempts), 'Hero do período', 'teal', 'hero-kpi') +
      kpi('Entregues', fmt(s.delivered), pct(s.deliveryRate) + ' das tentativas', 'good', 'secondary-kpi') +
      kpi('Não entregues', fmt(s.notDelivered), pct(s.attempts ? s.notDelivered / s.attempts : null) + ' das tentativas', 'bad', 'secondary-kpi') +
      kpi('Respondidas', fmt(s.replied), pct(s.responseRate) + ' das tentativas',
        s.responseRate >= 0.10 ? 'good' : (s.responseRate >= 0.03 ? 'warn' : 'bad'), 'secondary-kpi') +
      '</div>';
    return headline(s) + kpis + story + '<div class="grid">' + funnelDeltas(s) + statusComposition(rows) + agentRanking(rows) + '</div>';
  }

  function renderStatus(rows) {
    return '<div class="grid">' + statusComposition(rows) + '</div>';
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

  function dwOnlyNote(what) {
    return '<div class="card span-12"><div class="card-title"><div><h2>' + esc(what) + '</h2>' +
      '<div class="desc">Disponível somente no warehouse.</div></div></div>' +
      '<div class="note warn"><b>Indisponível no fallback REST:</b> esta leitura vem de colunas que só existem no ClickHouse ' +
      '(origem, timestamp de falha, latência, tentativa por lead, template). O fallback trabalha com sessões materializadas e não as tem.</div></div>';
  }

  // Corte mais macro que a tela não tinha: 70% das tentativas saem do inbox da
  // Sales.ai, uma por vez, e ficavam somadas com blast por API e carga de CSV
  // como se fossem a mesma operação.
  function renderOrigin(rows) {
    if (!state.dwMode) return '<div class="grid">' + dwOnlyNote('Origem do disparo') + '</div>';
    var by = groupOrigin(rows);
    var total = rows.length;
    var manual = rows.filter(function (r) { return r.originManual; }).length;
    var bars = by.map(function (o) {
      return '<div class="stack-seg ' + (o.manual ? 'teal' : 'warn') + '" style="width:' +
        Math.max(1, (total ? o.attempts / total : 0) * 100) + '%" title="' +
        esc(o.label + ' | ' + fmt(o.attempts) + ' | ' + pct(total ? o.attempts / total : null)) + '"></div>';
    }).join('');
    var trs = by.map(function (o) {
      return '<tr class="clickable-row" data-drill-field="origin" data-drill-value="' + esc(o.origin) + '">' +
        '<td><b>' + esc(o.label) + '</b><div class="muted">' + esc(o.origin) + ' | ' + esc(o.description) + '</div></td>' +
        '<td>' + fmt(o.attempts) + '</td><td>' + pct(total ? o.attempts / total : null) + '</td>' +
        '<td>' + fmt(o.leadsCount) + '</td><td>' + fmt(o.delivered) + '</td><td>' + pct(o.deliveryRate) + '</td>' +
        '<td>' + fmt(o.replied) + '</td><td>' + pct(o.responseRate) + '</td><td>' + fmt(o.flowsCount) + '</td>' +
        '<td>' + (o.manual ? 'Alguém digitou' : 'Automação') + '</td></tr>';
    }).join('');
    return '<div class="grid"><div class="card span-12"><div class="card-title"><div><h2>Origem do disparo</h2>' +
      '<div class="desc">Quem originou cada tentativa | ' + pct(total ? manual / total : null) +
      ' saiu de operação manual (inbox Sales.ai ou envio simples), o resto é automação nossa.</div></div></div>' +
      '<div class="stack100">' + bars + '</div>' +
      '<div class="table-wrap"><table><thead><tr><th>Origem</th><th>Tentativas</th><th>%</th><th>Leads</th>' +
      '<th>Entregues</th><th>Tx entrega</th><th>Respondidas</th><th>Tx resposta</th><th>Flows</th><th>Natureza</th></tr></thead><tbody>' +
      trs + '</tbody></table></div></div></div>';
  }

  // Grão de tentativa POR LEAD. `attemptSeq` é a posição na história da pessoa,
  // não no recorte, senão a 6ª tentativa de julho apareceria como 1ª em agosto.
  function renderAttempts(rows) {
    if (!state.dwMode) return '<div class="grid">' + dwOnlyNote('Tentativas por lead') + '</div>';
    var st = leadStats(rows);
    var by = groupAttempt(rows);
    var kpis = '<div class="kpis hierarchy-kpis">' +
      kpi('Tentativas', fmt(rows.length), 'Linhas do período', 'teal', 'hero-kpi') +
      kpi('Leads distintos', fmt(st.uniqueLeads), (st.attemptsPerLead ? st.attemptsPerLead.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—') + ' tentativas por lead', 'good', 'secondary-kpi') +
      kpi('Levaram mais de uma', fmt(st.reattempted), pct(st.reattemptedPct) + ' dos leads', 'warn', 'secondary-kpi') +
      kpi('Números suspeitos de teste', fmt(st.outlierLeads), fmt(st.outlierAttempts) + ' tentativas no período', st.outlierLeads ? 'bad' : 'good', 'secondary-kpi') +
      '</div>';
    var trs = by.map(function (a) {
      return '<tr class="clickable-row" data-drill-field="attemptBucket" data-drill-value="' + esc(a.bucket) + '">' +
        '<td><b>' + esc(a.label) + '</b></td><td>' + fmt(a.attempts) + '</td><td>' + fmt(a.delivered) + '</td>' +
        '<td>' + pct(a.deliveryRate) + '</td><td>' + fmt(a.replied) + '</td><td>' + pct(a.responseRate) + '</td>' +
        '<td>' + durHours(a.gapMedian) + '</td></tr>';
    }).join('');
    var leadTrs = st.top.map(function (l) {
      return '<tr class="clickable-row" data-drill-field="leadKey" data-drill-value="' + esc(l.leadKey) + '">' +
        '<td class="nowrap"><code>' + esc(l.leadKey) + '</code>' + (l.outlier ? '<div class="muted">suspeito de teste</div>' : '') + '</td>' +
        '<td>' + fmt(l.attemptsInPeriod) + '</td><td>' + fmt(l.attemptsAllTime) + '</td><td>' + fmt(l.delivered) + '</td>' +
        '<td>' + fmt(l.replied) + '</td><td>' + fmt(l.flowsCount) + '</td></tr>';
    }).join('');
    return kpis + '<div class="grid"><div class="card span-12"><div class="card-title"><div><h2>Entrega e resposta por número da tentativa</h2>' +
      '<div class="desc">Posição da tentativa na história do lead, não no recorte | intervalo é a mediana desde a tentativa anterior.</div></div></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Tentativa</th><th>Total</th><th>Entregues</th><th>Tx entrega</th>' +
      '<th>Respondidas</th><th>Tx resposta</th><th>Intervalo mediano</th></tr></thead><tbody>' + trs + '</tbody></table></div></div>' +
      '<div class="card span-12"><div class="card-title"><div><h2>Leads com mais tentativas</h2>' +
      '<div class="desc">Chave pseudônima do telefone (hash salgado, sem número) | "na história" conta fora do recorte também. ' +
      'Acima de 12 tentativas o número deixa de ser cadência e passa a inflar o denominador.</div></div></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Lead</th><th>No período</th><th>Na história</th><th>Entregues</th>' +
      '<th>Respondidas</th><th>Flows</th></tr></thead><tbody>' + leadTrs + '</tbody></table></div></div></div>';
  }

  function renderLatency(rows) {
    if (!state.dwMode) return '<div class="grid">' + dwOnlyNote('Latência de cada etapa') + '</div>';
    var l = latencyStats(rows);
    var kpis = '<div class="kpis hierarchy-kpis">' +
      kpi('Envio até entrega | p50', dur(l.delivery.p50), fmt(l.delivery.n) + ' entregas medidas', 'good', 'hero-kpi') +
      kpi('Envio até entrega | p90', dur(l.delivery.p90), 'cauda de entrega', 'warn', 'secondary-kpi') +
      kpi('Entrega até resposta | p50', dur(l.response.p50), fmt(l.response.n) + ' respostas medidas', 'good', 'secondary-kpi') +
      kpi('Entrega até resposta | p90', dur(l.response.p90), 'cauda de resposta', 'warn', 'secondary-kpi') +
      '</div>';
    var linhas = [
      { nome: 'Envio até entrega', b: l.delivery, f: dur },
      { nome: 'Entrega até resposta', b: l.response, f: dur },
      { nome: 'Intervalo desde a tentativa anterior', b: l.gap, f: durHours }
    ].map(function (x) {
      return '<tr><td><b>' + esc(x.nome) + '</b></td><td>' + fmt(x.b.n) + '</td><td>' + x.f(x.b.p50) + '</td><td>' +
        x.f(x.b.p90) + '</td><td>' + x.f(x.b.max) + '</td></tr>';
    }).join('');
    return kpis + '<div class="grid"><div class="card span-12"><div class="card-title"><div><h2>Latência por etapa</h2>' +
      '<div class="desc">Mediana e cauda, não média | quem não teve entrega ou resposta fica FORA do denominador em vez de entrar como zero.</div></div></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Etapa</th><th>Medidas</th><th>p50</th><th>p90</th><th>Máximo</th></tr></thead><tbody>' +
      linhas + '</tbody></table></div>' +
      '<div class="note"><b>Por que o máximo é absurdo em alguns recortes:</b> a Treble grava confirmação atrasada de operadora, ' +
      'então o máximo é evento real, não erro de conta. Ler p50 e p90; o máximo serve só para achar o caso extremo.</div></div></div>';
  }

  function renderHsm(rows) {
    if (!state.dwMode) return '<div class="grid">' + dwOnlyNote('HSM | template') + '</div>';
    var g = groupHsm(rows);
    var cov = g.total ? g.matched / g.total : null;
    var trs = g.rows.map(function (h) {
      return '<tr class="clickable-row" data-drill-field="hsm" data-drill-value="' + esc(h.hsm) + '">' +
        '<td><b>' + esc(h.hsm) + '</b><div class="muted">' + esc([h.hsmCategory, h.hsmType].filter(Boolean).join(' | ')) + '</div></td>' +
        '<td><span class="pill ' + (h.hsmStatus === 'APPROVED' ? 'good' : 'bad') + '">' + esc(h.hsmStatus || 'sem status') + '</span></td>' +
        '<td>' + fmt(h.attempts) + '</td><td>' + fmt(h.delivered) + '</td><td>' + pct(h.deliveryRate) + '</td>' +
        '<td>' + fmt(h.replied) + '</td><td>' + pct(h.responseRate) + '</td><td>' + fmt(h.flowsCount) + '</td></tr>';
    }).join('');
    var covNote = '<div class="note' + (cov != null && cov < 0.5 ? ' warn' : '') + '"><b>Cobertura do template: ' +
      pct(cov) + '</b> (' + fmt(g.matched) + ' de ' + fmt(g.total) + ' tentativas). ' +
      'A fato de deployment não tem hsm_id: o template só é nomeado quando o flow foi batizado igual ao HSM. ' +
      'As tentativas sem template não são envio sem HSM, são envio cujo template esta fonte não sabe nomear.</div>';
    return '<div class="grid"><div class="card span-12"><div class="card-title"><div><h2>HSM | template</h2>' +
      '<div class="desc">Grão mais granular que a Treble entrega hoje | status vem de dim_hsm, então HSM reprovado ou desativado aparece com o nome.</div></div></div>' +
      covNote +
      (g.rows.length
        ? '<div class="table-wrap"><table><thead><tr><th>Template</th><th>Status</th><th>Tentativas</th><th>Entregues</th>' +
          '<th>Tx entrega</th><th>Respondidas</th><th>Tx resposta</th><th>Flows</th></tr></thead><tbody>' + trs + '</tbody></table></div>'
        : '<div class="note">Nenhuma tentativa do recorte casou com template de dim_hsm.</div>') +
      '</div></div>';
  }

  function renderRead() {
    var r = (state.raw || {}).read;
    if (!state.dwMode || !r) return '<div class="grid">' + dwOnlyNote('Leitura') + '</div>';
    if (!r.available) {
      return '<div class="grid"><div class="card span-12"><div class="card-title"><div><h2>Leitura</h2></div></div>' +
        '<div class="note">Nenhuma mensagem de conversa no período: sem base para taxa de leitura.</div></div></div>';
    }
    var out = r.rows.filter(function (x) { return x.sender !== 'USER'; });
    var inbound = r.rows.filter(function (x) { return x.sender === 'USER'; });
    var inboundTotal = inbound.reduce(function (s, x) { return s + x.total; }, 0);
    var trs = out.map(function (x) {
      return '<tr><td><b>' + esc(x.category) + '</b><div class="muted">' + esc(x.sender === 'AI' ? 'automação' : 'agente') + '</div></td>' +
        '<td>' + fmt(x.total) + '</td><td>' + fmt(x.entregues) + '</td><td>' + fmt(x.lidas) + '</td><td>' + pctNum(x.readRate) + '</td></tr>';
    }).join('');
    return '<div class="grid"><div class="card span-12"><div class="card-title"><div><h2>Leitura | read receipt</h2>' +
      '<div class="desc">A tela dizia "leitura indisponível" | é verdade na fato de deployment, não no armazém: read_at existe em fact_agent_messages.</div></div></div>' +
      '<div class="kpis"><div class="kpi good"><div class="label">HSM lidos</div><div class="value">' + pctNum(r.hsm.readRate) +
      '</div><div class="sub">' + fmt(r.hsm.lidas) + ' de ' + fmt(r.hsm.entregues) + ' entregues</div></div>' +
      '<div class="kpi teal"><div class="label">Mensagens recebidas</div><div class="value">' + fmt(inboundTotal) +
      '</div><div class="sub">inbound não tem read receipt nosso</div></div></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Tipo</th><th>Enviadas</th><th>Entregues</th><th>Lidas</th><th>Tx leitura</th></tr></thead><tbody>' +
      trs + '</tbody></table></div>' +
      '<div class="note warn"><b>Cobertura parcial, e por isso não é KPI de topo:</b> ' + esc(r.caveat) + '</div>' +
      '<div class="note"><b>Este bloco ignora os filtros de agente, flow e status:</b> ele vem de outra fato, agregado no servidor, ' +
      'e só respeita o período. Comparar o volume dele com o funil acima é comparar bases diferentes.</div></div></div>';
  }

  function renderParity() {
    var p = (state.raw || {}).parity;
    if (!state.dwMode || !p) return '<div class="grid">' + dwOnlyNote('Reconciliação') + '</div>';
    if (!p.available) {
      return '<div class="grid"><div class="card span-12"><div class="card-title"><div><h2>Reconciliação</h2></div></div>' +
        '<div class="note warn"><b>Sem segundo caminho nesta carga:</b> ' + esc(p.reason || 'pré-agregado não respondeu') + '. ' +
        esc(p.note || '') + '</div></div></div>';
    }
    var trs = p.pairs.map(function (x) {
      return '<tr><td><b>' + esc(x.metric) + '</b></td><td>' + fmt(x.daily) + '</td><td>' + fmt(x.fact) + '</td>' +
        '<td>' + (x.diff > 0 ? '+' : '') + fmt(x.diff) + '</td>' +
        '<td><span class="pill ' + (x.verdict === 'ok' ? 'good' : 'bad') + '">' + (x.verdict === 'ok' ? 'bate' : 'divergente') + '</span></td></tr>';
    }).join('');
    var o = p.outcomes;
    var desfechos = [
      ['Em processamento', o.inProcess, 'status SUCCESS na fato | a Treble chama de in_process'],
      ['Transferidos para agente', o.toAgents, 'lead que caiu na fila de atendimento'],
      ['Opt-out', o.optout, 'pediu para sair | risco de reputação no WhatsApp'],
      ['Revogados', o.revoked, 'disparo cancelado antes de entregar'],
      ['Barrados por rate limit', o.rateLimit, 'teto de envio da Meta'],
      ['Telefone inválido', o.invalidPhone, 'número não existe ou não é WhatsApp']
    ].map(function (x) {
      return '<tr><td><b>' + esc(x[0]) + '</b><div class="muted">' + esc(x[2]) + '</div></td><td>' + fmt(x[1]) + '</td></tr>';
    }).join('');
    var verdictNote = p.verdict === 'ok'
      ? '<div class="note"><b>Os números desta tela têm prova independente:</b> o pré-agregado da própria Treble concorda com a fato ' +
        'dentro da tolerância (' + fmt(p.toleranceAbs) + ' linhas ou ' + pctNum(p.tolerancePct) + ').</div>'
      : '<div class="note warn"><b>Discordância real entre a fato e o pré-agregado da Treble</b> em ' + esc(p.worstMetric) +
        '. Não é arredondamento: alguma das duas leituras está incompleta e o número da tela não deve ser publicado antes de checar.</div>';
    return '<div class="grid"><div class="card span-12"><div class="card-title"><div><h2>Reconciliação com o pré-agregado da Treble</h2>' +
      '<div class="desc">Segundo caminho independente | fact_deployment_daily contra fact_deployment_status.</div></div></div>' +
      verdictNote +
      '<div class="table-wrap"><table><thead><tr><th>Métrica</th><th>Pré-agregado</th><th>Fato</th><th>Diferença</th><th>Veredito</th></tr></thead><tbody>' +
      trs + '</tbody></table></div>' +
      '<div class="note"><b>Régua de dia:</b> ' + esc(p.rulerNote) + ' No recorte atual, BRT ' + fmt(p.brtAttempts) +
      ' e UTC ' + fmt(p.utcAttempts) + ' (diferença de ' + plural(p.timezoneDelta, 'linha', 'linhas') + ' por fuso).</div></div>' +
      '<div class="card span-12"><div class="card-title"><div><h2>Desfechos que a fato de status não expressa</h2>' +
      '<div class="desc">' + esc(p.outcomesNote) + '</div></div></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Desfecho</th><th>Total</th></tr></thead><tbody>' + desfechos +
      '</tbody></table></div></div></div>';
  }

  // Erro deixa de ser total agregado: passa a ter ONDE (concentração por flow) e
  // QUANDO (timestamp da falha). É o que separa variável mal configurada, que se
  // conserta hoje, de reputação de template, que é outro diagnóstico.
  function renderErrors(rows) {
    if (!state.dwMode) return '<div class="grid">' + statusComposition(rows.filter(function (r) { return r.statusGroup !== 'delivered'; })) + '</div>';
    var g = groupErrors(rows);
    var cards = g.rows.map(function (e) {
      var flows = e.topFlows.map(function (f) {
        return '<tr><td>' + esc(f.flow) + '</td><td>' + fmt(f.count) + '</td><td>' + pct(e.count ? f.count / e.count : null) + '</td></tr>';
      }).join('');
      return '<div class="card span-6"><div class="card-title"><div><h2>' + esc(e.statusLabel) + ' | ' + fmt(e.count) + '</h2>' +
        '<div class="desc">' + esc(e.status) + ' | ' + pct(g.total ? e.count / g.total : null) + ' das não entregues | ' +
        'concentração no pior flow: ' + pct(e.concentration) + ' | ' + plural(e.flowsCount, 'flow afetado', 'flows afetados') + '</div></div></div>' +
        '<div class="note' + (e.statusGroup === 'not_delivered' ? ' warn' : '') + '"><b>Ação:</b> ' + esc(e.action) + '</div>' +
        (e.hsmStatusList.length ? '<div class="note"><b>Status do template envolvido:</b> ' + esc(e.hsmStatusList.join(' | ')) + '</div>' : '') +
        '<div class="table-wrap"><table><thead><tr><th>Flow</th><th>Casos</th><th>% do erro</th></tr></thead><tbody>' + flows +
        '</tbody></table></div>' +
        '<div class="muted">Instante da falha registrado em ' + fmt(e.withTimestamp) + ' de ' + fmt(e.count) + ' casos.</div></div>';
    }).join('');
    var head = '<div class="card span-12"><div class="card-title"><div><h2>Não entregues</h2>' +
      '<div class="desc">' + fmt(g.total) + ' de ' + fmt(g.base) + ' tentativas (' + pct(g.base ? g.total / g.base : null) +
      ') | timestamp de falha disponível em ' + fmt(g.withTimestamp) + '.</div></div></div>' +
      '<div class="note">Cada erro tem diagnóstico diferente: parâmetro ausente e HSM desativado são configuração nossa, ' +
      'e concentram em poucos flows. Meta não entregou é reputação ou política de template. ' +
      'A coluna de concentração é o que separa os dois.</div></div>';
    return '<div class="grid">' + head + cards + '</div>' +
      '<div class="grid">' + renderTable(rows.filter(function (r) { return r.statusGroup !== 'delivered'; }), true) + '</div>';
  }

  function renderTable(rows, compact) {
    var limit = compact ? 80 : 300;
    var truncationNote = rows.length > limit
      ? '<div class="note"><b>Detalhe parcial:</b> mostrando ' + fmt(limit) + ' de ' + fmt(rows.length) + ' tentativas. Aplique filtros para reduzir o recorte.</div>'
      : '';
    return '<div class="card span-12"><div class="card-title"><div><h2>Detalhe por tentativa</h2>' +
      '<div class="desc">Uma linha por tentativa real, com origem, número da tentativa no lead, template, latência e instante da falha. ' +
      'Sem telefone, email, conteúdo ou IDs sensíveis | o lead é um pseudônimo.</div></div></div>' +
      truncationNote +
      '<div class="table-wrap"><table><thead><tr><th>Data e hora</th><th>Origem</th><th>Lead</th><th>Tentativa</th><th>Agente</th>' +
      '<th>Flow</th><th>Template</th><th>Status</th><th>Entregue em</th><th>Falhou em</th></tr></thead><tbody>' +
      rows.slice(0, limit).map(function (m) {
        var tentativa = m.attemptSeq
          ? m.attemptSeq + 'ª de ' + fmt(m.leadAttemptsTotal || m.attemptSeq)
          : '—';
        return '<tr><td class="nowrap">' + esc(m.createdAt ? dateTimeBr(m.createdAt) : day(m.createdDay)) + '</td>' +
          '<td>' + esc(m.originLabel || '—') + '</td>' +
          '<td class="nowrap">' + (m.leadKey ? '<code>' + esc(m.leadKey) + '</code>' : '—') +
          (m.leadOutlier ? '<div class="muted">suspeito de teste</div>' : '') + '</td>' +
          '<td class="nowrap">' + esc(tentativa) + (m.gapPrevHours != null ? '<div class="muted">' + esc(durHours(m.gapPrevHours)) + ' depois</div>' : '') + '</td>' +
          '<td>' + esc(m.agent) + '<div class="muted">' + esc(sourceBadge(m.agentSource)) + '</div></td>' +
          '<td>' + esc(m.flow) + '</td>' +
          '<td>' + (m.hsm ? esc(m.hsm) + '<div class="muted">' + esc(m.hsmStatus) + '</div>' : '<span class="muted">sem template nomeado</span>') + '</td>' +
          '<td><span class="pill ' + statusClass(m.statusGroup) + '" title="' + esc(m.action) + '">' + esc(m.statusLabel) +
          '</span><div class="muted">' + esc(m.status) + '</div></td>' +
          '<td class="nowrap">' + esc(m.deliveryLagSec != null ? dur(m.deliveryLagSec) : '—') + '</td>' +
          '<td class="nowrap">' + esc(m.failedAt ? dateTimeBr(m.failedAt) : '—') + '</td></tr>';
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
      var emptyRaw = Object.assign({}, state.raw || {}, { droppedFilters: state.droppedFilters });
      var emptyState = composeEmptyState(emptyRaw, state.dwMode, state.range, activeFieldFilters());
      setState(emptyState.type, emptyState.title, emptyState.text, emptyState.noteHtml);
      return;
    }

    var s = summarize(rows);
    var flags = '<div class="active-filters-line" aria-live="polite">' + esc(activeFilterLine(rows.length, state.totalRows || state.rows.length)) + '</div>';
    var globalNote = renderFallbackNote();
    // Ordem das abas = macro para granular: origem do disparo, quem enviou,
    // status, erro com concentração, tentativa por lead, latência, template,
    // leitura, reconciliação, e só então a linha a linha.
    var tabDefs = [
      ['overview', 'Resumo'],
      ['origin', 'Origem'],
      ['agents', 'Quem enviou'],
      ['status', 'Status'],
      ['failures', 'Erros'],
      ['attempts', 'Tentativas por lead'],
      ['latency', 'Latência'],
      ['hsm', 'HSM'],
      ['read', 'Leitura'],
      ['parity', 'Reconciliação'],
      ['timeline', 'Linha do tempo'],
      ['audience', 'Público'],
      ['detail', 'Detalhe'],
      ['api', 'Arquitetura API']
    ];
    var tabs = '<div class="tabs">' + tabDefs.map(function (t) {
      return '<button class="tab ' + (state.tab === t[0] ? 'active' : '') + '" onclick="BdrTreble.tab(\'' + t[0] + '\')">' +
        esc(t[1]) + '</button>';
    }).join('') + '</div>';
    var body;
    if (state.tab === 'origin') body = renderOrigin(rows);
    else if (state.tab === 'agents') body = '<div class="grid">' + agentRanking(rows) + '</div>';
    else if (state.tab === 'status') body = renderStatus(rows);
    else if (state.tab === 'failures') body = renderErrors(rows);
    else if (state.tab === 'attempts') body = renderAttempts(rows);
    else if (state.tab === 'latency') body = renderLatency(rows);
    else if (state.tab === 'hsm') body = renderHsm(rows);
    else if (state.tab === 'read') body = renderRead();
    else if (state.tab === 'parity') body = renderParity();
    else if (state.tab === 'timeline') body = '<div class="grid">' + timeline(rows) + '</div>';
    else if (state.tab === 'audience') body = '<div class="grid">' + renderAudience(rows) + '</div>';
    else if (state.tab === 'detail') body = '<div class="grid">' + renderTable(rows, false) + '</div>';
    else if (state.tab === 'api') body = renderApiMap(rows);
    else body = renderOverview(rows, s);

    if (stateEl) stateEl.classList.add('hidden');
    content.classList.remove('hidden');
    content.innerHTML = flags + globalNote + tabs + body + '<div class="footer-note">Segurança, PII e memória de cálculo ficam no botão de ajuda.</div>';
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
        // O fallback não tem NENHUMA das colunas granulares do warehouse. Elas
        // vêm vazias de propósito, para a tela dizer "não medido" em vez de
        // exibir zero, que leria como "aconteceu e deu zero".
        origin: '',
        originLabel: '',
        originDescription: '',
        originManual: false,
        leadKey: '',
        attemptSeq: 0,
        leadAttemptsTotal: 0,
        attemptBucket: '',
        attemptBucketLabel: '',
        firstAttempt: false,
        leadOutlier: false,
        gapPrevHours: null,
        deliveryLagSec: null,
        responseLagSec: null,
        failedAt: '',
        hsm: '',
        hsmMatched: false,
        hsmStatus: '',
        hsmCategory: '',
        hsmType: '',
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

  function isNoFallbackStatus(status) {
    return status === 400 || status === 401 || status === 403;
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

  function buildFallbackNote(range) {
    var label = (range && range.label) || 'período selecionado';
    return 'O Data Warehouse falhou e a tela caiu na API REST da Treble, recortada em ' + label +
      '. O contrato muda: aqui a base são sessões materializadas, não tentativas de deployment, ' +
      'e o dia vem do created_at em UTC — números não são comparáveis com os do warehouse.';
  }

  function loadRestFallback(url, range) {
    return fetch(url, { credentials: 'include' }).then(function (response) {
      if (!response.ok) {
        var error = new Error(
          response.status === 401 || response.status === 403
            ? 'Não autorizado. Faça login novamente.'
            : 'Fallback REST falhou com HTTP ' + response.status
        );
        error.status = response.status;
        if (isNoFallbackStatus(response.status)) error.noFallback = true;
        throw error;
      }
      return response.json();
    }).then(function (json) {
      var label = (range && range.label) || 'período selecionado';
      json.source = 'treble_rest_fallback';
      json.dateRange = Object.assign({}, range || {}, { label: label });
      json.meta = json.meta || {};
      json.meta.sourceLabel = 'Fallback REST | ' + label;
      json.meta.metricContract = 'Fallback REST normalizado para o shape V2: base são sessões materializadas em sessions/history, não tentativas de deployment. Dia derivado de created_at em UTC.';
      json.meta.privacy = 'Payload normalizado sem telefone/email exibidos na UI.';
      json.apiMap = json.apiMap || [];
      json.messages = clipRowsToRange(normalizeRestRows(json), range);
      json.fallbackNote = buildFallbackNote(range);
      return json;
    });
  }

  var api = {
    load: function (refresh) {
      setState('loading', 'Carregando Treble', 'Buscando dados do Treble Data Warehouse');
      var f = state.filters;
      var clientRange = resolveClientRange(f);
      var dwUrl = '/api/bdr-treble-dw?preset=' + encodeURIComponent(f.preset || 'today') +
        (f.preset === 'custom' ? '&from=' + encodeURIComponent(f.from || '') + '&to=' + encodeURIComponent(f.to || '') : '') +
        (refresh ? '&refresh=true' : '');
      var fallbackUrl = '/api/bdr-treble?days=' + fallbackDaysForRange(clientRange) + (refresh ? '&refresh=true' : '');

      // O DW responder 200 é resposta final, inclusive quando o período tem zero
      // linhas. Trocar de fonte porque "hoje está vazio" era o que fazia o filtro
      // Hoje exibir 30 dias de REST. Fallback agora só existe para DW quebrado.
      fetch(dwUrl, { credentials: 'include' }).then(function (r) {
        if (r.ok) {
          return r.json().then(function (dwJson) {
            if (!dwJson.success) throw new Error(dwJson.error || dwJson.message || 'Resposta inválida');
            return dwJson;
          });
        }
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
        return loadRestFallback(fallbackUrl, clientRange);
      }).then(function (json) {
        if (!json.success) throw new Error(json.error || json.message || 'Resposta inválida');
        state.raw = json;
        state.dwMode = json.source === 'treble_data_warehouse';
        state.rows = json.messages || [];
        state.totalRows = state.rows.length;
        state.range = json.dateRange || clientRange;
        state.droppedFilters = pruneGhostFilters(state.rows);
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
      $('help-body').innerHTML = '<div class="help-block"><b>Fonte</b><p>ClickHouse Treble, via API server-side autenticada. ' +
        'fact_deployment_status (uma linha por tentativa) para o funil; fact_deployment_daily para reconciliar e para os desfechos que a fato de status não tem; ' +
        'fact_agent_messages para leitura; dim_hsm para nomear o template; dim_agents para atribuição direta.</p></div>' +
        '<div class="help-block"><b>Entrega</b><p>Entregue = timestamp_delivered válido ou status DELIVERED. Resposta válida entra no funil como entregue, mas não muda o status bruto.</p></div>' +
        '<div class="help-block"><b>Origem</b><p>HELPDESK_INTEGRATION = HSM disparado de dentro do inbox da Sales.ai, um lead por vez. ' +
        'API = disparo nosso por comando. CSV = lote por planilha. SIMPLE = envio simples pela UI da Treble. ' +
        'Somar os quatro sem separar mistura operação manual com automação.</p></div>' +
        '<div class="help-block"><b>Tentativa por lead</b><p>attemptSeq é a posição da tentativa na história do lead, contada na fato INTEIRA, não dentro do período. ' +
        'O lead aparece como pseudônimo: hash salgado do telefone, 12 caracteres. É pseudonimização, não anonimização — o telefone nunca sai do servidor, ' +
        'mas o espaço de números é pequeno e o sal vive no código.</p></div>' +
        '<div class="help-block"><b>Latência</b><p>Mediana e p90, nunca média. Tentativa sem entrega ou sem resposta fica FORA do denominador em vez de entrar como zero. ' +
        'Máximo alto é confirmação atrasada de operadora, evento real.</p></div>' +
        '<div class="help-block"><b>HSM</b><p>A fato de deployment não tem hsm_id: o template é nomeado por join de NOME com dim_hsm, ' +
        'e só casa quando o flow foi batizado igual ao HSM. A cobertura vai declarada na aba. Tentativa sem template não é envio sem HSM.</p></div>' +
        '<div class="help-block"><b>Reconciliação</b><p>fact_deployment_daily é o pré-agregado da própria Treble e serve de segundo caminho. ' +
        'A coluna day dele é UTC e esta tela conta em BRT, então a comparação roda em UTC nas duas pontas de propósito: ' +
        'comparar régua diferente produziria divergência permanente por fuso. A diferença de fuso aparece explícita no bloco.</p></div>' +
        '<div class="help-block"><b>Atribuição</b><p>Direta por origin_id=dim_agents.id; quando não há match, inferência pelo nome do flow; origin_id nunca é exposto ao browser.</p></div>' +
        '<div class="help-block"><b>Leitura</b><p>Não existe em fact_deployment_status. Existe em fact_agent_messages (read_at) e tem aba própria, ' +
        'só em agregado e com cobertura parcial: apenas conversa que passou por agente. O denominador dela não é o do funil, então não vira KPI de topo.</p></div>' +
        '<div class="help-block"><b>Período vazio ≠ dado velho</b><p>Se o período selecionado não tem linhas, a tela mostra zero e continua no warehouse. ' +
        'Ela não amplia o intervalo nem troca de fonte. O frescor da ingestão é reportado à parte, pelo último evento da fato inteira.</p></div>' +
        '<div class="help-block"><b>Fallback REST</b><p>Só entra quando o Data Warehouse falha (erro de servidor ou rede), nunca por período vazio. ' +
        'Quando entra, respeita o período escolhido e avisa que o contrato de métrica mudou.</p></div>' +
        '<div class="help-block"><b>Privacidade</b><p>Sem telefone, email, conteúdo, origin_id ou IDs sensíveis.</p></div>';
      $('help-backdrop').classList.add('open');
      $('help-drawer').classList.add('open');
    },
    closeHelp: function () {
      $('help-backdrop').classList.remove('open');
      $('help-drawer').classList.remove('open');
    },
    _test: {
      dur: dur,
      durHours: durHours,
      quantile: quantile,
      groupOrigin: groupOrigin,
      groupAttempt: groupAttempt,
      leadStats: leadStats,
      latencyStats: latencyStats,
      groupHsm: groupHsm,
      groupErrors: groupErrors,
      shouldFallback: shouldFallback,
      isNoFallbackStatus: isNoFallbackStatus,
      humanRangeError: humanRangeError,
      majoritySource: majoritySource,
      buildFallbackNote: buildFallbackNote,
      normalizeRestRows: normalizeRestRows,
      buildFallbackNoteHtml: buildFallbackNoteHtml,
      buildFreshnessNoteHtml: buildFreshnessNoteHtml,
      buildDroppedFilterNoteHtml: buildDroppedFilterNoteHtml,
      composeEmptyState: composeEmptyState,
      resolveClientRange: resolveClientRange,
      fallbackDaysForRange: fallbackDaysForRange,
      clipRowsToRange: clipRowsToRange,
      humanAge: humanAge,
      dateTimeBr: dateTimeBr,
      shiftIso: shiftIso,
      pruneGhostFilters: pruneGhostFilters,
      _state: state
    }
  };

  window.BdrTreble = api;
  window.addEventListener('DOMContentLoaded', function () { api.load(false); });
})();
