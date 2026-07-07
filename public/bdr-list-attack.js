(function () {
  'use strict';

  var state = { records: [], filtered: [], meta: {}, metrics: {}, filters: {} };
  var HELP = {
    overview: { title: 'Consumo da lista', formula: 'Empresas encontradas no HubSpot ÷ total de empresas da lista.', fields: 'Sheets: abas BDR ou Lista Clean | HubSpot: Companies por ID, domínio ou nome normalizado.' },
    attack: { title: 'Taxa de ataque', formula: 'Empresas com atividade comercial ÷ total de empresas da lista.', fields: 'Proxy de atividade: notes_last_updated, notes_last_contacted, hs_last_sales_activity_timestamp, calls, meetings ou deals associados.' },
    contacts: { title: 'Penetração de contatos', formula: 'Contatos associados ÷ empresas encontradas no HubSpot | mediana sobre empresas encontradas.', fields: 'HubSpot Company.num_associated_contacts. Contatos individuais não são enviados à UI.' },
    pipeline: { title: 'Pipeline da lista', formula: 'Soma de amount, arr_estimado, primeira_fatura × 12 ou premio_mensal × 12 dos deals associados.', fields: 'Associação Company | Deal via API server-side.' },
    bdr: { title: 'Ranking por BDR', formula: 'Agrupamento pelo BDR atribuído na lista, não pelo owner atual no HubSpot.', fields: 'Sheets: owner_bdr, assigned_bdr ou nome da aba do BDR.' },
    cadence: { title: 'Cadência de criação', formula: 'Empresas e contatos por semana de criação no HubSpot.', fields: 'Companies.createdate e num_associated_contacts. Contatos por data individual dependem de próxima iteração.' },
    funnel: { title: 'Funil de execução', formula: 'Lista | HubSpot | contatos | atividade | deal | pipeline ativo | ganho/perdido.', fields: 'Cada etapa é subconjunto da anterior quando possível; ganho/perdido vêm dos deals associados.' },
    quality: { title: 'Inconsistências', formula: 'Match médio/baixo, sem domínio, sem BDR, diferença BDR lista × owner e baixa visibilidade.', fields: 'Rules centralizadas no endpoint /api/bdr-list-attack.' },
    table: { title: 'Tabela operacional', formula: 'Ordenação padrão: alto risco | fora do HubSpot | sem contatos | sem atividade | maior pipeline.', fields: 'Registro normalizado por empresa da lista.' }
  };

  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null || v === '' ? '—' : v).replace(/[&<>\"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmtInt(n) { return Math.round(Number(n) || 0).toLocaleString('pt-BR'); }
  function fmtPct(n) { return ((Number(n) || 0) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'; }
  function fmtNum(n, d) { return (Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: d == null ? 1 : d }); }
  function fmtMoney(n) { return (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }); }
  function lower(v) { return String(v || '').toLowerCase(); }
  function riskRank(v) { return v === 'high' ? 3 : v === 'medium' ? 2 : v === 'low' ? 1 : 0; }
  function statusLabel(s) { return ({ not_in_hubspot: 'Fora do HubSpot', created_no_contacts: 'Criada sem contatos', created_with_contacts_no_activity: 'Contatos sem atividade', contacted_no_deal: 'Contato sem deal', deal_created: 'Deal criado', active_pipeline: 'Pipeline ativo', closed_lost: 'Perdida', closed_won: 'Ganha', unknown: 'Indefinido' })[s] || s || '—'; }
  function visibilityLabel(s) { return ({ no_visibility: 'Sem visibilidade', partial_visibility: 'Visibilidade parcial', good_visibility: 'Boa visibilidade', high_visibility: 'Alta visibilidade' })[s] || s || '—'; }
  function pill(text, kind) { return '<span class="pill ' + (kind || '') + '">' + esc(text) + '</span>'; }
  function info(key) { return '<button class="calc-btn" data-help="' + esc(key) + '" data-hover-title="' + esc((HELP[key] || {}).title || 'Memória') + '" data-hover-text="Clique para ver fórmula e fonte">i</button>'; }
  function showState(kind, title, msg) { $('state').classList.remove('hidden'); $('content').classList.add('hidden'); $('state').innerHTML = (kind === 'loading' ? '<div class="spinner"></div>' : '') + '<strong>' + esc(title) + '</strong>' + esc(msg || ''); }
  function showContent() { $('state').classList.add('hidden'); $('content').classList.remove('hidden'); }
  function uniq(key) { var m = {}; state.records.forEach(function (r) { m[r[key] || '—'] = true; }); return Object.keys(m).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); }); }
  function opt(values, selected) { var html = '<option value="">Todos</option>'; values.forEach(function (v) { html += '<option value="' + esc(v) + '"' + (selected === v ? ' selected' : '') + '>' + esc(v) + '</option>'; }); return html; }
  function groupBy(records, keyFn) { var m = {}; records.forEach(function (r) { var k = keyFn(r) || '—'; (m[k] || (m[k] = [])).push(r); }); return m; }
  function sum(records, fn) { return records.reduce(function (s, r) { return s + (Number(fn(r)) || 0); }, 0); }
  function mean(records, fn) { return records.length ? sum(records, fn) / records.length : 0; }
  function median(xs) { var a = xs.filter(function (x) { return isFinite(x); }).sort(function (a, b) { return a - b; }); if (!a.length) return 0; var m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
  function weekKey(iso) { if (!iso) return 'Sem data'; var d = new Date(String(iso).slice(0, 10) + 'T12:00:00'); if (isNaN(d.getTime())) return 'Sem data'; var x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); var day = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - day); var ys = new Date(Date.UTC(x.getUTCFullYear(), 0, 1)); var w = Math.ceil((((x - ys) / 86400000) + 1) / 7); return x.getUTCFullYear() + '-S' + String(w).padStart(2, '0'); }

  function calc(records) {
    var matched = records.filter(function (r) { return r.matchedInHubSpot; });
    var contacts = matched.map(function (r) { return Number(r.associatedContactsCount) || 0; });
    return {
      totalCompanies: records.length,
      matchedCompanies: matched.length,
      notInHubSpot: records.length - matched.length,
      hubspotPresenceRate: records.length ? matched.length / records.length : 0,
      createdAfterList: matched.filter(function (r) { return r.wasCreatedAfterListGeneration; }).length,
      associatedContacts: sum(records, function (r) { return r.associatedContactsCount; }),
      avgContactsPerMatchedCompany: matched.length ? contacts.reduce(function (a, b) { return a + b; }, 0) / matched.length : 0,
      medianContactsPerMatchedCompany: median(contacts),
      companiesWithCommercialActivity: records.filter(function (r) { return r.hasCommercialActivity; }).length,
      attackRate: records.length ? records.filter(function (r) { return r.hasCommercialActivity; }).length / records.length : 0,
      companiesWithDeal: records.filter(function (r) { return r.associatedDealsCount > 0; }).length,
      activePipelineCompanies: records.filter(function (r) { return r.activeDealsCount > 0; }).length,
      lostCompanies: records.filter(function (r) { return r.closedLostDealsCount > 0; }).length,
      wonCompanies: records.filter(function (r) { return r.closedWonDealsCount > 0; }).length,
      pipelineCreated: sum(records, function (r) { return r.pipelineCreated; }),
      pipelineActive: sum(records, function (r) { return r.pipelineActive; }),
      pipelineLost: sum(records, function (r) { return r.pipelineLost; }),
      pipelineWon: sum(records, function (r) { return r.pipelineWon; }),
      highRiskCompanies: records.filter(function (r) { return r.riskLevel === 'high'; }).length,
      weakMatches: records.filter(function (r) { return r.matchConfidence === 'medium' || r.matchConfidence === 'low'; }).length
    };
  }

  function renderFilters() {
    var f = state.filters;
    $('filters').innerHTML = [
      '<div class="filter"><label>BDR da lista</label><select id="f-bdr">' + opt(uniq('assignedBdrFromList'), f.bdr) + '</select></div>',
      '<div class="filter"><label>Owner HubSpot</label><select id="f-owner">' + opt(uniq('hubspotOwnerName'), f.owner) + '</select></div>',
      '<div class="filter"><label>Batch</label><select id="f-batch">' + opt(uniq('listBatch'), f.batch) + '</select></div>',
      '<div class="filter"><label>Prioridade</label><select id="f-priority">' + opt(uniq('priority'), f.priority) + '</select></div>',
      '<div class="filter"><label>Origem</label><select id="f-source">' + opt(uniq('sourceFromList'), f.source) + '</select></div>',
      '<div class="filter"><label>Segmento</label><select id="f-segment">' + opt(uniq('segmentFromList'), f.segment) + '</select></div>',
      '<div class="filter"><label>Porte | vidas</label><select id="f-size">' + opt(uniq('livesRangeFromList'), f.size) + '</select></div>',
      '<div class="filter"><label>Status de ataque</label><select id="f-status">' + opt(uniq('attackStatus').map(statusLabel), f.statusLabel) + '</select></div>',
      '<div class="filter"><label>Visibilidade</label><select id="f-vis">' + opt(uniq('visibilityStatus').map(visibilityLabel), f.visLabel) + '</select></div>',
      '<div class="filter"><label>Busca</label><input id="f-search" value="' + esc(f.search || '') + '" placeholder="Empresa, domínio, BDR"></div>',
      '<div class="filter" style="display:flex;gap:.5rem;align-items:end"><button class="btn primary" id="btn-apply">Aplicar</button><button class="btn" id="btn-clear">Limpar</button></div>'
    ].join('');
    $('btn-apply').onclick = applyFilters;
    $('btn-clear').onclick = function () { state.filters = {}; render(); };
  }

  function applyFilters() {
    state.filters = {
      bdr: $('f-bdr').value, owner: $('f-owner').value, batch: $('f-batch').value, priority: $('f-priority').value,
      source: $('f-source').value, segment: $('f-segment').value, size: $('f-size').value,
      statusLabel: $('f-status').value, visLabel: $('f-vis').value, search: $('f-search').value
    };
    render();
  }
  function filterRecords() {
    var f = state.filters;
    return state.records.filter(function (r) {
      if (f.bdr && r.assignedBdrFromList !== f.bdr) return false;
      if (f.owner && (r.hubspotOwnerName || '—') !== f.owner) return false;
      if (f.batch && (r.listBatch || '—') !== f.batch) return false;
      if (f.priority && (r.priority || '—') !== f.priority) return false;
      if (f.source && (r.sourceFromList || '—') !== f.source) return false;
      if (f.segment && (r.segmentFromList || '—') !== f.segment) return false;
      if (f.size && (r.livesRangeFromList || '—') !== f.size) return false;
      if (f.statusLabel && statusLabel(r.attackStatus) !== f.statusLabel) return false;
      if (f.visLabel && visibilityLabel(r.visibilityStatus) !== f.visLabel) return false;
      if (f.search) { var q = lower(f.search); var hay = lower([r.companyNameFromList, r.companyDomainFromList, r.hubspotCompanyName, r.assignedBdrFromList].join(' ')); if (hay.indexOf(q) < 0) return false; }
      return true;
    });
  }

  function kpi(key, label, value, sub, kind, records) { return '<div class="kpi clickable ' + (kind || '') + '" data-drill="' + esc(key) + '"><div class="label">' + esc(label) + info(key) + '</div><div class="value">' + value + '</div><div class="sub">' + esc(sub || '') + '</div></div>'; }
  function renderKpis(m, records) {
    return '<section class="kpis">' + [
      kpi('all', 'Empresas na lista', fmtInt(m.totalCompanies), 'Base planejada processada', 'teal'),
      kpi('matched', 'No HubSpot', fmtInt(m.matchedCompanies), fmtPct(m.hubspotPresenceRate) + ' de presença', 'good'),
      kpi('notInHubSpot', 'Fora do HubSpot', fmtInt(m.notInHubSpot), 'Não encontradas por ID, domínio ou nome', m.notInHubSpot ? 'bad' : 'good'),
      kpi('contactsKpi', 'Contatos associados', fmtInt(m.associatedContacts), 'Média ' + fmtNum(m.avgContactsPerMatchedCompany, 1) + ' | mediana ' + fmtNum(m.medianContactsPerMatchedCompany, 1), 'teal'),
      kpi('activityKpi', 'Com atividade', fmtInt(m.companiesWithCommercialActivity), fmtPct(m.attackRate) + ' de taxa de ataque', m.attackRate >= .5 ? 'good' : 'warn'),
      kpi('dealKpi', 'Com deal', fmtInt(m.companiesWithDeal), fmtInt(m.activePipelineCompanies) + ' em pipeline ativo', 'teal'),
      kpi('pipelineCreated', 'Pipeline criado', fmtMoney(m.pipelineCreated), 'Ativo ' + fmtMoney(m.pipelineActive), 'good'),
      kpi('pipelineLost', 'Pipeline perdido', fmtMoney(m.pipelineLost), fmtInt(m.lostCompanies) + ' empresas perdidas', m.pipelineLost ? 'bad' : 'good'),
      kpi('pipelineWon', 'Pipeline ganho', fmtMoney(m.pipelineWon), fmtInt(m.wonCompanies) + ' empresas ganhas', 'good'),
      kpi('highRisk', 'Alto risco', fmtInt(m.highRiskCompanies), 'Sem criação, sem contato, sem atividade ou stale', m.highRiskCompanies ? 'bad' : 'good'),
      kpi('weakMatches', 'Match médio/fraco', fmtInt(m.weakMatches), 'Não inflar leitura sem checagem', m.weakMatches ? 'warn' : 'good'),
      kpi('createdAfter', 'Criadas após lista', fmtInt(m.createdAfterList), 'Company.createdate maior que data de distribuição', 'teal')
    ].join('') + '</section>';
  }

  function renderProgress(m) { return '<div class="card span-12"><div class="card-title"><div><h2>Visão geral da lista</h2><div class="desc">Quanto da lista já aparece no CRM e quanto ainda precisa de visibilidade</div></div>' + info('overview') + '</div><div class="progress"><div class="progress-fill" style="width:' + Math.round(m.hubspotPresenceRate * 100) + '%"></div></div><div class="mini-meta"><span>' + fmtInt(m.matchedCompanies) + ' encontradas no HubSpot</span><span>' + fmtInt(m.notInHubSpot) + ' ainda fora ou sem match confiável</span></div></div>'; }
  function rankByBdr(records) {
    var groups = groupBy(records, function (r) { return r.assignedBdrFromList || 'Sem BDR'; });
    return Object.keys(groups).map(function (bdr) { var arr = groups[bdr]; var matched = arr.filter(function (r) { return r.matchedInHubSpot; }); return { bdr: bdr, rows: arr, total: arr.length, matched: matched.length, contacts: sum(arr, function (r) { return r.associatedContactsCount; }), activity: arr.filter(function (r) { return r.hasCommercialActivity; }).length, deal: arr.filter(function (r) { return r.associatedDealsCount > 0; }).length, pipe: sum(arr, function (r) { return r.pipelineCreated; }), noVisibility: arr.filter(function (r) { return r.visibilityStatus === 'no_visibility'; }).length, penetration: mean(matched, function (r) { return r.associatedContactsCount; }) }; }).sort(function (a, b) { return b.activity - a.activity || b.matched - a.matched || b.contacts - a.contacts; });
  }
  function renderRankings(records) {
    var ranks = rankByBdr(records);
    var top = function (metric, fmt, label) { return '<div class="card span-4"><div class="card-title"><div><h2>' + esc(label) + '</h2><div class="desc">Clique para abrir empresas do BDR</div></div>' + info('bdr') + '</div>' + ranks.slice(0, 8).sort(function (a, b) { return b[metric] - a[metric]; }).map(function (r) { return '<div class="rank-row clickable-row" data-bdr="' + esc(r.bdr) + '"><div><div class="rank-name">' + esc(r.bdr) + '</div><div class="rank-meta">' + fmtInt(r.total) + ' atribuídas | ' + fmtInt(r.noVisibility) + ' sem visibilidade</div></div><div class="right"><b>' + fmt(r[metric]) + '</b></div><div class="right">' + fmtPct(r.total ? r.activity / r.total : 0) + '</div></div>'; }).join('') + '</div>'; };
    return top('matched', fmtInt, 'BDRs por empresas no HubSpot') + top('contacts', fmtInt, 'BDRs por contatos associados') + top('pipe', fmtMoney, 'BDRs por pipeline criado');
  }
  function renderBdrTable(records) {
    var rows = rankByBdr(records).map(function (r) { return '<tr class="clickable-row" data-bdr="' + esc(r.bdr) + '"><td><b>' + esc(r.bdr) + '</b></td><td class="right">' + fmtInt(r.total) + '</td><td class="right">' + fmtInt(r.matched) + '</td><td class="right">' + fmtPct(r.total ? r.matched / r.total : 0) + '</td><td class="right">' + fmtInt(r.contacts) + '</td><td class="right">' + fmtNum(r.penetration, 1) + '</td><td class="right">' + fmtInt(r.activity) + '</td><td class="right">' + fmtPct(r.total ? r.activity / r.total : 0) + '</td><td class="right">' + fmtInt(r.deal) + '</td><td class="right">' + fmtMoney(r.pipe) + '</td><td class="right">' + fmtInt(r.noVisibility) + '</td></tr>'; }).join('');
    return '<div class="card span-12"><div class="card-title"><div><h2>Execução por BDR</h2><div class="desc">Tabela principal por BDR da lista</div></div>' + info('bdr') + '</div><div class="table-wrap"><table><thead><tr><th>BDR</th><th>Empresas</th><th>No HubSpot</th><th>Presença</th><th>Contatos</th><th>Média contatos</th><th>Com atividade</th><th>Taxa ataque</th><th>Com deal</th><th>Pipeline</th><th>Sem visibilidade</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }
  function renderTrend(records) {
    var groups = groupBy(records.filter(function (r) { return r.companyCreatedAt; }), function (r) { return weekKey(r.companyCreatedAt); });
    var keys = Object.keys(groups).sort().slice(-12); var max = Math.max(1, Math.max.apply(null, keys.map(function (k) { return groups[k].length; })));
    var bars = keys.map(function (k) { var arr = groups[k]; return '<div class="bar-wrap clickable" data-week="' + esc(k) + '"><div class="bar" style="height:' + Math.max(4, Math.round(arr.length / max * 190)) + 'px"><small>' + fmtInt(arr.length) + '</small></div><div class="bar-label">' + esc(k.replace(/^\d{4}-/, '')) + '</div></div>'; }).join('');
    var cg = groupBy(records.filter(function (r) { return r.matchedInHubSpot; }), function (r) { return r.associatedContactsCount > 0 ? 'Com contatos' : 'Sem contatos'; });
    return '<div class="card span-7"><div class="card-title"><div><h2>Empresas criadas por semana</h2><div class="desc">Company.createdate das empresas da lista encontradas no HubSpot</div></div>' + info('cadence') + '</div><div class="bars">' + bars + '</div></div><div class="card span-5"><div class="card-title"><div><h2>Penetração de contatos</h2><div class="desc">Distribuição por quantidade de contatos associados</div></div>' + info('contacts') + '</div>' + renderBreakdown(records, function (r) { var c = Number(r.associatedContactsCount) || 0; if (c === 0) return '0 contatos'; if (c === 1) return '1 contato'; if (c <= 3) return '2 a 3 contatos'; if (c <= 5) return '4 a 5 contatos'; return '6+ contatos'; }, 'contacts') + '</div>';
  }
  function renderFunnel(records) {
    var steps = [
      ['Lista', records], ['HubSpot', records.filter(function (r) { return r.matchedInHubSpot; })], ['Contatos', records.filter(function (r) { return r.associatedContactsCount > 0; })], ['Atividade', records.filter(function (r) { return r.hasCommercialActivity; })], ['Deal', records.filter(function (r) { return r.associatedDealsCount > 0; })], ['Pipeline ativo', records.filter(function (r) { return r.activeDealsCount > 0; })], ['Won/Lost', records.filter(function (r) { return r.closedWonDealsCount > 0 || r.closedLostDealsCount > 0; })]
    ];
    return '<div class="card span-12"><div class="card-title"><div><h2>Funil lista | HubSpot | contatos | atividade | deal</h2><div class="desc">Vazamento principal da lista até pipeline</div></div>' + info('funnel') + '</div><div class="funnel">' + steps.map(function (s) { return '<div class="funnel-step clickable" data-funnel="' + esc(s[0]) + '"><b>' + fmtInt(s[1].length) + '</b><span>' + esc(s[0]) + '</span></div>'; }).join('') + '</div></div>';
  }
  function renderBreakdown(records, fn, key) {
    var g = groupBy(records, fn); var rows = Object.keys(g).map(function (k) { return { k: k, n: g[k].length, rows: g[k] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 10); var max = Math.max(1, rows[0] ? rows[0].n : 1);
    return '<div class="break-list">' + rows.map(function (r) { return '<div class="break-row clickable-row" data-break="' + esc(key + '|' + r.k) + '"><div class="break-name">' + esc(r.k) + '</div><div class="break-val">' + fmtInt(r.n) + '</div><div class="right">' + fmtPct(records.length ? r.n / records.length : 0) + '</div><div class="break-track"><div class="break-fill" style="width:' + Math.round(r.n / max * 100) + '%"></div></div></div>'; }).join('') + '</div>';
  }
  function renderBreakdowns(records) { return '<div class="card span-4"><div class="card-title"><div><h2>Por segmento</h2><div class="desc">Segmento ou status da lista</div></div>' + info('table') + '</div>' + renderBreakdown(records, function (r) { return r.segmentFromList || 'Sem segmento'; }, 'segment') + '</div><div class="card span-4"><div class="card-title"><div><h2>Por porte</h2><div class="desc">Faixa de vidas ou colaboradores</div></div>' + info('contacts') + '</div>' + renderBreakdown(records, function (r) { return r.livesRangeFromList || 'Sem dado'; }, 'size') + '</div><div class="card span-4"><div class="card-title"><div><h2>Por origem</h2><div class="desc">Fonte da lista no Sheet</div></div>' + info('overview') + '</div>' + renderBreakdown(records, function (r) { return r.sourceFromList || 'Sem origem'; }, 'source') + '</div>'; }

  function opRows(records) { return records.slice().sort(function (a, b) { return riskRank(b.riskLevel) - riskRank(a.riskLevel) || (a.matchedInHubSpot ? 1 : 0) - (b.matchedInHubSpot ? 1 : 0) || (a.associatedContactsCount || 0) - (b.associatedContactsCount || 0) || (b.pipelineCreated || 0) - (a.pipelineCreated || 0); }).slice(0, 350).map(function (r) { var risk = r.riskLevel === 'high' ? 'bad' : r.riskLevel === 'medium' ? 'warn' : 'good'; var vis = r.visibilityStatus === 'no_visibility' ? 'bad' : r.visibilityStatus === 'partial_visibility' ? 'warn' : 'good'; return '<tr><td><a class="deal-link" href="' + esc(r.hubspotCompanyUrl || '#') + '" target="_blank" rel="noopener">' + esc(r.companyNameFromList) + '</a><div class="muted">' + esc(r.companyDomainFromList || r.hubspotCompanyDomain || '') + '</div></td><td>' + esc(r.assignedBdrFromList) + '</td><td>' + esc(r.hubspotOwnerName) + '</td><td>' + pill(r.matchedInHubSpot ? 'Encontrada' : 'Não encontrada', r.matchedInHubSpot ? 'good' : 'bad') + '<br>' + pill(r.matchConfidence, r.matchConfidence === 'high' ? 'good' : r.matchConfidence === 'none' ? 'bad' : 'warn') + '</td><td>' + pill(statusLabel(r.attackStatus), r.attackStatus === 'active_pipeline' || r.attackStatus === 'closed_won' ? 'good' : r.attackStatus === 'not_in_hubspot' ? 'bad' : 'warn') + '</td><td>' + pill(visibilityLabel(r.visibilityStatus), vis) + '</td><td>' + esc(r.companyCreatedAt) + '</td><td class="right">' + fmtInt(r.associatedContactsCount) + '</td><td>' + esc(r.lastActivityDate) + '<div class="muted">' + (r.daysSinceLastActivity == null ? '' : fmtInt(r.daysSinceLastActivity) + ' dias') + '</div></td><td class="right">' + fmtInt(r.associatedDealsCount) + '</td><td>' + esc(r.currentDealStage) + '</td><td>' + esc(r.lostReason) + '</td><td class="right">' + fmtMoney(r.pipelineCreated) + '</td><td>' + pill(r.riskLevel, risk) + '</td><td>' + esc(r.suggestedAction) + '</td></tr>'; }).join(''); }
  function renderTables(records) {
    var weak = records.filter(function (r) { return r.matchConfidence !== 'high' || !r.companyDomainFromList || !r.assignedBdrFromList || (r.hubspotOwnerName && r.assignedBdrFromList && lower(r.hubspotOwnerName).indexOf(lower(r.assignedBdrFromList).split(' ')[0]) < 0); }).slice(0, 250);
    var inc = weak.map(function (r) { return '<tr><td>' + esc(r.companyNameFromList) + '</td><td>' + esc(r.hubspotCompanyName) + '</td><td>' + pill(r.matchConfidence, r.matchConfidence === 'high' ? 'good' : r.matchConfidence === 'none' ? 'bad' : 'warn') + '</td><td>' + esc(r.matchMethod) + '</td><td>' + esc(r.assignedBdrFromList) + '</td><td>' + esc(r.hubspotOwnerName) + '</td><td>' + esc(r.companyDomainFromList || r.hubspotCompanyDomain) + '</td><td>' + esc(problemFor(r)) + '</td><td>' + esc(actionForIssue(r)) + '</td></tr>'; }).join('');
    return '<div class="card span-12"><div class="card-title"><div><h2>Tabela operacional por empresa</h2><div class="desc">Granularidade principal | ordenada por risco e ação sugerida</div></div>' + info('table') + '</div><div class="table-wrap"><table><thead><tr><th>Empresa</th><th>BDR atribuído</th><th>Owner HS</th><th>Match</th><th>Status ataque</th><th>Visibilidade</th><th>Criada HS</th><th>Contatos</th><th>Última atividade</th><th>Deals</th><th>Fase atual</th><th>Motivo perda</th><th>Pipeline</th><th>Risco</th><th>Ação sugerida</th></tr></thead><tbody>' + opRows(records) + '</tbody></table></div></div><div class="card span-12"><div class="card-title"><div><h2>Inconsistências e qualidade de dados</h2><div class="desc">Match fraco, sem domínio, sem BDR ou divergência entre lista e HubSpot</div></div>' + info('quality') + '</div><div class="table-wrap"><table><thead><tr><th>Empresa na lista</th><th>Possível empresa HS</th><th>Confiança</th><th>Método</th><th>BDR lista</th><th>Owner HS</th><th>Domínio</th><th>Problema</th><th>Ação sugerida</th></tr></thead><tbody>' + inc + '</tbody></table></div></div>';
  }
  function problemFor(r) { if (!r.matchedInHubSpot) return 'Empresa não encontrada no HubSpot'; if (!r.companyDomainFromList) return 'Sem domínio na lista'; if (!r.assignedBdrFromList) return 'Sem BDR atribuído'; if (r.matchConfidence !== 'high') return 'Match requer conferência'; if (r.hubspotOwnerName && lower(r.hubspotOwnerName).indexOf(lower(r.assignedBdrFromList).split(' ')[0]) < 0) return 'BDR lista diferente do owner HubSpot'; return 'Revisar visibilidade'; }
  function actionForIssue(r) { if (!r.matchedInHubSpot) return 'Criar ou justificar descarte'; if (r.matchConfidence !== 'high') return 'Confirmar match manualmente'; if (!r.companyDomainFromList) return 'Completar domínio'; return 'Ajustar owner ou documentar diferença'; }

  function render() {
    renderFilters();
    state.filtered = filterRecords();
    var rec = state.filtered;
    if (!rec.length) { showState('empty', 'Nenhuma empresa encontrada para os filtros selecionados.', 'Ajuste os filtros ou limpe a busca.'); return; }
    var m = calc(rec);
    $('content').innerHTML = renderKpis(m, rec) + '<section class="grid">' + renderProgress(m) + renderRankings(rec) + renderBdrTable(rec) + renderTrend(rec) + renderFunnel(rec) + renderBreakdowns(rec) + renderTables(rec) + '</section><section class="note"><b>Atualização:</b> ' + esc(state.meta.timestamp) + ' | fonte: ' + esc(state.meta.source) + ' | empresas processadas: ' + fmtInt(state.meta.processedCompanies) + ' | matches confiáveis: ' + fmtInt(state.meta.confidentMatches) + ' | cache/TTL: 30 minutos.</section>';
    bindInteractions(); showContent();
  }

  function drillForKey(key) {
    var rec = state.filtered;
    if (key === 'all') return rec;
    if (key === 'matched') return rec.filter(function (r) { return r.matchedInHubSpot; });
    if (key === 'notInHubSpot') return rec.filter(function (r) { return !r.matchedInHubSpot; });
    if (key === 'contactsKpi') return rec.filter(function (r) { return r.associatedContactsCount > 0; });
    if (key === 'activityKpi') return rec.filter(function (r) { return r.hasCommercialActivity; });
    if (key === 'dealKpi') return rec.filter(function (r) { return r.associatedDealsCount > 0; });
    if (key === 'pipelineCreated') return rec.filter(function (r) { return r.pipelineCreated > 0; });
    if (key === 'pipelineLost') return rec.filter(function (r) { return r.pipelineLost > 0; });
    if (key === 'pipelineWon') return rec.filter(function (r) { return r.pipelineWon > 0; });
    if (key === 'highRisk') return rec.filter(function (r) { return r.riskLevel === 'high'; });
    if (key === 'weakMatches') return rec.filter(function (r) { return r.matchConfidence === 'medium' || r.matchConfidence === 'low'; });
    if (key === 'createdAfter') return rec.filter(function (r) { return r.wasCreatedAfterListGeneration; });
    if (key === 'overview') return rec;
    if (key === 'contacts') return rec.filter(function (r) { return r.associatedContactsCount > 0; });
    if (key === 'attack') return rec.filter(function (r) { return r.hasCommercialActivity; });
    if (key === 'pipeline') return rec.filter(function (r) { return r.pipelineCreated > 0; });
    if (key === 'quality') return rec.filter(function (r) { return r.matchConfidence !== 'high' || r.visibilityStatus === 'no_visibility'; });
    if (key === 'table') return rec.filter(function (r) { return r.riskLevel === 'high'; });
    return rec;
  }
  function openDrill(title, rows) { rows = rows || []; var k = calc(rows); var body = '<div class="modal-kpis"><div class="modal-kpi"><b>' + fmtInt(rows.length) + '</b><span>Empresas</span></div><div class="modal-kpi"><b>' + fmtInt(k.matchedCompanies) + '</b><span>No HubSpot</span></div><div class="modal-kpi"><b>' + fmtInt(k.companiesWithCommercialActivity) + '</b><span>Com atividade</span></div><div class="modal-kpi"><b>' + fmtMoney(k.pipelineCreated) + '</b><span>Pipeline</span></div></div><div class="table-wrap"><table><thead><tr><th>Empresa</th><th>BDR</th><th>Match</th><th>Status</th><th>Visibilidade</th><th>Contatos</th><th>Deals</th><th>Pipeline</th><th>Ação</th></tr></thead><tbody>' + rows.slice(0, 250).map(function (r) { return '<tr><td>' + esc(r.companyNameFromList) + '</td><td>' + esc(r.assignedBdrFromList) + '</td><td>' + esc(r.matchConfidence) + '</td><td>' + esc(statusLabel(r.attackStatus)) + '</td><td>' + esc(visibilityLabel(r.visibilityStatus)) + '</td><td class="right">' + fmtInt(r.associatedContactsCount) + '</td><td class="right">' + fmtInt(r.associatedDealsCount) + '</td><td class="right">' + fmtMoney(r.pipelineCreated) + '</td><td>' + esc(r.suggestedAction) + '</td></tr>'; }).join('') + '</tbody></table></div>'; $('modal-title').textContent = title; $('modal-body').innerHTML = body; $('modal-overlay').classList.add('open'); }
  function bindInteractions() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-help]'), function (el) { el.onclick = function (ev) { ev.stopPropagation(); openHelp(el.getAttribute('data-help')); }; });
    Array.prototype.forEach.call(document.querySelectorAll('.kpi[data-drill]'), function (el) { el.onclick = function () { var key = el.getAttribute('data-drill'); openDrill((HELP[key] || {}).title || 'Detalhe', drillForKey(key)); }; });
    Array.prototype.forEach.call(document.querySelectorAll('[data-bdr]'), function (el) { el.onclick = function () { var b = el.getAttribute('data-bdr'); openDrill('BDR | ' + b, state.filtered.filter(function (r) { return r.assignedBdrFromList === b; })); }; });
    Array.prototype.forEach.call(document.querySelectorAll('[data-week]'), function (el) { el.onclick = function () { var w = el.getAttribute('data-week'); openDrill('Semana | ' + w, state.filtered.filter(function (r) { return weekKey(r.companyCreatedAt) === w; })); }; });
    Array.prototype.forEach.call(document.querySelectorAll('[data-funnel]'), function (el) { el.onclick = function () { var f = el.getAttribute('data-funnel'); var map = { 'Lista': state.filtered, 'HubSpot': state.filtered.filter(function (r) { return r.matchedInHubSpot; }), 'Contatos': state.filtered.filter(function (r) { return r.associatedContactsCount > 0; }), 'Atividade': state.filtered.filter(function (r) { return r.hasCommercialActivity; }), 'Deal': state.filtered.filter(function (r) { return r.associatedDealsCount > 0; }), 'Pipeline ativo': state.filtered.filter(function (r) { return r.activeDealsCount > 0; }), 'Won/Lost': state.filtered.filter(function (r) { return r.closedWonDealsCount > 0 || r.closedLostDealsCount > 0; }) }; openDrill('Funil | ' + f, map[f] || []); }; });
    Array.prototype.forEach.call(document.querySelectorAll('[data-break]'), function (el) { el.onclick = function () { var parts = el.getAttribute('data-break').split('|'); var key = parts[0], val = parts.slice(1).join('|'); var fn = function (r) { if (key === 'segment') return r.segmentFromList || 'Sem segmento'; if (key === 'size') return r.livesRangeFromList || 'Sem dado'; if (key === 'source') return r.sourceFromList || 'Sem origem'; if (key === 'contacts') { var c = Number(r.associatedContactsCount) || 0; if (c === 0) return '0 contatos'; if (c === 1) return '1 contato'; if (c <= 3) return '2 a 3 contatos'; if (c <= 5) return '4 a 5 contatos'; return '6+ contatos'; } return '—'; }; openDrill(key + ' | ' + val, state.filtered.filter(function (r) { return fn(r) === val; })); }; });
    bindHover();
  }
  function bindHover() { var tip = $('hover-tip'); Array.prototype.forEach.call(document.querySelectorAll('[data-hover-title],.kpi.clickable,.rank-row.clickable-row,.break-row.clickable-row,.funnel-step.clickable'), function (el) { el.onmousemove = function (ev) { var title = el.getAttribute('data-hover-title') || 'Clique para detalhar'; var text = el.getAttribute('data-hover-text') || 'Abre a memória de cálculo ou o recorte operacional desta métrica.'; tip.querySelector('.ht-title').textContent = title; tip.querySelector('.ht-text').textContent = text; tip.style.left = Math.min(ev.clientX + 14, window.innerWidth - 380) + 'px'; tip.style.top = Math.min(ev.clientY + 14, window.innerHeight - 90) + 'px'; tip.classList.add('show'); }; el.onmouseleave = function () { tip.classList.remove('show'); }; }); }
  function openHelp(key) { var h = HELP[key] || HELP.overview; $('help-title').textContent = h.title; $('help-body').innerHTML = '<div class="help-block"><b>Fórmula</b><code>' + esc(h.formula || '') + '</code></div><div class="help-block"><b>Fonte e campos</b><p>' + esc(h.fields || '') + '</p></div>'; $('help-backdrop').classList.add('open'); $('help-drawer').classList.add('open'); }
  function openAllHelp() { $('help-title').textContent = 'Memória de cálculo | Ataque à Lista'; $('help-body').innerHTML = Object.keys(HELP).map(function (k) { var h = HELP[k]; return '<div class="help-block"><b>' + esc(h.title) + '</b><code>' + esc(h.formula) + '</code><p>' + esc(h.fields) + '</p></div>'; }).join(''); $('help-backdrop').classList.add('open'); $('help-drawer').classList.add('open'); }
  function closeHelp() { $('help-backdrop').classList.remove('open'); $('help-drawer').classList.remove('open'); }
  function closeModal() { $('modal-overlay').classList.remove('open'); }
  function toggleTheme() { var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'; document.documentElement.setAttribute('data-theme', next); try { localStorage.setItem('axenya_theme', next); } catch (e) {} }
  function load(force) { showState('loading', 'Carregando dados', 'Buscando /api/bdr-list-attack'); var url = '/api/bdr-list-attack' + (force ? '?refresh=true' : ''); fetch(url, { credentials: 'include' }).then(function (res) { if (res.status === 401) { try { localStorage.setItem('axenya_login_next', '/novo-bdr/list-attack'); } catch (e) {} location.href = '/?next=/novo-bdr/list-attack'; return null; } if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); }).then(function (data) { if (!data) return; if (!data.success) throw new Error(data.error || 'Erro de integração'); state.records = data.records || []; state.meta = data.meta || {}; state.metrics = data.metrics || {}; state.filters = state.filters || {}; if (!state.records.length) { showState('empty', 'Sheet sem dados', 'Nenhuma empresa encontrada na lista configurada.'); return; } render(); }).catch(function (err) { showState('error', 'Não foi possível carregar os dados da lista ou do HubSpot.', err.message || 'Verifique as integrações e tente novamente.'); }); }

  window.ListAttack = { load: load, toggleTheme: toggleTheme, openAllHelp: openAllHelp, closeHelp: closeHelp, closeModal: closeModal };
  window.addEventListener('DOMContentLoaded', function () { load(false); });
})();
