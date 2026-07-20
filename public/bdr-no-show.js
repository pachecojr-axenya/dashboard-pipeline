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
    // BDR: usa sdr, com fallback para ae se não tiver sdr
    var bdrValue = deal.sdr || deal.ae || 'Sem BDR';
    var rec = {
      id: deal.hs_id || '',
      name: deal.dealname || '—',
      meetingDate: meetingDate,
      meetingIso: iso(meetingDate),
      week: weekKey(meetingDate),
      bdr: bdrValue,
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
    var h = CALC_HELP[key];
    return '<button type="button" class="calc-btn" data-help="' + esc(key) + '" data-hover-title="' + esc(h ? h[0] : 'Memória de cálculo') + '" data-hover-text="' + esc(h ? h[1] : 'Clique para abrir a ficha completa') + '" aria-label="Ver memória de cálculo">i</button>';
  }

  function kpi(label, value, sub, cls, key) {
    return '<div class="kpi clickable ' + (cls || '') + '" data-drill="' + esc(key || '') + '" data-hover-title="' + esc(label) + '" data-hover-text="Clique para abrir os deals que compõem este card. Passe no i para a fórmula."><div class="label"><span>' + esc(label) + '</span>' + (key ? infoBtn(key) : '') + '</div><div class="value">' + value + '</div><div class="sub">' + esc(sub || '') + '</div></div>';
  }

  function renderKpis(m) {
    return '<div class="kpis">' +
      kpi('Agendadas', fmtInt(m.scheduled), 'Reuniões com data definida no período', 'teal', 'scheduled') +
      kpi('Reuniões passadas', fmtInt(m.pastMeetings), 'Data da reunião já ocorreu', 'teal', 'past') +
      kpi('Campo preenchido', fmtPct(m.fieldCoverage), fmtInt(m.fieldFilledPast) + ' de ' + fmtInt(m.pastMeetings) + ' com campo Sim/Não', m.fieldCoverage < 0.8 ? 'warn' : 'good', 'fieldCoverage') +
      kpi('Campo pendente', fmtInt(m.fieldMissingPast), 'Reunião passou sem preencher se ocorreu', m.fieldMissingPast ? 'bad' : 'good', 'fieldMissing') +
      kpi('Realizadas', fmtInt(m.occurred), 'a_reuniao_ocorreu_ = Sim ou avançou de etapa', 'good', 'occurred') +
      kpi('Campo Não', fmtInt(m.fieldNo), 'BDR marcou que a reunião NÃO ocorreu', m.fieldNo ? 'bad' : 'good', 'fieldNo') +
      kpi('No-show confirmado', fmtInt(m.noShows), 'Campo Não OU evidência textual de ausência', 'bad', 'noShow') +
      kpi('Taxa no-show', fmtPct(m.noShowRate), 'No-shows ÷ total de agendadas', m.noShowRate > 0.25 ? 'bad' : 'warn', 'noShowRate') +
      kpi('Reagendadas', fmtInt(m.rescheduled), 'No-show com nova data marcada', 'warn', 'rescheduled') +
      kpi('Recuperados', fmtInt(m.recovered), 'No-show que virou reunião ou avançou', 'good', 'recovered') +
      kpi('Fora SLA', fmtInt(m.outsideSla), 'No-show há mais de ' + CONFIG.slaBusinessDays + ' dias úteis sem ação', m.outsideSla ? 'bad' : 'good', 'outsideSla') +
      kpi('Pipeline em risco', fmtMoney(m.pipelineRisk), 'ARR potencial em no-shows ainda abertos', 'bad', 'pipelineRisk') +
      kpi('Pipeline perdido', fmtMoney(m.pipelineLost), 'ARR perdido por deals com no-show', 'bad', 'pipelineLost') +
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
    var w = 700, h = 300, p = 44;
    var labelStep = Math.ceil(keys.length / 8);
    var labels = keys.map(function (k, i) {
      if (i % labelStep !== 0 && i !== keys.length - 1) return '';
      var x = p + Math.round(i / Math.max(1, keys.length - 1) * (w - p * 2));
      return '<text x="' + x + '" y="' + (h - 8) + '" text-anchor="middle" fill="var(--muted)">' + esc(k.replace('-', ' ')) + '</text>';
    }).join('');
    var svg = keys.length ? '<svg class="line-svg" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Volume semanal"><line x1="' + p + '" y1="30" x2="' + p + '" y2="' + (h - p) + '" stroke="var(--border)" stroke-width="1"/><line x1="' + p + '" y1="' + (h - p) + '" x2="' + (w - 20) + '" y2="' + (h - p) + '" stroke="var(--border)" stroke-width="1"/><text x="8" y="34" fill="var(--muted)" font-size="11">' + fmtInt(max) + '</text><text x="18" y="' + (h - 8) + '" fill="var(--muted)" font-size="11">0</text><polyline class="ln scheduled" points="' + svgPoints(scheduled, max, w, h, p) + '"/><polyline class="ln no-show" points="' + svgPoints(noShows, max, w, h, p) + '"/><polyline class="ln pending" points="' + svgPoints(pending, max, w, h, p) + '"/>' + labels + '</svg>' : '<div class="muted">Sem semanas com reunião no filtro atual</div>';
    return '<div class="card span-8"><div class="card-title"><div><h2>Volume semanal</h2></div>' + infoBtn('timeline') + '</div><div class="line-legend"><span><i class="scheduled"></i>Agendadas</span><span><i class="no-show"></i>No-show</span><span><i class="pending"></i>Pendente</span></div><div class="trend line-chart clickable" data-drill="timeline" data-hover-title="Volume" data-hover-text="Clique para abrir a tabela semanal.">' + svg + '</div></div>';
  }

  // Estado do filtro de taxa
  var currentRateFilter = 'all';
  
  function renderRateTrend(rows, m) {
    // Filtros de visualização
    var filters = [
      { key: 'all', label: 'Todos' },
      { key: 'bdr', label: 'Por BDR' },
      { key: 'origem', label: 'Por canal' },
      { key: 'porte', label: 'Por porte' }
    ];
    var filterBtns = filters.map(function (f) {
      return '<button type="button" class="rate-filter-btn' + (f.key === currentRateFilter ? ' active' : '') + '" data-rate-filter="' + f.key + '">' + esc(f.label) + '</button>';
    }).join('');
    
    // Gerar SVG baseado no filtro atual
    var svgResult = generateRateSvg(rows, currentRateFilter);
    var svg = svgResult.svg;
    var trendText = svgResult.trendText;
    
    // Calcular taxa média acumulada do período
    var totalMeetings = rows.filter(function (r) { return r.meetingDate; }).length;
    var totalNoShows = rows.filter(function (r) { return r.noShow; }).length;
    var avgRate = totalMeetings ? totalNoShows / totalMeetings : 0;
    var sampleWarning = totalMeetings < 30 ? '<span class="sample-warning">⚠️ Amostra pequena (' + totalMeetings + ' reuniões). Taxas semanais podem variar muito.</span>' : '';
    
    // Debug info
    var bdrCount = uniqueValues('bdr').length;
    var debugInfo = '<div class="rate-debug">Total: ' + fmtInt(totalMeetings) + ' reuniões | ' + fmtInt(totalNoShows) + ' no-shows | Taxa média: ' + fmtPct(avgRate) + ' | BDRs ativos: ' + bdrCount + '</div>';
    
    return '<div class="card span-12"><div class="card-title"><div><h2 id="rate-title">' + esc(trendText) + '</h2></div>' + infoBtn('rateTrend') + '</div><div class="rate-filters">' + filterBtns + '</div><div id="rate-chart" class="trend line-chart clickable" data-drill="timeline" data-hover-title="Taxa de no-show" data-hover-text="Clique para abrir a tabela semanal com volumes e taxas.">' + svg + '</div><div id="rate-legend" class="rate-legend"></div>' + debugInfo + sampleWarning + '</div>';
  }
  
  function generateRateSvg(rows, filterKey) {
    var g = group(rows.filter(function (r) { return r.meetingDate; }), 'week');
    var keys = Object.keys(g).sort().slice(-16);
    var colors = ['#f85149', '#e3b341', '#3ab8b7', '#3fb950', '#a371f7', '#79c0ff', '#ff7b72', '#ffa657'];
    
    if (filterKey === 'all') {
      // Linha única geral - calcular taxas e volumes
      var weekData = keys.map(function (k) {
        var arr = g[k];
        var ns = arr.filter(function (r) { return r.noShow; }).length;
        return { total: arr.length, noShows: ns, rate: arr.length ? ns / arr.length : 0 };
      });
      var rates = weekData.map(function (w) { return w.rate; });
      var volumes = weekData.map(function (w) { return w.total; });
      var maxRate = Math.max.apply(null, rates);
      var max = Math.max(0.1, Math.ceil(maxRate * 1.25 * 10) / 10);
      var w = 1100, h = 300, p = 44;
      var points = rates.map(function (r, i) {
        var x = p + Math.round(i / Math.max(1, keys.length - 1) * (w - p * 2));
        var y = h - p - Math.round(r / max * (h - p * 2));
        return x + ',' + y;
      }).join(' ');
      var labelStep = Math.ceil(keys.length / 8);
      var labels = keys.map(function (k, i) {
        if (i % labelStep !== 0 && i !== keys.length - 1) return '';
        var x = p + Math.round(i / Math.max(1, keys.length - 1) * (w - p * 2));
        return '<text x="' + x + '" y="' + (h - 10) + '" text-anchor="middle" fill="var(--muted)">' + esc(k.replace('-', ' ')) + '</text>';
      }).join('');
      var rateLabels = rates.map(function (r, i) {
        var x = p + Math.round(i / Math.max(1, keys.length - 1) * (w - p * 2));
        var y = h - p - Math.round(r / max * (h - p * 2)) - 8;
        var vol = volumes[i];
        // Não mostra label se taxa for 0% (evita ruído visual)
        if (r === 0) return '';
        // Mostra taxa + volume se for poucas reuniões (<10)
        var label = fmtPct(r);
        if (vol < 10) label += ' (' + vol + ')';
        return '<text x="' + x + '" y="' + y + '" text-anchor="middle" fill="var(--text)" font-size="11" font-weight="600">' + esc(label) + '</text>';
      }).join('');
      // Título com taxa média acumulada
      var totalNoShowsAll = weekData.reduce(function (s, w) { return s + w.noShows; }, 0);
      var totalMeetingsAll = weekData.reduce(function (s, w) { return s + w.total; }, 0);
      var avgRateAll = totalMeetingsAll ? totalNoShowsAll / totalMeetingsAll : 0;
      var trendText = 'Taxa média: ' + fmtPct(avgRateAll) + ' (' + totalNoShowsAll + '/' + totalMeetingsAll + ')';
      if (rates.length >= 2) {
        var last = rates[rates.length - 1];
        var prev = rates[rates.length - 2];
        if (last < prev - 0.02) trendText = 'Taxa em queda: ' + fmtPct(prev) + ' → ' + fmtPct(last) + ' | Média: ' + fmtPct(avgRateAll);
        else if (last > prev + 0.02) trendText = 'Taxa subindo: ' + fmtPct(prev) + ' → ' + fmtPct(last) + ' | Média: ' + fmtPct(avgRateAll);
        else trendText = 'Taxa estável em ' + fmtPct(last) + ' | Média: ' + fmtPct(avgRateAll);
      }
      var svg = keys.length ? '<svg class="line-svg" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Taxa de no-show semanal"><line x1="' + p + '" y1="30" x2="' + p + '" y2="' + (h - p) + '" stroke="var(--border)" stroke-width="1"/><line x1="' + p + '" y1="' + (h - p) + '" x2="' + (w - 20) + '" y2="' + (h - p) + '" stroke="var(--border)" stroke-width="1"/><text x="8" y="34" fill="var(--muted)" font-size="11">' + fmtPct(max) + '</text><text x="18" y="' + (h - 8) + '" fill="var(--muted)" font-size="11">0%</text><polyline class="ln" style="stroke:var(--red);stroke-width:3" points="' + points + '"/>' + rateLabels + labels + '</svg>' : '<div class="muted">Sem semanas com reunião no filtro atual</div>';
      return { svg: svg, trendText: trendText };
    }
    
    // Múltiplas linhas por dimensão
    var dimKey = filterKey;
    var dimValues = {};
    rows.forEach(function (r) {
      var val = r[dimKey] || 'Não informado';
      dimValues[val] = true;
    });
    var dimList = Object.keys(dimValues).slice(0, 8); // Máximo 8 linhas
    
    // Calcular taxas por dimensão por semana
    var linesData = dimList.map(function (dimVal) {
      var rates = keys.map(function (k) {
        var arr = g[k].filter(function (r) { return (r[dimKey] || 'Não informado') === dimVal; });
        var ns = arr.filter(function (r) { return r.noShow; }).length;
        return arr.length ? ns / arr.length : 0;
      });
      return { name: dimVal, rates: rates };
    });
    
    // Escala dinâmica
    var allRates = linesData.flatMap(function (l) { return l.rates; });
    var maxRate = Math.max.apply(null, allRates);
    var max = Math.max(0.1, Math.ceil(maxRate * 1.25 * 10) / 10);
    var w = 1100, h = 300, p = 44;
    
    var labelStep = Math.ceil(keys.length / 8);
    var labels = keys.map(function (k, i) {
      if (i % labelStep !== 0 && i !== keys.length - 1) return '';
      var x = p + Math.round(i / Math.max(1, keys.length - 1) * (w - p * 2));
      return '<text x="' + x + '" y="' + (h - 10) + '" text-anchor="middle" fill="var(--muted)">' + esc(k.replace('-', ' ')) + '</text>';
    }).join('');
    
    var polylines = linesData.map(function (line, idx) {
      var points = line.rates.map(function (r, i) {
        var x = p + Math.round(i / Math.max(1, keys.length - 1) * (w - p * 2));
        var y = h - p - Math.round(r / max * (h - p * 2));
        return x + ',' + y;
      }).join(' ');
      return '<polyline class="ln" style="stroke:' + colors[idx % colors.length] + ';stroke-width:2" points="' + points + '"/>';
    }).join('');
    
    var trendText = 'Taxa por ' + (filterKey === 'bdr' ? 'BDR' : filterKey === 'origem' ? 'canal' : 'porte');
    var svg = keys.length ? '<svg class="line-svg" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Taxa de no-show por ' + esc(filterKey) + '"><line x1="' + p + '" y1="30" x2="' + p + '" y2="' + (h - p) + '" stroke="var(--border)" stroke-width="1"/><line x1="' + p + '" y1="' + (h - p) + '" x2="' + (w - 20) + '" y2="' + (h - p) + '" stroke="var(--border)" stroke-width="1"/><text x="8" y="34" fill="var(--muted)" font-size="11">' + fmtPct(max) + '</text><text x="18" y="' + (h - 8) + '" fill="var(--muted)" font-size="11">0%</text>' + polylines + labels + '</svg>' : '<div class="muted">Sem semanas com reunião no filtro atual</div>';
    
    return { svg: svg, trendText: trendText, linesData: linesData, dimList: dimList, colors: colors };
  }
  
  // Dados para filtros de taxa (cache)
  var rateFilterData = { all: null, bdr: null, origem: null, porte: null };
  
  function buildRateFilterData(rows) {
    var weeks = {};
    rows.filter(function (r) { return r.meetingDate; }).forEach(function (r) {
      if (!weeks[r.week]) weeks[r.week] = { all: [], bdr: {}, origem: {}, porte: {} };
      weeks[r.week].all.push(r);
      if (r.bdr) { if (!weeks[r.week].bdr[r.bdr]) weeks[r.week].bdr[r.bdr] = []; weeks[r.week].bdr[r.bdr].push(r); }
      if (r.origem) { if (!weeks[r.week].origem[r.origem]) weeks[r.week].origem[r.origem] = []; weeks[r.week].origem[r.origem].push(r); }
      if (r.porte) { if (!weeks[r.week].porte[r.porte]) weeks[r.week].porte[r.porte] = []; weeks[r.week].porte[r.porte].push(r); }
    });
    return weeks;
  }
  
  function renderRateLegend(filterKey, rows, svgResult) {
    var legendEl = $('rate-legend');
    if (!legendEl) return;
    
    if (filterKey === 'all') {
      legendEl.innerHTML = '<span class="rate-legend-item"><span class="rate-legend-dot" style="background:var(--red)"></span>Taxa de no-show geral</span>';
      return;
    }
    
    // Usar dados do SVG gerado
    var linesData = svgResult && svgResult.linesData ? svgResult.linesData : [];
    var colors = svgResult && svgResult.colors ? svgResult.colors : ['#f85149', '#e3b341', '#3ab8b7', '#3fb950', '#a371f7', '#79c0ff'];
    
    // Calcular taxa média por linha
    var items = linesData.map(function (line, idx) {
      var avgRate = line.rates.reduce(function (a, b) { return a + b; }, 0) / line.rates.length;
      return { name: line.name, rate: avgRate, color: colors[idx % colors.length] };
    }).sort(function (a, b) { return b.rate - a.rate; });
    
    legendEl.innerHTML = items.map(function (item) {
      return '<span class="rate-legend-item" data-filter-key="' + esc(filterKey) + '" data-filter-val="' + esc(item.name) + '"><span class="rate-legend-dot" style="background:' + item.color + '"></span>' + esc(item.name) + ' (' + fmtPct(item.rate) + ')</span>';
    }).join('');
    
    // Adicionar click para filtrar
    var legendItems = legendEl.querySelectorAll('[data-filter-val]');
    for (var i = 0; i < legendItems.length; i += 1) legendItems[i].onclick = function () {
      var key = this.getAttribute('data-filter-key');
      var val = this.getAttribute('data-filter-val');
      openDealsNoShow(val, key, rows);
    };
  }
  
  function openDealsNoShow(title, key, rows) {
    var filtered = state.filtered.filter(function (r) { return r[key] === title && r.noShow; });
    openDeals(title, filtered);
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
    var infoKey = mode === 'outside' ? 'rankOutside' : 'rankVolume';
    var list = rankRows(rows, 'bdr', mode).map(function (r) {
      var val = mode === 'outside' ? fmtInt(r.outside) : fmtInt(r.noShows);
      var meta = mode === 'outside' 
        ? fmtPct(r.outRate) + ' dos no-shows deste BDR estão fora do SLA' 
        : fmtPct(r.rate) + ' de taxa de no-show';
      return '<div class="rank-row clickable-row" data-rank-mode="' + esc(mode) + '" data-rank-name="' + esc(r.name) + '" data-hover-title="' + esc(r.name) + '" data-hover-text="Clique para abrir os deals deste BDR no ranking."><div><div class="rank-name">' + esc(r.name) + '</div><div class="rank-meta">' + esc(meta) + '</div></div><span class="pill ' + (mode === 'outside' && r.outside ? 'bad' : 'warn') + '">' + esc(val) + '</span><span class="rank-meta right">n=' + fmtInt(r.total) + '</span></div>';
    }).join('');
    var descText = mode === 'outside' 
      ? 'Quantidade de no-shows fora do SLA (mais de ' + CONFIG.slaBusinessDays + ' dias úteis) | n = reuniões agendadas' 
      : 'Quantidade de no-shows confirmados | n = reuniões agendadas';
    return '<div class="card span-4"><div class="card-title"><div><h2>' + esc(title) + '</h2><div class="desc">' + esc(descText) + '</div></div>' + infoBtn(infoKey) + '</div>' + (list || '<div class="muted">Sem dados no filtro atual</div>') + '</div>';
  }

  function renderBigIdea(rows, m) {
    var bdrRows = rankRows(rows, 'bdr', 'rate');
    var top = bdrRows[0];
    var trendDirection = '';
    var g = group(rows.filter(function (r) { return r.meetingDate; }), 'week');
    var keys = Object.keys(g).sort();
    if (keys.length >= 2) {
      var last2 = keys.slice(-2);
      var rates = last2.map(function (k) {
        var arr = g[k];
        var ns = arr.filter(function (r) { return r.noShow; }).length;
        return arr.length ? ns / arr.length : 0;
      });
      if (rates[1] < rates[0] - 0.02) trendDirection = 'tendência de queda';
      else if (rates[1] > rates[0] + 0.02) trendDirection = 'tendência de alta';
      else trendDirection = 'estável';
    }
    var bigIdeaText = '';
    if (m.pipelineRisk > 0 && m.outsideSla > 0) {
      bigIdeaText = '<strong>' + fmtMoney(m.pipelineRisk) + '</strong> em no-shows abertos. <strong>' + fmtInt(m.outsideSla) + '</strong> casos fora do prazo esperam ação. ' + (top ? '<strong>' + esc(top.name) + '</strong> concentra a maior fila.' : '');
    } else if (m.noShows > 0) {
      bigIdeaText = '<strong>' + fmtInt(m.noShows) + '</strong> no-shows confirmados (' + fmtPct(m.noShowRate) + '). Taxa ' + trendDirection + '.';
    } else {
      bigIdeaText = 'Nenhum no-show confirmado no período. Higiene do CRM em ' + fmtPct(m.fieldCoverage) + '.';
    }
    return '<div class="big-idea"><div class="big-idea-text">' + bigIdeaText + '</div><div class="big-idea-action">Ação: abrir a fila de recuperação e atacar os deals fora do SLA</div></div>';
  }

  function renderHeroKpis(m) {
    return '<div class="kpis kpis-hero">' +
      kpi('Pipeline em risco', fmtMoney(m.pipelineRisk), 'Valor anual que pode escapar se não recuperar', 'bad hero', 'pipelineRisk') +
      kpi('Fora do prazo', fmtInt(m.outsideSla), 'No-shows há mais de 2 dias úteis sem ação', m.outsideSla ? 'bad hero' : 'good hero', 'outsideSla') +
      kpi('Taxa no-show', fmtPct(m.noShowRate), 'No-shows a cada 100 reuniões marcadas', m.noShowRate > 0.25 ? 'bad hero' : 'warn hero', 'noShowRate') +
      kpi('Recuperados', fmtInt(m.recovered), 'No-shows que voltaram a andar', 'good hero', 'recovered') +
      '</div>';
  }

  function renderHygieneCard(m) {
    return '<div class="card hygiene-card">' +
      '<div class="card-title"><h2>Higiene do CRM</h2>' + infoBtn('hygiene') + '</div>' +
      '<div class="hygiene-grid">' +
      '<div class="hygiene-item"><span class="hygiene-label">Reuniões agendadas</span><span class="hygiene-value">' + fmtInt(m.scheduled) + '</span></div>' +
      '<div class="hygiene-item"><span class="hygiene-label">Já passaram</span><span class="hygiene-value">' + fmtInt(m.pastMeetings) + '</span></div>' +
      '<div class="hygiene-item"><span class="hygiene-label">Campo preenchido</span><span class="hygiene-value ' + (m.fieldCoverage < 0.8 ? 'warn' : 'good') + '">' + fmtPct(m.fieldCoverage) + '</span></div>' +
      '<div class="hygiene-item"><span class="hygiene-label">Campo pendente</span><span class="hygiene-value ' + (m.fieldMissingPast ? 'bad' : 'good') + '">' + fmtInt(m.fieldMissingPast) + '</span></div>' +
      '<div class="hygiene-item"><span class="hygiene-label">Realizadas</span><span class="hygiene-value good">' + fmtInt(m.occurred) + '</span></div>' +
      '<div class="hygiene-item"><span class="hygiene-label">Marcadas como Não</span><span class="hygiene-value ' + (m.fieldNo ? 'bad' : '') + '">' + fmtInt(m.fieldNo) + '</span></div>' +
      '</div></div>';
  }

  function renderTrendSummary(rows, m) {
    var g = group(rows.filter(function (r) { return r.meetingDate; }), 'week');
    var keys = Object.keys(g).sort();
    var currentWeek = keys[keys.length - 1] || '—';
    var lastWeekData = g[keys[keys.length - 1]] || [];
    var lastWeekNoShows = lastWeekData.filter(function (r) { return r.noShow; }).length;
    var lastWeekTotal = lastWeekData.length;
    var lastWeekRate = lastWeekTotal ? lastWeekNoShows / lastWeekTotal : 0;
    return '<div class="card span-4"><div class="card-title"><h2>Resumo da semana</h2></div>' +
      '<div class="summary-grid">' +
      '<div class="summary-item"><span class="summary-label">Semana atual</span><span class="summary-value">' + esc(currentWeek.replace('-', ' ')) + '</span></div>' +
      '<div class="summary-item"><span class="summary-label">Reuniões agendadas</span><span class="summary-value">' + fmtInt(lastWeekTotal) + '</span></div>' +
      '<div class="summary-item"><span class="summary-label">No-shows</span><span class="summary-value">' + fmtInt(lastWeekNoShows) + '</span></div>' +
      '<div class="summary-item"><span class="summary-label">Taxa da semana</span><span class="summary-value ' + (lastWeekRate > 0.25 ? 'bad' : 'good') + '">' + fmtPct(lastWeekRate) + '</span></div>' +
      '</div></div>';
  }

  var CALC_HELP = {
    scheduled: ['Reuniões agendadas', 'Número de reuniões que foram marcadas com data definida no período. Conta todas, independentemente de terem ocorrido ou não.', 'Campo no HubSpot: data da reunião (data_reuniao_agendada). Só entram deals com essa data preenchida.'],
    past: ['Reuniões passadas', 'Reuniões cuja data já passou (antes de hoje). Só essas podem ser cobradas quanto ao preenchimento e ao no-show.', 'Reuniões com data futura ainda não entram nas contas de higiene ou de ausência.'],
    fieldCoverage: ['Campo preenchido', 'Percentual de reuniões passadas em que o BDR já registrou no HubSpot se a reunião ocorreu ou não (Sim/Não). Mede a disciplina de preenchimento.', 'Considera só a marcação oficial no campo. Não usamos o texto do deal para adivinhar o resultado.'],
    fieldMissing: ['Campo pendente', 'Reuniões cuja data já passou, mas o BDR ainda não marcou se ela ocorreu ou não. É uma fila de organização do CRM, não um no-show.', 'Enquanto o campo estiver vazio, não classificamos como ausência sem outra evidência.'],
    occurred: ['Realizadas', 'Reuniões que aconteceram de fato. Contamos como realizada quando o BDR marcou "Sim" ou quando o deal avançou para uma etapa que só se alcança após a reunião.', 'Etapas que indicam reunião feita: Diagnóstico, Cotação, Consultoria, Negociação, Implantação ou Ganho.'],
    fieldNo: ['Campo Não', 'Reuniões em que o BDR marcou explicitamente que a reunião NÃO ocorreu. É a evidência mais confiável de ausência.', 'Vem da marcação oficial do BDR no HubSpot, não de interpretação de texto.'],
    noShow: ['No-show confirmado', 'Reuniões que foram marcadas mas o cliente não compareceu. Confirmamos quando o BDR marcou "Não" ou quando há registro claro de ausência no motivo/status.', 'O texto do deal só é usado como último recurso, quando não há marcação oficial. Campo vazio sozinho não vira no-show.'],
    noShowRate: ['Taxa no-show', 'De cada 100 reuniões marcadas no período, quantas viraram no-show confirmado. Quanto menor, melhor.', 'Divide os no-shows confirmados pelo total de reuniões agendadas. Não mistura com as pendentes de preenchimento.'],
    rescheduled: ['Reagendadas', 'No-shows em que há registro de que uma nova data foi combinada. Sinal de recuperação em andamento.', 'Hoje detectamos a remarcação pelo texto do deal; o histórico exato de datas ainda não vem do sistema.'],
    recovered: ['Recuperados', 'No-shows que foram revertidos: a reunião acabou acontecendo depois, ou o negócio avançou de etapa mesmo após a falta.', 'Usamos a marcação da reunião e a trilha de etapas como prova de recuperação.'],
    outsideSla: ['Fora do prazo (SLA)', 'No-shows que já passaram de ' + CONFIG.slaBusinessDays + ' dias úteis sem nenhuma ação de recuperação. São os casos mais urgentes de cobrar.', 'Contamos os dias úteis entre a data da reunião e hoje.'],
    pipelineRisk: ['Pipeline em risco', 'Soma do valor anual estimado (ARR) dos negócios que tiveram no-show e ainda estão abertos, sem recuperação. É a receita que pode escapar.', 'Valor por deal: ARR estimado; se não houver, usamos a 1ª fatura × 12 ou o prêmio mensal × 12.'],
    pipelineLost: ['Pipeline perdido', 'Soma do valor anual estimado dos negócios que foram perdidos e têm o no-show registrado como causa. Receita já perdida.', 'Usa o motivo e a descrição da perda como comprovação.'],
    timeline: ['Volume semanal', 'Mostra, semana a semana, quantas reuniões foram agendadas, quantas viraram no-show e quantas ainda estão sem preenchimento.', 'Ajuda a separar problema de comparecimento de problema de registro. Clique para ver a tabela detalhada.'],
    rateTrend: ['Taxa de no-show ao longo do tempo', 'Mostra se a taxa de no-show está subindo, caindo ou estável nas últimas semanas. É o termômetro principal da página.', 'Para cada semana: no-shows confirmados divididos pelas reuniões agendadas daquela semana.'],
    rankVolume: ['Ranking por volume de no-show', 'Lista os BDRs com mais no-shows confirmados no período. A ordem é por quantidade, para priorizar onde cobrar primeiro; a taxa aparece como contexto.', '"n" = quantas reuniões aquele BDR tinha agendado no filtro atual.'],
    rankOutside: ['Ranking por fora do prazo', 'Lista os BDRs com mais no-shows que passaram do prazo de ' + CONFIG.slaBusinessDays + ' dias úteis sem ação. Mostra quem está deixando recuperação atrasar.', 'Ordena por quantidade fora do prazo; a % é dos no-shows daquele BDR.'],
    breakOrigem: ['Quebra por origem', 'Distribui os no-shows pela origem do lead (de onde o negócio veio). Mostra quais canais trazem mais faltas.', 'Usa o campo de origem do deal. Clique em cada linha para ver os negócios.'],
    breakSegment: ['Quebra por indústria', 'Distribui os no-shows pela indústria/setor da empresa. Mostra em quais setores o cliente falta mais.', 'Vem do setor cadastrado na empresa associada, não de adivinhação pelo nome.'],
    breakPersona: ['Quebra por persona', 'Distribui os no-shows pelo perfil de quem seria o interlocutor (senioridade + área, ex.: "Gestão | RH"). Mostra quais perfis faltam mais.', 'Vem do cargo do contato associado, classificado automaticamente.'],
    breakPorte: ['Quebra por porte', 'Distribui os no-shows pela faixa de vidas/funcionários da empresa. Mostra se empresas maiores ou menores faltam mais.', 'Usa o número de vidas; se não houver, usa o de colaboradores.'],
    fieldTable: ['Reunião passou sem preenchimento', 'Fila de organização: reuniões cuja data já passou mas o BDR ainda não marcou se ocorreu. Não são no-shows — são pendências de registro.', 'Priorizadas pelas que estão há mais dias úteis sem preenchimento.'],
    recoveryTable: ['Tabela de recuperação', 'Lista os no-shows ainda abertos, ordenados por risco, para o time saber o que atacar primeiro.', 'O risco combina: ser no-show, estar fora do prazo, dias sem atividade e valor do negócio.'],
    lostTable: ['Perdidos por no-show', 'Negócios já perdidos em que o no-show consta como causa. Serve para dimensionar o custo real das faltas.', 'Aqui o texto do motivo/descrição é usado como prova, porque a perda já ocorreu.'],
    story: ['Leitura executiva', 'Resumo em uma frase: quantos no-shows, quantas pendências de preenchimento e qual BDR priorizar.', 'Os números vêm exatamente dos mesmos filtros dos cards acima.'],
    hygiene: ['Higiene do CRM', 'Disciplina de preenchimento do campo "a reunião ocorreu?". Reuniões passadas devem ter Sim ou Não marcado.', 'Campo vazio após a reunião é pendência de CRM, não é no-show.']
  };

  function openHelp(key) {
    var h = CALC_HELP[key];
    if (!h) return;
    $('help-title').textContent = h[0];
    $('help-body').innerHTML = '<div class="help-block"><b>Fórmula</b><code>' + esc(h[1]) + '</code></div><div class="help-block"><b>Premissa</b><p>' + esc(h[2]) + '</p></div><div class="help-block"><b>Fonte</b><p>GET /api/forecast-table?includeLost=true&includeContext=true | Deal, Contact e Company associados.</p></div>';
    $('help-backdrop').classList.add('open');
    $('help-drawer').classList.add('open');
  }

  function openAllHelp() {
    var keys = Object.keys(CALC_HELP);
    $('help-title').textContent = 'Campos HubSpot | No Show';
    $('help-body').innerHTML = '<p style="font-size:.8rem;color:var(--muted);line-height:1.55;margin:0 0 1rem">Padrão do dashboard: passar o mouse no i mostra o rótulo; clicar abre a ficha. Clicar em cards, linhas e gráficos abre os deals ou o breakdown correspondente.</p>' + keys.map(function (k) {
      var h = CALC_HELP[k];
      return '<div class="help-block"><b>' + esc(h[0]) + '</b><code>' + esc(h[1]) + '</code><p>' + esc(h[2]) + '</p></div>';
    }).join('');
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
    var trend = '';
    var g = group(rows.filter(function (r) { return r.meetingDate; }), 'week');
    var keys = Object.keys(g).sort();
    if (keys.length >= 2) {
      var last2 = keys.slice(-2);
      var rates = last2.map(function (k) {
        var arr = g[k];
        var ns = arr.filter(function (r) { return r.noShow; }).length;
        return arr.length ? ns / arr.length : 0;
      });
      if (rates[1] < rates[0]) trend = ' Tendência de queda na taxa de no-show nas últimas semanas.';
      else if (rates[1] > rates[0]) trend = ' Tendência de alta na taxa de no-show nas últimas semanas.';
      else trend = ' Taxa de no-show estável nas últimas semanas.';
    }
    return '<div class="story-grid">' +
      '<div class="story-card"><div class="story-head"><b>Leitura executiva</b>' + infoBtn('story') + '</div><span><strong>' + fmtInt(m.noShows) + '</strong> no-shows confirmados de <strong>' + fmtInt(m.scheduled) + '</strong> reuniões agendadas (' + fmtPct(m.noShowRate) + ').' + fmtInt(m.fieldMissingPast) + ' reuniões passadas com campo pendente (higiene de CRM).' + trend + '</span></div>' +
      '<div class="story-card"><div class="story-head"><b>Onde cobrar primeiro</b>' + infoBtn('rankVolume') + '</div><span>' + (top ? '<strong>' + esc(top.name) + '</strong> concentra <strong>' + fmtInt(top.noShows) + '</strong> no-shows confirmados (' + fmtPct(top.rate) + ' de taxa) no filtro atual.' : 'Sem concentração relevante no filtro atual.') + '</span></div>' +
      '<div class="story-card"><div class="story-head"><b>Regra de classificação</b>' + infoBtn('noShow') + '</div><span>O no-show é confirmado quando <code>a_reuniao_ocorreu_ = Não</code>. Texto é suporte final para casos ambíguos. Campo vazio não conta como no-show.</span></div>' +
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
    var infoByKey = { origem: 'breakOrigem', segment: 'breakSegment', persona: 'breakPersona', porte: 'breakPorte' };
    var infoKey = infoByKey[key] || 'noShow';
    var g = group(rows, key);
    var items = Object.keys(g).map(function (k) {
      var arr = g[k];
      var ns = arr.filter(function (r) { return r.noShow; }).length;
      return { name: k, total: arr.length, ns: ns, rate: rate(ns, arr.length) };
    }).sort(function (a, b) { return b.ns - a.ns || b.rate - a.rate; }).slice(0, 8);
    var max = Math.max(1, items.reduce(function (m, x) { return Math.max(m, x.ns); }, 0));
    var html = items.map(function (x) {
      return '<div class="break-row clickable-row" data-break-key="' + esc(key) + '" data-break-name="' + esc(x.name) + '" data-hover-title="' + esc(x.name) + '" data-hover-text="Clique para abrir os deals desta quebra."><div class="break-name">' + esc(x.name) + '</div><div class="break-val">' + fmtInt(x.ns) + '</div><div class="break-val">' + fmtPct(x.rate) + '</div><div class="break-track"><div class="break-fill" style="width:' + Math.round(x.ns / max * 100) + '%"></div></div></div>';
    }).join('');
    return '<div class="card span-4"><div class="card-title"><div><h2>' + esc(title) + '</h2><div class="desc">No-shows | volume | taxa</div></div>' + infoBtn(infoKey) + '</div><div class="break-list">' + (html || '<div class="muted">Sem dados</div>') + '</div></div>';
  }

  function hubspotUrl(id) { return id ? 'https://app.hubspot.com/contacts/44715285/deal/' + encodeURIComponent(id) : '#'; }

  function openModal(title, bodyHtml) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = bodyHtml;
    $('modal-overlay').classList.add('open');
  }

  function closeModal() {
    $('modal-overlay').classList.remove('open');
  }

  function modalKpis(rows) {
    var no = rows.filter(function (r) { return r.noShow; }).length;
    var pend = rows.filter(function (r) { return r.fieldPendingPast; }).length;
    var arr = rows.reduce(function (s, r) { return s + (r.arr || 0); }, 0);
    return '<div class="modal-kpis"><div class="modal-kpi"><span>Deals</span><b>' + fmtInt(rows.length) + '</b></div><div class="modal-kpi"><span>No-show confirmado</span><b>' + fmtInt(no) + '</b></div><div class="modal-kpi"><span>Campo pendente</span><b>' + fmtInt(pend) + '</b></div><div class="modal-kpi"><span>Pipeline</span><b>' + fmtMoney(arr) + '</b></div></div>';
  }

  function dealRows(rows) {
    return rows.map(function (r) {
      return '<tr><td><a class="deal-link" href="' + hubspotUrl(r.id) + '" target="_blank" rel="noopener">' + esc(r.name) + '</a></td><td>' + esc(r.bdr) + '</td><td>' + esc(r.ae) + '</td><td>' + esc(r.meetingIso) + '</td><td>' + esc(r.meetingFieldStatus) + '</td><td>' + esc(r.status) + '</td><td>' + esc(r.stage) + '</td><td>' + esc(r.persona) + '</td><td>' + esc(r.segment) + '</td><td class="right">' + fmtMoney(r.arr) + '</td></tr>';
    }).join('');
  }

  function openDeals(title, rows) {
    var arr = (rows || []).slice(0, 200);
    var html = modalKpis(rows || []) + '<div class="table-wrap"><table><thead><tr><th>Deal</th><th>BDR</th><th>AE</th><th>Reunião</th><th>Campo</th><th>Status</th><th>Etapa</th><th>Persona</th><th>Indústria</th><th class="right">Pipeline</th></tr></thead><tbody>' + (dealRows(arr) || '<tr><td colspan="10" class="muted">Sem deals para este recorte</td></tr>') + '</tbody></table></div>';
    openModal(title + ' (' + fmtInt((rows || []).length) + ')', html);
  }

  function openTimelineModal(rows) {
    var g = group(rows.filter(function (r) { return r.meetingDate; }), 'week');
    var body = Object.keys(g).sort().map(function (k) {
      var arr = g[k];
      var no = arr.filter(function (r) { return r.noShow; }).length;
      var pend = arr.filter(function (r) { return r.fieldPendingPast; }).length;
      return '<tr><td>' + esc(k.replace('-', ' ')) + '</td><td class="right">' + fmtInt(arr.length) + '</td><td class="right">' + fmtInt(no) + '</td><td class="right">' + fmtPct(rate(no, arr.length)) + '</td><td class="right">' + fmtInt(pend) + '</td></tr>';
    }).join('');
    openModal('Linha temporal semanal', '<div class="table-wrap"><table><thead><tr><th>Semana</th><th class="right">Agendadas</th><th class="right">No-show</th><th class="right">Taxa</th><th class="right">Campo pendente</th></tr></thead><tbody>' + (body || '<tr><td colspan="5" class="muted">Sem semanas no filtro atual</td></tr>') + '</tbody></table></div>');
  }

  function drillRows(key) {
    var rows = state.filtered;
    if (key === 'scheduled') return rows.filter(function (r) { return r.meetingDate; });
    if (key === 'past') return rows.filter(function (r) { return r.pastMeeting; });
    if (key === 'fieldCoverage') return rows.filter(function (r) { return r.pastMeeting && r.meetingFieldFilled; });
    if (key === 'fieldMissing') return rows.filter(function (r) { return r.fieldPendingPast; });
    if (key === 'occurred') return rows.filter(function (r) { return r.occurred; });
    if (key === 'fieldNo') return rows.filter(function (r) { return r.explicitOccurred === false; });
    if (key === 'noShow') return rows.filter(function (r) { return r.noShow; });
    if (key === 'noShowRate') return rows.filter(function (r) { return r.noShow; });
    if (key === 'rescheduled') return rows.filter(function (r) { return r.rescheduled; });
    if (key === 'recovered') return rows.filter(function (r) { return r.recovered; });
    if (key === 'outsideSla') return rows.filter(function (r) { return r.outsideSla; });
    if (key === 'pipelineRisk') return rows.filter(function (r) { return r.noShow && r.stage !== 'Perdido' && !r.recovered; });
    if (key === 'pipelineLost') return rows.filter(function (r) { return r.status === 'Perdido por no-show'; });
    return [];
  }

  function openDrill(key) {
    if (!key) return;
    if (key === 'timeline') return openTimelineModal(state.filtered);
    var h = CALC_HELP[key];
    openDeals(h ? h[0] : 'Detalhe', drillRows(key));
  }
  function renderRecoveryTable(rows) {
    var arr = rows.filter(function (r) { return r.noShow && r.stage !== 'Perdido' && !r.recovered; }).sort(function (a, b) { return b.risk - a.risk || (b.businessDays || 0) - (a.businessDays || 0); }).slice(0, 100);
    var body = arr.map(function (r) {
      var slaLabel = r.businessDays == null ? 'SLA desconhecido' : (r.outsideSla ? 'Fora SLA' : 'Dentro SLA');
      var slaClass = r.businessDays == null ? 'warn' : (r.outsideSla ? 'bad' : 'good');
      return '<tr><td><a class="deal-link" href="' + hubspotUrl(r.id) + '" target="_blank" rel="noopener">' + esc(r.name) + '</a></td><td>' + esc(r.bdr) + '</td><td>' + esc(r.ae) + '</td><td>' + esc(r.meetingIso) + '</td><td>' + esc(r.meetingFieldStatus) + '</td><td>' + esc(r.status) + '</td><td class="right">' + esc(r.businessDays == null ? '—' : r.businessDays) + '</td><td><span class="pill ' + slaClass + '">' + slaLabel + '</span></td><td class="right">' + fmtMoney(r.arr) + '</td><td class="right">' + fmtInt(r.risk) + '</td></tr>';
    }).join('');
    return '<div class="card span-12"><div class="card-title"><div><h2>Tabela operacional de recuperação</h2><div class="desc">No-shows confirmados priorizados por risco | limitado a 100 linhas</div></div>' + infoBtn('recoveryTable') + '</div><div class="table-wrap"><table><thead><tr><th>Deal</th><th>BDR</th><th>AE</th><th>Reunião</th><th>Campo</th><th>Status</th><th class="right">Dias úteis</th><th>SLA</th><th class="right">Pipeline</th><th class="right">Risco</th></tr></thead><tbody>' + (body || '<tr><td colspan="10" class="muted">Nenhum no-show aberto no filtro atual</td></tr>') + '</tbody></table></div></div>';
  }

  function renderFieldTable(rows) {
    var arr = rows.filter(function (r) { return r.fieldPendingPast; }).sort(function (a, b) { return (b.businessDays || 0) - (a.businessDays || 0); }).slice(0, 100);
    var body = arr.map(function (r) {
      return '<tr><td><a class="deal-link" href="' + hubspotUrl(r.id) + '" target="_blank" rel="noopener">' + esc(r.name) + '</a></td><td>' + esc(r.bdr) + '</td><td>' + esc(r.ae) + '</td><td>' + esc(r.meetingIso) + '</td><td class="right">' + esc(r.businessDays == null ? '—' : r.businessDays) + '</td><td>' + esc(r.lastActivity) + '</td><td>' + esc(r.stage) + '</td><td>' + esc(r.persona) + '<div class="muted">' + esc(r.personaSource) + '</div></td><td>' + esc(r.segment) + '<div class="muted">' + esc(r.segmentSource) + '</div></td></tr>';
    }).join('');
    return '<div class="card span-12"><div class="card-title"><div><h2>Reunião passou | campo sem preenchimento</h2><div class="desc">Fila de higiene de CRM: a data da reunião passou, mas a_reuniao_ocorreu_ ainda não está Sim ou Não</div></div>' + infoBtn('fieldTable') + '</div><div class="table-wrap"><table><thead><tr><th>Deal</th><th>BDR</th><th>AE</th><th>Reunião</th><th class="right">Dias úteis</th><th>Última atividade</th><th>Etapa</th><th>Persona</th><th>Indústria</th></tr></thead><tbody>' + (body || '<tr><td colspan="9" class="muted">Nenhuma reunião passada com campo pendente no filtro atual</td></tr>') + '</tbody></table></div></div>';
  }

  function renderLostTable(rows) {
    var arr = rows.filter(function (r) { return r.status === 'Perdido por no-show'; }).sort(function (a, b) { return (b.arr || 0) - (a.arr || 0); }).slice(0, 100);
    var body = arr.map(function (r) {
      return '<tr><td><a class="deal-link" href="' + hubspotUrl(r.id) + '" target="_blank" rel="noopener">' + esc(r.name) + '</a></td><td>' + esc(r.bdr) + '</td><td>' + esc(r.ae) + '</td><td>' + esc(r.meetingIso) + '</td><td>' + esc(r.origem) + '</td><td>' + esc(r.porte) + '</td><td>' + esc(r.lostReason) + '</td><td class="right">' + fmtMoney(r.arr) + '</td></tr>';
    }).join('');
    return '<div class="card span-12"><div class="card-title"><div><h2>Perdidos por no-show</h2><div class="desc">Deals perdidos com evidência textual de no-show no motivo ou descrição</div></div>' + infoBtn('lostTable') + '</div><div class="table-wrap"><table><thead><tr><th>Deal</th><th>BDR</th><th>AE</th><th>Reunião</th><th>Origem</th><th>Porte</th><th>Motivo</th><th class="right">Pipeline perdido</th></tr></thead><tbody>' + (body || '<tr><td colspan="8" class="muted">Nenhum perdido por no-show no filtro atual</td></tr>') + '</tbody></table></div></div>';
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
    
    // ARCO NARRATIVO: Big Idea → KPIs herói → Gráficos → Rankings → Ação
    var html = '';
    
    // 1. BIG IDEA (tese + ação recomendada)
    html += renderBigIdea(rows, m);
    
    // 2. KPIs HERÓI (4 cards de decisão)
    html += renderHeroKpis(m);
    
    // 3. HIGIENE DE CRM (card composto colapsável)
    html += renderHygieneCard(m);
    
    // 4. GRÁFICO DE TAXA (full-width, título como conclusão)
    html += '<div class="grid">' + renderRateTrend(rows, m) + '</div>';
    
    // 5. VOLUME SEMANAL + RESUMO (lado a lado)
    html += '<div class="grid">' + renderTrend(rows) + renderTrendSummary(rows, m) + '</div>';
    
    // 6. RANKINGS (2 colunas lado a lado, preenchendo a linha)
    html += '<div class="grid">' + renderRank('Ranking por volume de no-show', rows, 'rate') + renderRank('Ranking por fora do prazo', rows, 'outside') + '</div>';
    
    // 7. QUEBRAS POR DIMENSÃO (4 cards por linha)
    html += '<div class="grid">' + renderBreak('Quebra por origem', rows, 'origem') + renderBreak('Quebra por indústria', rows, 'segment') + renderBreak('Quebra por persona', rows, 'persona') + renderBreak('Quebra por porte | vidas', rows, 'porte') + '</div>';
    
    // 8. FILA DE RECUPERAÇÃO (ação principal)
    html += '<div class="grid">' + renderRecoveryTable(rows) + '</div>';
    
    // 9. DETALHE (campo pendente, perdidos - contexto)
    html += '<div class="grid">' + renderFieldTable(rows) + renderLostTable(rows) + '</div>';
    
    $('content').innerHTML = html;
    
    // Cache de dados para filtros de taxa
    rateFilterData = buildRateFilterData(rows);
    
    var helps = $('content').querySelectorAll('[data-help]');
    for (var i = 0; i < helps.length; i += 1) helps[i].onclick = function (ev) { ev.stopPropagation(); openHelp(this.getAttribute('data-help')); };
    var drills = $('content').querySelectorAll('[data-drill]');
    for (var d = 0; d < drills.length; d += 1) drills[d].onclick = function () { openDrill(this.getAttribute('data-drill')); };
    
    // Filtros de visualização do gráfico de taxa
    var rateFilterBtns = $('content').querySelectorAll('[data-rate-filter]');
    for (var rf = 0; rf < rateFilterBtns.length; rf += 1) rateFilterBtns[rf].onclick = function () {
      var filterKey = this.getAttribute('data-rate-filter');
      // Atualizar estado
      currentRateFilter = filterKey;
      // Atualizar botões ativos
      for (var j = 0; j < rateFilterBtns.length; j += 1) rateFilterBtns[j].classList.remove('active');
      this.classList.add('active');
      // Regenerar SVG usando state.filtered (global) em vez de rows (local)
      var svgResult = generateRateSvg(state.filtered, filterKey);
      var rateChart = $('rate-chart');
      var oldSvg = rateChart.querySelector('svg, .muted');
      if (oldSvg) oldSvg.outerHTML = svgResult.svg;
      else rateChart.innerHTML = svgResult.svg;
      $('rate-title').textContent = svgResult.trendText;
      // Renderizar legenda
      renderRateLegend(filterKey, state.filtered, svgResult);
    };
    
    var ranks = $('content').querySelectorAll('[data-rank-name]');
    for (var r = 0; r < ranks.length; r += 1) ranks[r].onclick = function () {
      var name = this.getAttribute('data-rank-name');
      var mode = this.getAttribute('data-rank-mode');
      var rows = state.filtered.filter(function (x) { return x.bdr === name && (mode === 'outside' ? x.outsideSla : x.noShow); });
      openDeals('BDR | ' + name, rows);
    };
    var breaks = $('content').querySelectorAll('[data-break-key]');
    for (var b = 0; b < breaks.length; b += 1) breaks[b].onclick = function () {
      var key = this.getAttribute('data-break-key');
      var name = this.getAttribute('data-break-name');
      openDeals(name, state.filtered.filter(function (x) { return x[key] === name; }));
    };
    showContent();
  }

  function positionTip(ev) {
    var tip = $('hover-tip');
    if (!tip || !tip.classList.contains('show')) return;
    var rect = tip.getBoundingClientRect();
    var x = ev.clientX + 14;
    var y = ev.clientY + 14;
    if (x + rect.width > window.innerWidth - 8) x = ev.clientX - rect.width - 10;
    if (y + rect.height > window.innerHeight - 8) y = ev.clientY - rect.height - 10;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }

  document.addEventListener('mouseover', function (ev) {
    var el = ev.target.closest('[data-hover-title],[data-hover-text]');
    if (!el) return;
    var tip = $('hover-tip');
    tip.querySelector('.ht-title').textContent = el.getAttribute('data-hover-title') || 'Detalhe';
    tip.querySelector('.ht-text').textContent = el.getAttribute('data-hover-text') || 'Clique para abrir o detalhe.';
    tip.classList.add('show');
    positionTip(ev);
  });

  document.addEventListener('mouseout', function (ev) {
    if (!ev.target.closest('[data-hover-title],[data-hover-text]')) return;
    var tip = $('hover-tip');
    if (tip) tip.classList.remove('show');
  });

  document.addEventListener('mousemove', positionTip);

  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape' && ev.keyCode !== 27) return;
    if ($('help-drawer') && $('help-drawer').classList.contains('open')) return closeHelp();
    if ($('modal-overlay') && $('modal-overlay').classList.contains('open')) return closeModal();
  });

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

  window.NoShowBDR = { load: load, toggleTheme: toggleTheme, openAllHelp: openAllHelp, closeHelp: closeHelp, closeModal: closeModal, config: CONFIG, vidasRange: vidasRange };
  document.addEventListener('DOMContentLoaded', load);
}());
