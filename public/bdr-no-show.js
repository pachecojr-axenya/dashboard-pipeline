(function () {
  'use strict';

  var CONFIG = {
    slaBusinessDays: 2,
    noShowTerms: ['no show', 'no-show', 'noshow', 'não compareceu', 'nao compareceu', 'não veio', 'nao veio', 'faltou', 'ausente', 'remarcar', 'remarcou', 'remarcado'],
    rescheduleTerms: ['remarc', 'reagend', 'nova reunião', 'nova reuniao', 'novo horário', 'novo horario'],
    recoveryTerms: ['diagnóstico', 'diagnostico', 'cotação', 'cotacao', 'consultoria', 'negociação', 'negociacao', 'implantação', 'implantacao', 'ganho'],
    lostNoShowTerms: ['no show', 'no-show', 'noshow', 'não compareceu', 'nao compareceu', 'faltou', 'ausente', 'sumiu', 'sem retorno'],
    stagesAfterMeeting: ['Diagnóstico', 'Cotação', 'Consultoria', 'Negociação', 'Implantação', 'Ganho'],
    riskWeights: { noShow: 45, outsideSla: 25, noActivity: 15, value: 15 }
  };

  var state = { raw: [], records: [], filtered: [], filters: {} };

  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null || v === '' ? '—' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function lower(v) { return String(v || '').toLowerCase(); }
  function fmtInt(n) { return Math.round(Number(n) || 0).toLocaleString('pt-BR'); }
  function fmtPct(n) { return ((Number(n) || 0) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'; }
  function fmtMoney(n) { return (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }); }
  function parseDate(v) { var d = v ? new Date(String(v).slice(0, 10) + 'T12:00:00') : null; return d && !isNaN(d.getTime()) ? d : null; }
  function iso(d) { return d ? d.toISOString().slice(0, 10) : null; }
  function today() { var d = new Date(); d.setHours(12, 0, 0, 0); return d; }

  function containsAny(text, terms) {
    var t = lower(text);
    for (var i = 0; i < terms.length; i += 1) if (t.indexOf(terms[i]) >= 0) return true;
    return false;
  }

  function businessDaysBetween(start, end) {
    if (!start || !end || end < start) return 0;
    var d = new Date(start.getTime());
    var days = 0;
    while (d < end) {
      d.setDate(d.getDate() + 1);
      var w = d.getDay();
      if (w !== 0 && w !== 6) days += 1;
    }
    return days;
  }

  function weekKey(d) {
    if (!d) return 'Sem data';
    var x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var day = x.getUTCDay() || 7;
    x.setUTCDate(x.getUTCDate() + 4 - day);
    var yearStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
    var week = Math.ceil((((x - yearStart) / 86400000) + 1) / 7);
    return x.getUTCFullYear() + '-S' + String(week).padStart(2, '0');
  }

  function vidasRange(v) {
    var n = Number(v);
    if (!n || n < 1) return 'Sem vidas';
    if (n < 100) return 'Até 99';
    if (n < 200) return '100 a 199';
    if (n < 500) return '200 a 499';
    if (n < 1000) return '500 a 999';
    if (n < 3000) return '1.000 a 2.999';
    return '3.000+';
  }

  function personaProxy(deal) {
    var txt = lower([deal.dealname, deal.produto, deal.origem, deal.lost_reason, deal.lost_reason_desc].join(' '));
    if (/cfo|finance|diretor financeiro|finan/.test(txt)) return 'Financeiro';
    if (/m[eé]dico|sa[uú]de ocupacional|sst|seguran/.test(txt)) return 'Saúde Ocupacional';
    if (/corret|broker|consultor/.test(txt)) return 'Corretor';
    if (/benef[íi]cio|rh|people|gente|recursos humanos/.test(txt)) return 'RH';
    return 'Não identificado';
  }

  function segmentProxy(deal) {
    var txt = lower([deal.dealname, deal.produto, deal.origem].join(' '));
    if (/bid|rfp|concorr[êe]ncia/.test(txt) || deal.pipeline === 'Bid') return 'Bid/RFP';
    if (/sa[uú]de mental|psico|bem-estar|bem estar/.test(txt)) return 'Saúde mental';
    if (/plano|seguro|benef[íi]cio|vidas/.test(txt)) return 'Benefícios';
    if (/portal|demo|observat/.test(txt)) return 'Produto/Demo';
    return 'Comercial geral';
  }

  function isMeetingDone(deal) {
    var raw = lower(deal.reuniao_ocorreu);
    if (['sim', 'true', 'yes', 'ocorreu', 'realizada', 'realizado'].indexOf(raw) >= 0) return true;
    if (CONFIG.stagesAfterMeeting.indexOf(deal.stage) >= 0) return true;
    if (deal.stage_entered) {
      for (var i = 0; i < CONFIG.stagesAfterMeeting.length; i += 1) if (deal.stage_entered[CONFIG.stagesAfterMeeting[i]]) return true;
    }
    return false;
  }

  function evidenceText(deal) {
    return [deal.dealname, deal.stage, deal.reuniao_ocorreu, deal.lost_reason, deal.lost_reason_desc, deal.origem, deal.produto].join(' ');
  }

  function classifyRecovery(deal, meetingDate, occurred, text) {
    var explicitNoShow = containsAny(text, CONFIG.noShowTerms) || containsAny(text, CONFIG.lostNoShowTerms);
    if (explicitNoShow && occurred && deal.stage !== 'Perdido') return 'Recuperado';
    if (occurred) return 'Realizada';
    if (deal.stage === 'Perdido') return containsAny(text, CONFIG.lostNoShowTerms) ? 'Perdido por no-show' : 'Perdido sem evidência no-show';
    if (containsAny(text, CONFIG.rescheduleTerms)) return 'Reagendada';
    if (containsAny(text, CONFIG.noShowTerms)) return 'Em recuperação';
    if (meetingDate && meetingDate < today()) return 'Em recuperação';
    return 'Agendada futura';
  }

  function riskScore(deal, rec) {
    var score = 0;
    if (rec.noShow) score += CONFIG.riskWeights.noShow;
    if (rec.outsideSla) score += CONFIG.riskWeights.outsideSla;
    if (deal.dias_sem_atividade != null && deal.dias_sem_atividade > 7) score += CONFIG.riskWeights.noActivity;
    if ((deal.arr_estimado || 0) >= 120000) score += CONFIG.riskWeights.value;
    return Math.min(100, score);
  }

  function normalizeDeal(deal) {
    var meetingDate = parseDate(deal.data_reuniao_agendada);
    var occurred = isMeetingDone(deal);
    var text = evidenceText(deal);
    var noShowEvidence = containsAny(text, CONFIG.noShowTerms) || containsAny(text, CONFIG.lostNoShowTerms);
    var pastMeeting = !!(meetingDate && meetingDate < today());
    var status = classifyRecovery(deal, meetingDate, occurred, text);
    var noShow = status === 'Perdido por no-show' || status === 'Em recuperação' || status === 'Reagendada' || status === 'Recuperado' || noShowEvidence || (!occurred && pastMeeting && deal.stage !== 'Perdido');
    var lastActivityDate = parseDate(deal.ultima_atividade || deal.close_date || deal.createdate);
    var bd = meetingDate ? businessDaysBetween(meetingDate, today()) : null;
    var recovered = noShow && (occurred || CONFIG.stagesAfterMeeting.indexOf(deal.stage) >= 0) && deal.stage !== 'Perdido';
    var rescheduled = noShow && status === 'Reagendada';
    var outsideSla = noShow && !recovered && bd != null && bd > CONFIG.slaBusinessDays;
    var rec = {
      id: deal.hs_id || '',
      name: deal.dealname || '—',
      meetingDate: meetingDate,
      meetingIso: iso(meetingDate),
      week: weekKey(meetingDate),
      bdr: deal.sdr || 'Sem BDR',
      ae: deal.ae || 'Sem AE',
      stage: deal.stage || '—',
      origem: deal.origem || 'Sem origem',
      vidas: deal.vidas || deal.colaboradores || null,
      porte: vidasRange(deal.vidas || deal.colaboradores),
      persona: personaProxy(deal),
      segment: segmentProxy(deal),
      occurred: occurred,
      noShow: noShow,
      rescheduled: rescheduled,
      recovered: recovered,
      outsideSla: outsideSla,
      withinSla: noShow && !recovered && bd != null && !outsideSla,
      status: status,
      lostReason: deal.lost_reason || '—',
      lostDesc: deal.lost_reason_desc || '',
      lastActivity: deal.ultima_atividade || '—',
      hasActivityAfterNoShow: !!(meetingDate && lastActivityDate && lastActivityDate > meetingDate),
      businessDays: bd,
      arr: deal.arr_estimado || (deal.primeira_fatura ? deal.primeira_fatura * 12 : 0) || (deal.premio_mensal ? deal.premio_mensal * 12 : 0),
      raw: deal
    };
    rec.risk = riskScore(deal, rec);
    return rec;
  }

  function showState(kind, title, msg) {
    $('state').classList.remove('hidden');
    $('content').classList.add('hidden');
    $('state').innerHTML = (kind === 'loading' ? '<div class="spinner"></div>' : '') + '<strong>' + esc(title) + '</strong>' + esc(msg || '');
  }

  function showContent() {
    $('state').classList.add('hidden');
    $('content').classList.remove('hidden');
  }

  function uniqueValues(key) {
    var map = {};
    state.records.forEach(function (r) { map[r[key] || '—'] = true; });
    return Object.keys(map).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
  }

  function optionHtml(values, selected) {
    var html = '<option value="">Todos</option>';
    values.forEach(function (v) { html += '<option value="' + esc(v) + '"' + (selected === v ? ' selected' : '') + '>' + esc(v) + '</option>'; });
    return html;
  }

  function renderFilters() {
    var f = state.filters;
    var html = '';
    html += '<div class="filter"><label>Início reunião</label><input id="f-start" type="date" value="' + esc(f.start || '') + '"></div>';
    html += '<div class="filter"><label>Fim reunião</label><input id="f-end" type="date" value="' + esc(f.end || '') + '"></div>';
    html += '<div class="filter"><label>BDR</label><select id="f-bdr">' + optionHtml(uniqueValues('bdr'), f.bdr) + '</select></div>';
    html += '<div class="filter"><label>AE</label><select id="f-ae">' + optionHtml(uniqueValues('ae'), f.ae) + '</select></div>';
    html += '<div class="filter"><label>Fase</label><select id="f-stage">' + optionHtml(uniqueValues('stage'), f.stage) + '</select></div>';
    html += '<div class="filter"><label>Origem</label><select id="f-origem">' + optionHtml(uniqueValues('origem'), f.origem) + '</select></div>';
    html += '<div class="filter"><label>Porte | vidas</label><select id="f-porte">' + optionHtml(uniqueValues('porte'), f.porte) + '</select></div>';
    html += '<div class="filter"><label>Status recuperação</label><select id="f-status">' + optionHtml(uniqueValues('status'), f.status) + '</select></div>';
    html += '<div class="filter"><label>Motivo perda</label><select id="f-lost">' + optionHtml(uniqueValues('lostReason'), f.lostReason) + '</select></div>';
    html += '<div class="filter filter-actions"><button class="btn primary" id="apply-filters">Aplicar</button><button class="btn" id="clear-filters">Limpar</button></div>';
    $('filters').innerHTML = html;
    $('apply-filters').onclick = collectFilters;
    $('clear-filters').onclick = function () { state.filters = {}; render(); };
  }

  function collectFilters() {
    state.filters = {
      start: $('f-start').value,
      end: $('f-end').value,
      bdr: $('f-bdr').value,
      ae: $('f-ae').value,
      stage: $('f-stage').value,
      origem: $('f-origem').value,
      porte: $('f-porte').value,
      status: $('f-status').value,
      lostReason: $('f-lost').value
    };
    render();
  }

  function applyFilters(rows) {
    var f = state.filters;
    var start = parseDate(f.start);
    var end = parseDate(f.end);
    return rows.filter(function (r) {
      if (start && (!r.meetingDate || r.meetingDate < start)) return false;
      if (end && (!r.meetingDate || r.meetingDate > end)) return false;
      if (f.bdr && r.bdr !== f.bdr) return false;
      if (f.ae && r.ae !== f.ae) return false;
      if (f.stage && r.stage !== f.stage) return false;
      if (f.origem && r.origem !== f.origem) return false;
      if (f.porte && r.porte !== f.porte) return false;
      if (f.status && r.status !== f.status) return false;
      if (f.lostReason && r.lostReason !== f.lostReason) return false;
      return true;
    });
  }

  function group(rows, key) {
    var out = {};
    rows.forEach(function (r) { var k = typeof key === 'function' ? key(r) : r[key]; if (!out[k]) out[k] = []; out[k].push(r); });
    return out;
  }

  function rate(num, den) { return den ? num / den : 0; }
  function metrics(rows) {
    var scheduled = rows.filter(function (r) { return r.meetingDate; });
    var noShows = rows.filter(function (r) { return r.noShow; });
    var recovered = noShows.filter(function (r) { return r.recovered; });
    var lost = noShows.filter(function (r) { return r.status === 'Perdido por no-show'; });
    var out = {
      scheduled: scheduled.length,
      occurred: rows.filter(function (r) { return r.occurred; }).length,
      noShows: noShows.length,
      noShowRate: rate(noShows.length, scheduled.length),
      rescheduled: noShows.filter(function (r) { return r.rescheduled; }).length,
      recovered: recovered.length,
      recoveryRate: rate(recovered.length, noShows.length),
      withinSla: noShows.filter(function (r) { return r.withinSla; }).length,
      outsideSla: noShows.filter(function (r) { return r.outsideSla; }).length,
      pipelineRisk: noShows.filter(function (r) { return r.stage !== 'Perdido' && !r.recovered; }).reduce(function (s, r) { return s + (r.arr || 0); }, 0),
      pipelineLost: lost.reduce(function (s, r) { return s + (r.arr || 0); }, 0)
    };
    out.rescheduleRate = rate(out.rescheduled, scheduled.length);
    return out;
  }

  function kpi(label, value, sub, cls) {
    return '<div class="kpi ' + (cls || '') + '"><div class="label">' + esc(label) + '</div><div class="value">' + value + '</div><div class="sub">' + esc(sub || '') + '</div></div>';
  }

  function renderKpis(m) {
    return '<div class="kpis">' +
      kpi('Agendadas', fmtInt(m.scheduled), 'Com data_reuniao_agendada', 'teal') +
      kpi('Realizadas', fmtInt(m.occurred), 'Campo reunião ocorreu ou etapa posterior', 'good') +
      kpi('No-shows', fmtInt(m.noShows), 'Evidência textual ou reunião passada não realizada', 'bad') +
      kpi('Taxa no-show', fmtPct(m.noShowRate), 'No-shows / agendadas', m.noShowRate > 0.25 ? 'bad' : 'warn') +
      kpi('Reagendadas', fmtInt(m.rescheduled), 'Depende de evidência textual disponível', 'warn') +
      kpi('Taxa reagendamento', fmtPct(m.rescheduleRate), 'Reagendadas / no-shows', 'warn') +
      kpi('Recuperados', fmtInt(m.recovered), 'No-show que avançou ou foi realizado', 'good') +
      kpi('Taxa recuperação', fmtPct(m.recoveryRate), 'Recuperados / no-shows', 'good') +
      kpi('Dentro SLA', fmtInt(m.withinSla), 'Até ' + CONFIG.slaBusinessDays + ' dias úteis', 'good') +
      kpi('Fora SLA', fmtInt(m.outsideSla), 'No-show ainda sem recuperação', m.outsideSla ? 'bad' : 'good') +
      kpi('Pipeline em risco', fmtMoney(m.pipelineRisk), 'ARR estimado em no-shows abertos', 'bad') +
      kpi('Pipeline perdido', fmtMoney(m.pipelineLost), 'ARR estimado perdido por no-show', 'bad') +
      '</div>';
  }

  function renderTrend(rows) {
    var g = group(rows.filter(function (r) { return r.meetingDate; }), 'week');
    var keys = Object.keys(g).sort().slice(-16);
    var max = 1;
    keys.forEach(function (k) { var n = g[k].filter(function (r) { return r.noShow; }).length; if (n > max) max = n; });
    var bars = keys.map(function (k) {
      var n = g[k].filter(function (r) { return r.noShow; }).length;
      var h = Math.max(2, Math.round(n / max * 170));
      return '<div class="bar-wrap"><div class="bar" style="height:' + h + 'px"><small>' + fmtInt(n) + '</small></div><div class="bar-label">' + esc(k.replace('-', ' ')) + '</div></div>';
    }).join('');
    return '<div class="card span-8"><h2>Tendência no-show por semana</h2><div class="desc">Volume semanal de no-shows detectados no período filtrado</div><div class="trend"><div class="bars">' + (bars || '<div class="muted">Sem semanas com reunião no filtro atual</div>') + '</div></div></div>';
  }

  function rankRows(rows, key, mode) {
    var g = group(rows, key);
    return Object.keys(g).map(function (k) {
      var arr = g[k];
      var ns = arr.filter(function (r) { return r.noShow; }).length;
      var out = arr.filter(function (r) { return r.outsideSla; }).length;
      return { name: k, total: arr.length, noShows: ns, outside: out, rate: rate(ns, arr.filter(function (r) { return r.meetingDate; }).length), outRate: rate(out, ns) };
    }).sort(function (a, b) { return mode === 'outside' ? (b.outside - a.outside || b.outRate - a.outRate) : (b.rate - a.rate || b.noShows - a.noShows); }).slice(0, 8);
  }

  function renderRank(title, rows, mode) {
    var list = rankRows(rows, 'bdr', mode).map(function (r) {
      var val = mode === 'outside' ? fmtInt(r.outside) : fmtPct(r.rate);
      var meta = mode === 'outside' ? fmtPct(r.outRate) + ' dos no-shows' : fmtInt(r.noShows) + ' de ' + fmtInt(r.total);
      return '<div class="rank-row"><div><div class="rank-name">' + esc(r.name) + '</div><div class="rank-meta">' + esc(meta) + '</div></div><span class="pill ' + (mode === 'outside' && r.outside ? 'bad' : 'warn') + '">' + esc(val) + '</span><span class="rank-meta right">n=' + fmtInt(r.total) + '</span></div>';
    }).join('');
    return '<div class="card span-4"><h2>' + esc(title) + '</h2><div class="desc">Ranking BDR | ' + (mode === 'outside' ? 'fora do prazo' : 'taxa de no-show') + '</div>' + (list || '<div class="muted">Sem dados no filtro atual</div>') + '</div>';
  }

  function renderBreak(title, rows, key) {
    var g = group(rows, key);
    var items = Object.keys(g).map(function (k) {
      var arr = g[k];
      var ns = arr.filter(function (r) { return r.noShow; }).length;
      return { name: k, total: arr.length, ns: ns, rate: rate(ns, arr.length) };
    }).sort(function (a, b) { return b.ns - a.ns || b.rate - a.rate; }).slice(0, 8);
    var max = Math.max(1, items.reduce(function (m, x) { return Math.max(m, x.ns); }, 0));
    var html = items.map(function (x) {
      return '<div class="break-row"><div class="break-name">' + esc(x.name) + '</div><div class="break-val">' + fmtInt(x.ns) + '</div><div class="break-val">' + fmtPct(x.rate) + '</div><div class="break-track"><div class="break-fill" style="width:' + Math.round(x.ns / max * 100) + '%"></div></div></div>';
    }).join('');
    return '<div class="card span-4"><h2>' + esc(title) + '</h2><div class="desc">No-shows | volume | taxa</div><div class="break-list">' + (html || '<div class="muted">Sem dados</div>') + '</div></div>';
  }

  function hubspotUrl(id) { return id ? 'https://app.hubspot.com/contacts/44715285/deal/' + encodeURIComponent(id) : '#'; }
  function renderRecoveryTable(rows) {
    var arr = rows.filter(function (r) { return r.noShow && r.stage !== 'Perdido' && !r.recovered; }).sort(function (a, b) { return b.risk - a.risk || (b.businessDays || 0) - (a.businessDays || 0); }).slice(0, 100);
    var body = arr.map(function (r) {
      var slaLabel = r.businessDays == null ? 'SLA desconhecido' : (r.outsideSla ? 'Fora SLA' : 'Dentro SLA');
      var slaClass = r.businessDays == null ? 'warn' : (r.outsideSla ? 'bad' : 'good');
      return '<tr><td><a class="deal-link" href="' + hubspotUrl(r.id) + '" target="_blank" rel="noopener">' + esc(r.name) + '</a></td><td>' + esc(r.bdr) + '</td><td>' + esc(r.ae) + '</td><td>' + esc(r.meetingIso) + '</td><td>' + esc(r.status) + '</td><td class="right">' + esc(r.businessDays == null ? '—' : r.businessDays) + '</td><td><span class="pill ' + slaClass + '">' + slaLabel + '</span></td><td class="right">' + fmtMoney(r.arr) + '</td><td class="right">' + fmtInt(r.risk) + '</td></tr>';
    }).join('');
    return '<div class="card span-12"><h2>Tabela operacional de recuperação</h2><div class="desc">No-shows abertos priorizados por risco | limitado a 100 linhas</div><div class="table-wrap"><table><thead><tr><th>Deal</th><th>BDR</th><th>AE</th><th>Reunião</th><th>Status</th><th class="right">Dias úteis</th><th>SLA</th><th class="right">Pipeline</th><th class="right">Risco</th></tr></thead><tbody>' + (body || '<tr><td colspan="9" class="muted">Nenhum no-show aberto no filtro atual</td></tr>') + '</tbody></table></div></div>';
  }

  function renderLostTable(rows) {
    var arr = rows.filter(function (r) { return r.status === 'Perdido por no-show'; }).sort(function (a, b) { return (b.arr || 0) - (a.arr || 0); }).slice(0, 100);
    var body = arr.map(function (r) {
      return '<tr><td><a class="deal-link" href="' + hubspotUrl(r.id) + '" target="_blank" rel="noopener">' + esc(r.name) + '</a></td><td>' + esc(r.bdr) + '</td><td>' + esc(r.ae) + '</td><td>' + esc(r.meetingIso) + '</td><td>' + esc(r.origem) + '</td><td>' + esc(r.porte) + '</td><td>' + esc(r.lostReason) + '</td><td class="right">' + fmtMoney(r.arr) + '</td></tr>';
    }).join('');
    return '<div class="card span-12"><h2>Perdidos por no-show</h2><div class="desc">Deals perdidos com evidência textual de no-show no motivo ou descrição</div><div class="table-wrap"><table><thead><tr><th>Deal</th><th>BDR</th><th>AE</th><th>Reunião</th><th>Origem</th><th>Porte</th><th>Motivo</th><th class="right">Pipeline perdido</th></tr></thead><tbody>' + (body || '<tr><td colspan="8" class="muted">Nenhum perdido por no-show no filtro atual</td></tr>') + '</tbody></table></div></div>';
  }

  function render() {
    renderFilters();
    state.filtered = applyFilters(state.records);
    if (!state.records.length) {
      showState('empty', 'Sem dados de reunião', 'A API respondeu, mas nenhum deal veio com data_reuniao_agendada ou evidência de reunião.');
      return;
    }
    if (!state.filtered.length) {
      showState('empty', 'Filtro sem resultados', 'Ajuste período, BDR, origem ou status de recuperação.');
      return;
    }
    var rows = state.filtered;
    var html = renderKpis(metrics(rows));
    html += '<div class="grid">' + renderTrend(rows) + renderRank('Ranking por taxa no-show', rows, 'rate') + renderRank('Ranking por fora do prazo', rows, 'outside') + renderBreak('Quebra por origem', rows, 'origem') + renderBreak('Quebra por segmento', rows, 'segment') + renderBreak('Quebra por persona', rows, 'persona') + renderBreak('Quebra por porte | vidas', rows, 'porte') + renderRecoveryTable(rows) + renderLostTable(rows) + '</div>';
    $('content').innerHTML = html;
    showContent();
  }

  function load() {
    showState('loading', 'Carregando dados', 'Buscando /api/forecast-table?includeLost=true');
    fetch('/api/forecast-table?includeLost=true', { credentials: 'same-origin' })
      .then(function (res) {
        if (res.status === 401) {
          try { localStorage.setItem('axenya_login_next', '/novo-bdr/no-show'); } catch (e) {}
          showState('error', 'Sessão expirada', 'Redirecionando para login para acessar BDR Performance | No Show.');
          setTimeout(function () { window.location.href = '/?next=' + encodeURIComponent('/novo-bdr/no-show'); }, 700);
          throw new Error('AUTH_REDIRECT');
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (json) {
        if (!json || json.success === false) throw new Error((json && json.error) || 'Resposta inválida');
        state.raw = json.deals || [];
        state.records = state.raw.map(normalizeDeal).filter(function (r) { return r.meetingDate || r.noShow; });
        render();
      })
      .catch(function (err) { if (err && err.message === 'AUTH_REDIRECT') return; showState('error', 'Erro ao carregar', err.message || String(err)); });
  }

  function toggleTheme() {
    var n = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', n);
    try { localStorage.setItem('axenya_theme', n); } catch (e) {}
  }

  window.NoShowBDR = { load: load, toggleTheme: toggleTheme, config: CONFIG, vidasRange: vidasRange };
  document.addEventListener('DOMContentLoaded', load);
}());
