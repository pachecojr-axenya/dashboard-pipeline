'use strict';
/**
 * growth-performance.js — /growth/performance
 *
 * Consome GET /api/growth-performance?from&to. A granularidade que chega é DIA;
 * dia, semana e mês são recortes feitos aqui, para o mesmo dado servir aos três
 * cortes sem ida extra à API.
 *
 * Padrão de UX obrigatório do dashboard (ver skill pipeline-dashboard-ops):
 * hover em tudo, `i` abre memória de cálculo, KPI/barra/linha/célula abre
 * drilldown com os leads que compõem o número, separador de texto sempre `|`.
 */
var GrowthPerf = (function () {
  var state = { from: null, to: null, gran: 'dia', data: null, preset: 'mes' };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return (s == null ? '' : String(s))
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── formatação ---------------------------------------------------------
  function brl(v) {
    if (v == null || isNaN(v)) return '—';
    return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function brl0(v) {
    if (v == null || isNaN(v)) return '—';
    return 'R$ ' + Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  }
  function num(v) {
    if (v == null || isNaN(v)) return '—';
    return Number(v).toLocaleString('pt-BR');
  }
  function pct(v, d) {
    if (v == null || isNaN(v)) return '—';
    return (Number(v) * 100).toFixed(d == null ? 1 : d).replace('.', ',') + '%';
  }
  function ptDate(iso) {
    if (!iso) return '—';
    var p = String(iso).slice(0, 10).split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }
  function shortDate(iso) {
    var p = String(iso).slice(0, 10).split('-');
    return p[2] + '/' + p[1];
  }

  // ── datas / períodos ---------------------------------------------------
  function todayBrt() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  }
  function addDays(iso, n) {
    var d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function monthRange(offset) {
    var t = todayBrt().split('-');
    var y = parseInt(t[0], 10), m = parseInt(t[1], 10) + (offset || 0);
    while (m < 1) { m += 12; y -= 1; }
    while (m > 12) { m -= 12; y += 1; }
    var mm = (m < 10 ? '0' : '') + m;
    var last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    var to = y + '-' + mm + '-' + (last < 10 ? '0' : '') + last;
    var hoje = todayBrt();
    return { from: y + '-' + mm + '-01', to: to > hoje ? hoje : to };
  }
  var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function monthLabel(ym) {
    var p = ym.split('-');
    return MESES[parseInt(p[1], 10) - 1] + '/' + p[0].slice(2);
  }
  /** Segunda-feira da semana ISO da data. */
  function weekStart(iso) {
    var d = new Date(iso + 'T12:00:00Z');
    var dow = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - ((dow + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  function bucketOf(iso, gran) {
    if (gran === 'mes') return String(iso).slice(0, 7);
    if (gran === 'semana') return weekStart(iso);
    return String(iso).slice(0, 10);
  }
  function bucketLabel(key, gran) {
    if (gran === 'mes') return monthLabel(key);
    if (gran === 'semana') return 'sem ' + shortDate(key);
    return shortDate(key);
  }

  // ── memória de cálculo -------------------------------------------------
  var CALC_HELP = {
    spendTotal: ['Spend total', 'Soma do gasto de todas as campanhas de Meta Ads e LinkedIn Ads no período, puxada ao vivo das APIs das plataformas.',
      'Meta: Graph API /insights level=campaign time_increment=1 campo spend. LinkedIn: /rest/adAnalytics pivot=CAMPAIGN timeGranularity=DAILY campo costInLocalCurrency. Soma dia por dia, sem arredondamento intermediário. Campanha pausada ainda acumula spend residual e por isso entra na conta.'],
    leadsPagos: ['Leads pagos', 'Contatos criados no período cujo utm_medium indica mídia paga (paid_social, cpc, ppc, paid, ads, paid_search) e cujo utm_source é um canal com spend conectado.',
      'Coorte pela DATA DE CRIAÇÃO do contato em America/Sao_Paulo, não pela data do toque. Lead orgânico do mesmo canal (utm_medium = social) NÃO entra aqui — ele aparece separado como orgânico.'],
    cplPago: ['CPL pago', 'Spend total dividido pelos leads pagos.',
      'CPL = spend total ÷ leads pagos. Usa só lead pago de propósito: dividir o spend por todos os leads do canal (incluindo os orgânicos) subestima o CPL. Quando a maioria dos leads do canal não está marcada como paga, o alerta de higiene avisa e o CPL pago fica artificialmente alto.'],
    custoEmpresa: ['Custo por empresa', 'Spend total dividido pelo número de empresas distintas por trás dos leads pagos.',
      'Empresa = company associada ao contato no HubSpot (associatedcompanyid), contada uma única vez mesmo com vários leads da mesma empresa. Lead sem company associada não entra no denominador, então este número é mais conservador que o CPL.'],
    volume: ['Impressões, clicks e derivados', 'Métricas de entrega somadas das duas plataformas.',
      'CTR = clicks ÷ impressões. CPM = (spend ÷ impressões) × 1000. CPC = spend ÷ clicks. São métricas da plataforma, independentes do HubSpot.'],
    canais: ['Por canal', 'Spend, leads e eficiência de cada canal de mídia paga.',
      'Leads do canal = todos os contatos com aquele utm_source. Pagos = subconjunto com utm_medium pago. CPL pago = spend ÷ pagos. CPL do canal = spend ÷ leads do canal (referência para quando a marcação de medium está furada). Canal sem spend conectado mostra "—" e nunca R$ 0,00, porque zero leria como eficiência infinita.'],
    serie: ['Série temporal', 'Spend empilhado por canal, com a linha de leads pagos por cima.',
      'Barras = spend por dia, semana ou mês, empilhado por canal. Linha amarela = leads pagos no mesmo bucket, em escala própria à direita. O bucket é sempre o dia agregado; semana começa na segunda-feira. Dia sem spend e sem lead não aparece. Clique na barra abre os leads do bucket.'],
    iniciativas: ['Iniciativa', 'O join entre a campanha da plataforma e o utm_campaign do HubSpot.',
      'A campanha de anúncio se chama "META | P0 | MoFu | Pesquisa RH CONARH 26 | 2026-07" e o site marca "pesquisa_rh_conarh26_2026_07" — não existe chave comum. As duas pontas passam pelo mesmo classificador de iniciativa (webinar tal, pesquisa tal, observatório) e o join é por canal + iniciativa. Pareamento por semelhança de nome foi testado e descartado: duplicava spend e gerava match falso por token de data. A correção durável é batizar a campanha com o mesmo slug do utm_campaign.'],
    higiene: ['Higiene de marcação', 'Onde o número não fecha e por quê.',
      'Spend sem nenhum lead atribuído = a URL do anúncio provavelmente não carrega UTM. Maioria dos leads do canal sem marcação de pago = o utm_medium veio como social em vez de paid_social, o que joga o lead fora do CPL pago e infla o CPL. Lead sem spend correspondente = não há campanha classificada nessa iniciativa no período.'],
    cortes: ['Cortes do lead pago', 'Quem são os leads que o spend comprou.',
      'Calculado só sobre lead PAGO — é o universo que o spend paga. Cargo vem de jobtitle do contato (texto livre) classificado em senioridade e área. Porte vem do campo porte da company; sem ele, cai para faixa de nº de funcionários ou vidas, marcada como (proxy). Setor vem de industry da company e tem cobertura baixa neste portal.'],
    campanhasAnuncio: ['Campanhas de anúncio', 'Verdade da plataforma, sem HubSpot no meio.',
      'Spend, impressões, clicks e CPC por campanha, direto de Meta e LinkedIn. Serve para conferir o que rodou no período independente de atribuição. A coluna iniciativa mostra em qual bucket a campanha caiu no join.'],
    cobertura: ['Cobertura dos dados', 'Quanto do período é de fato atribuível.',
      'Leads do período = todos os contatos criados na janela, incluindo outbound e importação de lista. Com utm_source = os que têm atribuição de canal. A fatia sem UTM é grande e isso é esperado: prospecção de BDR e importação nascem sem UTM. O número que importa é o de leads pagos, não a proporção.'],
    leadsTable: ['Leads do período', 'A lista que compõe todos os números da página.',
      'Um lead por linha, com canal, tipo, campanha, cargo, empresa e porte. Clique no nome abre o contato no HubSpot. A tabela mostra apenas leads COM utm_source; leads sem UTM não têm canal e não entram em nenhum corte de mídia paga.']
  };

  function infoBtn(key) {
    var h = CALC_HELP[key];
    return '<button type="button" class="calc-btn" data-help="' + esc(key) + '" data-hover-title="'
      + esc(h ? h[0] : 'Memória de cálculo') + '" data-hover-text="' + esc(h ? h[1] : 'Clique para abrir a ficha completa')
      + '" aria-label="Ver memória de cálculo">i</button>';
  }

  function openHelp(key) {
    var h = CALC_HELP[key];
    if (!h) return;
    $('help-title').textContent = h[0];
    $('help-body').innerHTML = '<div class="help-block"><b>O que é</b><p>' + esc(h[1]) + '</p></div>'
      + '<div class="help-block"><b>Como é calculado</b><code>' + esc(h[2]) + '</code></div>';
    $('help-drawer').classList.add('open');
    $('help-backdrop').classList.add('open');
    setContentBlur(true);
  }
  function openAllHelp() {
    var keys = Object.keys(CALC_HELP), html = '';
    for (var i = 0; i < keys.length; i += 1) {
      var h = CALC_HELP[keys[i]];
      html += '<div class="help-block"><b>' + esc(h[0]) + '</b><p>' + esc(h[1]) + '</p><code style="margin-top:.5rem">' + esc(h[2]) + '</code></div>';
    }
    $('help-title').textContent = 'Memória de cálculo | página inteira';
    $('help-body').innerHTML = html;
    $('help-drawer').classList.add('open');
    $('help-backdrop').classList.add('open');
    setContentBlur(true);
  }
  function closeHelp() {
    $('help-drawer').classList.remove('open');
    $('help-backdrop').classList.remove('open');
    setContentBlur(false);
  }

  function openModal(title, bodyHtml) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = bodyHtml;
    $('modal-overlay').classList.add('open');
  }
  function closeModal() { $('modal-overlay').classList.remove('open'); }

  // ── filtros ------------------------------------------------------------
  var PRESETS = [
    { key: 'hoje', label: 'Hoje' },
    { key: '7d', label: '7 dias' },
    { key: '30d', label: '30 dias' },
    { key: 'mes', label: 'Mês atual' },
    { key: 'mes-1', label: 'Mês passado' },
    { key: 'mes-2', label: '2 meses atrás' },
    { key: 'ano', label: 'Ano até hoje' }
  ];

  function resolvePreset(key) {
    var hoje = todayBrt();
    if (key === 'hoje') return { from: hoje, to: hoje };
    if (key === '7d') return { from: addDays(hoje, -6), to: hoje };
    if (key === '30d') return { from: addDays(hoje, -29), to: hoje };
    if (key === 'mes') return monthRange(0);
    if (key === 'mes-1') return monthRange(-1);
    if (key === 'mes-2') return monthRange(-2);
    if (key === 'ano') return { from: hoje.slice(0, 4) + '-01-01', to: hoje };
    return monthRange(0);
  }

  function renderFilters() {
    var chips = '';
    for (var i = 0; i < PRESETS.length; i += 1) {
      chips += '<button type="button" class="period-chip' + (state.preset === PRESETS[i].key ? ' active' : '')
        + '" data-preset="' + PRESETS[i].key + '" data-hover-title="' + esc(PRESETS[i].label)
        + '" data-hover-text="Clique para recarregar a página neste período.">' + esc(PRESETS[i].label) + '</button>';
    }
    $('filters').innerHTML =
      '<div class="periodbar"><span class="period-label">Período</span>' + chips
      + '<span class="period-help">Fuso America/Sao_Paulo | fim do período inclusivo</span></div>'
      + '<div class="filter"><label>De</label><input type="date" id="f-from" value="' + esc(state.from) + '"></div>'
      + '<div class="filter"><label>Até</label><input type="date" id="f-to" value="' + esc(state.to) + '"></div>'
      + '<div class="filter"><label>Granularidade da série</label><select id="f-gran">'
      + '<option value="dia"' + (state.gran === 'dia' ? ' selected' : '') + '>Dia</option>'
      + '<option value="semana"' + (state.gran === 'semana' ? ' selected' : '') + '>Semana</option>'
      + '<option value="mes"' + (state.gran === 'mes' ? ' selected' : '') + '>Mês</option>'
      + '</select></div>'
      + '<div class="filter filter-actions"><button class="btn primary" id="f-apply">Aplicar</button>'
      + '<button class="btn" id="f-refresh" data-hover-title="Ignorar cache" data-hover-text="Força nova busca nas APIs de Meta, LinkedIn e HubSpot.">Sem cache</button></div>';

    var ps = $('filters').querySelectorAll('[data-preset]');
    for (var p = 0; p < ps.length; p += 1) {
      ps[p].onclick = function () {
        state.preset = this.getAttribute('data-preset');
        var r = resolvePreset(state.preset);
        state.from = r.from; state.to = r.to;
        if (state.preset === 'ano' || state.preset === 'mes-2') state.gran = 'mes';
        else if (state.preset === '30d' || state.preset === 'mes' || state.preset === 'mes-1') state.gran = 'dia';
        load(false);
      };
    }
    $('f-apply').onclick = function () {
      state.from = $('f-from').value || state.from;
      state.to = $('f-to').value || state.to;
      state.gran = $('f-gran').value;
      state.preset = null;
      load(false);
    };
    $('f-refresh').onclick = function () { load(true); };
    $('f-gran').onchange = function () {
      state.gran = this.value;
      if (state.data) renderAll();
    };
  }

  // ── séries -------------------------------------------------------------
  /** Junta spend e leads no mesmo bucket temporal. */
  function buildSeries() {
    var d = state.data, map = {}, i, k;
    for (i = 0; i < d.spend.byDay.length; i += 1) {
      var row = d.spend.byDay[i];
      k = bucketOf(row.date, state.gran);
      map[k] = map[k] || { key: k, spend: {}, total: 0, pagos: 0, canal: 0, dias: {} };
      for (var ch in row) {
        if (ch === 'date' || !Object.prototype.hasOwnProperty.call(row, ch)) continue;
        map[k].spend[ch] = (map[k].spend[ch] || 0) + row[ch];
        map[k].total += row[ch];
      }
      map[k].dias[row.date] = true;
    }
    for (i = 0; i < d.leads.byDay.length; i += 1) {
      var lr = d.leads.byDay[i];
      k = bucketOf(lr.date, state.gran);
      map[k] = map[k] || { key: k, spend: {}, total: 0, pagos: 0, canal: 0, dias: {} };
      for (var c in lr.canais) {
        if (!Object.prototype.hasOwnProperty.call(lr.canais, c)) continue;
        map[k].pagos += lr.canais[c].pago;
        map[k].canal += lr.canais[c].total;
      }
      map[k].dias[lr.date] = true;
    }
    var out = [];
    for (k in map) if (Object.prototype.hasOwnProperty.call(map, k)) out.push(map[k]);
    out.sort(function (a, b) { return a.key < b.key ? -1 : 1; });
    return out;
  }

  var CH_COLOR = { Meta: 'var(--blue)', LinkedIn: 'var(--teal)', Google: 'var(--yellow)' };

  function renderSerie() {
    var serie = buildSeries();
    if (!serie.length) {
      return '<div class="card span-12"><div class="card-title"><div><h2>Spend e leads no tempo</h2></div>' + infoBtn('serie')
        + '</div><div class="muted">Sem spend e sem lead atribuído no período.</div></div>';
    }
    var W = 1000, H = 250, padL = 58, padR = 46, padB = 34, padT = 14;
    var innerW = W - padL - padR, innerH = H - padT - padB;
    var maxSpend = 0, maxLeads = 0, i;
    for (i = 0; i < serie.length; i += 1) {
      if (serie[i].total > maxSpend) maxSpend = serie[i].total;
      if (serie[i].pagos > maxLeads) maxLeads = serie[i].pagos;
    }
    if (maxSpend <= 0) maxSpend = 1;
    if (maxLeads <= 0) maxLeads = 1;

    var slot = innerW / serie.length;
    var bw = Math.max(4, Math.min(46, slot * 0.62));
    var svg = '<svg class="stack-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Spend por período com leads pagos">';
    var g;
    for (g = 0; g <= 4; g += 1) {
      var gy = padT + innerH - (innerH * g / 4);
      svg += '<line class="axis" x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '"/>';
      svg += '<text x="' + (padL - 6) + '" y="' + (gy + 3) + '" text-anchor="end">' + esc(brl0(maxSpend * g / 4)) + '</text>';
      svg += '<text x="' + (W - padR + 6) + '" y="' + (gy + 3) + '" text-anchor="start">' + Math.round(maxLeads * g / 4) + '</text>';
    }
    var channels = ['Meta', 'LinkedIn', 'Google'];
    var pts = [];
    for (i = 0; i < serie.length; i += 1) {
      var s = serie[i];
      var cx = padL + slot * i + slot / 2;
      var y0 = padT + innerH;
      for (var c = 0; c < channels.length; c += 1) {
        var v = s.spend[channels[c]] || 0;
        if (v <= 0) continue;
        var h = (v / maxSpend) * innerH;
        y0 -= h;
        svg += '<rect class="seg" data-bucket="' + esc(s.key) + '" x="' + (cx - bw / 2).toFixed(1) + '" y="' + y0.toFixed(1)
          + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3" fill="' + CH_COLOR[channels[c]]
          + '" data-hover-title="' + esc(bucketLabel(s.key, state.gran) + ' | ' + channels[c])
          + '" data-hover-text="' + esc(brl(v) + ' de spend | clique para abrir os leads do período') + '"/>';
      }
      pts.push({ x: cx, y: padT + innerH - (s.pagos / maxLeads) * innerH, s: s });
      if (serie.length <= 34 || i % Math.ceil(serie.length / 24) === 0) {
        svg += '<text x="' + cx.toFixed(1) + '" y="' + (H - padB + 15) + '" text-anchor="middle">' + esc(bucketLabel(s.key, state.gran)) + '</text>';
      }
    }
    var poly = '';
    for (i = 0; i < pts.length; i += 1) poly += pts[i].x.toFixed(1) + ',' + pts[i].y.toFixed(1) + ' ';
    svg += '<polyline class="lead-ln" points="' + poly.trim() + '"/>';
    for (i = 0; i < pts.length; i += 1) {
      svg += '<circle class="lead-pt" data-bucket="' + esc(pts[i].s.key) + '" cx="' + pts[i].x.toFixed(1) + '" cy="' + pts[i].y.toFixed(1)
        + '" r="3.5" data-hover-title="' + esc(bucketLabel(pts[i].s.key, state.gran))
        + '" data-hover-text="' + esc(pts[i].s.pagos + ' lead(s) pago(s) | ' + pts[i].s.canal + ' do canal | ' + brl(pts[i].s.total) + ' de spend') + '"/>';
    }
    svg += '<line class="axis" x1="' + padL + '" y1="' + (padT + innerH) + '" x2="' + (W - padR) + '" y2="' + (padT + innerH) + '"/>';
    svg += '<text x="' + padL + '" y="' + (H - 2) + '" text-anchor="start">R$ spend (esq.) | leads pagos (dir.)</text>';
    svg += '</svg>';

    return '<div class="card span-12"><div class="card-title"><div><h2>Spend e leads no tempo | ' + esc(state.gran) + '</h2>'
      + '<div class="desc">Barra = spend por canal | linha amarela = leads pagos | clique abre o detalhe do período</div></div>'
      + infoBtn('serie') + '</div>'
      + '<div class="granbar">' + granBtn('dia', 'Dia') + granBtn('semana', 'Semana') + granBtn('mes', 'Mês') + '</div>'
      + '<div class="line-legend"><span><i class="meta"></i>Meta</span><span><i class="linkedin"></i>LinkedIn</span><span><i class="leads"></i>Leads pagos</span></div>'
      + svg + '</div>';
  }
  function granBtn(k, label) {
    return '<button type="button" data-gran="' + k + '" class="' + (state.gran === k ? 'active' : '') + '">' + label + '</button>';
  }

  // ── blocos -------------------------------------------------------------
  function kpi(label, value, sub, cls, helpKey, drill) {
    return '<div class="kpi ' + (cls || '') + (drill ? ' clickable' : '') + '"'
      + (drill ? ' data-drill="' + esc(drill) + '"' : '')
      + ' data-hover-title="' + esc(label) + '" data-hover-text="'
      + esc(drill ? 'Clique para abrir os leads que compõem este número. Passe no i para a fórmula.' : 'Passe no i para a fórmula.')
      + '"><div class="label"><span>' + esc(label) + '</span>' + (helpKey ? infoBtn(helpKey) : '') + '</div>'
      + '<div class="value">' + value + '</div><div class="sub">' + esc(sub || '') + '</div></div>';
  }

  function renderBigIdea() {
    var d = state.data, k = d.kpis;
    var chans = [], name;
    for (name in k.byChannel) {
      if (k.byChannel[name].conectado && k.byChannel[name].cpl != null) chans.push({ name: name, cpl: k.byChannel[name].cpl });
    }
    chans.sort(function (a, b) { return a.cpl - b.cpl; });
    var txt, act;
    if (!k.spendTotal) {
      txt = 'Nenhum spend de mídia paga no período <strong>' + ptDate(d.range.from) + ' a ' + ptDate(d.range.to) + '</strong>.';
      act = 'Meta e LinkedIn responderam sem gasto na janela | não é falha de conexão.';
    } else if (!k.leadsPagos) {
      txt = '<strong>' + brl(k.spendTotal) + '</strong> de mídia paga no período e <strong>nenhum lead marcado como pago</strong>.';
      act = 'Ver o bloco de higiene de marcação abaixo | provavelmente o utm_medium do anúncio não está como paid_social.';
    } else {
      txt = '<strong>' + brl(k.spendTotal) + '</strong> em mídia paga geraram <strong>' + num(k.leadsPagos)
        + ' leads pagos</strong> de <strong>' + num(k.empresasPagas) + ' empresas</strong> | CPL <strong>'
        + brl(k.cplPago) + '</strong> | custo por empresa <strong>' + brl(k.custoPorEmpresa) + '</strong>.';
      if (chans.length >= 2) {
        var ratio = chans[chans.length - 1].cpl / chans[0].cpl;
        act = chans[0].name + ' é o canal mais eficiente | CPL ' + brl(chans[0].cpl) + ' contra '
          + brl(chans[chans.length - 1].cpl) + ' do ' + chans[chans.length - 1].name
          + ' (' + ratio.toFixed(1).replace('.', ',') + '× mais caro).';
      } else if (chans.length === 1) {
        act = 'Único canal com CPL mensurável no período: ' + chans[0].name + ' a ' + brl(chans[0].cpl) + ' por lead.';
      } else {
        act = 'Nenhum canal com CPL mensurável | ver higiene de marcação.';
      }
    }
    return '<section class="big-idea"><div class="big-idea-text">' + txt + '</div><div class="big-idea-action">' + esc(act) + '</div></section>';
  }

  function renderHero() {
    var k = state.data.kpis, sp = state.data.spend;
    return '<section class="kpis kpis-hero">'
      + kpi('Spend mídia paga', brl(k.spendTotal), sp.canaisConectados.length ? 'Canais: ' + sp.canaisConectados.join(' | ') : 'Nenhum canal com gasto', 'hero teal', 'spendTotal', 'campanhas')
      + kpi('Leads pagos', num(k.leadsPagos), state.data.leads.comUtm + ' leads com UTM no período', 'hero', 'leadsPagos', 'pagos')
      + kpi('CPL pago', brl(k.cplPago), 'Spend ÷ leads pagos', 'hero ' + (k.cplPago == null ? '' : k.cplPago > 300 ? 'bad' : k.cplPago > 150 ? 'warn' : 'good'), 'cplPago', 'pagos')
      + kpi('Custo por empresa', brl(k.custoPorEmpresa), num(k.empresasPagas) + ' empresas distintas', 'hero', 'custoEmpresa', 'empresas')
      + '</section>';
  }

  function renderVolume() {
    var sp = state.data.spend, l = state.data.leads;
    return '<section class="kpis">'
      + kpi('Impressões', num(sp.impressions), 'Entrega das plataformas', '', 'volume', null)
      + kpi('Clicks', num(sp.clicks), 'Cliques nos anúncios', '', 'volume', null)
      + kpi('CTR', pct(sp.ctr, 2), 'Clicks ÷ impressões', '', 'volume', null)
      + kpi('CPM', brl(sp.cpm), 'Custo por mil impressões', '', 'volume', null)
      + kpi('CPC', brl(sp.cpc), 'Custo por click', '', 'volume', null)
      + kpi('Leads do canal', num(l.comUtm), 'Pagos + orgânicos + outros', '', 'canais', 'todos')
      + '</section>';
  }

  function renderHigiene() {
    var h = state.data.higiene, sp = state.data.spend, rows = '', i;
    for (i = 0; i < sp.erros.length; i += 1) {
      rows += '<div class="alert-row alto"><span class="alert-tag">Conexão</span><div><b>' + esc(sp.erros[i].channel)
        + ' | não foi possível puxar o spend</b><span>' + esc(sp.erros[i].error) + '</span></div></div>';
    }
    for (i = 0; i < h.length; i += 1) {
      rows += '<div class="alert-row ' + esc(h[i].nivel) + '"><span class="alert-tag">' + esc(h[i].canal)
        + '</span><div><b>' + esc(h[i].iniciativa + ' | ' + h[i].problema) + '</b><span>' + esc(h[i].detalhe) + '</span></div></div>';
    }
    if (!rows) {
      rows = '<div class="alert-row" style="border-left-color:var(--green)"><span class="alert-tag">OK</span><div><b>Nenhum problema de marcação no período</b><span>Todo spend tem lead atribuído e a marcação de pago está consistente.</span></div></div>';
    }
    return '<div class="card span-12"><div class="card-title"><div><h2>Higiene de marcação</h2>'
      + '<div class="desc">Onde o número não fecha e por quê | corrigir aqui melhora o CPL de verdade, não só o relatório</div></div>'
      + infoBtn('higiene') + '</div><div class="alert-list">' + rows + '</div></div>';
  }

  function renderCanais() {
    var k = state.data.kpis.byChannel, cards = '', name;
    var names = Object.keys(k).sort(function (a, b) { return (k[b].spend || 0) - (k[a].spend || 0); });
    for (var i = 0; i < names.length; i += 1) {
      name = names[i];
      var c = k[name];
      cards += '<div class="chan-card" data-canal="' + esc(name) + '" data-hover-title="' + esc(name)
        + '" data-hover-text="Clique para abrir os leads deste canal.">'
        + '<div class="chan-head"><b>' + esc(name) + '</b>'
        + '<span class="pill ' + (c.conectado ? 'teal' : '') + '">' + (c.conectado ? 'spend conectado' : 'sem spend') + '</span></div>'
        + '<div class="chan-metrics">'
        + '<div class="chan-metric teal"><span>Spend</span><b>' + brl(c.spend) + '</b></div>'
        + '<div class="chan-metric"><span>CPL pago</span><b>' + brl(c.cpl) + '</b></div>'
        + '<div class="chan-metric"><span>Leads pagos</span><b>' + num(c.leadsPagos) + '</b></div>'
        + '<div class="chan-metric ' + (c.leadsOrganicos ? 'warn' : '') + '"><span>Orgânicos</span><b>' + num(c.leadsOrganicos) + '</b></div>'
        + '<div class="chan-metric"><span>Empresas</span><b>' + num(c.empresas) + '</b></div>'
        + '<div class="chan-metric"><span>R$ por empresa</span><b>' + brl(c.custoPorEmpresa) + '</b></div>'
        + '</div></div>';
    }
    if (!cards) cards = '<div class="muted">Nenhum canal com spend ou lead no período.</div>';
    var google = '<div class="chan-card" style="cursor:default;opacity:.7" data-hover-title="Google Ads" data-hover-text="Canal ainda não conectado nesta página.">'
      + '<div class="chan-head"><b>Google Ads</b><span class="pill">não conectado</span></div>'
      + '<div class="chan-metrics"><div class="chan-metric"><span>Spend</span><b>—</b></div>'
      + '<div class="chan-metric"><span>CPL pago</span><b>—</b></div></div></div>';
    return '<div class="card span-12"><div class="card-title"><div><h2>Por canal</h2>'
      + '<div class="desc">Clique no card abre os leads do canal | canal sem spend conectado mostra "—", nunca R$ 0,00</div></div>'
      + infoBtn('canais') + '</div><div class="chan-grid">' + cards + google + '</div></div>';
  }

  function renderIniciativas() {
    var list = state.data.iniciativas, body = '', i;
    for (i = 0; i < list.length; i += 1) {
      var it = list[i];
      body += '<tr class="clickable-row" data-ini="' + esc(it.iniciativa) + '" data-ini-canal="' + esc(it.canal)
        + '" data-hover-title="' + esc(it.canal + ' | ' + it.iniciativa) + '" data-hover-text="Clique para abrir os leads desta iniciativa.">'
        + '<td class="nowrap">' + esc(it.canal) + '</td>'
        + '<td>' + esc(it.iniciativa) + '</td>'
        + '<td class="right nowrap">' + brl(it.spend) + '</td>'
        + '<td class="right">' + num(it.leadsCanal) + '</td>'
        + '<td class="right">' + num(it.pagos) + '</td>'
        + '<td class="right">' + (it.organicos ? '<span class="pill warn">' + num(it.organicos) + '</span>' : '0') + '</td>'
        + '<td class="right nowrap">' + brl(it.cpl) + '</td>'
        + '<td class="right nowrap">' + brl(it.cplCanal) + '</td>'
        + '<td class="right">' + num(it.empresas) + '</td>'
        + '<td class="right nowrap">' + brl(it.custoPorEmpresa) + '</td></tr>';
    }
    return '<div class="card span-12"><div class="card-title"><div><h2>Por iniciativa | campanha</h2>'
      + '<div class="desc">Join do spend da plataforma com o utm_campaign do HubSpot | CPL pago usa só lead marcado como pago</div></div>'
      + infoBtn('iniciativas') + '</div>'
      + '<div class="table-wrap"><table><thead><tr><th>Canal</th><th>Iniciativa</th><th class="right">Spend</th>'
      + '<th class="right">Leads canal</th><th class="right">Pagos</th><th class="right">Orgânicos</th>'
      + '<th class="right">CPL pago</th><th class="right">CPL canal</th><th class="right">Empresas</th><th class="right">R$/empresa</th></tr></thead>'
      + '<tbody>' + (body || '<tr><td colspan="10" class="muted">Sem iniciativa no período</td></tr>') + '</tbody></table></div></div>';
  }

  function renderCorte(title, key, spanClass) {
    var list = state.data.cortes[key], max = 0, html = '', i;
    for (i = 0; i < list.length; i += 1) if (list[i].leads > max) max = list[i].leads;
    var show = list.slice(0, 10);
    for (i = 0; i < show.length; i += 1) {
      var r = show[i];
      html += '<div class="break-row clickable-row" data-corte="' + esc(key) + '" data-corte-val="' + esc(r.label)
        + '" data-hover-title="' + esc(r.label) + '" data-hover-text="' + esc(r.leads + ' lead(s) pago(s) | clique para abrir a lista')
        + '"><div class="break-name">' + esc(r.label) + '</div><div class="break-val">' + num(r.leads) + '</div>'
        + '<div class="break-track"><div class="break-fill" style="width:' + (max ? (r.leads / max * 100).toFixed(1) : 0) + '%"></div></div></div>';
    }
    return '<div class="card ' + (spanClass || 'span-6') + '"><div class="card-title"><div><h2>' + esc(title) + '</h2>'
      + '<div class="desc">Somente leads pagos | clique abre a lista</div></div>' + infoBtn('cortes') + '</div>'
      + '<div class="break-list">' + (html || '<div class="muted">Sem lead pago no período</div>') + '</div></div>';
  }

  function renderCampanhasAnuncio() {
    var list = state.data.campanhasAnuncio, body = '', i;
    for (i = 0; i < list.length; i += 1) {
      var c = list[i];
      body += '<tr><td class="nowrap">' + esc(c.channel) + '</td><td>' + esc(c.campaignName) + '</td>'
        + '<td>' + esc(c.iniciativa) + '</td><td class="right nowrap">' + brl(c.spend) + '</td>'
        + '<td class="right">' + num(c.impressions) + '</td><td class="right">' + num(c.clicks) + '</td>'
        + '<td class="right nowrap">' + brl(c.clicks ? c.spend / c.clicks : null) + '</td></tr>';
    }
    return '<div class="card span-12"><div class="card-title"><div><h2>Campanhas de anúncio | verdade da plataforma</h2>'
      + '<div class="desc">Direto de Meta Ads e LinkedIn Ads, sem HubSpot no meio</div></div>' + infoBtn('campanhasAnuncio') + '</div>'
      + '<div class="table-wrap"><table><thead><tr><th>Canal</th><th>Campanha</th><th>Iniciativa</th><th class="right">Spend</th>'
      + '<th class="right">Impressões</th><th class="right">Clicks</th><th class="right">CPC</th></tr></thead>'
      + '<tbody>' + (body || '<tr><td colspan="7" class="muted">Nenhuma campanha com spend no período</td></tr>') + '</tbody></table></div></div>';
  }

  function renderCobertura() {
    var c = state.data.coverage;
    return '<div class="card span-12"><div class="card-title"><div><h2>Cobertura dos dados</h2>'
      + '<div class="desc">O que a página consegue atribuir e o que fica de fora</div></div>' + infoBtn('cobertura') + '</div>'
      + '<div class="cov-grid">'
      + covItem('Leads no período', num(c.leadsPeriodo), '')
      + covItem('Com utm_source', num(c.comUtmSource) + ' | ' + pct(c.pctComUtm), '')
      + covItem('Sem UTM', num(c.semUtmSource), 'warn')
      + covItem('Com cargo', pct(c.pctComCargo, 0), c.pctComCargo > 0.9 ? 'good' : 'warn')
      + covItem('Com porte', pct(c.pctComPorte, 0), c.pctComPorte > 0.8 ? 'good' : 'warn')
      + '</div>'
      + '<div class="desc" style="margin-top:.9rem">A fatia sem UTM é esperada: prospecção de BDR e importação de lista nascem sem UTM. '
      + 'O número que importa para mídia paga é o de leads pagos, não a proporção do total.</div></div>';
  }
  function covItem(label, value, cls) {
    return '<div class="cov-item"><span class="cov-label">' + esc(label) + '</span><span class="cov-value ' + (cls || '') + '">' + value + '</span></div>';
  }

  function renderLeadsTable() {
    var rows = state.data.leads.rows.slice(0).sort(function (a, b) { return a.criadoEm < b.criadoEm ? 1 : -1; });
    return '<div class="card span-12"><div class="card-title"><div><h2>Leads do período | base de tudo</h2>'
      + '<div class="desc">Somente leads com utm_source | ' + rows.length + ' linha(s) | clique no nome abre o HubSpot</div></div>'
      + infoBtn('leadsTable') + '</div>' + leadsTableHtml(rows) + '</div>';
  }

  function leadsTableHtml(rows) {
    var body = '', i;
    for (i = 0; i < rows.length; i += 1) {
      var r = rows[i];
      body += '<tr><td class="nowrap">' + ptDate(r.data) + '</td>'
        + '<td><a class="deal-link" href="' + esc(r.hubspotUrl) + '" target="_blank" rel="noopener">' + esc(r.nome) + '</a></td>'
        + '<td>' + esc(r.cargo || '—') + '</td>'
        + '<td>' + esc(r.empresa || '—') + '</td>'
        + '<td class="nowrap">' + esc(r.porte) + '</td>'
        + '<td class="nowrap">' + esc(r.canal) + '</td>'
        + '<td class="nowrap"><span class="pill ' + (r.tipo === 'pago' ? 'teal' : r.tipo === 'organico' ? 'warn' : '') + '">' + esc(r.tipo) + '</span></td>'
        + '<td>' + esc(r.utmCampaign || '—') + '</td>'
        + '<td>' + esc(r.iniciativa) + '</td></tr>';
    }
    return '<div class="table-wrap"><table><thead><tr><th>Data</th><th>Lead</th><th>Cargo</th><th>Empresa</th><th>Porte</th>'
      + '<th>Canal</th><th>Tipo</th><th>utm_campaign</th><th>Iniciativa</th></tr></thead>'
      + '<tbody>' + (body || '<tr><td colspan="9" class="muted">Nenhum lead com UTM no período</td></tr>') + '</tbody></table></div>';
  }

  // ── drilldowns ---------------------------------------------------------
  function modalKpis(rows, spend) {
    var pagos = rows.filter(function (r) { return r.tipo === 'pago'; }).length;
    var emp = {}, i;
    for (i = 0; i < rows.length; i += 1) if (rows[i].companyId) emp[rows[i].companyId] = true;
    var nEmp = Object.keys(emp).length;
    return '<div class="modal-kpis">'
      + '<div class="modal-kpi"><b>' + num(rows.length) + '</b><span>Leads</span></div>'
      + '<div class="modal-kpi"><b>' + num(pagos) + '</b><span>Pagos</span></div>'
      + '<div class="modal-kpi"><b>' + num(nEmp) + '</b><span>Empresas</span></div>'
      + '<div class="modal-kpi"><b>' + brl(spend != null && pagos ? spend / pagos : null) + '</b><span>CPL pago</span></div>'
      + '</div>';
  }

  function openLeads(title, rows, spend) {
    openModal(title, modalKpis(rows, spend) + leadsTableHtml(rows));
  }

  function openBucket(bucketKey) {
    var d = state.data, rows = [], i, spend = 0;
    for (i = 0; i < d.leads.rows.length; i += 1) {
      if (bucketOf(d.leads.rows[i].data, state.gran) === bucketKey) rows.push(d.leads.rows[i]);
    }
    for (i = 0; i < d.spend.byDay.length; i += 1) {
      var row = d.spend.byDay[i];
      if (bucketOf(row.date, state.gran) !== bucketKey) continue;
      for (var ch in row) if (ch !== 'date' && Object.prototype.hasOwnProperty.call(row, ch)) spend += row[ch];
    }
    openLeads('Período | ' + bucketLabel(bucketKey, state.gran) + ' | ' + brl(spend) + ' de spend', rows, spend);
  }

  function drill(key) {
    var d = state.data, rows = d.leads.rows, k = d.kpis;
    if (key === 'pagos') return openLeads('Leads pagos | ' + ptDate(d.range.from) + ' a ' + ptDate(d.range.to),
      rows.filter(function (r) { return r.tipo === 'pago'; }), k.spendTotal);
    if (key === 'todos') return openLeads('Todos os leads com UTM', rows, k.spendTotal);
    if (key === 'empresas') {
      var seen = {}, uniq = [];
      var pagos = rows.filter(function (r) { return r.tipo === 'pago' && r.companyId; });
      for (var i = 0; i < pagos.length; i += 1) {
        if (seen[pagos[i].companyId]) continue;
        seen[pagos[i].companyId] = true; uniq.push(pagos[i]);
      }
      return openLeads('Empresas distintas com lead pago | 1 lead por empresa', uniq, k.spendTotal);
    }
    if (key === 'campanhas') {
      var list = d.campanhasAnuncio, body = '';
      for (var c = 0; c < list.length; c += 1) {
        body += '<tr><td>' + esc(list[c].channel) + '</td><td>' + esc(list[c].campaignName) + '</td>'
          + '<td class="right nowrap">' + brl(list[c].spend) + '</td><td class="right">' + num(list[c].impressions)
          + '</td><td class="right">' + num(list[c].clicks) + '</td></tr>';
      }
      return openModal('Spend por campanha | ' + brl(k.spendTotal),
        '<div class="table-wrap"><table><thead><tr><th>Canal</th><th>Campanha</th><th class="right">Spend</th>'
        + '<th class="right">Impressões</th><th class="right">Clicks</th></tr></thead><tbody>'
        + (body || '<tr><td colspan="5" class="muted">Nenhuma campanha com spend</td></tr>') + '</tbody></table></div>');
    }
  }

  // ── render principal ---------------------------------------------------
  function renderAll() {
    var d = state.data;
    var html = renderBigIdea() + renderHero() + renderVolume()
      + '<div class="grid">' + renderHigiene() + '</div>'
      + '<div class="grid">' + renderCanais() + '</div>'
      + '<div class="grid">' + renderSerie() + '</div>'
      + '<div class="grid">' + renderIniciativas() + '</div>'
      + '<div class="grid">' + renderCorte('Por senioridade', 'senioridade') + renderCorte('Por área', 'area') + '</div>'
      + '<div class="grid">' + renderCorte('Por porte da empresa', 'porte') + renderCorte('Por cargo declarado', 'cargo') + '</div>'
      + '<div class="grid">' + renderCorte('Por setor', 'setor') + renderCorte('Por persona | senioridade e área', 'persona') + '</div>'
      + '<div class="grid">' + renderCampanhasAnuncio() + '</div>'
      + '<div class="grid">' + renderCobertura() + '</div>'
      + '<div class="grid">' + renderLeadsTable() + '</div>';
    $('content').innerHTML = html;
    // Janela efetivamente renderizada. O smoke sincroniza por aqui: sem isso ele
    // lia o render do mês corrente (que pode estar vazio) achando que era o
    // período pedido, porque #content já estava visível da carga anterior.
    $('content').setAttribute('data-range', d.range.from + '..' + d.range.to);
    // Nome propositalmente diferente de `data-gran` dos botões: com o mesmo nome,
    // #content vinha primeiro no documento e roubava o querySelector dos botões.
    $('content').setAttribute('data-gran-atual', state.gran);
    wire();
    $('state').classList.add('hidden');
    $('content').classList.remove('hidden');
  }

  function wire() {
    var root = $('content'), i;
    var helps = root.querySelectorAll('[data-help]');
    for (i = 0; i < helps.length; i += 1) {
      helps[i].onclick = function (ev) { ev.stopPropagation(); openHelp(this.getAttribute('data-help')); };
    }
    var drills = root.querySelectorAll('[data-drill]');
    for (i = 0; i < drills.length; i += 1) {
      drills[i].onclick = function () { drill(this.getAttribute('data-drill')); };
    }
    var buckets = root.querySelectorAll('[data-bucket]');
    for (i = 0; i < buckets.length; i += 1) {
      buckets[i].onclick = function () { openBucket(this.getAttribute('data-bucket')); };
    }
    var canais = root.querySelectorAll('[data-canal]');
    for (i = 0; i < canais.length; i += 1) {
      canais[i].onclick = function () {
        var canal = this.getAttribute('data-canal');
        var c = state.data.kpis.byChannel[canal] || {};
        openLeads('Canal | ' + canal + ' | ' + brl(c.spend) + ' de spend',
          state.data.leads.rows.filter(function (r) { return r.canal === canal; }), c.spend);
      };
    }
    var inis = root.querySelectorAll('[data-ini]');
    for (i = 0; i < inis.length; i += 1) {
      inis[i].onclick = function () {
        var ini = this.getAttribute('data-ini'), canal = this.getAttribute('data-ini-canal');
        var found = null, list = state.data.iniciativas;
        for (var j = 0; j < list.length; j += 1) {
          if (list[j].iniciativa === ini && list[j].canal === canal) { found = list[j]; break; }
        }
        openLeads(canal + ' | ' + ini + ' | ' + brl(found ? found.spend : null) + ' de spend',
          state.data.leads.rows.filter(function (r) { return r.iniciativa === ini && r.canal === canal; }),
          found ? found.spend : null);
      };
    }
    var cortes = root.querySelectorAll('[data-corte]');
    for (i = 0; i < cortes.length; i += 1) {
      cortes[i].onclick = function () {
        var key = this.getAttribute('data-corte'), val = this.getAttribute('data-corte-val');
        var field = key === 'cargo' ? 'cargo' : key;
        openLeads(val + ' | leads pagos', state.data.leads.rows.filter(function (r) {
          return r.tipo === 'pago' && String(r[field] || (field === 'cargo' ? '(sem cargo)' : '')) === val;
        }), null);
      };
    }
    var grans = root.querySelectorAll('[data-gran]');
    for (i = 0; i < grans.length; i += 1) {
      grans[i].onclick = function () {
        state.gran = this.getAttribute('data-gran');
        var sel = $('f-gran');
        if (sel) sel.value = state.gran;
        renderAll();
      };
    }
  }

  // ── carga --------------------------------------------------------------
  function showState(msg, sub) {
    $('content').classList.add('hidden');
    $('state').classList.remove('hidden');
    $('state').innerHTML = '<div class="spinner"></div><strong>' + esc(msg) + '</strong>' + esc(sub || '');
  }
  function showError(msg) {
    $('content').classList.add('hidden');
    $('state').classList.remove('hidden');
    $('state').innerHTML = '<strong>Não foi possível carregar</strong>' + esc(msg)
      + '<div style="margin-top:1rem"><button class="btn primary" onclick="GrowthPerf.load(true)">Tentar de novo</button></div>';
  }

  // Guarda de sequência: a carga inicial usa o mês corrente e o usuário quase
  // sempre troca de período antes dela voltar. Sem isso, a resposta ATRASADA da
  // requisição antiga chegava depois e sobrescrevia a nova — a tela mostrava o
  // período errado de forma intermitente (pego no smoke, 2026-08-06).
  var reqSeq = 0;

  function load(refresh) {
    var mine = ++reqSeq;
    renderFilters();
    showState('Carregando dados', 'Meta Ads | LinkedIn Ads | HubSpot | ' + ptDate(state.from) + ' a ' + ptDate(state.to));
    var url = '/api/growth-performance?from=' + encodeURIComponent(state.from) + '&to=' + encodeURIComponent(state.to)
      + (refresh ? '&refresh=1' : '');
    fetch(url, { credentials: 'same-origin' })
      .then(function (res) {
        if (res.status === 401) { window.location.href = '/'; return null; }
        return res.json();
      })
      .then(function (json) {
        if (mine !== reqSeq) return;
        if (!json) return;
        if (!json.success) return showError(json.error || 'Erro desconhecido na API.');
        state.data = json;
        renderAll();
      })
      .catch(function (e) {
        if (mine !== reqSeq) return;
        showError(String(e && e.message || e));
      });
  }

  function exportCsv() {
    if (!state.data) return;
    var rows = state.data.leads.rows;
    var head = ['data', 'nome', 'email', 'cargo', 'senioridade', 'area', 'empresa', 'porte', 'setor',
      'canal', 'tipo', 'utm_source', 'utm_medium', 'utm_campaign', 'iniciativa', 'hubspot'];
    var lines = [head.join(';')], i, j;
    for (i = 0; i < rows.length; i += 1) {
      var r = rows[i], vals = [r.data, r.nome, r.email, r.cargo, r.senioridade, r.area, r.empresa, r.porte,
        r.setor, r.canal, r.tipo, r.utmSource, r.utmMedium, r.utmCampaign, r.iniciativa, r.hubspotUrl];
      for (j = 0; j < vals.length; j += 1) {
        vals[j] = '"' + String(vals[j] == null ? '' : vals[j]).replace(/"/g, '""') + '"';
      }
      lines.push(vals.join(';'));
    }
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'growth_performance_' + state.from + '_a_' + state.to + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  function toggleTheme() {
    var cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', cur);
    try { localStorage.setItem('axenya_theme', cur); } catch (e) {}
  }

  // ── hover tip ----------------------------------------------------------
  function positionTip(ev) {
    var tip = $('hover-tip');
    if (!tip || !tip.classList.contains('show')) return;
    var rect = tip.getBoundingClientRect();
    var x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + rect.width > window.innerWidth - 8) x = ev.clientX - rect.width - 10;
    if (y + rect.height > window.innerHeight - 8) y = ev.clientY - rect.height - 10;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }
  document.addEventListener('mouseover', function (ev) {
    var el = ev.target.closest ? ev.target.closest('[data-hover-title],[data-hover-text]') : null;
    if (!el) return;
    var tip = $('hover-tip');
    if (!tip) return;
    tip.querySelector('.ht-title').textContent = el.getAttribute('data-hover-title') || 'Detalhe';
    tip.querySelector('.ht-text').textContent = el.getAttribute('data-hover-text') || 'Clique para abrir o detalhe.';
    tip.classList.add('show');
    positionTip(ev);
  });
  document.addEventListener('mouseout', function (ev) {
    if (!ev.target.closest || !ev.target.closest('[data-hover-title],[data-hover-text]')) return;
    var tip = $('hover-tip');
    if (tip) tip.classList.remove('show');
  });
  document.addEventListener('mousemove', positionTip);
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape' && ev.keyCode !== 27) return;
    if ($('help-drawer') && $('help-drawer').classList.contains('open')) return closeHelp();
    if ($('modal-overlay') && $('modal-overlay').classList.contains('open')) return closeModal();
  });

  window.addEventListener('DOMContentLoaded', function () {
    var r = resolvePreset(state.preset);
    state.from = r.from; state.to = r.to;
    load(false);
  });

  return {
    load: load, openHelp: openHelp, openAllHelp: openAllHelp, closeHelp: closeHelp,
    closeModal: closeModal, toggleTheme: toggleTheme, exportCsv: exportCsv
  };
})();
