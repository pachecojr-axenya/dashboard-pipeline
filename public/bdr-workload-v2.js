'use strict';

window.BDR_WORKLOAD_V2_ASSET_LOADED = true;

var WorkloadBDRV2 = (function () {
  var ALL_CHANNELS = ['calls', 'emails', 'whatsapp', 'linkedin', 'meetings'];
  var CHANNEL_LABELS = { calls: 'Ligações', emails: 'E-mails', whatsapp: 'WhatsApp', linkedin: 'LinkedIn', meetings: 'Reuniões' };
  var tabs = [
    ['pulse', 'Pulso & Reatividade'],
    ['channels', 'Atividades & Canais'],
    ['management', 'Gestão por BDR'],
    ['penetration', 'Penetração & ICP'],
    ['evolution', 'Evolução A×B'],
  ];
  var state = {
    tab: 'pulse', period: 'hoje', since: null, until: null, bdr: '', businessDays: true,
    channels: ALL_CHANNELS.slice(), porte: '', sortBy: 'deltaHistorical', sortDir: 'asc',
    comparePreset: 'hoje_ontem', compareDomain: 'ritmo', compareBreakdown: 'canal',
    aSince: null, aUntil: null, bSince: null, bUntil: null, labelA: 'antes', labelB: 'depois',
  };
  var lastSemantic = null;
  var focusBeforeDrawer = null;
  var globalKeysBound = false;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function iso(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }
  function addDays(value, amount) {
    var d = new Date(value + 'T00:00:00');
    d.setDate(d.getDate() + amount);
    return iso(d);
  }
  function rangeFor(period) {
    var now = new Date();
    var s = new Date(now);
    var u = new Date(now);
    if (period === 'ontem') { s.setDate(s.getDate() - 1); u = new Date(s); }
    else if (period === '7d') s.setDate(s.getDate() - 6);
    else if (period === '30d') s.setDate(s.getDate() - 29);
    else if (period === '90d') s.setDate(s.getDate() - 89);
    return { since: iso(s), until: iso(u) };
  }
  function businessDays(since, until) {
    var count = 0;
    var d = new Date(since + 'T00:00:00');
    var end = new Date(until + 'T00:00:00');
    while (d <= end) { var day = d.getDay(); if (day !== 0 && day !== 6) count++; d.setDate(d.getDate() + 1); }
    return count;
  }
  function initState() {
    var q = new URLSearchParams(location.search);
    state.tab = q.get('tab') || state.tab;
    state.period = q.get('period') || state.period;
    state.since = q.get('since');
    state.until = q.get('until');
    state.bdr = q.get('bdr') || '';
    state.businessDays = q.get('businessDays') !== 'false';
    state.channels = (q.get('channels') || ALL_CHANNELS.join(',')).split(',').filter(Boolean);
    state.porte = q.get('porte') || '';
    state.comparePreset = q.get('comparePreset') || state.comparePreset;
    state.compareDomain = q.get('compareDomain') || state.compareDomain;
    state.compareBreakdown = q.get('compareBreakdown') || state.compareBreakdown;
    state.aSince = q.get('aSince'); state.aUntil = q.get('aUntil'); state.bSince = q.get('bSince'); state.bUntil = q.get('bUntil');
    state.labelA = q.get('labelA') || state.labelA; state.labelB = q.get('labelB') || state.labelB;
    if (!state.since || !state.until) { var r = rangeFor(state.period); state.since = r.since; state.until = r.until; }
    resolveComparePreset();
  }
  function syncUrl() {
    var q = new URLSearchParams(location.search);
    ['tab', 'period', 'since', 'until', 'bdr', 'businessDays', 'channels', 'porte', 'comparePreset', 'compareDomain', 'compareBreakdown', 'aSince', 'aUntil', 'bSince', 'bUntil', 'labelA', 'labelB'].forEach(function (key) { q.delete(key); });
    q.set('tab', state.tab); q.set('period', state.period); q.set('since', state.since); q.set('until', state.until);
    if (state.bdr) q.set('bdr', state.bdr);
    q.set('businessDays', String(state.businessDays)); q.set('channels', state.channels.join(','));
    if (state.porte) q.set('porte', state.porte);
    q.set('comparePreset', state.comparePreset); q.set('compareDomain', state.compareDomain); q.set('compareBreakdown', state.compareBreakdown);
    q.set('aSince', state.aSince); q.set('aUntil', state.aUntil); q.set('bSince', state.bSince); q.set('bUntil', state.bUntil);
    q.set('labelA', state.labelA); q.set('labelB', state.labelB);
    history.replaceState(null, '', '?' + q.toString());
  }
  function el(id) { return document.getElementById(id); }
  function showState(kind, title, message) {
    var cls = kind === 'error' ? 'unavailable' : kind;
    return '<div class="state data-state ' + esc(cls) + '"><strong>' + esc(title) + '</strong>' + esc(message || '') + '</div>';
  }
  function api(path, params) {
    var q = new URLSearchParams(params);
    return fetch(path + '?' + q.toString(), { credentials: 'same-origin' }).then(function (res) {
      if (res.status === 401) { window.location.href = '/'; throw new Error('login'); }
      return res.json().then(function (data) {
        if (!res.ok || !data.success) throw new Error(data.error || 'Falha ao carregar');
        return data;
      });
    });
  }
  function baseParams() {
    var q = new URLSearchParams(location.search);
    var params = { v: '2', since: state.since, until: state.until, bdr: state.bdr, channels: state.channels.join(','), businessDays: String(state.businessDays) };
    if (q.get('refresh') === '1') params.refresh = '1';
    return params;
  }
  function renderShell() {
    syncUrl();
    el('filters').innerHTML = renderFilters();
    el('state').classList.add('hidden');
    el('content').classList.remove('hidden');
    el('content').innerHTML = renderTabs() + '<section id="v2-panel" role="tabpanel" tabindex="0" aria-live="polite" aria-atomic="false" aria-labelledby="tab-' + esc(state.tab) + '"></section>' + renderDrawer();
    loadTab();
  }
  function setIntroV2() {
    var intro = el('workload-intro');
    var subtitle = el('workload-subtitle');
    if (subtitle) subtitle.textContent = 'Ritmo | canais | gestão por BDR | penetração | evolução A×B';
    if (!intro) return;
    intro.innerHTML = '<b>Workload v2:</b> ritmo = cinco canais MECE | hoje = HubSpot live agregado no servidor | histórico = BigQuery Gold | sem metas | reatividade, CRM, segmento e persona aparecem como indisponíveis quando a fonte não sustenta o cálculo | cada visual possui memória de cálculo.';
  }
  function drawerIsOpen() {
    var drawer = el('v2-info-drawer');
    return !!(drawer && drawer.classList.contains('open'));
  }
  function bindGlobalKeys() {
    if (globalKeysBound) return;
    globalKeysBound = true;
    document.addEventListener('keydown', function (event) {
      if (!drawerIsOpen()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        WorkloadBDRV2.closeInfo();
        return;
      }
      if (event.key !== 'Tab') return;
      var drawer = el('v2-info-drawer');
      var focusable = drawer.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }
  function renderFilters() {
    var periods = [['hoje', 'Hoje'], ['ontem', 'Ontem'], ['7d', '7 dias'], ['30d', '30 dias'], ['90d', '90 dias'], ['custom', 'Custom']];
    var v1Query = new URLSearchParams(location.search); v1Query.set('workload', 'v1');
    var h = '<div class="periodbar"><span class="period-label">Workload v2</span><a class="period-chip" href="?' + esc(v1Query.toString()) + '">Abrir v1</a></div>';
    h += '<div class="periodbar"><span class="period-label">Período</span>';
    periods.forEach(function (p) { h += '<button class="period-chip ' + (state.period === p[0] ? 'active' : '') + '" onclick="WorkloadBDRV2.setPeriod(\'' + p[0] + '\')">' + p[1] + '</button>'; });
    h += '</div>';
    h += filterInput('Desde', 'since', state.since, 'date') + filterInput('Até', 'until', state.until, 'date') + bdrSelect();
    h += '<div class="filter"><label for="v2-filter-businessDays">Dias</label><select id="v2-filter-businessDays" onchange="WorkloadBDRV2.setBool(\'businessDays\',this.value)"><option value="true" ' + (state.businessDays ? 'selected' : '') + '>Úteis</option><option value="false" ' + (!state.businessDays ? 'selected' : '') + '>Corridos</option></select></div>';
    h += '<div class="filter"><label for="v2-filter-channel">Canal</label><select id="v2-filter-channel" onchange="WorkloadBDRV2.setChannel(this.value)"><option value="all">Todos</option>' + ALL_CHANNELS.map(function (c) { return '<option value="' + c + '" ' + (state.channels.length === 1 && state.channels[0] === c ? 'selected' : '') + '>' + CHANNEL_LABELS[c] + '</option>'; }).join('') + '</select></div>';
    h += filterInput('Porte', 'porte', state.porte, 'text', 'Somente Penetração');
    h += '<div class="filter"><label for="v2-filter-segment">Segmento</label><select id="v2-filter-segment" disabled aria-describedby="v2-segment-help"><option>Indisponível</option></select><span id="v2-segment-help" class="period-help">Schema atual sem segmento.</span></div>';
    h += '<div class="filter"><label for="v2-filter-persona">Persona</label><select id="v2-filter-persona" disabled aria-describedby="v2-persona-help"><option>Indisponível</option></select><span id="v2-persona-help" class="period-help">Schema atual sem persona.</span></div>';
    return h;
  }
  function filterInput(label, key, value, type, placeholder) {
    var id = 'v2-filter-' + key;
    return '<div class="filter"><label for="' + id + '">' + esc(label) + '</label><input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(value) + '" placeholder="' + esc(placeholder || '') + '" onchange="WorkloadBDRV2.set(\'' + key + '\',this.value)"></div>';
  }
  function bdrSelect() {
    var team = window.BDR_WORKLOAD_TEAM || [];
    return '<div class="filter"><label for="v2-filter-bdr">BDR congelado</label><select id="v2-filter-bdr" onchange="WorkloadBDRV2.set(\'bdr\',this.value)"><option value="">Todos</option>' + team.map(function (bdr) { return '<option value="' + esc(bdr) + '" ' + (state.bdr === bdr ? 'selected' : '') + '>' + esc(bdr) + '</option>'; }).join('') + '</select></div>';
  }
  function renderTabs() {
    return '<div class="tabs" role="tablist" aria-label="Visões Workload v2" onkeydown="WorkloadBDRV2.onTabsKey(event)">' + tabs.map(function (tab) {
      return '<button role="tab" id="tab-' + tab[0] + '" aria-selected="' + (state.tab === tab[0]) + '" aria-controls="v2-panel" tabindex="' + (state.tab === tab[0] ? '0' : '-1') + '" class="period-chip ' + (state.tab === tab[0] ? 'active' : '') + '" onclick="WorkloadBDRV2.setTab(\'' + tab[0] + '\')">' + tab[1] + '</button>';
    }).join('') + '</div>';
  }
  function renderDrawer() {
    return '<div class="help-drawer" id="v2-info-drawer" role="dialog" aria-modal="true" aria-labelledby="v2-info-title"><div class="help-hdr"><h3 id="v2-info-title">Memória de cálculo</h3><button class="hdr-btn" id="v2-info-close" onclick="WorkloadBDRV2.closeInfo()" aria-label="Fechar memória de cálculo">×</button></div><div class="help-body" id="v2-info-body"></div></div><div class="help-backdrop" id="v2-info-backdrop" onclick="WorkloadBDRV2.closeInfo()"></div>';
  }
  function infoButton(key, label) { return '<button class="calc-btn" onclick="WorkloadBDRV2.openInfo(\'' + key + '\')" aria-label="Memória de cálculo: ' + esc(label || key) + '">i</button>'; }
  var INFO = {
    pulse: ['Pulso & Reatividade', 'Fórmula: ritmo_real = ligações + e-mails enviados + WhatsApp + LinkedIn + reuniões. Fonte: gold.bdr_daily_ops. Data: metric_date. Limitação: reatividade bloqueada por ausência de associação entry→first touch.'],
    channels: ['Atividades & Canais', 'Cinco canais MECE em gold.bdr_daily_ops. Exclui notas, tarefas genéricas e e-mails recebidos. Ligações usam drill legado para duração/desfecho.'],
    management: ['Gestão por BDR', 'Tabela por owner canônico do time. Colunas suportadas: cinco canais, leads_created e sql_deals. CRM/contato efetivo ficam indisponíveis até existir semantic layer.'],
    penetration: ['Penetração & ICP', 'Fonte: vw_dash_bdr_penetration_v1. Denominador = snapshot observado; buckets exatos 0/1/2/3/4/5/6+. Segmento/persona não existem no schema atual.'],
    evolution: ['Evolução A×B', 'Fonte: gold.bdr_daily_ops. Domínios suportados: ritmo, inserção por leads_created e SQL. A×B descreve mudança observada, sem claim causal.'],
  };
  function cards(items) {
    return '<section class="kpis">' + items.map(function (item) {
      return '<div class="kpi"><div class="label"><span>' + esc(item.label) + '</span>' + infoButton(item.info || state.tab, item.label) + '</div><div class="value">' + esc(item.value) + '</div><div class="sub">' + esc(item.sub || '') + '</div></div>';
    }).join('') + '</section>';
  }
  function panel(html) { el('v2-panel').innerHTML = html; }
  function loadTab() {
    panel(showState('loading', 'Carregando', 'Buscando dados da aba ativa.'));
    if (state.tab === 'penetration') return loadPenetration();
    if (state.tab === 'evolution') return loadCompare();
    return loadSemantic();
  }
  function loadSemantic() {
    api('/api/bdr-workload-semantic', baseParams()).then(function (data) {
      lastSemantic = data;
      if (state.tab === 'pulse') renderPulse(data);
      else if (state.tab === 'channels') renderChannels(data);
      else renderManagement(data);
    }).catch(function (error) { panel(showState('error', 'Indisponível', error.message)); });
  }
  function renderPulse(data) {
    var totals = data.data.rhythm.totals;
    panel(cards([
      { label: 'Atividades registradas', value: totals.total, sub: 'Soma dos canais selecionados', info: 'pulse' },
      { label: 'Leads inseridos', value: totals.leadsCreated, sub: 'Gold leads_created', info: 'management' },
      { label: 'Reatividade', value: 'Bloqueada', sub: data.data.reactivity.gate, info: 'pulse' },
    ]) + '<div class="note"><b>Estado degradado:</b> reatividade exige associação auditável entre entrada elegível e primeiro toque real. O modelo atual não possui esse vínculo.</div>' + renderSeriesTable(data.data.rhythm.series));
  }
  function renderChannels(data) {
    var totals = data.data.rhythm.totals;
    var callsSub = state.bdr ? 'Clique para abrir drill legado de ligações' : 'Selecione/congele um BDR na aba Gestão para ver breakdown';
    panel(cards([
      { label: 'Ligações', value: totals.calls, sub: callsSub },
      { label: 'E-mails enviados', value: totals.emails },
      { label: 'WhatsApp', value: totals.whatsapp },
      { label: 'LinkedIn', value: totals.linkedin },
      { label: 'Reuniões', value: totals.meetings },
      { label: 'Total MECE', value: totals.total, sub: 'Sem notas/tarefas' },
    ]) + '<div class="note"><b>Ligações:</b> conversa é proxy operacional por duração ≥1 minuto; discagem é duração nula ou inferior.</div><div class="note">' + (state.bdr ? '<button class="period-chip active" onclick="WorkloadBDRV2.openCallsDrill()">Carregar breakdown de ' + esc(state.bdr) + '</button><div id="v2-calls-breakdown"></div>' : '<b>Ação:</b> congele um BDR na aba Gestão para habilitar breakdown real de ligações.') + '</div>');
  }
  function renderManagement(data) {
    var rows = data.data.management.slice();
    rows.sort(compareRows);
    if (state.sortDir === 'desc') rows.reverse();
    var cols = [
      ['bdr', 'BDR'], ['total', 'Total'], ['calls', 'Ligações'], ['emails', 'E-mails'], ['whatsapp', 'WhatsApp'], ['linkedin', 'LinkedIn'], ['meetings', 'Reuniões'], ['leadsCreated', 'Leads inseridos'], ['sqlDeals', 'SQL'], ['deltaHistorical', 'Delta histórico'],
    ];
    var h = '<div class="table-wrap"><table><thead><tr>' + cols.map(function (col) { return sortableTh(col[0], col[1]); }).join('') + '</tr></thead><tbody>';
    if (!rows.length) h += '<tr><td colspan="10">Sem dados para os filtros ativos.</td></tr>';
    rows.forEach(function (row) {
      h += '<tr tabindex="0" onclick="WorkloadBDRV2.freezeBdr(\'' + esc(row.bdr).replace(/'/g, '') + '\')" onkeydown="WorkloadBDRV2.rowKey(event,\'' + esc(row.bdr).replace(/'/g, '') + '\')"><td>' + esc(row.bdr) + '</td><td>' + row.total + '</td><td>' + row.calls + '</td><td>' + row.emails + '</td><td>' + row.whatsapp + '</td><td>' + row.linkedin + '</td><td>' + row.meetings + '</td><td>' + row.leadsCreated + '</td><td>' + sqlCell(row.sqlDeals) + '</td><td>' + deltaCell(row) + '</td></tr>';
    });
    panel(h + '</tbody></table></div><div class="note"><b>Indisponível:</b> empresas criadas, movimentações e contato efetivo não existem em gold.bdr_daily_ops; a v2 nunca converte ausência de fonte em zero. Ordenação padrão = delta absoluto contra o período anterior equivalente, ascendente.</div>');
  }
  function sqlCell(value) {
    var immature = businessDays(state.since, state.until) < 7;
    return esc(value) + (immature ? ' <span class="pill warn">imaturo</span>' : '');
  }
  function deltaCell(row) {
    if (row.deltaHistorical == null) return 'sem base comparável';
    var sign = row.deltaHistorical > 0 ? '+' : '';
    return sign + esc(row.deltaHistorical) + ' <span class="muted">vs anterior ' + esc(row.previousTotal) + '</span>';
  }
  function compareRows(a, b) {
    if (state.sortBy === 'bdr') return String(a.bdr || '').localeCompare(String(b.bdr || ''));
    if (state.sortBy === 'deltaHistorical') {
      if (a.deltaHistorical == null && b.deltaHistorical != null) return 1;
      if (a.deltaHistorical != null && b.deltaHistorical == null) return -1;
      if (a.deltaHistorical !== b.deltaHistorical) return Number(a.deltaHistorical || 0) - Number(b.deltaHistorical || 0);
      return String(a.bdr || '').localeCompare(String(b.bdr || ''));
    }
    var diff = Number(a[state.sortBy] || 0) - Number(b[state.sortBy] || 0);
    return diff || String(a.bdr || '').localeCompare(String(b.bdr || ''));
  }
  function sortableTh(key, label) {
    var active = state.sortBy === key;
    var aria = active ? (state.sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
    return '<th scope="col" tabindex="0" aria-sort="' + aria + '" onclick="WorkloadBDRV2.sort(\'' + key + '\')" onkeydown="WorkloadBDRV2.sortKey(event,\'' + key + '\')">' + esc(label) + (active ? (state.sortDir === 'asc' ? ' ▲' : ' ▼') : '') + '</th>';
  }
  function loadPenetration() {
    var params = baseParams(); params.porte = state.porte; params.cohort = 'observed_snapshot';
    api('/api/bdr-workload-penetration', params).then(function (data) {
      var h = cards([
        { label: 'Denominador observado', value: data.coverage.denominatorObserved, sub: 'Experimental | não é a carteira elegível completa', info: 'penetration' },
        { label: 'Contatos reais', value: data.coverage.contactsReal, sub: 'contacts_real na view', info: 'penetration' },
        { label: 'Segmento/persona', value: 'Desabilitado', sub: 'Schema atual não possui atributos', info: 'penetration' },
      ]);
      h += '<div class="note"><b>Visão experimental:</b> os buckets usam apenas empresas do snapshot observado. Bucket 0 significa zero contatos reais dentro desse snapshot, não zero toque em toda a carteira elegível.</div>';
      h += '<div class="note"><b>Associação observacional; correlação não implica causalidade.</b> Confundidores: porte, qualidade da carteira e maturação/timing.</div>';
      h += '<div class="grid"><div class="card span-6"><h2>Buckets observados exatos ' + infoButton('penetration', 'Buckets observados exatos') + '</h2>' + bars(data.data.bucketsExact) + '</div><div class="card span-6"><h2>Buckets observados agrupados</h2>' + bars(data.data.bucketsGrouped) + '</div></div>';
      h += associationTable(data.data.association);
      panel(h);
    }).catch(function (error) { panel(showState('error', 'Indisponível', error.message)); });
  }
  function bars(rows) {
    var max = Math.max(1, rows.reduce(function (m, row) { return Math.max(m, row.companies || 0); }, 0));
    return '<div class="break-list">' + rows.map(function (row) {
      return '<div class="break-row"><span class="break-name">' + esc(row.label) + '</span><div class="break-track"><div class="break-fill" style="width:' + Math.round((row.companies || 0) / max * 100) + '%"></div></div><span class="break-val">' + esc(row.companies) + ' (' + Math.round((row.percent || 0) * 100) + '%)</span></div>';
    }).join('') + '</div>';
  }
  function associationTable(rows) {
    return '<div class="table-wrap"><table><thead><tr><th>Bucket</th><th>n</th><th>Convertidos</th><th>Taxa</th><th>Threshold</th></tr></thead><tbody>' + rows.map(function (row) {
      return '<tr><td>' + esc(row.bucket) + '</td><td>' + row.n + '</td><td>' + row.converted + '</td><td>' + (row.rate == null ? 'amostra insuficiente' : Math.round(row.rate * 100) + '%') + '</td><td>' + esc(row.threshold) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  function resolveComparePreset() {
    var today = iso(new Date());
    if (state.comparePreset === 'hoje_ontem') { state.bSince = today; state.bUntil = today; state.aSince = addDays(today, -1); state.aUntil = addDays(today, -1); }
    else if (state.comparePreset === 'semana') {
      var now = new Date(); var dow = (now.getDay() + 6) % 7; var bStart = addDays(today, -dow); var aEnd = addDays(bStart, -1); var aStart = addDays(aEnd, -6);
      state.bSince = bStart; state.bUntil = today; state.aSince = aStart; state.aUntil = aEnd;
    } else if (state.comparePreset === '30d') { state.bUntil = today; state.bSince = addDays(today, -29); state.aUntil = addDays(state.bSince, -1); state.aSince = addDays(state.aUntil, -29); }
  }
  function renderCompareControls() {
    var domains = [['ritmo', 'Ritmo'], ['insercao', 'Inserção (leads_created)'], ['sql', 'SQL'], ['crm', 'CRM indisponível'], ['contato_efetivo', 'Contato efetivo indisponível']];
    return '<div class="filters"><div class="filter"><label>Preset</label><select onchange="WorkloadBDRV2.setComparePreset(this.value)"><option value="hoje_ontem" ' + (state.comparePreset === 'hoje_ontem' ? 'selected' : '') + '>hoje × ontem</option><option value="semana" ' + (state.comparePreset === 'semana' ? 'selected' : '') + '>semana atual × anterior</option><option value="30d" ' + (state.comparePreset === '30d' ? 'selected' : '') + '>30d × 30d anterior</option><option value="custom" ' + (state.comparePreset === 'custom' ? 'selected' : '') + '>custom</option></select></div>' +
      compareInput('A desde', 'aSince') + compareInput('A até', 'aUntil') + compareInput('B desde', 'bSince') + compareInput('B até', 'bUntil') +
      '<div class="filter"><label>Domínio</label><select onchange="WorkloadBDRV2.setCompareDomain(this.value)">' + domains.map(function (d) { return '<option value="' + d[0] + '" ' + (state.compareDomain === d[0] ? 'selected' : '') + (d[0] === 'crm' || d[0] === 'contato_efetivo' ? ' disabled' : '') + '>' + d[1] + '</option>'; }).join('') + '</select></div>' +
      '<div class="filter"><label>Breakdown</label><select onchange="WorkloadBDRV2.setCompareBreakdown(this.value)"><option value="canal" ' + (state.compareBreakdown === 'canal' ? 'selected' : '') + '>Canal</option><option value="bdr" ' + (state.compareBreakdown === 'bdr' ? 'selected' : '') + '>BDR</option><option value="none" ' + (state.compareBreakdown === 'none' ? 'selected' : '') + '>Total</option></select></div></div>';
  }
  function compareInput(label, key) { return '<div class="filter"><label>' + label + '</label><input type="date" value="' + esc(state[key]) + '" onchange="WorkloadBDRV2.setCompare(\'' + key + '\',this.value)"></div>'; }
  function loadCompare() {
    resolveComparePreset();
    var breakdown = state.compareDomain === 'ritmo' ? state.compareBreakdown : (state.compareBreakdown === 'bdr' ? 'bdr' : 'none');
    var params = { v: '2', aSince: state.aSince, aUntil: state.aUntil, bSince: state.bSince, bUntil: state.bUntil, domain: state.compareDomain, breakdown: breakdown, businessDays: String(state.businessDays), bdr: state.bdr, channels: state.channels.join(',') };
    api('/api/bdr-workload-compare', params).then(function (data) {
      var normal = data.data.defaultMode === 'per_business_day';
      var h = renderCompareControls();
      h += cards([
        { label: state.labelA, value: formatCompareValue(data, 'A'), sub: normal ? 'por dia útil; total absoluto ' + data.data.totalA : 'Período A descritivo', info: 'evolution' },
        { label: state.labelB, value: formatCompareValue(data, 'B'), sub: normal ? 'por dia útil; total absoluto ' + data.data.totalB : (data.coverage.partial ? 'parcial' : 'Período B descritivo'), info: 'evolution' },
        { label: 'Delta', value: signed(formatCompareDelta(data)), sub: data.invariant.matches ? 'invariante ok' : 'invariante falhou', info: 'evolution' },
      ]);
      h += '<div class="note"><b>Modo padrão:</b> ' + (normal ? 'normalizado por dia útil porque as janelas diferem em mais de 2 dias; totais absolutos preservados nos cards.' : 'absoluto.') + ' Mudança observada, sem claim causal.</div>';
      if (data.coverage.partial) h += '<div class="note"><b>Comparação parcial não equivalente:</b> o período B inclui hoje e usa o último snapshot BigQuery; o período A não foi truncado no mesmo horário. Use como sinal descritivo, não como avaliação conclusiva.</div>';
      h += renderCompareTable(data);
      h += renderWaterfall(data);
      panel(h);
    }).catch(function (error) { panel(renderCompareControls() + showState('error', 'Indisponível', error.message)); });
  }
  function signed(value) { return value == null ? '—' : (value > 0 ? '+' : '') + Math.round(value * 100) / 100; }
  function formatCompareValue(data, side) {
    if (data.data.defaultMode !== 'per_business_day') return side === 'A' ? data.data.totalA : data.data.totalB;
    return signed(side === 'A' ? data.data.normalized.aPerBusinessDay : data.data.normalized.bPerBusinessDay).replace('+', '');
  }
  function formatCompareDelta(data) {
    if (data.data.defaultMode !== 'per_business_day') return data.data.deltaTotal;
    return data.data.normalized.bPerBusinessDay - data.data.normalized.aPerBusinessDay;
  }
  function activeComponents(data) {
    if (data.data.defaultMode !== 'per_business_day') return data.data.components;
    return data.data.componentsNormalized.map(function (component) { return { key: component.key, label: component.label, a: component.aPerBusinessDay, b: component.bPerBusinessDay, delta: component.deltaPerBusinessDay, absoluteA: component.a, absoluteB: component.b, absoluteDelta: component.delta }; });
  }
  function renderCompareTable(data) {
    var rows = activeComponents(data);
    var h = '<div class="table-wrap"><table><thead><tr><th>Componente</th><th>A</th><th>B</th><th>Delta assinado</th></tr></thead><tbody>';
    rows.forEach(function (row) { h += '<tr><td>' + esc(row.label) + '</td><td>' + esc(row.a == null ? '—' : Math.round(row.a * 100) / 100) + '</td><td>' + esc(row.b == null ? '—' : Math.round(row.b * 100) / 100) + '</td><td>' + esc(signed(row.delta)) + '</td></tr>'; });
    return h + '</tbody></table></div>';
  }
  function renderWaterfall(data) {
    return '<div class="break-list">' + activeComponents(data).map(function (component) { return '<div class="break-row"><span class="break-name">' + esc(component.label) + '</span><div class="break-track"><div class="break-fill" style="width:' + Math.min(100, Math.max(4, Math.abs(Number(component.delta || 0)))) + '%"></div></div><span class="break-val">' + esc(signed(component.delta)) + '</span></div>'; }).join('') + '</div>';
  }
  function renderSeriesTable(rows) {
    if (!rows.length) return showState('empty', 'Sem dados', 'Consulta válida sem linhas para os filtros ativos.');
    return '<div class="table-wrap"><table><thead><tr><th>Data</th><th>BDR</th><th>Total</th><th>Ligações</th><th>E-mails</th><th>WhatsApp</th><th>LinkedIn</th><th>Reuniões</th><th>Leads</th><th>SQL</th></tr></thead><tbody>' + rows.slice(0, 200).map(function (row) {
      return '<tr><td>' + row.date + '</td><td>' + esc(row.bdr) + '</td><td>' + row.total + '</td><td>' + row.calls + '</td><td>' + row.emails + '</td><td>' + row.whatsapp + '</td><td>' + row.linkedin + '</td><td>' + row.meetings + '</td><td>' + row.leadsCreated + '</td><td>' + row.sqlDeals + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  return {
    init: function () { initState(); setIntroV2(); bindGlobalKeys(); renderShell(); },
    setTab: function (tab) { state.tab = tab; renderShell(); },
    setPeriod: function (period) { state.period = period; if (period !== 'custom') { var r = rangeFor(period); state.since = r.since; state.until = r.until; } renderShell(); },
    set: function (key, value) { state[key] = value; renderShell(); },
    setBool: function (key, value) { state[key] = value === 'true'; renderShell(); },
    setChannel: function (value) { state.channels = value === 'all' ? ALL_CHANNELS.slice() : [value]; renderShell(); },
    freezeBdr: function (bdr) { state.bdr = bdr; renderShell(); },
    rowKey: function (event, bdr) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.freezeBdr(bdr); } },
    sort: function (key) { if (state.sortBy === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc'; else { state.sortBy = key; state.sortDir = key === 'deltaHistorical' ? 'asc' : 'desc'; } renderManagement(lastSemantic); },
    sortKey: function (event, key) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.sort(key); } },
    onTabsKey: function (event) { var keys = ['ArrowLeft', 'ArrowRight']; if (keys.indexOf(event.key) < 0) return; event.preventDefault(); var idx = tabs.map(function (t) { return t[0]; }).indexOf(state.tab); idx += event.key === 'ArrowRight' ? 1 : -1; if (idx < 0) idx = tabs.length - 1; if (idx >= tabs.length) idx = 0; state.tab = tabs[idx][0]; renderShell(); setTimeout(function () { var tab = el('tab-' + state.tab); if (tab) tab.focus(); }, 0); },
    openInfo: function (key) { var block = INFO[key] || INFO[state.tab]; focusBeforeDrawer = document.activeElement; el('v2-info-title').textContent = block[0]; el('v2-info-body').innerHTML = '<div class="help-block"><b>Definição</b><p>' + esc(block[1]) + '</p></div><div class="help-block"><b>Filtros</b><p>Período, BDR, dias úteis e canais persistidos na URL. Filtros sem suporte são desabilitados ou rejeitados pela API.</p></div>'; el('v2-info-drawer').classList.add('open'); el('v2-info-backdrop').classList.add('open'); setTimeout(function () { var btn = el('v2-info-drawer').querySelector('button'); if (btn) btn.focus(); }, 0); },
    closeInfo: function () { el('v2-info-drawer').classList.remove('open'); el('v2-info-backdrop').classList.remove('open'); if (focusBeforeDrawer) focusBeforeDrawer.focus(); },
    setComparePreset: function (value) { state.comparePreset = value; resolveComparePreset(); loadCompare(); syncUrl(); },
    setCompare: function (key, value) { state.comparePreset = 'custom'; state[key] = value; loadCompare(); syncUrl(); },
    setCompareDomain: function (value) { state.compareDomain = value; if (value !== 'ritmo' && state.compareBreakdown === 'canal') state.compareBreakdown = 'none'; loadCompare(); syncUrl(); },
    setCompareBreakdown: function (value) { state.compareBreakdown = value; loadCompare(); syncUrl(); },
    refresh: function () { var q = new URLSearchParams(location.search); q.set('refresh', '1'); history.replaceState(null, '', '?' + q.toString()); loadTab(); },
    openCallsDrill: function () {
      if (!state.bdr) return;
      var box = el('v2-calls-breakdown');
      if (box) box.innerHTML = showState('loading', 'Carregando ligações', 'Buscando breakdown lazy e sanitizado.');
      api('/api/bdr-workload-calls', baseParams()).then(function (data) {
        var target = el('v2-calls-breakdown');
        if (!target) return;
        var outcomes = Object.keys(data.byDesfecho || {}).sort(function (a, b) { return data.byDesfecho[b] - data.byDesfecho[a]; });
        var durations = Object.keys(data.byBucket || {});
        target.innerHTML = cards([
          { label: 'Total ligações', value: data.total || 0, info: 'channels' },
          { label: 'Conversas ≥1 min', value: data.conversas || 0, info: 'channels' },
          { label: 'Discagens', value: data.discagens || 0, info: 'channels' },
          { label: 'Taxa de conversa', value: (data.pctConversa || 0) + '%', info: 'channels' },
        ]) + '<div class="grid"><div class="card span-6"><h2>Desfechos</h2>' + (outcomes.length ? '<div class="break-list">' + outcomes.map(function (key) { return '<div class="break-row"><span class="break-name">' + esc(key) + '</span><span class="break-val">' + esc(data.byDesfecho[key]) + '</span></div>'; }).join('') + '</div>' : '<div class="desc">Sem desfecho mapeado.</div>') + '</div><div class="card span-6"><h2>Duração</h2><div class="break-list">' + durations.map(function (key) { return '<div class="break-row"><span class="break-name">' + esc(key) + '</span><span class="break-val">' + esc(data.byBucket[key]) + '</span></div>'; }).join('') + '</div></div></div>';
      }).catch(function (error) {
        var target = el('v2-calls-breakdown');
        if (target) target.innerHTML = showState('error', 'Drill indisponível', error.message);
      });
    },
  };
})();

window.addEventListener('DOMContentLoaded', function () {
  var q = new URLSearchParams(location.search);
  if (q.get('workload') === 'v1') {
    if (window.WorkloadBDRRouter) WorkloadBDRRouter.setMode('v1');
    return;
  }
  fetch('/api/bdr-workload-config', { credentials: 'same-origin' }).then(function (res) {
    if (res.status === 401) { window.location.href = '/'; throw new Error('login'); }
    return res.json().then(function (data) {
      if (!res.ok || !data.success) throw new Error(data.error || 'Falha ao carregar configuração');
      return data;
    });
  }).then(function (data) {
    if (!data.enabled) {
      if (window.WorkloadBDRRouter) WorkloadBDRRouter.setMode('v1');
      WorkloadBDR.init();
      return;
    }
    window.BDR_WORKLOAD_TEAM = Array.isArray(data.team) ? data.team : [];
    if (window.WorkloadBDRRouter) WorkloadBDRRouter.setMode('v2');
    WorkloadBDRV2.init();
  }).catch(function (error) {
    if (error.message === 'login') return;
    if (window.WorkloadBDRRouter) WorkloadBDRRouter.setMode('v1');
    WorkloadBDR.init();
    var intro = document.getElementById('workload-intro');
    if (intro) intro.innerHTML = '<b>Workload v2 indisponível:</b> configuração não carregou; fallback v1 ativado com segurança.';
  });
});
