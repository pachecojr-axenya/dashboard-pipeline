(function () {
  'use strict';

  var state = {
    raw: null,
    messages: [],
    filters: loadFilters(),
    tab: 'strategic'
  };

  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) { return Number(n || 0).toLocaleString('pt-BR'); }
  function pct(v) { return v == null ? 'Não medido' : (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'; }
  function day(v) { return v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—'; }
  function clsStatus(s) { return s === 'FAILED' ? 'bad' : (s === 'READ' || s === 'DELIVERED' || s === 'RECEIVED' ? 'good' : (s === 'UNKNOWN' ? 'warn' : 'teal')); }

  function loadFilters() {
    try {
      var saved = JSON.parse(localStorage.getItem('bdr_treble_filters') || '{}');
      return {
        days: saved.days || '180', bdr: saved.bdr || '', flow: saved.flow || '',
        direction: saved.direction || '', status: saved.status || '', q: saved.q || ''
      };
    } catch (e) {
      return { days: '180', bdr: '', flow: '', direction: '', status: '', q: '' };
    }
  }
  function saveFilters() { try { localStorage.setItem('bdr_treble_filters', JSON.stringify(state.filters)); } catch (e) {} }

  function setState(type, title, text) {
    var el = $('state');
    var content = $('content');
    if (content) content.classList.add('hidden');
    if (!el) return;
    el.classList.remove('hidden');
    el.innerHTML = (type === 'loading' ? '<div class="spinner"></div>' : '') + '<strong>' + esc(title) + '</strong>' + esc(text || '');
  }

  function unique(arr, field) {
    var seen = {}, out = [];
    arr.forEach(function (m) { var v = m[field] || ''; if (v && !seen[v]) { seen[v] = true; out.push(v); } });
    return out.sort(function (a, b) { return String(a).localeCompare(String(b)); });
  }

  function renderFilters() {
    var el = $('filters');
    if (!el) return;
    var bdrs = unique(state.messages, 'bdr');
    var flows = unique(state.messages, 'flow');
    var statuses = unique(state.messages, 'status');
    function opts(values, selected, allLabel) {
      var h = '<option value="">' + esc(allLabel) + '</option>';
      values.forEach(function (v) { h += '<option value="' + esc(v) + '"' + (String(v) === String(selected) ? ' selected' : '') + '>' + esc(v) + '</option>'; });
      return h;
    }
    var periods = [['30', '30d'], ['90', '90d'], ['180', '180d'], ['365', '365d']];
    var h = '<div class="periodbar"><span class="period-label">Período</span>';
    periods.forEach(function (p) { h += '<button class="period-chip' + (state.filters.days === p[0] ? ' active' : '') + '" data-days="' + p[0] + '">' + p[1] + '</button>'; });
    h += '<span class="muted">Cache server-side 10 min | refresh força recarga</span></div>';
    h += '<div class="filter"><label>BDR</label><select id="f-bdr">' + opts(bdrs, state.filters.bdr, 'Todos') + '</select></div>';
    h += '<div class="filter"><label>Flow</label><select id="f-flow">' + opts(flows, state.filters.flow, 'Todos') + '</select></div>';
    h += '<div class="filter"><label>Direção</label><select id="f-direction"><option value="">Todas</option><option value="OUTBOUND">Outbound</option><option value="INBOUND">Inbound</option><option value="UNKNOWN">Não identificada</option></select></div>';
    h += '<div class="filter"><label>Status</label><select id="f-status">' + opts(statuses, state.filters.status, 'Todos') + '</select></div>';
    h += '<div class="filter"><label>Busca textual</label><input id="f-q" value="' + esc(state.filters.q) + '" placeholder="snippet, flow ou BDR"></div>';
    h += '<div class="filter" style="display:flex;align-items:end;gap:.5rem"><button class="btn" id="f-clear">Limpar</button><button class="btn primary" id="f-refresh">Refresh</button></div>';
    el.innerHTML = h;
    $('f-direction').value = state.filters.direction;
    function bind(id, key) { var x = $(id); if (x) x.onchange = function () { state.filters[key] = x.value; saveFilters(); render(); }; }
    bind('f-bdr', 'bdr'); bind('f-flow', 'flow'); bind('f-direction', 'direction'); bind('f-status', 'status');
    $('f-q').oninput = function () { state.filters.q = this.value; saveFilters(); render(); };
    $('f-clear').onclick = function () { state.filters = { days: state.filters.days, bdr: '', flow: '', direction: '', status: '', q: '' }; saveFilters(); render(); };
    $('f-refresh').onclick = function () { api.load(true); };
    Array.prototype.forEach.call(el.querySelectorAll('.period-chip'), function (b) { b.onclick = function () { state.filters.days = b.getAttribute('data-days'); saveFilters(); api.load(false); }; });
  }

  function filtered() {
    var q = String(state.filters.q || '').toLowerCase();
    return state.messages.filter(function (m) {
      if (state.filters.bdr && m.bdr !== state.filters.bdr) return false;
      if (state.filters.flow && m.flow !== state.filters.flow) return false;
      if (state.filters.direction && m.direction !== state.filters.direction) return false;
      if (state.filters.status && m.status !== state.filters.status) return false;
      if (q) {
        var hay = [m.snippet, m.bdr, m.flow, m.direction, m.statusLabel].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function summary(rows) {
    var s = { total: rows.length, outbound: 0, inbound: 0, failed: 0, delivered: 0, read: 0, unknown: 0, withoutOwner: 0 };
    rows.forEach(function (m) {
      if (m.direction === 'OUTBOUND') s.outbound++;
      if (m.direction === 'INBOUND') s.inbound++;
      if (m.status === 'FAILED') s.failed++;
      if (m.status === 'DELIVERED' || m.status === 'READ') s.delivered++;
      if (m.status === 'READ') s.read++;
      if (m.status === 'UNKNOWN') s.unknown++;
      if (!m.ownerPresent) s.withoutOwner++;
    });
    s.responseRate = s.outbound ? s.inbound / s.outbound : null;
    s.failureRate = s.outbound ? s.failed / s.outbound : null;
    s.statusCoverage = s.total ? (s.total - s.unknown) / s.total : null;
    return s;
  }

  function group(rows, field) {
    var map = {};
    rows.forEach(function (m) {
      var k = m[field] || 'Sem dado';
      if (!map[k]) map[k] = { key: k, total: 0, outbound: 0, inbound: 0, failed: 0, delivered: 0, read: 0, unknown: 0, withoutOwner: 0 };
      var r = map[k]; r.total++;
      if (m.direction === 'OUTBOUND') r.outbound++;
      if (m.direction === 'INBOUND') r.inbound++;
      if (m.status === 'FAILED') r.failed++;
      if (m.status === 'DELIVERED' || m.status === 'READ') r.delivered++;
      if (m.status === 'READ') r.read++;
      if (m.status === 'UNKNOWN') r.unknown++;
      if (!m.ownerPresent) r.withoutOwner++;
    });
    return Object.keys(map).map(function (k) { var r = map[k]; r.responseRate = r.outbound ? r.inbound / r.outbound : null; r.score = r.inbound / (r.outbound + 10); return r; })
      .sort(function (a, b) { return b.total - a.total; });
  }

  function kpi(label, value, sub, kind, drillKind) {
    return '<div class="kpi ' + (kind || '') + (drillKind ? ' clickable" data-drill-kind="' + esc(drillKind) + '"' : '"') + '><div class="label">' + esc(label) + '</div><div class="value">' + esc(value) + '</div><div class="sub">' + esc(sub) + '</div></div>';
  }

  function barRows(rows, type, limit, bad) {
    if (!rows.length) return '<div class="muted">Sem dados no filtro.</div>';
    var max = Math.max.apply(null, rows.map(function (r) { return r.total; }).concat([1]));
    return rows.slice(0, limit || 10).map(function (r) {
      return '<div class="bar-row clickable-row" data-drill-field="' + esc(type) + '" data-drill-value="' + esc(r.key) + '"><div class="bar-name">' + esc(r.key) + '<div class="muted">Resp. por mensagem ' + pct(r.responseRate) + ' | falhas ' + fmt(r.failed) + '</div></div><div class="bar-track"><div class="bar-fill ' + (bad ? 'bad' : '') + '" style="width:' + Math.max(3, Math.round(r.total / max * 100)) + '%"></div></div><div class="bar-val">' + fmt(r.total) + '</div><div class="bar-val">' + fmt(r.inbound) + ' resp.</div></div>';
    }).join('');
  }

  function renderStrategic(rows, s) {
    var byFlow = group(rows, 'flow');
    var byBdr = group(rows, 'bdr');
    var best = byFlow.filter(function (r) { return r.outbound >= 5; }).sort(function (a, b) { return b.score - a.score; })[0];
    var worst = byFlow.filter(function (r) { return r.outbound >= 5; }).sort(function (a, b) { return b.failed - a.failed || b.total - a.total; })[0];
    var story = '<div class="story-grid">' +
       '<div class="story-card"><b>O que aconteceu</b><span>' + fmt(s.total) + ' mensagens Treble sincronizadas | ' + fmt(s.outbound) + ' outbound | ' + fmt(s.inbound) + ' inbound.</span></div>' +
      '<div class="story-card"><b>Onde está o gargalo</b><span>' + fmt(s.failed) + ' falhas | ' + fmt(s.withoutOwner) + ' sem owner | status medido em ' + pct(s.statusCoverage) + '.</span></div>' +
      '<div class="story-card"><b>O que funciona</b><span>' + (best ? esc(best.key) + ' tem melhor resposta ajustada a volume.' : 'Sem volume suficiente por flow no filtro.') + '</span></div>' +
      '<div class="story-card"><b>O que fazer na próxima vez</b><span>' + (worst ? 'Revisar entrega e copy do flow ' + esc(worst.key) + '.' : 'Padronizar metadata e owner para melhorar leitura.') + '</span></div></div>';
    var kpis = '<div class="kpis">' +
      kpi('Mensagens', fmt(s.total), 'Universo filtrado', 'teal', 'all') +
      kpi('Outbound', fmt(s.outbound), 'HSMs e envios', '', 'outbound') +
       kpi('Respostas', fmt(s.inbound), 'Por mensagem | inbound ÷ outbound = ' + pct(s.responseRate), 'good', 'inbound') +
      kpi('Falhas', fmt(s.failed), 'Falhas ÷ outbound = ' + pct(s.failureRate), s.failed ? 'bad' : '', 'failed') +
      kpi('Entregues', fmt(s.delivered), s.delivered ? 'Cobertura parcial' : 'Não medido', s.delivered ? 'good' : 'warn', 'delivered') +
      kpi('Sem owner', fmt(s.withoutOwner), 'Owner do contato ausente', s.withoutOwner ? 'warn' : 'good', 'owner') + '</div>';
    return story + kpis + '<div class="grid"><div class="card span-6"><div class="card-title"><div><h2>Flows por volume e resposta</h2><div class="desc">Clique para ver snippets sanitizados.</div></div></div>' + barRows(byFlow, 'flow', 12, false) + '</div><div class="card span-6"><div class="card-title"><div><h2>BDRs por proxy de owner</h2><div class="desc">Owner atual do contato associado | não autor histórico.</div></div></div>' + barRows(byBdr, 'bdr', 12, false) + '</div></div>';
  }

  function renderDiagnosis(rows) {
    var byFlow = group(rows, 'flow');
    var byStatus = group(rows, 'statusLabel');
    var bad = byFlow.slice().sort(function (a, b) { return b.failed - a.failed || b.withoutOwner - a.withoutOwner; });
    return '<div class="grid"><div class="card span-8"><div class="card-title"><div><h2>Diagnóstico por flow</h2><div class="desc">Falhas, resposta, volume e cobertura parcial de status.</div></div></div>' + barRows(bad, 'flow', 18, true) + '</div><div class="card span-4"><div class="card-title"><div><h2>Status medido</h2><div class="desc">Não medido é ausência de status, não zero.</div></div></div>' + barRows(byStatus, 'statusLabel', 10, false) + '</div></div>' + renderTable(rows.slice(0, 60), true);
  }

  function renderTable(rows, compact) {
     var h = '<div class="card span-12"><div class="card-title"><div><h2>Detalhe de mensagens</h2><div class="desc">Snippets outbound redigidos por heurística | conteúdo inbound ocultado | sem email, telefone, CPF/CNPJ ou payload bruto.</div></div></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Direção</th><th>Status</th><th>BDR proxy</th><th>Flow</th><th>Snippet</th><th>Mensurabilidade</th><th>HubSpot</th></tr></thead><tbody>';
    rows.slice(0, compact ? 80 : 300).forEach(function (m) {
      h += '<tr><td class="nowrap">' + day(m.timestamp) + '</td><td>' + esc(m.direction) + '</td><td><span class="pill ' + clsStatus(m.status) + '">' + esc(m.statusLabel || m.status) + '</span></td><td>' + esc(m.bdr) + '<div class="muted">' + esc(m.bdrSource) + '</div></td><td>' + esc(m.flow) + '</td><td>' + esc(m.snippet || '—') + '</td><td>' + esc(m.measurability || '—') + '</td><td><a class="deal-link" href="' + esc(m.hubspotUrl) + '" target="_blank" rel="noopener">Abrir</a></td></tr>';
    });
    return h + '</tbody></table></div></div>';
  }

  function render() {
    renderFilters();
    var rows = filtered();
    var content = $('content'), stateEl = $('state');
    if (!rows.length) { setState('empty', 'Sem dados no filtro', 'Ajuste período ou filtros.'); return; }
    var s = summary(rows);
    var meta = state.raw && state.raw.meta ? state.raw.meta : {};
    var flags = '<div class="note"><b>Status do sync:</b> origem = ' + esc(meta.source || 'HubSpot communications') + ' | gerado em ' + esc(day(state.raw && state.raw.generatedAt)) + (state.raw && state.raw.cached ? ' | cache' : '') + (state.raw && state.raw.stale ? ' | stale' : '') + '. <b>Limitação:</b> BDR é proxy do owner atual do contato associado.</div>';
    var tabs = '<div class="tabs"><button class="tab ' + (state.tab === 'strategic' ? 'active' : '') + '" onclick="BdrTreble.tab(\'strategic\')">Estratégico</button><button class="tab ' + (state.tab === 'diagnosis' ? 'active' : '') + '" onclick="BdrTreble.tab(\'diagnosis\')">Diagnóstico por flow/mensagem</button><button class="tab ' + (state.tab === 'detail' ? 'active' : '') + '" onclick="BdrTreble.tab(\'detail\')">Detalhe de mensagens</button></div>';
    var body = state.tab === 'diagnosis' ? renderDiagnosis(rows) : (state.tab === 'detail' ? renderTable(rows, false) : renderStrategic(rows, s));
     if (stateEl) stateEl.classList.add('hidden');
     content.classList.remove('hidden');
     content.innerHTML = flags + tabs + body;
     bindDynamicDrills(content);
  }

  function bindDynamicDrills(root) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-drill-kind]'), function (el) {
      el.addEventListener('click', function () { api.drill(el.getAttribute('data-drill-kind')); });
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-drill-field]'), function (el) {
      el.addEventListener('click', function () {
        api.drillGroup(el.getAttribute('data-drill-field'), el.getAttribute('data-drill-value'));
      });
    });
  }

  function modal(title, rows) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = renderTable(rows, false);
    $('modal-overlay').classList.add('open');
  }

  var api = {
    load: function (refresh) {
      setState('loading', 'Carregando dados', 'Buscando /api/bdr-treble');
      var url = '/api/bdr-treble?days=' + encodeURIComponent(state.filters.days || '180') + (refresh ? '&refresh=true' : '');
      fetch(url, { credentials: 'include' }).then(function (r) {
        if (!r.ok) throw new Error(r.status === 401 ? 'Não autorizado. Faça login novamente.' : 'Erro HTTP ' + r.status);
        return r.json();
      }).then(function (json) {
        if (!json.success) throw new Error(json.error || 'Resposta inválida');
        state.raw = json; state.messages = json.messages || []; render();
      }).catch(function (e) { setState('error', 'Erro ao carregar Treble', e.message || 'Falha desconhecida.'); });
    },
    tab: function (name) { state.tab = name; render(); },
    toggleTheme: function () { var html = document.documentElement; var light = html.getAttribute('data-theme') === 'light'; html.setAttribute('data-theme', light ? 'dark' : 'light'); try { localStorage.setItem('axenya_theme', light ? 'dark' : 'light'); } catch (e) {} },
    drill: function (kind) {
      var rows = filtered();
      if (kind === 'outbound') rows = rows.filter(function (m) { return m.direction === 'OUTBOUND'; });
      if (kind === 'inbound') rows = rows.filter(function (m) { return m.direction === 'INBOUND'; });
      if (kind === 'failed') rows = rows.filter(function (m) { return m.status === 'FAILED'; });
      if (kind === 'delivered') rows = rows.filter(function (m) { return m.status === 'DELIVERED' || m.status === 'READ'; });
      if (kind === 'owner') rows = rows.filter(function (m) { return !m.ownerPresent; });
      modal('Mensagens | ' + kind + ' | ' + fmt(rows.length), rows);
    },
    drillGroup: function (field, value) {
      var map = { flow: 'flow', bdr: 'bdr', statusLabel: 'statusLabel' };
      var f = map[field] || field;
      var rows = filtered().filter(function (m) { return String(m[f] || '') === String(value || ''); });
      modal(field + ' | ' + value + ' | ' + fmt(rows.length), rows);
    },
    closeModal: function () { $('modal-overlay').classList.remove('open'); },
    openHelp: function () {
       $('help-body').innerHTML = '<div class="help-block"><b>Resposta</b><p>Resposta = mensagens INBOUND ÷ mensagens OUTBOUND no universo filtrado. Se outbound for zero, a taxa fica Não medido.</p></div><div class="help-block"><b>Entrega e leitura</b><p>Entregues e lidas são calculadas somente quando o status foi sincronizado para a communication. Não medido não é zero.</p></div><div class="help-block"><b>Flow</b><p>Flow vem de metadata Treble gravada no corpo/metadados da HubSpot communication. Quando não existe, aparece como Sem identificação de flow.</p></div><div class="help-block"><b>BDR</b><p>BDR = owner atual do contato associado à communication. É proxy inicial de atribuição, não autor histórico por mensagem.</p></div><div class="help-block"><b>Privacidade</b><p>O backend não retorna contato, email, telefone, CPF/CNPJ, payload bruto nem corpo HTML bruto. Snippets outbound usam redaction heurística e conteúdo inbound fica ocultado.</p></div>';
      $('help-backdrop').classList.add('open'); $('help-drawer').classList.add('open');
    },
    closeHelp: function () { $('help-backdrop').classList.remove('open'); $('help-drawer').classList.remove('open'); }
  };

  window.BdrTreble = api;
  window.addEventListener('DOMContentLoaded', function () { api.load(false); });
})();
