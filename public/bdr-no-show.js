(function () {
  'use strict';

  var CONFIG = {
    analysisStart: '2025-09-01',
    slaBusinessDays: 2,
    noShowTerms: ['no show', 'no-show', 'noshow', 'não compareceu', 'nao compareceu', 'não veio', 'nao veio', 'faltou', 'ausente'],
    rescheduleTerms: ['remarc', 'reagend', 'nova reunião', 'nova reuniao', 'novo horário', 'novo horario'],
    recoveryTerms: ['diagnóstico', 'diagnostico', 'cotação', 'cotacao', 'consultoria', 'negociação', 'negociacao', 'implantação', 'implantacao', 'ganho'],
    lostNoShowTerms: ['no show', 'no-show', 'noshow', 'não compareceu', 'nao compareceu', 'faltou', 'ausente', 'sumiu', 'sem retorno'],
    stagesAfterMeeting: ['Diagnóstico', 'Cotação', 'Consultoria', 'Negociação', 'Implantação', 'Ganho'],
    riskWeights: { noShow: 45, outsideSla: 25, noActivity: 15, value: 15 }
  };

  var state = { raw: [], records: [], filtered: [], filters: { preset: 'all', start: '2025-09-01', end: null } };

  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null || v === '' ? '—' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function lower(v) { return String(v || '').toLowerCase(); }
  function fmtInt(n) { return Math.round(Number(n) || 0).toLocaleString('pt-BR'); }
  function fmtPct(n) { return ((Number(n) || 0) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'; }
  function fmtMoney(n) { return (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }); }
  function parseDate(v) { var d = v ? new Date(String(v).slice(0, 10) + 'T12:00:00') : null; return d && !isNaN(d.getTime()) ? d : null; }
  function iso(d) { return d ? d.toISOString().slice(0, 10) : null; }
  function today() { var d = new Date(); d.setHours(12, 0, 0, 0); return d; }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }

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

  function norm(v) {
    return lower(v).normalize ? lower(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '') : lower(v);
  }

  function firstFilled(values) {
    for (var i = 0; i < values.length; i += 1) {
      if (values[i] != null && String(values[i]).trim() !== '') return values[i];
    }
    return null;
  }

  function seniorityFromTitle(title) {
    var t = norm(title);
    if (!t) return 'Senioridade não informada';
    if (/\b(ceo|cfo|chro|coo|cto|c-level|presidente|socio|socia|owner)\b/.test(t)) return 'C-Level | Sócio';
    if (/\b(diretor|diretora|director|vp|vice presidente|superintendente)\b/.test(t)) return 'Diretoria | VP';
    if (/\b(head|gerente|manager|gestor|gestora|coordenador|coordenadora|coord|supervisor|supervisora)\b/.test(t)) return 'Gestão | Coordenação';
    if (/\b(especialista|senior|sr|consultor|consultora|business partner|bp)\b/.test(t)) return 'Especialista | Sênior';
    if (/\b(analista|assistente|auxiliar|estagiario|estagiaria|trainee|junior|jr)\b/.test(t)) return 'Operacional | Analista';
    return 'Senioridade não classificada';
  }

  function areaFromTitle(title) {
    var t = norm(title);
    if (!t) return 'Área não informada';
    if (/\b(dp|departamento pessoal|pessoal|folha|payroll|admissao|admissões|demissao|demissoes)\b/.test(t)) return 'DP | Folha';
    if (/beneficio|beneficios|benefit|benefits|remuneracao|remuneração|total rewards|compensacao|compensação/.test(t)) return 'Benefícios | Remuneração';
    if (/\b(sst|sesmt|seguranca do trabalho|segurança do trabalho|saude ocupacional|saúde ocupacional|medicina do trabalho|medico do trabalho|médico do trabalho)\b/.test(t)) return 'SST | Saúde Ocupacional';
    if (/\b(rh|recursos humanos|people|gente|talentos|talent|human resources|hr)\b/.test(t)) return 'RH | People';
    if (/\b(financeiro|financas|finanças|controller|controladoria|cfo|tesouraria)\b/.test(t)) return 'Financeiro';
    if (/\b(compras|suprimentos|procurement|supply)\b/.test(t)) return 'Compras | Suprimentos';
    if (/\b(juridico|jurídico|legal|compliance)\b/.test(t)) return 'Jurídico | Compliance';
    if (/\b(saude|saúde|medico|médico|enfermagem|enfermeir)\b/.test(t)) return 'Saúde | Médico';
    return 'Área não classificada';
  }

  function personaFromPayload(deal) {
    var title = firstFilled([deal.contact_jobtitle, deal.jobtitle]);
    if (title) return seniorityFromTitle(title) + ' | ' + areaFromTitle(title);
    return deal.persona || deal.observatorio_axenya_persona || deal.buyer_persona || 'Contato sem cargo no payload';
  }

  function personaSourceFromPayload(deal) {
    var title = firstFilled([deal.contact_jobtitle, deal.jobtitle]);
    if (title) return 'Cargo do contato | ' + title;
    return 'Sem cargo associado ao contato';
  }

  function industryFromPayload(deal) {
    return firstFilled([deal.company_industry, deal.company_segment, deal.industry]) || 'Company sem segmento no payload';
  }

  function industrySourceFromPayload(deal) {
    if (firstFilled([deal.company_industry, deal.company_segment, deal.industry])) return 'Company.industry | ' + (deal.company_name || 'empresa associada');
    return deal.company_name ? 'Company associada sem industry' : 'Sem company associada no payload';
  }

  function normalizeMeetingOccurred(v) {
    var raw = norm(v);
    if (!raw) return null;
    if (['sim', 'true', 'yes', 'ocorreu', 'realizada', 'realizado'].indexOf(raw) >= 0) return true;
    if (['nao', 'não', 'false', 'no', 'nao ocorreu', 'não ocorreu', 'nao realizada', 'não realizada'].indexOf(raw) >= 0) return false;
    return null;
  }

  function isMeetingDone(deal) {
    var explicit = normalizeMeetingOccurred(deal.reuniao_ocorreu);
    if (explicit === true) return true;
    if (CONFIG.stagesAfterMeeting.indexOf(deal.stage) >= 0) return true;
    if (deal.stage_entered) {
      for (var i = 0; i < CONFIG.stagesAfterMeeting.length; i += 1) if (deal.stage_entered[CONFIG.stagesAfterMeeting[i]]) return true;
    }
    return false;
  }

  function evidenceText(deal) {
    return [deal.dealname, deal.stage, deal.reuniao_ocorreu, deal.lost_reason, deal.lost_reason_desc, deal.origem, deal.produto].join(' ');
  }

  function meetingFieldStatus(explicit, pastMeeting) {
    if (explicit === true) return 'Campo Sim';
    if (explicit === false) return 'Campo Não';
    if (pastMeeting) return 'Campo pendente | reunião passou';
    return 'Campo pendente | reunião futura';
  }

  function classifyRecovery(deal, meetingDate, occurred, explicit, text) {
    var explicitNoShow = containsAny(text, CONFIG.noShowTerms) || containsAny(text, CONFIG.lostNoShowTerms);
    var pastMeeting = !!(meetingDate && meetingDate < today());
    if (explicit === false && occurred && deal.stage !== 'Perdido') return 'Recuperado';
    if (explicitNoShow && occurred && deal.stage !== 'Perdido') return 'Recuperado';
    if (occurred) return 'Realizada';
    if (deal.stage === 'Perdido') return containsAny(text, CONFIG.lostNoShowTerms) ? 'Perdido por no-show' : 'Perdido sem evidência no-show';
    if (containsAny(text, CONFIG.rescheduleTerms)) return 'Reagendada';
    if (explicit === false) return 'No-show confirmado';
    if (containsAny(text, CONFIG.noShowTerms)) return 'No-show aberto';
    if (pastMeeting && explicit == null) return 'Campo pendente | reunião passou';
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
    var explicitOccurred = normalizeMeetingOccurred(deal.reuniao_ocorreu);
    var occurred = isMeetingDone(deal);
    var text = evidenceText(deal);
    var noShowEvidence = containsAny(text, CONFIG.noShowTerms) || containsAny(text, CONFIG.lostNoShowTerms);
    var pastMeeting = !!(meetingDate && meetingDate < today());
    var status = classifyRecovery(deal, meetingDate, occurred, explicitOccurred, text);
    var fieldStatus = meetingFieldStatus(explicitOccurred, pastMeeting);
    var noShow = status === 'Perdido por no-show' || status === 'No-show confirmado' || status === 'No-show aberto' || status === 'Recuperado' || noShowEvidence || explicitOccurred === false;
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
      persona: personaFromPayload(deal),
      segment: industryFromPayload(deal),
      personaSource: personaSourceFromPayload(deal),
      segmentSource: industrySourceFromPayload(deal),
      occurred: occurred,
      explicitOccurred: explicitOccurred,
      meetingFieldFilled: explicitOccurred !== null,
      meetingFieldStatus: fieldStatus,
      pastMeeting: pastMeeting,
      fieldPendingPast: pastMeeting && explicitOccurred === null,
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

  function presetRange(preset) {
    var t = today();
    if (preset === 'last30') return { start: iso(addDays(t, -30)), end: iso(t) };
    if (preset === 'curmonth') return { start: iso(new Date(t.getFullYear(), t.getMonth(), 1, 12, 0, 0, 0)), end: iso(t) };
    return { start: CONFIG.analysisStart, end: iso(t) };
  }

  function setPreset(preset) {
    var r = presetRange(preset);
    state.filters.preset = preset;
    state.filters.start = r.start;
    state.filters.end = r.end;
    render();
  }

  function presetBtn(key, label) {
    var on = state.filters.preset === key;
    return '<button type="button" class="period-chip' + (on ? ' active' : '') + '" data-preset="' + key + '">' + esc(label) + '</button>';
  }

  function renderFilters() {
    var f = state.filters;
    var html = '';
    html += '<div class="periodbar"><span class="period-label">Período</span>' + presetBtn('all', 'Tudo desde set/25') + presetBtn('last30', 'Últimos 30 dias') + presetBtn('curmonth', 'Mês atual') + '<span class="period-help">O universo sempre considera apenas deals com <code>data_reuniao_agendada</code> entre set/25 e hoje.</span></div>';
    html += '<div class="filter"><label>Início reunião</label><input id="f-start" type="date" value="' + esc(f.start || '') + '"></div>';
    html += '<div class="filter"><label>Fim reunião</label><input id="f-end" type="date" value="' + esc(f.end || '') + '"></div>';
    html += '<div class="filter"><label>BDR</label><select id="f-bdr">' + optionHtml(uniqueValues('bdr'), f.bdr) + '</select></div>';
    html += '<div class="filter"><label>AE</label><select id="f-ae">' + optionHtml(uniqueValues('ae'), f.ae) + '</select></div>';
    html += '<div class="filter"><label>Fase</label><select id="f-stage">' + optionHtml(uniqueValues('stage'), f.stage) + '</select></div>';
    html += '<div class="filter"><label>Origem</label><select id="f-origem">' + optionHtml(uniqueValues('origem'), f.origem) + '</select></div>';
    html += '<div class="filter"><label>Indústria | Company</label><select id="f-segment">' + optionHtml(uniqueValues('segment'), f.segment) + '</select></div>';
    html += '<div class="filter"><label>Persona | Cargo contato</label><select id="f-persona">' + optionHtml(uniqueValues('persona'), f.persona) + '</select></div>';
    html += '<div class="filter"><label>Porte | vidas</label><select id="f-porte">' + optionHtml(uniqueValues('porte'), f.porte) + '</select></div>';
    html += '<div class="filter"><label>Campo reunião ocorreu</label><select id="f-field">' + optionHtml(uniqueValues('meetingFieldStatus'), f.meetingFieldStatus) + '</select></div>';
    html += '<div class="filter"><label>Status operacional</label><select id="f-status">' + optionHtml(uniqueValues('status'), f.status) + '</select></div>';
    html += '<div class="filter"><label>Motivo perda</label><select id="f-lost">' + optionHtml(uniqueValues('lostReason'), f.lostReason) + '</select></div>';
    html += '<div class="filter filter-actions"><button class="btn primary" id="apply-filters">Aplicar</button><button class="btn" id="clear-filters">Limpar</button></div>';
    $('filters').innerHTML = html;
    var chips = $('filters').querySelectorAll('[data-preset]');
    for (var i = 0; i < chips.length; i += 1) chips[i].onclick = function () { setPreset(this.getAttribute('data-preset')); };
    $('apply-filters').onclick = collectFilters;
    $('clear-filters').onclick = function () { setPreset('all'); };
  }

  function collectFilters() {
    state.filters = {
      preset: 'custom',
      start: $('f-start').value,
      end: $('f-end').value,
      bdr: $('f-bdr').value,
      ae: $('f-ae').value,
      stage: $('f-stage').value,
      origem: $('f-origem').value,
      segment: $('f-segment').value,
      persona: $('f-persona').value,
      porte: $('f-porte').value,
      meetingFieldStatus: $('f-field').value,
      status: $('f-status').value,
      lostReason: $('f-lost').value
    };
    render();
  }

  function applyFilters(rows) {
    var f = state.filters;
    var range = f.preset === 'custom' ? { start: f.start || CONFIG.analysisStart, end: f.end || iso(today()) } : presetRange(f.preset || 'all');
    var start = parseDate(range.start);
    var end = parseDate(range.end);
    return rows.filter(function (r) {
      if (start && (!r.meetingDate || r.meetingDate < start)) return false;
      if (end && (!r.meetingDate || r.meetingDate > end)) return false;
      if (f.bdr && r.bdr !== f.bdr) return false;
      if (f.ae && r.ae !== f.ae) return false;
      if (f.stage && r.stage !== f.stage) return false;
      if (f.origem && r.origem !== f.origem) return false;
      if (f.segment && r.segment !== f.segment) return false;
      if (f.persona && r.persona !== f.persona) return false;
      if (f.porte && r.porte !== f.porte) return false;
      if (f.meetingFieldStatus && r.meetingFieldStatus !== f.meetingFieldStatus) return false;
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
    var past = rows.filter(function (r) { return r.pastMeeting; });
    var noShows = rows.filter(function (r) { return r.noShow; });
    var recovered = noShows.filter(function (r) { return r.recovered; });
    var lost = noShows.filter(function (r) { return r.status === 'Perdido por no-show'; });
    var out = {
      scheduled: scheduled.length,
      pastMeetings: past.length,
      fieldFilledPast: past.filter(function (r) { return r.meetingFieldFilled; }).length,
      fieldMissingPast: past.filter(function (r) { return r.fieldPendingPast; }).length,
      fieldYes: past.filter(function (r) { return r.explicitOccurred === true; }).length,
      fieldNo: past.filter(function (r) { return r.explicitOccurred === false; }).length,
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
    out.fieldCoverage = rate(out.fieldFilledPast, past.length);
    return out;
  }

  function infoBtn(key) {
    return '<button type="button" class="calc-btn" data-help="' + esc(key) + '" aria-label="Ver memória de cálculo">i</button>';
  }

  function kpi(label, value, sub, cls, key) {
    return '<div class="kpi ' + (cls || '') + '"><div class="label"><span>' + esc(label) + '</span>' + (key ? infoBtn(key) : '') + '</div><div class="value">' + value + '</div><div class="sub">' + esc(sub || '') + '</div></div>';
  }

  function renderKpis(m) {
    return '<div class="kpis">' +
      kpi('Agendadas', fmtInt(m.scheduled), 'Deals com data_reuniao_agendada', 'teal', 'scheduled') +
      kpi('Reuniões passadas', fmtInt(m.pastMeetings), 'Data da reunião menor que hoje', 'teal', 'past') +
      kpi('Campo preenchido', fmtPct(m.fieldCoverage), fmtInt(m.fieldFilledPast) + ' de ' + fmtInt(m.pastMeetings) + ' passadas', m.fieldCoverage < 0.8 ? 'warn' : 'good', 'fieldCoverage') +
      kpi('Campo pendente', fmtInt(m.fieldMissingPast), 'Reunião passou e a_reuniao_ocorreu_ está vazio', m.fieldMissingPast ? 'bad' : 'good', 'fieldMissing') +
      kpi('Realizadas', fmtInt(m.occurred), 'Campo Sim ou etapa posterior', 'good', 'occurred') +
      kpi('Campo Não', fmtInt(m.fieldNo), 'No-show confirmado por propriedade', m.fieldNo ? 'bad' : 'good', 'fieldNo') +
      kpi('No-show confirmado', fmtInt(m.noShows), 'Campo Não ou evidência final de ausência', 'bad', 'noShow') +
      kpi('Taxa no-show', fmtPct(m.noShowRate), 'No-show confirmado / agendadas', m.noShowRate > 0.25 ? 'bad' : 'warn', 'noShowRate') +
      kpi('Reagendadas', fmtInt(m.rescheduled), 'Fallback textual de remarcação', 'warn', 'rescheduled') +
      kpi('Recuperados', fmtInt(m.recovered), 'No-show que avançou ou foi realizado', 'good', 'recovered') +
      kpi('Fora SLA', fmtInt(m.outsideSla), 'No-show aberto sem recuperação', m.outsideSla ? 'bad' : 'good', 'outsideSla') +
      kpi('Pipeline em risco', fmtMoney(m.pipelineRisk), 'ARR estimado em no-shows abertos', 'bad', 'pipelineRisk') +
      kpi('Pipeline perdido', fmtMoney(m.pipelineLost), 'ARR estimado perdido por no-show', 'bad', 'pipelineLost') +
      '</div>';
  }

  function svgPoints(values, max, width, height, pad) {
    if (!values.length) return '';
    if (values.length === 1) return pad + ',' + (height - pad - Math.round(values[0] / max * (height - pad * 2)));
    return values.map(function (v, i) {
      var x = pad + Math.round(i / (values.length - 1) * (width - pad * 2));
      var y = height - pad - Math.round(v / max * (height - pad * 2));
      return x + ',' + y;
    }).join(' ');
  }

  function renderTrend(rows) {
    var g = group(rows.filter(function (r) { return r.meetingDate; }), 'week');
    var keys = Object.keys(g).sort().slice(-16);
    var scheduled = keys.map(function (k) { return g[k].length; });
    var noShows = keys.map(function (k) { return g[k].filter(function (r) { return r.noShow; }).length; });
    var pending = keys.map(function (k) { return g[k].filter(function (r) { return r.fieldPendingPast; }).length; });
    var max = Math.max(1, scheduled.concat(noShows).concat(pending).reduce(function (m, n) { return Math.max(m, n); }, 0));
    var w = 760, h = 240, p = 34;
    var labels = keys.map(function (k, i) { var x = p + Math.round(i / Math.max(1, keys.length - 1) * (w - p * 2)); return '<text x="' + x + '" y="232" text-anchor="middle">' + esc(k.replace('-', ' ')) + '</text>'; }).join('');
    var svg = keys.length ? '<svg class="line-svg" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Linha temporal semanal"><line x1="' + p + '" y1="20" x2="' + p + '" y2="210"/><line x1="' + p + '" y1="210" x2="730" y2="210"/><text x="8" y="24">' + fmtInt(max) + '</text><text x="18" y="214">0</text><polyline class="ln scheduled" points="' + svgPoints(scheduled, max, w, h, p) + '"/><polyline class="ln no-show" points="' + svgPoints(noShows, max, w, h, p) + '"/><polyline class="ln pending" points="' + svgPoints(pending, max, w, h, p) + '"/>' + labels + '</svg>' : '<div class="muted">Sem semanas com reunião no filtro atual</div>';
    return '<div class="card span-8"><div class="card-title"><div><h2>Linha temporal semanal</h2><div class="desc">Agendadas, no-show confirmado e campo pendente por semana</div></div>' + infoBtn('timeline') + '</div><div class="line-legend"><span><i class="scheduled"></i>Agendadas</span><span><i class="no-show"></i>No-show confirmado</span><span><i class="pending"></i>Campo pendente</span></div><div class="trend line-chart">' + svg + '</div></div>';
  }

  function rankRows(rows, key, mode) {
    var g = group(rows, key);
    return Object.keys(g).map(function (k) {
      var arr = g[k];
      var ns = arr.filter(function (r) { return r.noShow; }).length;
      var out = arr.filter(function (r) { return r.outsideSla; }).length;
      return { name: k, total: arr.length, noShows: ns, outside: out, rate: rate(ns, arr.filter(function (r) { return r.meetingDate; }).length), outRate: rate(out, ns) };
    }).sort(function (a, b) { return mode === 'outside' ? (b.outside - a.outside || b.outRate - a.outRate) : (b.noShows - a.noShows || b.rate - a.rate); }).slice(0, 8);
  }

  function renderRank(title, rows, mode) {
    var list = rankRows(rows, 'bdr', mode).map(function (r) {
      var val = mode === 'outside' ? fmtInt(r.outside) : fmtInt(r.noShows);
      var meta = mode === 'outside' ? fmtPct(r.outRate) + ' dos no-shows' : fmtPct(r.rate) + ' de taxa';
      return '<div class="rank-row"><div><div class="rank-name">' + esc(r.name) + '</div><div class="rank-meta">' + esc(meta) + '</div></div><span class="pill ' + (mode === 'outside' && r.outside ? 'bad' : 'warn') + '">' + esc(val) + '</span><span class="rank-meta right">n=' + fmtInt(r.total) + '</span></div>';
    }).join('');
    return '<div class="card span-4"><h2>' + esc(title) + '</h2><div class="desc">Ordena por quantidade e desempata por taxa | n = reuniões agendadas</div>' + (list || '<div class="muted">Sem dados no filtro atual</div>') + '</div>';
  }

  var CALC_HELP = {
    scheduled: ['Agendadas', 'COUNT(deals com data_reuniao_agendada no período)', 'Campo: hs_v2_date_entered_1144746905 normalizado como data_reuniao_agendada.'],
    past: ['Reuniões passadas', 'COUNT(data_reuniao_agendada < hoje)', 'Se a reunião ainda é futura, não entra nos buckets de higiene do campo.'],
    fieldCoverage: ['Campo preenchido', 'Reuniões passadas com a_reuniao_ocorreu_ Sim ou Não ÷ reuniões passadas', 'Propriedade primeiro. Não usa texto para preencher o campo.'],
    fieldMissing: ['Campo pendente', 'COUNT(reunião passada E a_reuniao_ocorreu_ vazio)', 'Este bucket é higiene de CRM. Não é classificado como no-show confirmado sem outra evidência.'],
    occurred: ['Realizadas', 'a_reuniao_ocorreu_ = Sim OU deal avançou para etapa posterior', 'Etapas posteriores: Diagnóstico, Cotação, Consultoria, Negociação, Implantação ou Ganho.'],
    fieldNo: ['Campo Não', 'COUNT(a_reuniao_ocorreu_ = Não em reuniões passadas)', 'É a fonte mais forte de no-show confirmado.'],
    noShow: ['No-show confirmado', 'Campo Não OU evidência final de ausência em motivo/status', 'Texto só entra como suporte final: motivo de perda, descrição e status com termos de ausência.'],
    noShowRate: ['Taxa no-show', 'No-show confirmado ÷ reuniões agendadas', 'Não mistura campo pendente com no-show confirmado.'],
    rescheduled: ['Reagendadas', 'No-show com evidência textual de remarcação', 'Limitação: histórico real de mudança de data ainda não vem no payload.'],
    recovered: ['Recuperados', 'No-show confirmado que ocorreu ou avançou depois', 'Usa a propriedade e a trilha de etapas como evidência de recuperação.'],
    outsideSla: ['Fora SLA', 'No-show aberto sem recuperação com mais de ' + CONFIG.slaBusinessDays + ' dias úteis', 'Dias úteis entre data_reuniao_agendada e hoje.'],
    pipelineRisk: ['Pipeline em risco', 'SUM(ARR estimado) de no-shows abertos', 'ARR = arr_estimado, fallback primeira_fatura × 12, fallback premio_mensal × 12.'],
    pipelineLost: ['Pipeline perdido', 'SUM(ARR estimado) de perdidos com evidência de no-show', 'Usa motivo do declínio e descrição como suporte textual.'],
    timeline: ['Linha temporal semanal', 'Por semana: agendadas, no-show confirmado e campo pendente', 'Ajuda a separar problema operacional de reunião de problema de preenchimento.']
  };

  function openHelp(key) {
    var h = CALC_HELP[key];
    if (!h) return;
    $('help-title').textContent = h[0];
    $('help-body').innerHTML = '<div class="help-block"><b>Fórmula</b><code>' + esc(h[1]) + '</code></div><div class="help-block"><b>Premissa</b><p>' + esc(h[2]) + '</p></div><div class="help-block"><b>Fonte</b><p>GET /api/forecast-table?includeLost=true&includeContext=true | Deal, Contact e Company associados.</p></div>';
    $('help-backdrop').classList.add('open');
    $('help-drawer').classList.add('open');
  }

  function closeHelp() {
    $('help-backdrop').classList.remove('open');
    $('help-drawer').classList.remove('open');
  }

  function renderStory(rows, m) {
    var bdrRows = rankRows(rows, 'bdr', 'rate');
    var top = bdrRows[0];
    return '<div class="story-grid">' +
      '<div class="story-card"><b>Leitura executiva</b><span>' + fmtInt(m.noShows) + ' no-shows confirmados e ' + fmtInt(m.fieldMissingPast) + ' reuniões passadas sem campo preenchido. O painel separa performance real de higiene de CRM.</span></div>' +
      '<div class="story-card"><b>Onde cobrar primeiro</b><span>' + (top ? esc(top.name) + ' concentra ' + fmtInt(top.noShows) + ' no-shows confirmados no filtro atual.' : 'Sem concentração relevante no filtro atual.') + '</span></div>' +
      '<div class="story-card"><b>Regra de classificação</b><span>Propriedades e atividades vêm primeiro. Texto só fecha casos ambíguos de no-show, remarcação ou perda.</span></div>' +
      '</div>';
  }

  function renderLegend() {
    return '<div class="legend-grid">' +
      '<div class="legend-card"><b>Universo</b><span>Conta somente deals com data_reuniao_agendada entre set/25 e hoje. Deals sem reunião agendada ficam fora da análise.</span></div>' +
      '<div class="legend-card"><b>No-show confirmado</b><span>Primeiro usa a_reuniao_ocorreu_ = Não. Texto só entra como suporte final quando o campo não resolve.</span></div>' +
      '<div class="legend-card"><b>Status operacional</b><span>No-show aberto = precisa ação. Reagendada = há evidência textual de remarcação. Recuperado = avançou ou ocorreu depois do no-show.</span></div>' +
      '<div class="legend-card"><b>Persona e indústria</b><span>Persona = cargo do contato classificado em senioridade e área. Indústria = industry da company associada.</span></div>' +
      '</div>';
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
      return '<tr><td><a class="deal-link" href="' + hubspotUrl(r.id) + '" target="_blank" rel="noopener">' + esc(r.name) + '</a></td><td>' + esc(r.bdr) + '</td><td>' + esc(r.ae) + '</td><td>' + esc(r.meetingIso) + '</td><td>' + esc(r.meetingFieldStatus) + '</td><td>' + esc(r.status) + '</td><td class="right">' + esc(r.businessDays == null ? '—' : r.businessDays) + '</td><td><span class="pill ' + slaClass + '">' + slaLabel + '</span></td><td class="right">' + fmtMoney(r.arr) + '</td><td class="right">' + fmtInt(r.risk) + '</td></tr>';
    }).join('');
    return '<div class="card span-12"><h2>Tabela operacional de recuperação</h2><div class="desc">No-shows confirmados priorizados por risco | limitado a 100 linhas</div><div class="table-wrap"><table><thead><tr><th>Deal</th><th>BDR</th><th>AE</th><th>Reunião</th><th>Campo</th><th>Status</th><th class="right">Dias úteis</th><th>SLA</th><th class="right">Pipeline</th><th class="right">Risco</th></tr></thead><tbody>' + (body || '<tr><td colspan="10" class="muted">Nenhum no-show aberto no filtro atual</td></tr>') + '</tbody></table></div></div>';
  }

  function renderFieldTable(rows) {
    var arr = rows.filter(function (r) { return r.fieldPendingPast; }).sort(function (a, b) { return (b.businessDays || 0) - (a.businessDays || 0); }).slice(0, 100);
    var body = arr.map(function (r) {
      return '<tr><td><a class="deal-link" href="' + hubspotUrl(r.id) + '" target="_blank" rel="noopener">' + esc(r.name) + '</a></td><td>' + esc(r.bdr) + '</td><td>' + esc(r.ae) + '</td><td>' + esc(r.meetingIso) + '</td><td class="right">' + esc(r.businessDays == null ? '—' : r.businessDays) + '</td><td>' + esc(r.lastActivity) + '</td><td>' + esc(r.stage) + '</td><td>' + esc(r.persona) + '<div class="muted">' + esc(r.personaSource) + '</div></td><td>' + esc(r.segment) + '<div class="muted">' + esc(r.segmentSource) + '</div></td></tr>';
    }).join('');
    return '<div class="card span-12"><h2>Reunião passou | campo sem preenchimento</h2><div class="desc">Fila de higiene de CRM: a data da reunião passou, mas a_reuniao_ocorreu_ ainda não está Sim ou Não</div><div class="table-wrap"><table><thead><tr><th>Deal</th><th>BDR</th><th>AE</th><th>Reunião</th><th class="right">Dias úteis</th><th>Última atividade</th><th>Etapa</th><th>Persona</th><th>Indústria</th></tr></thead><tbody>' + (body || '<tr><td colspan="9" class="muted">Nenhuma reunião passada com campo pendente no filtro atual</td></tr>') + '</tbody></table></div></div>';
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
      showState('empty', 'Sem reuniões agendadas', 'A API respondeu, mas nenhum deal veio com data_reuniao_agendada entre set/25 e hoje.');
      return;
    }
    if (!state.filtered.length) {
      showState('empty', 'Filtro sem resultados', 'Ajuste período, BDR, origem ou status operacional.');
      return;
    }
    var rows = state.filtered;
    var m = metrics(rows);
    var html = renderStory(rows, m);
    html += renderKpis(m);
    html += renderLegend();
    html += '<div class="grid">' + renderTrend(rows) + renderRank('Ranking por volume de no-show', rows, 'rate') + renderRank('Ranking por fora do prazo', rows, 'outside') + renderBreak('Quebra por origem', rows, 'origem') + renderBreak('Quebra por indústria', rows, 'segment') + renderBreak('Quebra por persona', rows, 'persona') + renderBreak('Quebra por porte | vidas', rows, 'porte') + renderFieldTable(rows) + renderRecoveryTable(rows) + renderLostTable(rows) + '</div>';
    $('content').innerHTML = html;
    var helps = $('content').querySelectorAll('[data-help]');
    for (var i = 0; i < helps.length; i += 1) helps[i].onclick = function (ev) { ev.stopPropagation(); openHelp(this.getAttribute('data-help')); };
    showContent();
  }

  function load() {
    showState('loading', 'Carregando dados', 'Buscando /api/forecast-table?includeLost=true&includeContext=true');
    fetch('/api/forecast-table?includeLost=true&includeContext=true', { credentials: 'same-origin' })
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
        state.records = state.raw.map(normalizeDeal).filter(function (r) { return r.meetingDate && r.meetingIso >= CONFIG.analysisStart && r.meetingDate <= today(); });
        render();
      })
      .catch(function (err) { if (err && err.message === 'AUTH_REDIRECT') return; showState('error', 'Erro ao carregar', err.message || String(err)); });
  }

  function toggleTheme() {
    var n = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', n);
    try { localStorage.setItem('axenya_theme', n); } catch (e) {}
  }

  window.NoShowBDR = { load: load, toggleTheme: toggleTheme, closeHelp: closeHelp, config: CONFIG, vidasRange: vidasRange };
  document.addEventListener('DOMContentLoaded', load);
}());
