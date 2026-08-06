'use strict';
/**
 * seo-performance.js — /growth/seo
 *
 * Consome GET /api/seo-performance?base&end&q. O payload já traz os KPIs de
 * TODAS as bases (DoD, WoW, MoM, QoQ, YoY) e a série diária de 65 semanas, então
 * trocar de comparação no strip de cima ou de granularidade na linha do tempo é
 * instantâneo; só a MOVIMENTAÇÃO por entidade (consulta e página) depende da base
 * e obriga nova ida à API.
 *
 * Padrão de UX do dashboard: hover em tudo, `i` abre memória de cálculo, KPI,
 * barra e linha de tabela abrem drilldown, separador de texto sempre `|`.
 *
 * Duas convenções que não são óbvias e não devem ser "corrigidas":
 *  - posição MENOR é melhor, então delta negativo de posição é pintado de verde;
 *  - bucket parcial (mês corrente, trimestre corrente) aparece com variação em
 *    branco de propósito: comparar 4 dias com 31 é calendário, não performance.
 */
var SeoPerf = (function () {
  var state = {
    base: 'wow',
    end: '',
    gran: 'semana',
    view: 'consultas',
    busca: '',
    buscaServidor: '',
    data: null,
    sort: null,
    filtros: { status: 'todos', categoria: 'todas', minImp: 0 }
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return (s == null ? '' : String(s))
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── formatação ---------------------------------------------------------
  function num(v) {
    if (v == null || isNaN(v)) return '—';
    return Number(v).toLocaleString('pt-BR');
  }
  function pct(v, d) {
    if (v == null || isNaN(v)) return '—';
    return (Number(v) * 100).toFixed(d == null ? 1 : d).replace('.', ',') + '%';
  }
  function pos(v) {
    if (v == null || isNaN(v) || Number(v) === 0) return '—';
    return Number(v).toFixed(1).replace('.', ',');
  }
  /** Delta de posição: aqui o zero é informação ("não mexeu"), não ausência. */
  function posd(v) {
    if (v == null || isNaN(v)) return '—';
    var n = Number(v);
    return (n > 0 ? '+' : '') + n.toFixed(1).replace('.', ',');
  }
  function sig(v) {
    if (v == null || isNaN(v)) return '—';
    var n = Number(v);
    return (n > 0 ? '+' : '') + n.toLocaleString('pt-BR');
  }
  function sigPct(v) {
    if (v == null) return 'novo';
    if (isNaN(v)) return '—';
    var n = Number(v) * 100;
    return (n > 0 ? '+' : '') + n.toFixed(1).replace('.', ',') + '%';
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
  var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function monthLabel(ym) {
    var p = String(ym).split('-');
    return MESES[parseInt(p[1], 10) - 1] + '/' + p[0].slice(2);
  }
  function bucketLabel(b) {
    if (state.gran === 'dia') return shortDate(b.key);
    if (state.gran === 'semana') return shortDate(b.from);
    if (state.gran === 'mes') return monthLabel(b.key);
    return String(b.key).replace('-T', ' T');
  }
  /** Classe de cor de um delta. `inverso` para posição, onde menor é melhor. */
  function cls(v, inverso) {
    if (v == null || Number(v) === 0) return 'flat';
    var bom = inverso ? Number(v) < 0 : Number(v) > 0;
    return bom ? 'up' : 'down';
  }
  function arrow(v, inverso) {
    if (v == null || Number(v) === 0) return '';
    var bom = inverso ? Number(v) < 0 : Number(v) > 0;
    return bom ? '▲ ' : '▼ ';
  }

  // ── memória de cálculo -------------------------------------------------
  var CALC_HELP = {
    fonte: ['Fonte do dado', 'Google Search Console da propriedade de domínio sc-domain:axenya.com, lido ao vivo pela Search Analytics API v3 com uma service account.',
      'A autenticação é Service Account JWT RS256 no escopo webmasters.readonly. Nenhum dado é exportado à mão nem passa por planilha. A propriedade é de domínio, então cobre www e subdomínios, http e https.'],
    fechado: ['Dia fechado', 'Só entra na conta o dia que o Google já consolidou (dataState=final).',
      'Foi medido que com dataState=all os 2 últimos dias vêm parciais: o dia corrente apareceu com 1 clique contra ~130 dos dias fechados. Num gráfico isso lê como queda de 99%. Todas as janelas terminam no último dia FECHADO, e o painel mostra qual é essa data e quantos dias parciais existem depois dela.'],
    janela: ['Janela de comparação', 'DoD compara 1 dia, WoW 7 dias, MoM 28 dias, QoQ 91 dias e YoY 28 dias contra os mesmos 28 de 52 semanas atrás.',
      'Todas as janelas são múltiplos de 7 dias de propósito. Nesta propriedade domingo rende 36 e sábado 32 cliques por dia contra 124 a 127 de segunda a quarta, quase 4x. Comparar 30 contra 31 dias, ou uma janela com dois sábados contra uma com um, produz variação que é só calendário. Com múltiplo de 7 as duas pontas têm exatamente a mesma composição de dias da semana. YoY usa 364 dias (52 semanas) em vez de 365 para preservar o dia da semana.'],
    kpis: ['Cliques, impressões, CTR e posição', 'Os quatro números da propriedade inteira na janela atual, e a variação contra a janela anterior.',
      'Cliques e impressões são somas. CTR é recalculado como cliques ÷ impressões. Posição é média ponderada por IMPRESSÃO. Foi verificado que somar a série diária reproduz o agregado da API com igualdade de float (8108 cliques, 676778 impressões e posição 6.400175537 nos dois), então o KPI e o gráfico saem do mesmo array e não podem divergir.'],
    posicao: ['Posição média', 'Onde o site aparece, na média ponderada por impressão.',
      'Posição MENOR é melhor: 1 é o primeiro resultado. Por isso um delta negativo é ganho e aparece em verde, ao contrário de todas as outras métricas da página. Média simples de posição está errada: no conjunto medido ela deu 7,90 contra 8,00 da ponderada, e a ponderada é a que o Google usa.'],
    timeline: ['Linha do tempo', 'Cliques por período, com posição média por cima.',
      'Barra = cliques do bucket. Linha amarela = posição média, com o eixo da direita INVERTIDO (mais alto = melhor posição). Na granularidade de dia, sábado e domingo são pintados de cinza porque rendem ~1/4 de um dia útil, e a linha tracejada é a média móvel de 7 dias, que é a única forma de ler tendência numa série que oscila 4x por dia da semana. Semana é bloco de 7 dias ancorado no último dia fechado, nunca semana ISO, senão a última semana ficaria parcial. Mês e trimestre são calendário e o bucket incompleto aparece em cinza SEM variação.'],
    movimento: ['Movimentação', 'O que mudou entre a janela atual e a anterior, entidade por entidade.',
      'Para cada consulta e cada página o painel guarda os dois lados da comparação e classifica: novo (tinha zero impressão antes), perdido (tem zero impressão agora), subiu, caiu ou estável. Quando o clique não mudou, o status olha a impressão e só muda se ela variou 20% ou mais. Ordem padrão é o maior movimento absoluto de clique, porque é o que explica a variação do total.'],
    coberturaQ: ['Cobertura das consultas', 'Quanto do site a tabela de consultas consegue explicar.',
      'O Google anonimiza consultas de cauda longa por privacidade. Na janela de 90 dias medida, as consultas nomeadas cobriam 27,5% dos cliques e 20,4% das impressões do site. Isso significa que somar a coluna de cliques da tabela NUNCA vai dar o total do site, e não é bug. O painel mostra a cobertura em número para deixar isso explícito.'],
    coberturaP: ['Cobertura das páginas', 'Cliques por página fecham; impressões por página inflam.',
      'A soma de cliques por página deu 100,5% do total do site, praticamente exato. A soma de impressões deu 129,5%, porque quando duas URLs do site aparecem na mesma página de resultado cada uma conta uma impressão. Então impressão por página serve para comparar páginas entre si, nunca para comparar com o total do site.'],
    categoria: ['Categoria da consulta', 'Agrupamento temático das consultas por regra de texto.',
      'A consulta normalizada (sem acento, minúscula) passa por uma lista ordenada de regras e cai na primeira que casa: Marca, NR-01 | PGR | Riscos psicossociais, Saúde mental | Absenteísmo, Afastamento | INSS | CID, FAP | CNAE | eSocial, Reajuste | VCMH | ANS, Plano de saúde empresarial, SST | Ergonomia | NR-17, Produto | Tecnologia, Benefícios | RH, Outros. A ordem importa: regra específica vem antes da genérica, senão "reajuste plano de saúde" cairia em Plano de saúde e a visão de reajuste ficaria vazia. O agregado por categoria usa o universo inteiro de consultas, mesmo quando a tabela está cortada ou filtrada por busca.'],
    marca: ['Marca vs não-marca', 'Separa quem já procurava a Axenya de quem chegou por tema.',
      'É marca a consulta que casa com axenya, axenia, anexya, axeny ou variantes de digitação que aparecem de fato no relatório. É o corte mais importante de SEO: crescimento em marca mede reconhecimento e mídia, crescimento em não-marca mede conteúdo e ranqueamento. Somar os dois e comemorar esconde qual dos dois motores está andando.'],
    secao: ['Seção do site', 'Agrupamento das páginas pelo caminho da URL.',
      'Blog é /recursos/blog, Ferramentas é /recursos/ferramentas, Home é a raiz, e assim por diante. Serve para ver se o movimento é do blog, da home ou de uma landing, sem precisar ler URL por URL.'],
    oportunidade: ['Oportunidade', 'Consultas com impressão alta, zero clique e posição pior que 5.',
      'Critério: pelo menos 100 impressões na janela atual, nenhum clique e posição média acima de 5. É o padrão clássico de "aparece mas não convence": título e meta description errados, ou intenção de busca diferente do conteúdo da página. Não é problema de indexação, porque a impressão prova que o Google já mostra a página.'],
    cortes: ['Dispositivo e país', 'De onde vem o clique.',
      'Mesma lógica de movimentação aplicada às dimensões device e country do Search Console. País vem em código ISO de 3 letras (bra, usa). Serve principalmente para detectar tráfego internacional irrelevante inflando impressão.'],
    busca: ['Busca', 'Filtra por texto na visão atual.',
      'A busca filtra localmente as linhas já carregadas. Quando a janela tem mais entidades do que o payload carrega (o corte é declarado embaixo da tabela), o botão de buscar no servidor refaz a consulta filtrando no conjunto COMPLETO da janela, para que um termo fora do corte ainda possa ser encontrado.']
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
    var keys = Object.keys(CALC_HELP), html = '', i;
    for (i = 0; i < keys.length; i += 1) {
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

  // ── filtros de topo ----------------------------------------------------
  function renderFilters() {
    var d = state.data;
    var bases = (d && d.basesDisponiveis) || [
      { base: 'dod', label: 'DoD | dia' }, { base: 'wow', label: 'WoW | semana' },
      { base: 'mom', label: 'MoM | mês' }, { base: 'qoq', label: 'QoQ | trimestre' },
      { base: 'yoy', label: 'YoY | ano' }
    ];
    var chips = '', i;
    for (i = 0; i < bases.length; i += 1) {
      chips += '<button type="button" class="period-chip' + (state.base === bases[i].base ? ' active' : '')
        + '" data-base="' + esc(bases[i].base) + '" data-hover-title="' + esc(bases[i].label)
        + '" data-hover-text="' + esc(bases[i].desc || 'Trocar a base de comparação recarrega a movimentação por consulta e página.')
        + '">' + esc(bases[i].label) + '</button>';
    }
    var ancora = (d && d.frescor && d.frescor.ultimoFechado) || '';
    $('filters').innerHTML =
      '<div class="periodbar"><span class="period-label">Comparar</span>' + chips
      + '<span class="period-help">janela ancorada no último dia fechado do Search Console</span></div>'
      + '<div class="filter"><label>Âncora | último dia da janela</label><input type="date" id="f-end" value="' + esc(state.end || ancora) + '" max="' + esc(ancora) + '"></div>'
      + '<div class="filter"><label>Granularidade da linha do tempo</label><select id="f-gran">'
      + '<option value="dia"' + (state.gran === 'dia' ? ' selected' : '') + '>Dia</option>'
      + '<option value="semana"' + (state.gran === 'semana' ? ' selected' : '') + '>Semana</option>'
      + '<option value="mes"' + (state.gran === 'mes' ? ' selected' : '') + '>Mês</option>'
      + '<option value="trimestre"' + (state.gran === 'trimestre' ? ' selected' : '') + '>Trimestre</option>'
      + '</select></div>'
      + '<div class="filter"><label>Busca no servidor</label><input type="search" id="f-q" placeholder="termo em toda a janela" value="' + esc(state.buscaServidor) + '"></div>'
      + '<div class="filter filter-actions"><button class="btn primary" id="f-apply">Aplicar</button>'
      + '<button class="btn" id="f-refresh" data-hover-title="Ignorar cache" data-hover-text="Força nova leitura na API do Search Console.">Sem cache</button></div>';

    var bs = $('filters').querySelectorAll('[data-base]');
    for (i = 0; i < bs.length; i += 1) {
      bs[i].onclick = function () {
        state.base = this.getAttribute('data-base');
        load(false);
      };
    }
    $('f-apply').onclick = function () {
      state.end = $('f-end').value || '';
      state.gran = $('f-gran').value;
      state.buscaServidor = $('f-q').value || '';
      load(false);
    };
    $('f-refresh').onclick = function () { load(true); };
    $('f-gran').onchange = function () {
      state.gran = this.value;
      if (state.data) renderAll();
    };
    $('f-q').onkeydown = function (ev) {
      if (ev.key === 'Enter' || ev.keyCode === 13) {
        state.buscaServidor = this.value || '';
        load(false);
      }
    };
  }

  // ── strip de comparações ----------------------------------------------
  function renderComparacoes() {
    var d = state.data, html = '', i;
    var ordem = ['dod', 'wow', 'mom', 'qoq', 'yoy'];
    for (i = 0; i < ordem.length; i += 1) {
      var r = d.resumo[ordem[i]];
      if (!r) continue;
      var dc = r.delta.clicks, dp = r.delta.clicksPct;
      html += '<div class="cmp-card' + (state.base === ordem[i] ? ' active' : '') + '" data-cmp="' + esc(ordem[i]) + '"'
        + ' data-hover-title="' + esc(r.label) + '"'
        + ' data-hover-text="' + esc(r.janelas.atual.from + ' a ' + r.janelas.atual.to + ' contra ' + r.janelas.anterior.from + ' a ' + r.janelas.anterior.to + ' | ' + r.desc + ' | clique para usar esta base na movimentação')
        + '">'
        + '<div class="cmp-lbl">' + esc(r.label) + '</div>'
        + '<div class="cmp-val ' + cls(dc) + '">' + arrow(dc) + sigPct(dp) + '</div>'
        + '<div class="cmp-sub">' + num(r.atual.clicks) + ' vs ' + num(r.anterior.clicks) + ' cliques | ' + sig(dc)
        + (r.janelaCompleta ? '' : ' | janela incompleta') + '</div>'
        + '</div>';
    }
    return '<div class="cmp-grid">' + html + '</div>';
  }

  // ── KPIs ---------------------------------------------------------------
  function kpiCard(label, valor, delta, sub, helpKey, drill, inverso) {
    return '<div class="kpi hero clickable teal" data-drill="' + esc(drill) + '"'
      + ' data-hover-title="' + esc(label) + '" data-hover-text="Clique para abrir a comparação das duas janelas.">'
      + '<div class="label">' + esc(label) + infoBtn(helpKey) + '</div>'
      + '<div class="value">' + valor + '</div>'
      + '<div class="sub"><span class="delta ' + cls(delta, inverso) + '">' + arrow(delta, inverso) + esc(sub) + '</span></div>'
      + '</div>';
  }

  function renderKpis() {
    var r = state.data.resumo[state.base];
    var a = r.atual, p = r.anterior, dl = r.delta;
    return '<div class="kpis kpis-hero k4">'
      + kpiCard('Cliques', num(a.clicks), dl.clicks, sig(dl.clicks) + ' | ' + sigPct(dl.clicksPct) + ' vs ' + num(p.clicks), 'kpis', 'clicks', false)
      + kpiCard('Impressões', num(a.impressions), dl.impressions, sig(dl.impressions) + ' | ' + sigPct(dl.impressionsPct) + ' vs ' + num(p.impressions), 'kpis', 'impressions', false)
      + kpiCard('CTR', pct(a.ctr, 2), dl.ctr, (dl.ctr > 0 ? '+' : '') + (dl.ctr * 100).toFixed(2).replace('.', ',') + ' p.p. vs ' + pct(p.ctr, 2), 'kpis', 'ctr', false)
      + kpiCard('Posição média', pos(a.position), dl.position, posd(dl.position) + ' vs ' + pos(p.position) + ' | menor é melhor', 'posicao', 'position', true)
      + '</div>';
  }

  // ── linha do tempo -----------------------------------------------------
  function serieAtual() {
    var s = state.data.timeline[state.gran] || [];
    if (state.gran === 'dia') return s.slice(-91);
    if (state.gran === 'semana') return s.slice(-52);
    return s;
  }

  function renderTimeline() {
    var serie = serieAtual();
    if (!serie.length) {
      return '<div class="card span-12"><div class="card-title"><div><h2>Linha do tempo</h2></div>' + infoBtn('timeline')
        + '</div><div class="muted">Sem dias fechados na série.</div></div>';
    }
    var W = 1000, H = 280, padL = 56, padR = 44, padB = 34, padT = 14;
    var innerW = W - padL - padR, innerH = H - padT - padB;
    var maxC = 0, minP = 99, maxP = 0, i;
    for (i = 0; i < serie.length; i += 1) {
      if (serie[i].clicks > maxC) maxC = serie[i].clicks;
      if (serie[i].position > 0) {
        if (serie[i].position < minP) minP = serie[i].position;
        if (serie[i].position > maxP) maxP = serie[i].position;
      }
    }
    if (maxC <= 0) maxC = 1;
    if (minP > maxP) { minP = 0; maxP = 10; }
    var spanP = Math.max(1, maxP - minP);
    // Eixo de posição INVERTIDO: posição menor (melhor) fica no alto.
    function yPos(v) { return padT + ((v - minP) / spanP) * innerH; }

    var slot = innerW / serie.length;
    var bw = Math.max(2, Math.min(38, slot * 0.66));
    var svg = '<svg class="seo-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Cliques e posição média por período">';
    var g;
    for (g = 0; g <= 4; g += 1) {
      var gy = padT + innerH - (innerH * g / 4);
      svg += '<line class="axis" x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '"/>';
      svg += '<text x="' + (padL - 6) + '" y="' + (gy + 3) + '" text-anchor="end">' + esc(num(Math.round(maxC * g / 4))) + '</text>';
      svg += '<text x="' + (W - padR + 6) + '" y="' + (padT + innerH * g / 4 + 3) + '" text-anchor="start">' + pos(minP + spanP * g / 4) + '</text>';
    }
    var pts = [], mms = [];
    var mmAcc = [];
    for (i = 0; i < serie.length; i += 1) {
      var b = serie[i];
      var cx = padL + slot * i + slot / 2;
      var h = innerH * (b.clicks / maxC);
      var cl = 'bar' + (state.gran === 'dia' && b.fds ? ' fds' : '') + (b.parcial ? ' parcial' : '');
      var hint = bucketLabel(b) + ' | ' + num(b.clicks) + ' cliques | ' + num(b.impressions) + ' impressões | CTR ' + pct(b.ctr, 2)
        + ' | posição ' + pos(b.position) + (b.parcial ? ' | bucket PARCIAL, sem variação' : (b.dc == null ? '' : ' | ' + sig(b.dc) + ' vs período anterior'));
      svg += '<rect class="' + cl + '" data-bucket="' + esc(b.key) + '" x="' + (cx - bw / 2).toFixed(1) + '" y="' + (padT + innerH - h).toFixed(1)
        + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, h).toFixed(1) + '" rx="2"'
        + ' data-hover-title="' + esc(bucketLabel(b)) + '" data-hover-text="' + esc(hint) + '"></rect>';
      if (b.position > 0) pts.push(cx.toFixed(1) + ',' + yPos(b.position).toFixed(1));
      if (state.gran === 'dia') {
        mmAcc.push(b.clicks);
        if (mmAcc.length > 7) mmAcc.shift();
        var soma = 0, k;
        for (k = 0; k < mmAcc.length; k += 1) soma += mmAcc[k];
        var mm = soma / mmAcc.length;
        mms.push(cx.toFixed(1) + ',' + (padT + innerH - innerH * (mm / maxC)).toFixed(1));
      }
      if (serie.length <= 24 || i % Math.ceil(serie.length / 14) === 0) {
        svg += '<text x="' + cx.toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle">' + esc(bucketLabel(b)) + '</text>';
      }
    }
    if (mms.length > 1) svg += '<polyline class="mm-ln" points="' + mms.join(' ') + '"/>';
    if (pts.length > 1) svg += '<polyline class="pos-ln" points="' + pts.join(' ') + '"/>';
    svg += '</svg>';

    var legenda = '<div class="line-legend"><span><i class="clicks"></i>Cliques</span>'
      + (state.gran === 'dia' ? '<span><i class="fds"></i>Fim de semana</span><span><i class="mm"></i>Média móvel 7 dias</span>' : '')
      + '<span><i class="pos"></i>Posição média | eixo direito invertido, mais alto é melhor</span></div>';

    var gran = '<div class="granbar">'
      + granBtn('dia', 'Dia') + granBtn('semana', 'Semana') + granBtn('mes', 'Mês') + granBtn('trimestre', 'Trimestre')
      + '</div>';

    return '<div class="card span-12"><div class="card-title"><div><h2>Linha do tempo | cliques e posição</h2>'
      + '<div class="desc">' + esc(serie.length + ' períodos | ' + ptDate(serie[0].from || serie[0].key) + ' a ' + ptDate(serie[serie.length - 1].to || serie[serie.length - 1].key))
      + ' | clique numa barra para abrir o detalhe do período</div></div>' + infoBtn('timeline') + '</div>'
      + gran + legenda + svg + '</div>';
  }

  function granBtn(k, label) {
    return '<button type="button" data-gran="' + k + '" class="' + (state.gran === k ? 'active' : '') + '">' + esc(label) + '</button>';
  }

  // ── visões -------------------------------------------------------------
  var VIEWS = [
    { key: 'consultas', label: 'Consultas', help: 'movimento' },
    { key: 'paginas', label: 'Páginas', help: 'movimento' },
    { key: 'categorias', label: 'Categorias', help: 'categoria' },
    { key: 'marca', label: 'Marca vs não-marca', help: 'marca' },
    { key: 'secoes', label: 'Seções', help: 'secao' },
    { key: 'oportunidades', label: 'Oportunidades', help: 'oportunidade' },
    { key: 'dispositivos', label: 'Dispositivo', help: 'cortes' },
    { key: 'paises', label: 'País', help: 'cortes' }
  ];

  /** Achata rollup (categoria/seção/marca) no MESMO formato das linhas compactas. */
  function flatRollup(r) {
    return {
      k: r.k, itens: r.itens,
      c: r.atual.clicks, c0: r.anterior.clicks,
      i: r.atual.impressions, i0: r.anterior.impressions,
      p: r.atual.position, p0: r.anterior.position,
      dc: r.delta.clicks, di: r.delta.impressions, dp: r.delta.position,
      st: r.st
    };
  }

  function rowsOf(view) {
    var m = state.data.movimentos, c = state.data.cortes, i, out;
    if (view === 'consultas') return m.consultas;
    if (view === 'paginas') return m.paginas;
    if (view === 'oportunidades') return m.oportunidades;
    if (view === 'dispositivos') return c.dispositivos;
    if (view === 'paises') return c.paises;
    var src = view === 'categorias' ? m.categorias : (view === 'marca' ? m.marca : m.secoes);
    out = [];
    for (i = 0; i < src.length; i += 1) out.push(flatRollup(src[i]));
    return out;
  }

  var STATUS_LABEL = { novo: 'Novo', perdido: 'Perdido', subiu: 'Subiu', caiu: 'Caiu', estavel: 'Estável' };
  var STATUS_PILL = { novo: 'teal', perdido: 'bad', subiu: 'good', caiu: 'warn', estavel: '' };

  function aplicaFiltros(rows) {
    var f = state.filtros, out = [], i, r;
    var termo = state.busca ? state.busca.toLowerCase() : '';
    for (i = 0; i < rows.length; i += 1) {
      r = rows[i];
      if (f.status !== 'todos' && r.st !== f.status) continue;
      if (f.categoria !== 'todas' && r.cat !== f.categoria) continue;
      if (f.minImp > 0 && Math.max(r.i || 0, r.i0 || 0) < f.minImp) continue;
      if (termo) {
        var alvo = String(r.k || '') + ' ' + String(r.rot || '') + ' ' + String(r.cat || '') + ' ' + String(r.sec || '');
        if (alvo.toLowerCase().indexOf(termo) < 0) continue;
      }
      out.push(r);
    }
    return out;
  }

  var COLS = {
    entidade: [
      { key: 'k', label: 'Consulta', tipo: 'texto', w: '30%' },
      { key: 'cat', label: 'Categoria', tipo: 'texto' },
      { key: 'c', label: 'Cliques', tipo: 'num' },
      { key: 'c0', label: 'Antes', tipo: 'num' },
      { key: 'dc', label: 'Δ cliques', tipo: 'delta' },
      { key: 'i', label: 'Impressões', tipo: 'num' },
      { key: 'di', label: 'Δ impr.', tipo: 'delta' },
      { key: 'ctr', label: 'CTR', tipo: 'ctr' },
      { key: 'p', label: 'Posição', tipo: 'pos' },
      { key: 'dp', label: 'Δ posição', tipo: 'deltaPos' },
      { key: 'st', label: 'Status', tipo: 'status' }
    ],
    paginas: [
      { key: 'rot', label: 'Página', tipo: 'texto', w: '34%' },
      { key: 'sec', label: 'Seção', tipo: 'texto' },
      { key: 'c', label: 'Cliques', tipo: 'num' },
      { key: 'c0', label: 'Antes', tipo: 'num' },
      { key: 'dc', label: 'Δ cliques', tipo: 'delta' },
      { key: 'i', label: 'Impressões', tipo: 'num' },
      { key: 'di', label: 'Δ impr.', tipo: 'delta' },
      { key: 'ctr', label: 'CTR', tipo: 'ctr' },
      { key: 'p', label: 'Posição', tipo: 'pos' },
      { key: 'dp', label: 'Δ posição', tipo: 'deltaPos' },
      { key: 'st', label: 'Status', tipo: 'status' }
    ],
    grupo: [
      { key: 'k', label: 'Grupo', tipo: 'texto', w: '26%' },
      { key: 'itens', label: 'Itens', tipo: 'num' },
      { key: 'c', label: 'Cliques', tipo: 'num' },
      { key: 'c0', label: 'Antes', tipo: 'num' },
      { key: 'dc', label: 'Δ cliques', tipo: 'delta' },
      { key: 'i', label: 'Impressões', tipo: 'num' },
      { key: 'di', label: 'Δ impr.', tipo: 'delta' },
      { key: 'ctr', label: 'CTR', tipo: 'ctr' },
      { key: 'p', label: 'Posição', tipo: 'pos' },
      { key: 'dp', label: 'Δ posição', tipo: 'deltaPos' }
    ],
    simples: [
      { key: 'k', label: 'Chave', tipo: 'texto', w: '26%' },
      { key: 'c', label: 'Cliques', tipo: 'num' },
      { key: 'c0', label: 'Antes', tipo: 'num' },
      { key: 'dc', label: 'Δ cliques', tipo: 'delta' },
      { key: 'i', label: 'Impressões', tipo: 'num' },
      { key: 'di', label: 'Δ impr.', tipo: 'delta' },
      { key: 'ctr', label: 'CTR', tipo: 'ctr' },
      { key: 'p', label: 'Posição', tipo: 'pos' },
      { key: 'dp', label: 'Δ posição', tipo: 'deltaPos' },
      { key: 'st', label: 'Status', tipo: 'status' }
    ],
    oportunidade: [
      { key: 'k', label: 'Consulta', tipo: 'texto', w: '38%' },
      { key: 'cat', label: 'Categoria', tipo: 'texto' },
      { key: 'i', label: 'Impressões', tipo: 'num' },
      { key: 'i0', label: 'Antes', tipo: 'num' },
      { key: 'di', label: 'Δ impr.', tipo: 'delta' },
      { key: 'p', label: 'Posição', tipo: 'pos' },
      { key: 'dp', label: 'Δ posição', tipo: 'deltaPos' }
    ]
  };

  function colsOf(view) {
    if (view === 'consultas') return COLS.entidade;
    if (view === 'paginas') return COLS.paginas;
    if (view === 'oportunidades') return COLS.oportunidade;
    if (view === 'categorias' || view === 'secoes' || view === 'marca') return COLS.grupo;
    return COLS.simples;
  }

  function defaultSort(view) {
    if (view === 'oportunidades') return { key: 'i', dir: 'desc' };
    if (view === 'categorias' || view === 'secoes' || view === 'marca') return { key: 'c', dir: 'desc' };
    return { key: 'dc', dir: 'abs' };
  }

  function valorDe(r, col) {
    if (col.tipo === 'ctr') return (r.i > 0 ? r.c / r.i : 0);
    if (col.key === 'k' && r.rot) return r.rot;
    return r[col.key];
  }

  function ordena(rows, cols) {
    var s = state.sort || defaultSort(state.view);
    var col = null, i;
    for (i = 0; i < cols.length; i += 1) if (cols[i].key === s.key) col = cols[i];
    if (!col) col = cols[0];
    var textual = col.tipo === 'texto' || col.tipo === 'status';
    var arr = rows.slice();
    arr.sort(function (a, b) {
      var va = valorDe(a, col), vb = valorDe(b, col);
      if (textual) {
        va = String(va == null ? '' : va).toLowerCase();
        vb = String(vb == null ? '' : vb).toLowerCase();
        if (va === vb) return 0;
        return (va < vb ? -1 : 1) * (s.dir === 'asc' ? 1 : -1);
      }
      va = Number(va) || 0; vb = Number(vb) || 0;
      if (s.dir === 'abs') return Math.abs(vb) - Math.abs(va);
      return s.dir === 'asc' ? va - vb : vb - va;
    });
    return arr;
  }

  function celula(r, col, maxAbs) {
    var v = valorDe(r, col);
    if (col.tipo === 'texto') {
      var txt = String(v == null ? '—' : v);
      var extra = '';
      if (col.key === 'k' && r.mk === 1) extra = ' <span class="pill teal">marca</span>';
      return '<td>' + esc(txt) + extra + '</td>';
    }
    if (col.tipo === 'num') {
      var bar = '';
      if (col.key === 'c' && maxAbs > 0) {
        bar = '<span class="cellbar" style="width:' + Math.min(100, (100 * (Number(v) || 0) / maxAbs)).toFixed(1) + '%"></span>';
      }
      return '<td class="right nowrap">' + esc(num(v)) + bar + '</td>';
    }
    if (col.tipo === 'ctr') return '<td class="right nowrap">' + esc(pct(v, 2)) + '</td>';
    if (col.tipo === 'pos') return '<td class="right nowrap">' + esc(pos(v)) + '</td>';
    if (col.tipo === 'delta') {
      return '<td class="right nowrap"><span class="delta ' + cls(v) + '">' + arrow(v) + esc(sig(v)) + '</span></td>';
    }
    if (col.tipo === 'deltaPos') {
      if (v == null || Number(v) === 0 || !r.p || !r.p0) return '<td class="right muted">—</td>';
      return '<td class="right nowrap"><span class="delta ' + cls(v, true) + '">' + arrow(v, true) + esc(posd(Math.abs(v))) + '</span></td>';
    }
    if (col.tipo === 'status') {
      var st = String(v || '');
      return '<td><span class="pill ' + (STATUS_PILL[st] || '') + '">' + esc(STATUS_LABEL[st] || st || '—') + '</span></td>';
    }
    return '<td>' + esc(String(v == null ? '—' : v)) + '</td>';
  }

  function renderView() {
    var view = state.view;
    var cols = colsOf(view);
    var todas = rowsOf(view);
    var rows = ordena(aplicaFiltros(todas), cols);
    var s = state.sort || defaultSort(view);

    var tabs = '', i;
    for (i = 0; i < VIEWS.length; i += 1) {
      var n = rowsOf(VIEWS[i].key).length;
      tabs += '<button type="button" data-view="' + VIEWS[i].key + '" class="' + (view === VIEWS[i].key ? 'active' : '') + '"'
        + ' data-hover-title="' + esc(VIEWS[i].label) + '" data-hover-text="Trocar a visão. Ordenação, filtros e busca valem para a visão aberta.">'
        + esc(VIEWS[i].label) + '<span class="cnt">' + n + '</span></button>';
    }

    var cats = {}, catOpts = '<option value="todas">Todas</option>';
    if (view === 'consultas' || view === 'oportunidades') {
      for (i = 0; i < todas.length; i += 1) if (todas[i].cat) cats[todas[i].cat] = true;
      var ks = Object.keys(cats).sort();
      for (i = 0; i < ks.length; i += 1) {
        catOpts += '<option value="' + esc(ks[i]) + '"' + (state.filtros.categoria === ks[i] ? ' selected' : '') + '>' + esc(ks[i]) + '</option>';
      }
    }

    var stOpts = '';
    var stKeys = ['todos', 'novo', 'perdido', 'subiu', 'caiu', 'estavel'];
    for (i = 0; i < stKeys.length; i += 1) {
      stOpts += '<option value="' + stKeys[i] + '"' + (state.filtros.status === stKeys[i] ? ' selected' : '') + '>'
        + (stKeys[i] === 'todos' ? 'Todos' : STATUS_LABEL[stKeys[i]]) + '</option>';
    }
    var impOpts = '';
    var impKeys = [0, 10, 50, 100, 500];
    for (i = 0; i < impKeys.length; i += 1) {
      impOpts += '<option value="' + impKeys[i] + '"' + (state.filtros.minImp === impKeys[i] ? ' selected' : '') + '>'
        + (impKeys[i] === 0 ? 'Sem mínimo' : '≥ ' + impKeys[i]) + '</option>';
    }

    var head = '', maxAbs = 0;
    for (i = 0; i < rows.length; i += 1) if ((rows[i].c || 0) > maxAbs) maxAbs = rows[i].c || 0;
    for (i = 0; i < cols.length; i += 1) {
      var on = cols[i].key === s.key;
      var arw = on ? (s.dir === 'asc' ? '↑' : (s.dir === 'abs' ? '↕' : '↓')) : '↕';
      head += '<th class="sortable' + (on ? ' on' : '') + '" data-sort="' + cols[i].key + '"'
        + (cols[i].w ? ' style="width:' + cols[i].w + '"' : '')
        + ' data-hover-title="Ordenar por ' + esc(cols[i].label) + '"'
        + ' data-hover-text="Clique alterna decrescente, crescente e (nas colunas de variação) maior movimento absoluto.">'
        + esc(cols[i].label) + '<span class="arw">' + arw + '</span></th>';
    }

    var body = '';
    var limite = Math.min(rows.length, 400);
    for (i = 0; i < limite; i += 1) {
      body += '<tr class="clickable-row" data-row="' + esc(rows[i].k) + '">';
      for (var c = 0; c < cols.length; c += 1) body += celula(rows[i], cols[c], maxAbs);
      body += '</tr>';
    }
    if (!rows.length) {
      body = '<tr><td colspan="' + cols.length + '" class="muted">Nenhuma linha com os filtros atuais.</td></tr>';
    }

    var corte = state.data.movimentos.corte;
    var aviso = '';
    if (view === 'consultas' && corte.consultas.enviadas < corte.consultas.total) {
      aviso = '<div class="trunc-note">Mostrando as ' + num(corte.consultas.enviadas) + ' consultas de maior movimento das '
        + num(corte.consultas.total) + ' da janela. Para achar um termo fora desse corte, use a busca no servidor no filtro do topo.</div>';
    }
    if (rows.length > limite) {
      aviso += '<div class="trunc-note">Tabela renderiza ' + limite + ' linhas de ' + num(rows.length)
        + ' filtradas. Ordene ou filtre para trazer o que interessa para cima; o CSV exporta todas as ' + num(rows.length) + '.</div>';
    }

    var vhelp = null;
    for (i = 0; i < VIEWS.length; i += 1) if (VIEWS[i].key === view) vhelp = VIEWS[i].help;

    return '<div class="card span-12"><div class="card-title"><div><h2>Movimentação | ' + esc(nomeView(view)) + '</h2>'
      + '<div class="desc">' + esc(state.data.janelas.atual.from + ' a ' + state.data.janelas.atual.to + ' contra '
        + state.data.janelas.anterior.from + ' a ' + state.data.janelas.anterior.to)
      + ' | ' + num(rows.length) + ' linhas | clique numa linha para o detalhe</div></div>' + infoBtn(vhelp || 'movimento') + '</div>'
      + '<div class="tabbar">' + tabs + '</div>'
      + '<div class="viewbar">'
      + '<div class="filter"><label>Busca nesta visão' + infoBtn('busca') + '</label><input type="search" id="v-busca" placeholder="filtra as linhas carregadas" value="' + esc(state.busca) + '"></div>'
      + '<div class="filter"><label>Status</label><select id="v-status">' + stOpts + '</select></div>'
      + '<div class="filter"><label>Categoria</label><select id="v-cat"' + (view === 'consultas' || view === 'oportunidades' ? '' : ' disabled') + '>' + catOpts + '</select></div>'
      + '<div class="filter"><label>Mín. de impressões</label><select id="v-imp">' + impOpts + '</select></div>'
      + '<div class="filter filter-actions"><button class="btn" id="v-clear">Limpar</button></div>'
      + '</div>'
      + '<div class="table-wrap"><table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>'
      + aviso + '</div>';
  }

  function nomeView(v) {
    var i;
    for (i = 0; i < VIEWS.length; i += 1) if (VIEWS[i].key === v) return VIEWS[i].label;
    return v;
  }

  // ── cobertura e higiene ------------------------------------------------
  function renderCobertura() {
    var cb = state.data.cobertura, f = state.data.frescor;
    function item(label, valor, klass) {
      return '<div class="cov-item"><span class="cov-label">' + esc(label) + '</span><span class="cov-value ' + (klass || '') + '">' + valor + '</span></div>';
    }
    var pc = cb.consultas.pctClicks;
    return '<div class="card span-12"><div class="card-title"><div><h2>Cobertura e frescor do dado</h2>'
      + '<div class="desc">o que a tabela consegue explicar do site, e até quando o Google já fechou o dado</div></div>'
      + infoBtn('coberturaQ') + '</div><div class="cov-grid">'
      + item('Último dia fechado', ptDate(f.ultimoFechado))
      + item('Defasagem', (f.defasagemDias == null ? '—' : f.defasagemDias + ' dias'), f.defasagemDias > 3 ? 'warn' : 'good')
      + item('Dias parciais depois', num(f.diasParciais) + ' descartados')
      + item('Consultas | % dos cliques', pct(pc, 1), pc != null && pc < 0.4 ? 'warn' : '')
      + item('Consultas | % das impressões', pct(cb.consultas.pctImpressions, 1))
      + item('Páginas | % dos cliques', pct(cb.paginas.pctClicks, 1), 'good')
      + item('Páginas | % das impressões', pct(cb.paginas.pctImpressions, 1), cb.paginas.pctImpressions > 1.1 ? 'warn' : '')
      + item('Propriedade', esc(state.data.site))
      + '</div></div>';
  }

  function renderHigiene() {
    var av = state.data.higiene || [];
    if (!av.length) return '';
    var html = '', i;
    for (i = 0; i < av.length; i += 1) {
      html += '<div class="alert-row' + (av[i].nivel === 'alto' ? ' alto' : '') + '"><span class="alert-tag">'
        + esc(av[i].nivel) + '</span><div><b>' + esc(av[i].titulo) + '</b><span>' + esc(av[i].detalhe) + '</span></div></div>';
    }
    return '<div class="card span-12"><div class="card-title"><div><h2>Higiene | onde o número não fecha e por quê</h2>'
      + '<div class="desc">avisos calculados sobre a janela atual, não texto fixo</div></div>' + infoBtn('coberturaP') + '</div>'
      + '<div class="alert-list">' + html + '</div></div>';
  }

  function renderBigIdea() {
    var d = state.data, r = d.resumo[state.base];
    var m = d.movimentos.marca, i, marca = null, naoMarca = null;
    for (i = 0; i < m.length; i += 1) {
      if (m[i].k === 'Marca') marca = m[i];
      if (m[i].k === 'Não-marca') naoMarca = m[i];
    }
    var topCat = d.movimentos.categorias.length ? d.movimentos.categorias[0] : null;
    var txt = 'Na janela de ' + r.label + ' o site fez <strong>' + num(r.atual.clicks) + ' cliques</strong> ('
      + sigPct(r.delta.clicksPct) + ' vs ' + num(r.anterior.clicks) + ') com posição média <strong>' + pos(r.atual.position) + '</strong>.';
    var acao = '';
    if (marca && naoMarca) {
      acao = 'Marca ' + sig(marca.delta.clicks) + ' cliques | não-marca ' + sig(naoMarca.delta.clicks)
        + '. ' + (topCat ? 'Maior categoria: ' + topCat.k + ' com ' + num(topCat.atual.clicks) + ' cliques (' + sig(topCat.delta.clicks) + ').' : '');
    }
    return '<div class="big-idea"><div class="big-idea-text">' + txt + '</div><div class="big-idea-action">' + esc(acao) + '</div></div>';
  }

  // ── drilldowns ---------------------------------------------------------
  function drillKpi(metrica) {
    var r = state.data.resumo[state.base];
    var campo = { clicks: 'clicks', impressions: 'impressions', ctr: 'ctr', position: 'position' }[metrica] || 'clicks';
    var fmt = campo === 'ctr' ? function (v) { return pct(v, 2); } : (campo === 'position' ? pos : num);
    var titulos = { clicks: 'Cliques', impressions: 'Impressões', ctr: 'CTR', position: 'Posição média' };

    var rows = state.data.movimentos.consultas.slice(0, 25), html = '', i;
    for (i = 0; i < rows.length; i += 1) {
      html += '<tr><td>' + esc(rows[i].k) + '</td><td>' + esc(rows[i].cat || '—') + '</td>'
        + '<td class="right">' + num(rows[i].c) + '</td><td class="right">' + num(rows[i].c0) + '</td>'
        + '<td class="right"><span class="delta ' + cls(rows[i].dc) + '">' + sig(rows[i].dc) + '</span></td>'
        + '<td class="right">' + pos(rows[i].p) + '</td></tr>';
    }

    openModal(titulos[campo] + ' | ' + r.label,
      '<div class="modal-kpis">'
      + '<div class="modal-kpi"><span>Janela atual</span><b>' + fmt(r.atual[campo]) + '</b>' + esc(r.janelas.atual.from + ' a ' + r.janelas.atual.to) + '</div>'
      + '<div class="modal-kpi"><span>Janela anterior</span><b>' + fmt(r.anterior[campo]) + '</b>' + esc(r.janelas.anterior.from + ' a ' + r.janelas.anterior.to) + '</div>'
      + '<div class="modal-kpi"><span>Variação</span><b class="' + cls(r.delta[campo], campo === 'position') + '">'
      + (campo === 'position' ? posd(r.delta.position) : sig(r.delta[campo])) + '</b>'
      + (campo === 'clicks' || campo === 'impressions' ? sigPct(r.delta[campo + 'Pct']) : '') + '</div>'
      + '<div class="modal-kpi"><span>Dias por janela</span><b>' + r.janelas.atual.dias + '</b>' + (r.janelaCompleta ? 'janela completa' : 'janela incompleta') + '</div>'
      + '</div>'
      + (r.mesmoDiaSemanaAnterior ? '<div class="note" style="margin-bottom:.8rem"><b>Referência honesta para DoD:</b> o mesmo dia da semana 7 dias antes fez '
        + num(r.mesmoDiaSemanaAnterior.clicks) + ' cliques. Comparar um dia com o dia anterior mistura dia útil com fim de semana, que nesta propriedade difere quase 4x.</div>' : '')
      + '<h3 style="font-size:.85rem;margin:.4rem 0 .5rem">Consultas que mais mexeram na janela</h3>'
      + '<div class="table-wrap"><table><thead><tr><th>Consulta</th><th>Categoria</th><th class="right">Cliques</th><th class="right">Antes</th><th class="right">Δ</th><th class="right">Posição</th></tr></thead><tbody>'
      + (html || '<tr><td colspan="6" class="muted">Sem consultas nomeadas na janela.</td></tr>') + '</tbody></table></div>');
  }

  function drillBucket(key) {
    var serie = state.data.timeline[state.gran] || [], b = null, i;
    for (i = 0; i < serie.length; i += 1) if (serie[i].key === key) b = serie[i];
    if (!b) return;
    var dias = state.data.timeline.dia, html = '', n = 0;
    var from = b.from || b.key, to = b.to || b.key;
    for (i = 0; i < dias.length; i += 1) {
      var d = dias[i];
      if (d.key < from || d.key > to) continue;
      n += 1;
      html += '<tr><td class="nowrap">' + ptDate(d.key) + (d.fds ? ' <span class="pill">fim de semana</span>' : '') + '</td>'
        + '<td class="right">' + num(d.clicks) + '</td><td class="right">' + num(d.impressions) + '</td>'
        + '<td class="right">' + pct(d.ctr, 2) + '</td><td class="right">' + pos(d.position) + '</td>'
        + '<td class="right"><span class="delta ' + cls(d.dc) + '">' + (d.dc == null ? '—' : sig(d.dc)) + '</span></td></tr>';
    }
    openModal('Período | ' + (b.label || b.key),
      '<div class="modal-kpis">'
      + '<div class="modal-kpi"><span>Cliques</span><b>' + num(b.clicks) + '</b>' + (b.dc == null ? (b.parcial ? 'bucket parcial | sem variação' : 'sem período anterior') : sig(b.dc) + ' vs anterior') + '</div>'
      + '<div class="modal-kpi"><span>Impressões</span><b>' + num(b.impressions) + '</b>CTR ' + pct(b.ctr, 2) + '</div>'
      + '<div class="modal-kpi"><span>Posição média</span><b>' + pos(b.position) + '</b>' + (b.dp == null ? '—' : posd(b.dp) + ' vs anterior') + '</div>'
      + '<div class="modal-kpi"><span>Dias no bucket</span><b>' + (b.dias || 1) + '</b>' + (b.parcial ? 'PARCIAL' : 'completo') + '</div>'
      + '</div>'
      + '<div class="table-wrap"><table><thead><tr><th>Dia</th><th class="right">Cliques</th><th class="right">Impressões</th><th class="right">CTR</th><th class="right">Posição</th><th class="right">Δ vs dia anterior</th></tr></thead><tbody>'
      + (html || '<tr><td colspan="6" class="muted">Sem dias fechados neste bucket.</td></tr>') + '</tbody></table></div>');
  }

  function drillRow(chave) {
    var rows = rowsOf(state.view), r = null, i;
    for (i = 0; i < rows.length; i += 1) if (String(rows[i].k) === String(chave)) r = rows[i];
    if (!r) return;

    var extra = '';
    // Grupo (categoria, seção, marca) abre a lista de entidades que o compõem.
    if (state.view === 'categorias' || state.view === 'marca' || state.view === 'secoes') {
      var fonte = state.view === 'secoes' ? state.data.movimentos.paginas : state.data.movimentos.consultas;
      var filtro = state.view === 'secoes'
        ? function (x) { return x.sec === r.k; }
        : (state.view === 'marca' ? function (x) { return (r.k === 'Marca') === (x.mk === 1); } : function (x) { return x.cat === r.k; });
      var lin = '', n = 0;
      for (i = 0; i < fonte.length && n < 60; i += 1) {
        if (!filtro(fonte[i])) continue;
        n += 1;
        lin += '<tr><td>' + esc(fonte[i].rot || fonte[i].k) + '</td><td class="right">' + num(fonte[i].c) + '</td>'
          + '<td class="right">' + num(fonte[i].c0) + '</td>'
          + '<td class="right"><span class="delta ' + cls(fonte[i].dc) + '">' + sig(fonte[i].dc) + '</span></td>'
          + '<td class="right">' + pos(fonte[i].p) + '</td></tr>';
      }
      extra = '<h3 style="font-size:.85rem;margin:.6rem 0 .5rem">' + esc(state.view === 'secoes' ? 'Páginas' : 'Consultas') + ' deste grupo | '
        + num(r.itens) + ' no total, ' + n + ' carregadas</h3>'
        + '<div class="table-wrap"><table><thead><tr><th>' + (state.view === 'secoes' ? 'Página' : 'Consulta')
        + '</th><th class="right">Cliques</th><th class="right">Antes</th><th class="right">Δ</th><th class="right">Posição</th></tr></thead><tbody>'
        + (lin || '<tr><td colspan="5" class="muted">Nenhuma entidade carregada neste grupo.</td></tr>') + '</tbody></table></div>';
    }

    var ctrA = r.i > 0 ? r.c / r.i : 0, ctrB = r.i0 > 0 ? r.c0 / r.i0 : 0;
    openModal((r.rot || r.k) + ' | ' + state.data.resumo[state.base].label,
      '<div class="modal-kpis">'
      + '<div class="modal-kpi"><span>Cliques</span><b>' + num(r.c) + '</b><span class="delta ' + cls(r.dc) + '">' + sig(r.dc) + ' vs ' + num(r.c0) + '</span></div>'
      + '<div class="modal-kpi"><span>Impressões</span><b>' + num(r.i) + '</b><span class="delta ' + cls(r.di) + '">' + sig(r.di) + ' vs ' + num(r.i0) + '</span></div>'
      + '<div class="modal-kpi"><span>CTR</span><b>' + pct(ctrA, 2) + '</b>antes ' + pct(ctrB, 2) + '</div>'
      + '<div class="modal-kpi"><span>Posição</span><b>' + pos(r.p) + '</b><span class="delta ' + cls(r.dp, true) + '">antes ' + pos(r.p0) + ' | menor é melhor</span></div>'
      + '</div>'
      + '<div class="note" style="margin-bottom:.5rem"><b>Status:</b> ' + esc(STATUS_LABEL[r.st] || r.st || '—')
      + (r.cat ? ' | <b>categoria:</b> ' + esc(r.cat) : '') + (r.sec ? ' | <b>seção:</b> ' + esc(r.sec) : '')
      + (r.mk === 1 ? ' | consulta de MARCA' : '') + '</div>' + extra);
  }

  // ── render + eventos ---------------------------------------------------
  function renderAll() {
    var d = state.data;
    $('content').innerHTML = renderBigIdea() + renderComparacoes() + renderKpis()
      + '<div class="grid">' + renderTimeline() + '</div>'
      + '<div class="grid">' + renderView() + '</div>'
      + '<div class="grid">' + renderHigiene() + '</div>'
      + '<div class="grid">' + renderCobertura() + '</div>';

    // Hooks de sincronização do smoke. Nomes distintos dos seletores de botão de
    // propósito: `data-gran` num container já colidiu com `[data-gran="mes"]` dos
    // botões em document order e o teste clicou no elemento errado.
    $('content').setAttribute('data-base-atual', state.base);
    $('content').setAttribute('data-gran-atual', state.gran);
    $('content').setAttribute('data-view-atual', state.view);
    $('content').setAttribute('data-janela', d.janelas.atual.from + '..' + d.janelas.atual.to);

    $('state').classList.add('hidden');
    $('content').classList.remove('hidden');
    wire();
  }

  function wire() {
    var root = $('content'), i, els;

    els = root.querySelectorAll('[data-help]');
    for (i = 0; i < els.length; i += 1) {
      els[i].onclick = function (ev) { ev.stopPropagation(); openHelp(this.getAttribute('data-help')); };
    }
    els = root.querySelectorAll('[data-cmp]');
    for (i = 0; i < els.length; i += 1) {
      els[i].onclick = function () { state.base = this.getAttribute('data-cmp'); load(false); };
    }
    els = root.querySelectorAll('[data-drill]');
    for (i = 0; i < els.length; i += 1) {
      els[i].onclick = function () { drillKpi(this.getAttribute('data-drill')); };
    }
    els = root.querySelectorAll('[data-gran]');
    for (i = 0; i < els.length; i += 1) {
      els[i].onclick = function () { state.gran = this.getAttribute('data-gran'); renderAll(); };
    }
    els = root.querySelectorAll('[data-bucket]');
    for (i = 0; i < els.length; i += 1) {
      els[i].onclick = function () { drillBucket(this.getAttribute('data-bucket')); };
    }
    els = root.querySelectorAll('[data-view]');
    for (i = 0; i < els.length; i += 1) {
      els[i].onclick = function () {
        state.view = this.getAttribute('data-view');
        state.sort = null;
        state.filtros = { status: 'todos', categoria: 'todas', minImp: 0 };
        state.busca = '';
        renderAll();
      };
    }
    els = root.querySelectorAll('[data-sort]');
    for (i = 0; i < els.length; i += 1) {
      els[i].onclick = function () {
        var k = this.getAttribute('data-sort');
        var cur = state.sort || defaultSort(state.view);
        if (cur.key !== k) state.sort = { key: k, dir: 'desc' };
        else if (cur.dir === 'desc') state.sort = { key: k, dir: 'asc' };
        else if (cur.dir === 'asc') state.sort = { key: k, dir: 'abs' };
        else state.sort = { key: k, dir: 'desc' };
        renderAll();
      };
    }
    els = root.querySelectorAll('[data-row]');
    for (i = 0; i < els.length; i += 1) {
      els[i].onclick = function () { drillRow(this.getAttribute('data-row')); };
    }
    if ($('v-busca')) {
      $('v-busca').oninput = function () {
        state.busca = this.value || '';
        renderView_soft();
      };
    }
    if ($('v-status')) $('v-status').onchange = function () { state.filtros.status = this.value; renderAll(); };
    if ($('v-cat')) $('v-cat').onchange = function () { state.filtros.categoria = this.value; renderAll(); };
    if ($('v-imp')) $('v-imp').onchange = function () { state.filtros.minImp = parseInt(this.value, 10) || 0; renderAll(); };
    if ($('v-clear')) {
      $('v-clear').onclick = function () {
        state.busca = '';
        state.filtros = { status: 'todos', categoria: 'todas', minImp: 0 };
        renderAll();
      };
    }
  }

  /** Redesenha só a visão e devolve o foco ao campo de busca (digitação fluida). */
  function renderView_soft() {
    var pos0 = $('v-busca') ? $('v-busca').selectionStart : null;
    renderAll();
    var el = $('v-busca');
    if (el) {
      el.focus();
      try { if (pos0 != null) el.setSelectionRange(pos0, pos0); } catch (e) {}
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
      + '<div style="margin-top:1rem"><button class="btn primary" onclick="SeoPerf.load(true)">Tentar de novo</button></div>';
  }

  // Guarda de sequência: trocar de base dispara nova busca e a resposta ATRASADA
  // da anterior chegava depois, sobrescrevendo a nova. Sem isso o painel mostra
  // uma base e o strip marca outra, de forma intermitente.
  var reqSeq = 0;

  function load(refresh) {
    var mine = ++reqSeq;
    renderFilters();
    showState('Carregando dados', 'Google Search Console | base ' + state.base.toUpperCase()
      + (state.buscaServidor ? ' | busca "' + state.buscaServidor + '"' : ''));
    var url = '/api/seo-performance?base=' + encodeURIComponent(state.base)
      + (state.end ? '&end=' + encodeURIComponent(state.end) : '')
      + (state.buscaServidor ? '&q=' + encodeURIComponent(state.buscaServidor) : '')
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
        if (json.vazio) return showError(json.error || 'O Search Console não devolveu dados para esta propriedade.');
        state.data = json;
        state.base = json.base;
        renderFilters();
        renderAll();
      })
      .catch(function (e) {
        if (mine !== reqSeq) return;
        showError(String(e && e.message || e));
      });
  }

  function exportCsv() {
    if (!state.data) return;
    var cols = colsOf(state.view);
    var rows = ordena(aplicaFiltros(rowsOf(state.view)), cols);
    var head = ['chave', 'rotulo', 'categoria', 'secao', 'marca', 'cliques', 'cliques_anterior', 'delta_cliques',
      'impressoes', 'impressoes_anterior', 'delta_impressoes', 'ctr', 'ctr_anterior', 'posicao', 'posicao_anterior',
      'delta_posicao', 'status', 'itens'];
    var lines = [head.join(';')], i, j;
    for (i = 0; i < rows.length; i += 1) {
      var r = rows[i];
      var vals = [r.k, r.rot || '', r.cat || '', r.sec || '', r.mk === 1 ? 'sim' : '', r.c, r.c0, r.dc,
        r.i, r.i0, r.di, (r.i > 0 ? r.c / r.i : 0), (r.i0 > 0 ? r.c0 / r.i0 : 0), r.p, r.p0, r.dp, r.st || '', r.itens == null ? '' : r.itens];
      for (j = 0; j < vals.length; j += 1) {
        var v = vals[j] == null ? '' : vals[j];
        if (typeof v === 'number') v = String(v).replace('.', ',');
        vals[j] = '"' + String(v).replace(/"/g, '""') + '"';
      }
      lines.push(vals.join(';'));
    }
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'seo_' + state.view + '_' + state.base + '_' + state.data.janelas.atual.from + '_a_' + state.data.janelas.atual.to + '.csv';
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

  window.addEventListener('DOMContentLoaded', function () { load(false); });

  return {
    load: load, openHelp: openHelp, openAllHelp: openAllHelp, closeHelp: closeHelp,
    closeModal: closeModal, toggleTheme: toggleTheme, exportCsv: exportCsv
  };
})();
