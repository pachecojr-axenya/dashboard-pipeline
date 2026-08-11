/**
 * bdr-lead-funnel.js — Funil de Leads no OBJETO CERTO (0-136), via /api/bdr-lead-funnel.
 *
 * Substitui, na prática, o "Funil de Lead Status" que saía de `hs_lead_status` no
 * CONTATO e media ~10% do funil (jul/26: 234 contatos contra 2.302 leads).
 *
 * QUEBRA DE SÉRIE, e ela está na tela e não só no código: o número sobe ~10x porque é
 * outro OBJETO, não porque o time ficou 10x mais produtivo.
 *
 * TRÊS REGRAS DE DESENHO que valem para tudo aqui:
 *
 * 1. MARCA DE ESTADO NUNCA SÓ POR COR — há BDR daltônico no time. Toda seta carrega
 *    símbolo (↑ ↓ ✖ ＋) e PALAVRA, e a cor é redundante, não portadora.
 * 2. O RESÍDUO APARECE. O waterfall macro fecha por aritmética, e o que a aritmética
 *    não explica ganha barra própria em vez de ser diluído nas outras. Waterfall cujas
 *    barras não fecham no saldo é ficção que ninguém confere porque parece plausível.
 * 3. TODO DRILL MOSTRA CRIADO → TRILHA → STATUS ATUAL. Card que mostra só o total é
 *    card que não dá para auditar; a pergunta certa na frente de um número estranho é
 *    "que caminho esse lead fez", e a resposta tem de estar a um clique.
 *
 * Reusa os helpers globais de bdr.html: _novoMkChart, _novoTheme, NOVO_FONT, _ne,
 * openModal, _filterState, _infoBtn, _subTabs, _setActive, ChartDataLabels.
 */
(function () {
  'use strict';

  var D = null, ERR = null, LOADING = false, REQ = 0;
  // Janela com que D foi carregado. Sem isto o paint() re-renderizava o dado velho e o
  // filtro parecia não fazer nada — era o defeito relatado como "preso em agosto".
  var LOADED = null;
  var funil = 'todos';          // todos | principal | diagnostico
  var reguaDim = 'bdr';         // bdr | porte | tier | vidas | origem
  var wfView = 'status';        // status | mov  — "ver pelo status" é o default pedido
  // Ordenação por tabela. dir: 1 asc, -1 desc.
  var sort = {
    wf:    { col: 'saldo_fim', dir: -1 },
    mov:   { col: 'n',         dir: -1 },
    regua: { col: 'n',         dir: -1 },
    leads: { col: 'n_movimentos', dir: -1 }
  };

  var CAN = ['novo', 'tentativa', 'conectado', 'qualificado', 'desqualificado'];
  var ABERTAS = { novo: 1, tentativa: 1, conectado: 1 };
  var COR = {
    novo: 'rgba(88,166,255,.85)',
    tentativa: 'rgba(210,153,34,.85)',
    conectado: 'rgba(58,184,183,.9)',
    qualificado: 'rgba(63,185,80,.85)',
    desqualificado: 'rgba(248,81,73,.75)'
  };
  var C_BOM_T = 'rgba(63,185,80,1)';
  var C_TOTAL = 'rgba(58,184,183,.85)', C_BOM = 'rgba(63,185,80,.85)',
      C_RUIM = 'rgba(248,81,73,.8)', C_NEUTRO = 'rgba(140,140,150,.65)';

  function pt(c) { return (D && D.rotulos && D.rotulos[c]) || c; }
  function esc(v) { return typeof _ne === 'function' ? _ne(v == null ? '' : v) : String(v == null ? '' : v); }
  function ni(v) { return v == null ? '—' : Number(v).toLocaleString('pt-BR'); }
  function fmtBR(s) { var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '/' + m[2] : (s ? String(s) : '—'); }
  function fmtBRfull(s) { var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '/' + m[2] + '/' + m[1] : (s ? String(s) : '—'); }
  function pct(a, b) { return b ? (a / b * 100).toFixed(1).replace('.', ',') + '%' : '—'; }
  function sgn(v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + ni(Math.abs(v)); }

  // Cabeçalho de coluna ordenável. A seta indica a direção ATIVA; coluna inerte não
  // ganha seta, para não sugerir que tudo é clicável quando não é.
  function th(tabela, col, rotulo, align) {
    var s = sort[tabela], on = s.col === col;
    return '<th style="text-align:' + (align || 'right') + ';cursor:pointer;user-select:none;white-space:nowrap"' +
      ' onclick="AxLeadFunnel.sort(\'' + tabela + '\',\'' + col + '\')"' +
      ' title="Ordenar por ' + esc(rotulo.replace(/<[^>]*>/g, ' ')) + '">' +
      rotulo + (on ? ' <span style="color:var(--teal)">' + (s.dir < 0 ? '▼' : '▲') + '</span>' : '<span style="opacity:.25"> ⇅</span>') + '</th>';
  }
  function ordena(arr, tabela, get) {
    var s = sort[tabela];
    return arr.slice().sort(function (a, b) {
      var va = get(a, s.col), vb = get(b, s.col);
      if (typeof va === 'string' || typeof vb === 'string') {
        return String(va).localeCompare(String(vb), 'pt-BR') * s.dir;
      }
      return ((va == null ? -Infinity : va) - (vb == null ? -Infinity : vb)) * s.dir;
    });
  }
  function doSort(tabela, col) {
    var s = sort[tabela];
    if (s.col === col) s.dir = -s.dir; else { s.col = col; s.dir = -1; }
    if (tabela === 'wf' || tabela === 'mov') waterfallTabela();
    else if (tabela === 'regua') tabelaRegua();
    else if (tabela === 'leads') { if (window._lfLastDrill) window._lfLastDrill(); }
  }

  // ── carga ──────────────────────────────────────────────────────────────────────
  // A JANELA É UNIVERSAL: sai do filtro global da página, e "Tudo" (start/end nulos)
  // vira `tudo=1` para o servidor usar como piso a data do primeiro lead — antes o
  // default caía no mês corrente e a seção ficava PRESA EM AGOSTO sem dizer que estava.
  function janelaAtual() {
    var st = (typeof _filterState === 'function') ? _filterState() : {};
    var hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
    if (!st.start && !st.end) return { tudo: true, until: hoje, label: st.label || 'Tudo' };
    var until = st.end || hoje;
    return { tudo: false, since: st.start || (until.slice(0, 8) + '01'), until: until, label: st.label || null };
  }
  function chaveJanela() {
    var j = janelaAtual();
    return funil + '|' + (j.tudo ? 'tudo' : j.since) + '|' + j.until;
  }

  function load(force) {
    var j = janelaAtual();
    var qs = j.tudo ? 'tudo=1&until=' + j.until : 'since=' + j.since + '&until=' + j.until;
    var url = '/api/bdr-lead-funnel?funil=' + funil + '&' + qs + (force ? '&refresh=1' : '');
    var chave = chaveJanela();
    var myReq = ++REQ;
    LOADING = true; ERR = null;
    fetch(url, { credentials: 'include' })
      .then(function (r) { if (!r.ok) return r.text().then(function (t) { throw new Error(t || ('HTTP ' + r.status)); }); return r.json(); })
      .then(function (d) {
        if (myReq !== REQ) return;
        LOADING = false;
        if (!d || !d.success) throw new Error((d && d.error) || 'resposta inválida');
        D = d; LOADED = chave; paint();
      })
      .catch(function (e) {
        if (myReq !== REQ) return;
        LOADING = false; ERR = String(e && e.message || e); LOADED = chave; paint();
      });
  }

  function switchFunil(f) { funil = f; if (typeof _setActive === 'function') _setActive('lf-funil-tabs', f); D = null; LOADED = null; paint(); }
  function switchDim(m) { reguaDim = m; if (typeof _setActive === 'function') _setActive('lf-dim-tabs', m); tabelaRegua(); }
  function switchWf(v) { wfView = v; if (typeof _setActive === 'function') _setActive('lf-wf-tabs', v); waterfallTabela(); }

  // ── HTML da seção ──────────────────────────────────────────────────────────────
  function sectionHtml() {
    var hdr = '<div class="section-hdr"><h2>Funil de Leads | objeto Leads do HubSpot</h2></div>';

    var aviso = '<div class="novo-card" style="grid-column:1/-1;border-left:3px solid var(--teal);padding:.7rem .9rem">' +
      '<div style="font-size:.74rem;color:var(--text2);line-height:1.5">' +
      '<strong style="color:var(--text)">Quebra de série declarada.</strong> Esta seção lê o <strong>objeto Leads</strong> (0-136). ' +
      'O funil antigo lia <code>hs_lead_status</code> no contato e via ~10% do movimento — em jul/26, 234 contatos contra 2.302 leads. ' +
      'O número sobe ~10x porque é outro objeto, <strong>não</strong> porque o time ficou 10x mais produtivo. ' +
      'Comparação com print anterior a 11/08/2026 é inválida.' +
      '</div></div>';

    var tabsFunil = (typeof _subTabs === 'function') ? _subTabs('lf-funil-tabs', funil, [
      { mode: 'todos', label: 'Ambos', fn: 'AxLeadFunnel.switchFunil' },
      { mode: 'principal', label: 'Lead pipeline', fn: 'AxLeadFunnel.switchFunil' },
      { mode: 'diagnostico', label: 'Diagnóstico (Site)', fn: 'AxLeadFunnel.switchFunil' }
    ]) : '';

    var barraFunil = '<div class="novo-card" style="grid-column:1/-1;display:flex;align-items:center;gap:1rem;flex-wrap:wrap;padding:.6rem .9rem">' +
      '<span style="font-size:.72rem;color:var(--text2);font-weight:600;text-transform:uppercase;letter-spacing:.06em">Funil</span>' +
      tabsFunil +
      '<span style="font-size:.7rem;color:var(--text2)">Pipeline <strong>Backup</strong> excluído (parou de receber lead em 09/04/2026)</span>' +
      '<span id="lf-selo" style="margin-left:auto;font-size:.7rem;color:var(--text2)"></span>' +
      '</div>';

    if (ERR) {
      return hdr + aviso + barraFunil + '<div class="novo-card" style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--red)">' +
        'Falha ao carregar o funil de leads: ' + esc(ERR) +
        '<br><br><button onclick="AxLeadFunnel.load(true)" style="background:var(--teal);color:#fff;border:none;border-radius:8px;padding:.5rem 1.2rem;cursor:pointer">Tentar novamente</button></div>';
    }
    if (!D) {
      return hdr + aviso + barraFunil + '<div class="novo-card" style="grid-column:1/-1;text-align:center;padding:2.5rem;color:var(--text2)">Carregando funil de leads…</div>';
    }

    var i = (typeof _infoBtn === 'function') ? _infoBtn : function () { return ''; };
    var card = function (titulo, tip, id, h, extra, wide) {
      return '<div class="novo-card"' + (wide ? ' style="grid-column:1/-1"' : '') + '>' +
        '<div class="novo-card-header"><h3>' + titulo + '</h3>' + i(tip, id) + (extra || '') + '</div>' +
        '<canvas id="lf-' + id + '" style="max-height:' + (h || 320) + 'px"></canvas></div>';
    };
    var painel = function (titulo, tip, id, extra) {
      return '<div class="novo-card" style="grid-column:1/-1">' +
        '<div class="novo-card-header"><h3>' + titulo + '</h3>' + i(tip, id) + (extra || '') + '</div>' +
        '<div id="lf-' + id + '" style="overflow-x:auto;margin-top:.5rem"></div></div>';
    };

    var tabsWf = (typeof _subTabs === 'function') ? _subTabs('lf-wf-tabs', wfView, [
      { mode: 'status', label: 'Por status', fn: 'AxLeadFunnel.switchWf' },
      { mode: 'mov', label: 'Por movimentação', fn: 'AxLeadFunnel.switchWf' }
    ]) : '';
    var tabsDim = (typeof _subTabs === 'function') ? _subTabs('lf-dim-tabs', reguaDim, [
      { mode: 'bdr', label: 'BDR', fn: 'AxLeadFunnel.switchDim' },
      { mode: 'porte', label: 'Colaboradores', fn: 'AxLeadFunnel.switchDim' },
      { mode: 'tier', label: 'Tier colabs', fn: 'AxLeadFunnel.switchDim' },
      { mode: 'vidas', label: 'Vidas', fn: 'AxLeadFunnel.switchDim' },
      { mode: 'origem', label: 'Origem', fn: 'AxLeadFunnel.switchDim' }
    ]) : '';

    return hdr + aviso + barraFunil +
      card('Waterfall macro | o funil aberto que abre, recebe, perde e fecha',
        'Aberto@início + entrou no funil + reativados − qualificados − desqualificados = Aberto@fim. ABERTO = Novo + Tentativa + Conectado; qualificado e desqualificado são SAÍDAS do funil de prospecção (um vira deal, o outro morre), e contá-los no saldo faria o funil só crescer. A barra "Resíduo" é o que a aritmética não explica — ela aparece em vez de ser diluída nas outras, porque waterfall que não fecha no saldo é ficção. O saldo de abertura usa a etapa do lead em T0 derivada de fact_stage_entry (dim_lead só sabe o agora); método validado em 18.294 de 18.296 leads. Clique numa barra para os leads.',
        'macro', 340, null, true) +
      card('Waterfall por etapa | entradas contra saídas',
        'O mesmo período do macro, aberto por etapa: barras para CIMA são entradas, para BAIXO são saídas, e o rótulo é o líquido com sinal. O losango marca o saldo no fim. Barras opostas de tamanho parecido significam etapa que girou muito e andou pouco — é o que a tabela de saldo não mostra de relance. Clique numa etapa para os leads que entraram ou saíram dela.',
        'poretapa', 340, null, true) +
      painel('Waterfall detalhado',
        'Duas leituras do mesmo período. POR STATUS: como cada etapa ganhou e perdeu — saldo no início, entradas, saídas, saldo no fim, e o resíduo por etapa. POR MOVIMENTAÇÃO: cada seta de→para, com a natureza marcada por símbolo e palavra (nunca só por cor). Toda coluna com ⇅ ordena. Clique numa linha para os leads, com criado, trilha e status atual.',
        'waterfall', tabsWf) +
      card('Snapshot de agora | leads por etapa',
        'Estado ATUAL do funil, direto de dim_lead. É estado, não série — por isso sai do snapshot e não do histórico. A defasagem da extração das 06:30 está no selo à direita da barra de funil.', 'snapshot', 300) +
      card('Criados e movimentados por dia',
        'Barras = leads criados no dia (entrada no funil). Linhas = movimentações que chegaram em cada etapa naquele dia. É a taxa por dia: quantos leads novos, quantos passaram para tentativa, conectado, qualificado ou desqualificado.', 'pordia', 320, null, true) +
      painel('Taxa de contato | AS DUAS RÉGUAS, lado a lado',
        'A tela NÃO escolhe entre as duas réguas. ETAPA = o lead chegou a Tentativa+ no histórico de etapa. ATIVIDADE REAL = houve ligação conectada, e-mail enviado ou LinkedIn enviado (nota não conta: nota não é ação). Medido em jul/26: 89,4% contra 46,7%, com 1.009 leads movidos para Tentativa sem UM toque no CRM — a premissa "teve que passar, senão não tem como" não se sustenta no dado. Toda coluna com ⇅ ordena; clique numa linha para os leads.',
        'regua', tabsDim) +
      card('Desqualificações por dia',
        'Entradas em Desqualificado por dia, empilhadas por MOTIVO (o objeto Leads tem o campo — o contato nunca teve). Preenchimento: Lead pipeline 99,2%, Diagnóstico Site 0,0% (1.056 sem motivo). Clique num dia para o drill.', 'disq', 300, null, true) +
      painel('Desqualificações | motivo × quem',
        'Cruzamento motivo × autor da movimentação, pelo autor REAL do evento (updated_by_user_id), não pelo dono atual do lead. "Automação" e "Integração" são bucket próprio: ninguém digitou, então não é esforço do BDR. Medido em jul/26: a automação move lead ADIANTE (inscrição em sequência) e quase nunca desqualifica — 1.499 desqualificações por gente contra 1 por integração. Clique numa célula para ver os leads.',
        'disqmatrix');
  }

  // ── render ─────────────────────────────────────────────────────────────────────
  function paint() {
    var host = document.getElementById('lf-host');
    if (!host) return;
    host.innerHTML = sectionHtml();
    if (typeof _initTabSubs === 'function') try { _initTabSubs(); } catch (e) {}
    // A JANELA MUDOU? recarrega. Antes o paint() só carregava quando D estava vazio,
    // então trocar o filtro re-renderizava o MESMO dado e a tela ficava presa.
    if (!D || LOADED !== chaveJanela()) { if (!LOADING) load(); return; }
    selo();
    macroChart();
    porEtapaChart();
    waterfallTabela();
    snapshot();
    porDia();
    tabelaRegua();
    disq();
    disqMatrix();
  }

  function selo() {
    var el = document.getElementById('lf-selo'); if (!el || !D) return;
    var j = D.janela || {};
    el.innerHTML = '<strong style="color:var(--text)">' + fmtBRfull(j.since) + ' → ' + fmtBRfull(j.until) + '</strong>' +
      ' <span style="opacity:.7">(' + ni(j.dias) + ' dias · ' + esc(j.origem || '') + ')</span> · ' +
      ni(D.coorte ? D.coorte.criados : 0) + ' criados · ' +
      ni(D.waterfall ? D.waterfall.movimentos : 0) + ' movimentações';
  }

  // ── Waterfall MACRO (barras flutuantes, como o D02 do Delta) ───────────────────
  function macroChart() {
    if (!D || !D.macro || typeof _novoMkChart !== 'function') return;
    var th_ = _novoTheme(), m = D.macro;

    // [rotulo, delta, cor, tipo]. tipo 'total' desenha do zero; 'delta' flutua.
    var passos = [
      ['Aberto @ início', m.aberto_inicio, C_TOTAL, 'total'],
      ['＋ Entrou no funil', m.entrada_no_funil, C_BOM, 'delta'],
      ['＋ Reativados', m.reativados, C_BOM, 'delta'],
      ['− Qualificados', -m.qualificados, C_TOTAL, 'delta'],
      ['− Desqualificados', -m.desqualificados, C_RUIM, 'delta'],
      ['− Saiu do recorte', -(m.saiu_do_recorte || 0), C_NEUTRO, 'delta'],
      ['± Resíduo', m.residuo, C_NEUTRO, 'delta'],
      ['Aberto @ fim', m.aberto_fim, C_TOTAL, 'total']
    ].filter(function (p) { return p[3] === 'total' || p[1] !== 0; });

    var cum = 0, dados = [], cores = [], rotulos = [], deltas = [];
    passos.forEach(function (p) {
      if (p[3] === 'total') { dados.push([0, p[1]]); cum = p[1]; }
      else { var ini = cum, fim = cum + p[1]; dados.push([Math.min(ini, fim), Math.max(ini, fim)]); cum = fim; }
      cores.push(p[2]); rotulos.push(p[0]); deltas.push(p[1]);
    });
    window._lfMacroPassos = rotulos;

    _novoMkChart('lf-macro', {
      type: 'bar', plugins: [ChartDataLabels],
      data: { labels: rotulos, datasets: [{ data: dados, backgroundColor: cores, borderRadius: 3, borderSkipped: false }] },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 26 } },
        plugins: {
          legend: { display: false },
          datalabels: {
            anchor: 'end', align: 'top', color: th_.cText, font: { family: NOVO_FONT, size: 11, weight: 'bold' },
            formatter: function (v, c) {
              var i = c.dataIndex, d = deltas[i];
              return passos[i][3] === 'total' ? ni(d) : sgn(d);
            }
          },
          tooltip: {
            callbacks: {
              label: function (c) {
                var i = c.dataIndex, d = deltas[i];
                if (passos[i][3] === 'total') return 'Saldo aberto: ' + ni(d) + ' leads';
                return (d >= 0 ? 'Entrada' : 'Saída') + ': ' + ni(Math.abs(d)) + ' leads';
              },
              afterBody: function () { return ['', m.conferencia]; }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: th_.cText2, font: { family: NOVO_FONT, size: 10 }, maxRotation: 20, autoSkip: false } },
          y: { beginAtZero: true, grid: { color: th_.cGrid }, ticks: { color: th_.cText2, font: { family: NOVO_FONT }, precision: 0 } }
        },
        onClick: function (e, el) { if (!el.length) return; drillMacro(rotulos[el[0].index]); }
      }
    });

    // A conferência da aritmética fica embaixo do gráfico, não escondida no tooltip:
    // é o que permite alguém desconfiar do waterfall sem abrir o payload.
    var cv = document.getElementById('lf-macro');
    if (cv && cv.parentNode && !cv.parentNode.querySelector('.lf-macro-nota')) {
      var p = document.createElement('p');
      p.className = 'lf-macro-nota';
      p.style.cssText = 'font-size:.71rem;color:var(--text2);margin:.5rem 0 0;line-height:1.5';
      p.innerHTML = '<strong style="color:var(--text)">Conferência:</strong> ' + esc(m.conferencia) +
        '. Resíduo de ' + pct(Math.abs(m.residuo), m.aberto_fim) + ' do saldo' +
        (m.criados_sem_movimento ? ' · ' + ni(m.criados_sem_movimento) + ' lead(s) criado(s) sem movimento de etapa (contam em "criados por dia", não no fluxo)' : '') +
        '. ABERTO = Novo + Tentativa + Conectado.';
      cv.parentNode.appendChild(p);
    }
  }

  // ── Waterfall POR ETAPA, em barras (o macro conta a história; este mostra o giro) ──
  // Entradas para cima, saídas para baixo. Duas barras grandes e opostas na mesma etapa
  // são giro alto com avanço baixo — informação que a coluna de saldo esconde, porque
  // saldo é a diferença e a diferença não sabe o tamanho do fluxo.
  function porEtapaChart() {
    if (!D || !D.waterfall || typeof _novoMkChart !== 'function') return;
    var th_ = _novoTheme();
    var lista = (D.waterfall.por_status || []).filter(function (s) {
      return s.saldo_inicio || s.saldo_fim || s.entradas || s.saidas;
    });
    if (!lista.length) return;
    var ordem = CAN.filter(function (c) { return lista.some(function (s) { return s.etapa === c; }); });
    var por = {}; lista.forEach(function (s) { por[s.etapa] = s; });
    var ent = ordem.map(function (c) { return por[c].entradas; });
    var sai = ordem.map(function (c) { return -por[c].saidas; });
    var fim = ordem.map(function (c) { return por[c].saldo_fim; });
    var liq = ordem.map(function (c) { return por[c].liquido; });

    _novoMkChart('lf-poretapa', {
      type: 'bar', plugins: [ChartDataLabels],
      data: {
        labels: ordem.map(pt),
        datasets: [
          { label: 'Entradas', data: ent, backgroundColor: C_BOM, borderRadius: 3, stack: 'f',
            datalabels: { anchor: 'end', align: 'top', color: th_.cText2, font: { family: NOVO_FONT, size: 9 }, formatter: function (v) { return v ? '+' + ni(v) : ''; } } },
          { label: 'Saídas', data: sai, backgroundColor: C_RUIM, borderRadius: 3, stack: 'f',
            datalabels: { anchor: 'end', align: 'bottom', color: th_.cText2, font: { family: NOVO_FONT, size: 9 }, formatter: function (v) { return v ? '−' + ni(Math.abs(v)) : ''; } } },
          { label: 'Saldo no fim', type: 'line', data: fim, borderColor: C_TOTAL, backgroundColor: C_TOTAL,
            showLine: false, pointStyle: 'rectRot', pointRadius: 7, yAxisID: 'y1',
            datalabels: { align: 'right', offset: 8, color: th_.cText, font: { family: NOVO_FONT, size: 10, weight: 'bold' }, formatter: function (v) { return ni(v); } } }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 22, bottom: 14, right: 46 } },
        plugins: {
          legend: { display: true, labels: { color: th_.cText2, font: { family: NOVO_FONT, size: 10 }, padding: 8, usePointStyle: true } },
          tooltip: {
            callbacks: {
              afterBody: function (items) {
                var i = items[0].dataIndex, s = por[ordem[i]];
                return ['', 'Líquido: ' + sgn(liq[i]) + (liq[i] > 0 ? ' (↑ ganhou)' : liq[i] < 0 ? ' (↓ perdeu)' : ' (→ estável)'),
                  'Saldo: ' + ni(s.saldo_inicio) + ' → ' + ni(s.saldo_fim) + (s.residuo ? '  | resíduo ' + sgn(s.residuo) : '')];
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: th_.cText2, font: { family: NOVO_FONT, size: 10 } }, stacked: true },
          y: { grid: { color: th_.cGrid }, ticks: { color: th_.cText2, font: { family: NOVO_FONT }, precision: 0, callback: function (v) { return ni(Math.abs(v)); } }, stacked: true },
          y1: { display: false, position: 'right', beginAtZero: true }
        },
        onClick: function (e, el) { if (!el.length) return; drillStatus(ordem[el[0].index]); }
      }
    });
  }

  // ── Waterfall detalhado: POR STATUS ou POR MOVIMENTAÇÃO ────────────────────────
  function waterfallTabela() {
    var el = document.getElementById('lf-waterfall'); if (!el || !D) return;
    el.innerHTML = wfView === 'status' ? htmlPorStatus() : htmlPorMovimento();
  }

  function htmlPorStatus() {
    var lista = (D.waterfall.por_status || []).filter(function (s) {
      return s.saldo_inicio || s.saldo_fim || s.entradas || s.saidas;
    });
    if (!lista.length) return '<p style="color:var(--text2);padding:1rem 0">Sem movimento nem saldo no período.</p>';
    var ord = ordena(lista, 'wf', function (r, c) { return c === 'etapa' ? r.rotulo : r[c]; });
    var maxAbs = Math.max.apply(null, lista.map(function (r) { return Math.abs(r.liquido) || 1; }));

    var linhas = ord.map(function (r) {
      var liq = r.liquido;
      var marca = liq > 0 ? '↑ ganhou' : liq < 0 ? '↓ perdeu' : '→ estável';
      var cor = liq > 0 ? C_BOM : liq < 0 ? C_RUIM : C_NEUTRO;
      var w = Math.round(Math.abs(liq) / maxAbs * 100);
      return '<tr style="cursor:pointer" onclick="AxLeadFunnel.drillStatus(\'' + r.etapa + '\')">' +
        '<td style="text-align:left;font-weight:600;white-space:nowrap">' +
          '<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + (COR[r.etapa] || C_NEUTRO) + ';margin-right:.45rem"></span>' +
          esc(r.rotulo) + (ABERTAS[r.etapa] ? '' : ' <span style="font-size:.64rem;color:var(--text2);font-weight:400">(saída do funil)</span>') + '</td>' +
        '<td>' + ni(r.saldo_inicio) + '</td>' +
        '<td style="color:' + C_BOM + '">+' + ni(r.entradas) + '</td>' +
        '<td style="color:' + C_RUIM + '">−' + ni(r.saidas) + '</td>' +
        '<td style="font-weight:700">' + ni(r.saldo_fim) + '</td>' +
        '<td style="white-space:nowrap"><span style="font-size:.72rem;color:var(--text2)">' + marca + '</span></td>' +
        '<td style="min-width:120px"><div style="display:flex;align-items:center;gap:.4rem;justify-content:flex-end">' +
          '<div style="flex:1;max-width:66px;height:6px;background:var(--card2);border-radius:3px;overflow:hidden">' +
          '<div style="width:' + w + '%;height:100%;background:' + cor + '"></div></div>' +
          '<span style="white-space:nowrap;font-weight:600">' + sgn(liq) + '</span></div></td>' +
        '<td style="color:' + (r.residuo ? 'var(--text)' : 'var(--text2)') + '">' + (r.residuo ? sgn(r.residuo) : '0') + '</td></tr>';
    }).join('');

    var t = lista.reduce(function (a, r) {
      a.si += r.saldo_inicio; a.e += r.entradas; a.s += r.saidas; a.sf += r.saldo_fim; a.res += r.residuo; return a;
    }, { si: 0, e: 0, s: 0, sf: 0, res: 0 });

    return '<table class="lb" style="font-size:.78rem;width:100%"><thead><tr>' +
      th('wf', 'etapa', 'Etapa', 'left') + th('wf', 'saldo_inicio', 'Saldo início') +
      th('wf', 'entradas', 'Entradas') + th('wf', 'saidas', 'Saídas') +
      th('wf', 'saldo_fim', 'Saldo fim') +
      '<th style="text-align:left">Natureza</th>' +
      th('wf', 'liquido', 'Líquido') + th('wf', 'residuo', 'Resíduo') +
      '</tr></thead><tbody>' + linhas + '</tbody>' +
      '<tfoot><tr><td style="text-align:left;font-weight:700">Total</td>' +
      '<td style="font-weight:700">' + ni(t.si) + '</td><td style="font-weight:700">+' + ni(t.e) + '</td>' +
      '<td style="font-weight:700">−' + ni(t.s) + '</td><td style="font-weight:700">' + ni(t.sf) + '</td>' +
      '<td></td><td style="font-weight:700;text-align:right">' + sgn(t.e - t.s) + '</td>' +
      '<td style="font-weight:700">' + sgn(t.res) + '</td></tr></tfoot></table>' +
      '<p style="font-size:.71rem;color:var(--text2);margin:.5rem 0 0">' +
      'Por etapa, <strong>saldo início + entradas − saídas = saldo fim</strong>. A coluna Resíduo é o que não fecha — ' +
      'ela existe para o desacordo ser visível em vez de arredondado.</p>';
  }

  function htmlPorMovimento() {
    var setas = D.waterfall.setas || {};
    var rank = { '(criacao)': -1, novo: 0, tentativa: 1, conectado: 2, qualificado: 3, desqualificado: 9 };
    var lista = Object.keys(setas).map(function (k) {
      var p = k.split('>'), de = p[0], para = p[1];
      var rd = rank[de] == null ? 0 : rank[de], rp = rank[para] == null ? 0 : rank[para];
      var tipo, marca, cor;
      if (de === '(criacao)') { tipo = 'entrada'; marca = '＋ entrou'; cor = COR.novo; }
      else if (para === 'desqualificado') { tipo = 'saida'; marca = '✖ desqualificou'; cor = C_RUIM; }
      else if (rp > rd) { tipo = 'avanco'; marca = '↑ avançou'; cor = C_BOM; }
      else if (rp < rd) { tipo = 'retorno'; marca = '↓ voltou'; cor = COR.tentativa; }
      else { tipo = 'lateral'; marca = '→ lateral'; cor = C_NEUTRO; }
      return { k: k, de: de, para: para, n: setas[k], tipo: tipo, marca: marca, cor: cor,
        rot: (de === '(criacao)' ? 'Começou em' : pt(de)) + ' → ' + pt(para) };
    });
    if (!lista.length) return '<p style="color:var(--text2);padding:1rem 0">Nenhuma movimentação de etapa no período.</p>';
    var total = lista.reduce(function (a, r) { return a + r.n; }, 0);
    var max = Math.max.apply(null, lista.map(function (r) { return r.n; }));
    var ord = ordena(lista, 'mov', function (r, c) { return c === 'rot' ? r.rot : c === 'tipo' ? r.marca : r[c]; });

    var linhas = ord.map(function (r) {
      var w = max ? Math.round(r.n / max * 100) : 0;
      return '<tr style="cursor:pointer" onclick="AxLeadFunnel.drillSeta(\'' + r.k + '\')">' +
        '<td style="text-align:left;white-space:nowrap;font-weight:600">' + esc(r.rot) + '</td>' +
        '<td style="text-align:left;white-space:nowrap;font-size:.72rem;color:var(--text2)">' + r.marca + '</td>' +
        '<td style="font-weight:700">' + ni(r.n) + '</td>' +
        '<td style="min-width:130px"><div style="height:8px;background:var(--card2);border-radius:4px;overflow:hidden">' +
        '<div style="width:' + w + '%;height:100%;background:' + r.cor + '"></div></div></td>' +
        '<td style="font-size:.72rem;color:var(--text2)">' + pct(r.n, total) + '</td></tr>';
    }).join('');

    return '<table class="lb" style="font-size:.78rem;width:100%"><thead><tr>' +
      th('mov', 'rot', 'Movimentação', 'left') + th('mov', 'tipo', 'Natureza', 'left') +
      th('mov', 'n', 'Leads') + '<th></th>' +
      // % do total é proporcional a Leads: dar seta própria sugeriria uma segunda
      // ordenação que não existe.
      '<th style="text-align:right;white-space:nowrap">% do total</th>' +
      '</tr></thead><tbody>' + linhas + '</tbody>' +
      '<tfoot><tr><td style="text-align:left;font-weight:700">Total</td><td></td>' +
      '<td style="font-weight:700">' + ni(total) + '</td><td></td><td></td></tr></tfoot></table>';
  }

  function snapshot() {
    if (!D || typeof _novoMkChart !== 'function') return;
    var th_ = _novoTheme();
    var s = D.snapshot.por_etapa || {};
    var ordem = CAN.filter(function (c) { return s[c]; });
    var total = ordem.reduce(function (a, c) { return a + s[c]; }, 0);
    var cv = document.getElementById('lf-snapshot');
    if (cv) cv.style.height = Math.max(ordem.length * 38 + 40, 150) + 'px';
    _novoMkChart('lf-snapshot', {
      type: 'bar', plugins: [ChartDataLabels],
      data: { labels: ordem.map(pt), datasets: [{ data: ordem.map(function (c) { return s[c]; }), backgroundColor: ordem.map(function (c) { return COR[c]; }), borderRadius: 4 }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false, layout: { padding: { right: 92 } },
        plugins: {
          legend: { display: false },
          datalabels: { anchor: 'end', align: 'right', color: th_.cText, font: { family: NOVO_FONT, size: 11, weight: 'bold' }, formatter: function (v) { return ni(v) + ' (' + (total ? Math.round(v / total * 100) : 0) + '%)'; } },
          tooltip: { callbacks: { label: function (c) { return ni(c.parsed.x) + ' leads | ' + pct(c.parsed.x, total) + ' do funil'; } } }
        },
        scales: { x: { grid: { color: th_.cGrid }, ticks: { color: th_.cText2, font: { family: NOVO_FONT }, precision: 0 } }, y: { grid: { display: false }, ticks: { color: th_.cText, font: { family: NOVO_FONT }, autoSkip: false } } },
        onClick: function (e, el) { if (!el.length) return; drillStatus(ordem[el[0].index]); }
      }
    });
  }

  function porDia() {
    if (!D || typeof _novoMkChart !== 'function') return;
    var th_ = _novoTheme();
    var criados = {};
    (D.coorte.leads || []).forEach(function (l) { criados[l.criado] = (criados[l.criado] || 0) + 1; });
    var pd = D.waterfall.por_dia || {};
    var dias = Object.keys(criados).concat(Object.keys(pd)).filter(function (d, i, a) { return d && a.indexOf(d) === i; }).sort();
    if (!dias.length) return;
    var linha = function (c, cor) {
      return { type: 'line', label: pt(c), data: dias.map(function (d) { return (pd[d] && pd[d][c]) || 0; }), borderColor: cor, backgroundColor: cor, pointRadius: 2, borderWidth: 2, tension: .3, datalabels: { display: false } };
    };
    _novoMkChart('lf-pordia', {
      type: 'bar', plugins: [ChartDataLabels],
      data: {
        labels: dias.map(fmtBR),
        datasets: [
          { label: 'Leads criados', data: dias.map(function (d) { return criados[d] || 0; }), backgroundColor: 'rgba(88,166,255,.45)', borderRadius: 2, datalabels: { display: false } },
          linha('tentativa', COR.tentativa), linha('conectado', COR.conectado),
          linha('qualificado', COR.qualificado), linha('desqualificado', COR.desqualificado)
        ]
      },
      options: {
        responsive: true, layout: { padding: { top: 16 } },
        plugins: { legend: { display: true, labels: { color: th_.cText2, font: { family: NOVO_FONT, size: 10 }, padding: 8 } }, tooltip: { mode: 'index', intersect: false } },
        scales: { x: { grid: { display: false }, ticks: { color: th_.cText2, font: { family: NOVO_FONT, size: 9 }, maxRotation: 0, autoSkip: true } }, y: { grid: { color: th_.cGrid }, ticks: { color: th_.cText2, font: { family: NOVO_FONT }, precision: 0 } } },
        onClick: function (e, el) { if (!el.length) return; drillDia(dias[el[0].index]); }
      }
    });
  }

  // A FAIXA VEM DO SQL. O front LÊ o rótulo, nunca recalcula — a agregação da tabela é
  // um GROUP BY no BigQuery, e recalcular a faixa aqui faria as duas definições
  // derivarem: a tabela diria "50–200" para um conjunto e o drill para outro.
  function dimOf(l) {
    return l['dim_' + reguaDim] || (reguaDim === 'bdr' ? (l.bdr || '(sem dono)') : '(sem valor)');
  }

  function tabelaRegua() {
    var el = document.getElementById('lf-regua'); if (!el || !D) return;
    // A TABELA LÊ A AGREGAÇÃO DO BIGQUERY, não a lista de leads. A lista vem capada em
    // 3.000 para o drill; somar ela daria total errado em janela longa — e daria errado
    // de um jeito plausível, que é o pior tipo.
    var agg = (D.coorte.por_dimensao || {})[reguaDim] || [];
    if (!agg.length) { el.innerHTML = '<p style="color:var(--text2);padding:1rem 0">Nenhum lead criado no período.</p>'; return; }

    var todas = agg.map(function (r) {
      return {
        k: r.valor, n: r.criados, ativ: r.com_atividade, etapa: r.por_etapa, ambos: r.ambos,
        auto: r.so_automacao, nunca: r.nunca_tocados, qual: r.qualificados,
        deal: r.com_deal, dq: r.desqualificados,
        lacuna: r.por_etapa - r.ambos,
        tx_etapa: r.criados ? r.por_etapa / r.criados : 0,
        tx_ativ: r.criados ? r.com_atividade / r.criados : 0
      };
    });
    var ord = ordena(todas, 'regua', function (r, c) { return c === 'k' ? r.k : r[c]; }).slice(0, 25);

    var t = todas.reduce(function (a, r) {
      ['n', 'etapa', 'ativ', 'ambos', 'qual', 'deal', 'dq', 'auto', 'nunca'].forEach(function (f) { a[f] += r[f]; });
      return a;
    }, { n: 0, etapa: 0, ativ: 0, ambos: 0, qual: 0, deal: 0, dq: 0, auto: 0, nunca: 0 });

    var barra = function (a, b, cor) {
      var p = b ? Math.round(a / b * 100) : 0;
      return '<td style="min-width:104px"><div style="display:flex;align-items:center;gap:.4rem;justify-content:flex-end">' +
        '<div style="flex:1;max-width:62px;height:6px;background:var(--card2);border-radius:3px;overflow:hidden">' +
        '<div style="width:' + p + '%;height:100%;background:' + cor + '"></div></div>' +
        '<span style="white-space:nowrap">' + pct(a, b) + '</span></div></td>';
    };
    var rotDim = { bdr: 'BDR', porte: 'Colaboradores', tier: 'Tier colabs', vidas: 'Vidas', origem: 'Origem' }[reguaDim];

    var html = '<div style="font-size:.74rem;color:var(--text2);margin:.1rem 0 .6rem;line-height:1.6">' +
      '<strong style="color:var(--text)">Criaram ' + ni(t.n) + ' e falaram com ' + ni(t.ativ) + '</strong> (' + pct(t.ativ, t.n) + ') — ' +
      'atividade real distinta por lead: ligação conectada, e-mail, LinkedIn, WhatsApp manual ou reunião realizada.<br>' +
      'Pela régua de <strong>etapa</strong> seriam ' + ni(t.etapa) + ' (' + pct(t.etapa, t.n) + '), e a diferença é o alerta: ' +
      '<strong style="color:var(--red)">' + ni(t.etapa - t.ambos) + ' movidos de etapa sem nenhum toque registrado</strong>. ' +
      'Além disso, <strong>' + ni(t.nunca) + ' nunca foram tocados</strong> por ninguém' +
      (t.auto ? ' e <strong>' + ni(t.auto) + '</strong> só por automação (não conta como esforço do BDR)' : '') + '.' +
      '</div>';

    html += '<table class="lb" style="font-size:.78rem;width:100%"><thead><tr>' +
      th('regua', 'k', rotDim, 'left') +
      th('regua', 'n', 'Criaram<br><span style="font-weight:400;font-size:.66rem;color:var(--text2)">X leads</span>') +
      th('regua', 'ativ', 'Falaram com<br><span style="font-weight:400;font-size:.66rem;color:var(--text2)">Y distintos</span>') +
      th('regua', 'tx_ativ', 'Tx contato<br><span style="font-weight:400;font-size:.66rem;color:var(--text2)">por ATIVIDADE</span>') +
      th('regua', 'tx_etapa', 'Tx contato<br><span style="font-weight:400;font-size:.66rem;color:var(--text2)">por ETAPA</span>') +
      th('regua', 'lacuna', 'Etapa sem<br>toque') +
      th('regua', 'auto', 'Só<br>automação') + th('regua', 'nunca', 'Nunca<br>tocados') +
      th('regua', 'qual', 'Qualificados') + th('regua', 'deal', 'Com deal') + th('regua', 'dq', 'Desqualif.') +
      '</tr></thead><tbody>';
    ord.forEach(function (r) {
      html += '<tr style="cursor:pointer" onclick="AxLeadFunnel.drillDim(' + JSON.stringify(r.k).replace(/"/g, '&quot;') + ')">' +
        '<td style="text-align:left;white-space:nowrap;max-width:210px;overflow:hidden;text-overflow:ellipsis;font-weight:600">' + esc(r.k) + '</td>' +
        '<td style="font-weight:600">' + ni(r.n) + '</td>' +
        '<td style="font-weight:600;color:' + C_BOM_T + '">' + ni(r.ativ) + '</td>' +
        barra(r.ativ, r.n, COR.conectado) + barra(r.etapa, r.n, COR.tentativa) +
        '<td style="color:' + (r.lacuna ? 'var(--red)' : 'var(--text2)') + '">' + ni(r.lacuna) + '</td>' +
        '<td style="color:var(--text2)">' + ni(r.auto) + '</td>' +
        '<td style="color:' + (r.nunca ? 'var(--red)' : 'var(--text2)') + '">' + ni(r.nunca) + '</td>' +
        '<td>' + ni(r.qual) + '</td><td>' + ni(r.deal) + '</td><td>' + ni(r.dq) + '</td></tr>';
    });
    html += '</tbody><tfoot><tr><td style="text-align:left;font-weight:700">Total</td>' +
      '<td style="font-weight:700">' + ni(t.n) + '</td><td style="font-weight:700">' + ni(t.ativ) + '</td>' +
      '<td style="font-weight:700;text-align:right">' + pct(t.ativ, t.n) + '</td>' +
      '<td style="font-weight:700;text-align:right">' + pct(t.etapa, t.n) + '</td>' +
      '<td style="font-weight:700">' + ni(t.etapa - t.ambos) + '</td>' +
      '<td style="font-weight:700">' + ni(t.auto) + '</td><td style="font-weight:700">' + ni(t.nunca) + '</td>' +
      '<td style="font-weight:700">' + ni(t.qual) + '</td><td style="font-weight:700">' + ni(t.deal) + '</td>' +
      '<td style="font-weight:700">' + ni(t.dq) + '</td></tr></tfoot></table>' +
      '<p style="font-size:.71rem;color:var(--text2);margin:.45rem 0 0">' +
      (todas.length > 25 ? 'Mostrando 25 de ' + ni(todas.length) + ' valores de ' + rotDim + ' — o Total soma TODOS. ' : '') +
      'Os números desta tabela são agregados no BigQuery e cobrem <strong>100% da coorte</strong>. ' +
      (D.coorte.leads_truncado ? 'O <em>drill</em> mostra os ' + ni(D.coorte.leads.length) + ' leads mais recentes (a lista é capada; a conta não).' : '') +
      '</p>';
    el.innerHTML = html;
  }

  function disq() {
    if (!D || typeof _novoMkChart !== 'function') return;
    var th_ = _novoTheme();
    var lista = D.desqualificacoes || [];
    if (!lista.length) return;
    var dias = lista.map(function (d) { return d.dia; }).filter(function (d, i, a) { return a.indexOf(d) === i; }).sort();
    var motivos = {};
    lista.forEach(function (d) { motivos[d.motivo] = (motivos[d.motivo] || 0) + 1; });
    var topMot = Object.keys(motivos).sort(function (a, b) { return motivos[b] - motivos[a]; }).slice(0, 8);
    var cores = ['rgba(248,81,73,.8)', 'rgba(227,179,65,.8)', 'rgba(147,112,219,.8)', 'rgba(88,166,255,.75)', 'rgba(58,184,183,.75)', 'rgba(255,140,105,.8)', 'rgba(140,140,150,.7)', 'rgba(236,72,153,.7)'];
    var ds = topMot.map(function (m, i) {
      return { label: m.length > 34 ? m.slice(0, 33) + '…' : m, stack: 's', borderRadius: 2, backgroundColor: cores[i % cores.length], data: dias.map(function (d) { return lista.filter(function (x) { return x.dia === d && x.motivo === m; }).length; }) };
    });
    var outros = dias.map(function (d) { return lista.filter(function (x) { return x.dia === d && topMot.indexOf(x.motivo) < 0; }).length; });
    if (outros.some(function (v) { return v; })) ds.push({ label: 'Outros motivos', stack: 's', borderRadius: 2, backgroundColor: 'rgba(110,118,129,.6)', data: outros });

    _novoMkChart('lf-disq', {
      type: 'bar', plugins: [ChartDataLabels],
      data: { labels: dias.map(fmtBR), datasets: ds },
      options: {
        responsive: true, layout: { padding: { top: 20 } },
        plugins: {
          legend: { display: true, labels: { color: th_.cText2, font: { family: NOVO_FONT, size: 9 }, padding: 6, boxWidth: 10 } },
          datalabels: { display: function (c) { return c.datasetIndex === c.chart.data.datasets.length - 1; }, anchor: 'end', align: 'top', color: th_.cText, font: { family: NOVO_FONT, size: 9, weight: 'bold' }, formatter: function (v, c) { var t = 0; c.chart.data.datasets.forEach(function (d) { t += (d.data[c.dataIndex] || 0); }); return t || ''; } },
          tooltip: { mode: 'index', intersect: false, filter: function (i) { return i.parsed.y > 0; } }
        },
        scales: { x: { stacked: true, grid: { display: false }, ticks: { color: th_.cText2, font: { family: NOVO_FONT, size: 9 }, maxRotation: 0, autoSkip: true } }, y: { stacked: true, grid: { color: th_.cGrid }, ticks: { color: th_.cText2, font: { family: NOVO_FONT }, precision: 0 } } },
        onClick: function (e, el) { if (!el.length) return; drillDisq({ dia: dias[el[0].index] }); }
      }
    });
  }

  function disqMatrix() {
    var el = document.getElementById('lf-disqmatrix'); if (!el || !D) return;
    var lista = D.desqualificacoes || [];
    if (!lista.length) { el.innerHTML = '<p style="color:var(--text2);padding:1rem 0">Nenhuma desqualificação no período.</p>'; return; }
    var autores = {}, motivos = {};
    lista.forEach(function (d) { autores[d.autor] = (autores[d.autor] || 0) + 1; motivos[d.motivo] = (motivos[d.motivo] || 0) + 1; });
    var cols = Object.keys(autores).sort(function (a, b) { return autores[b] - autores[a]; }).slice(0, 10);
    var rows = Object.keys(motivos).sort(function (a, b) { return motivos[b] - motivos[a]; }).slice(0, 12);
    var max = 0;
    rows.forEach(function (m) { cols.forEach(function (a) { var n = lista.filter(function (x) { return x.motivo === m && x.autor === a; }).length; if (n > max) max = n; }); });

    var h = '<table class="lb" style="font-size:.72rem;width:100%"><thead><tr><th style="text-align:left">Motivo</th>' +
      cols.map(function (a) { return '<th style="font-size:.66rem;max-width:90px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(a) + '</th>'; }).join('') +
      '<th>Total</th></tr></thead><tbody>';
    rows.forEach(function (m) {
      h += '<tr><td style="text-align:left;max-width:230px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600">' + esc(m) + '</td>';
      cols.forEach(function (a) {
        var n = lista.filter(function (x) { return x.motivo === m && x.autor === a; }).length;
        var alpha = max ? (0.10 + 0.62 * (n / max)) : 0;
        h += '<td style="' + (n ? 'background:rgba(248,81,73,' + alpha.toFixed(2) + ');cursor:pointer' : 'color:var(--text2)') + '"' +
          (n ? ' onclick="AxLeadFunnel.drillDisqCel(' + JSON.stringify(m).replace(/"/g, '&quot;') + ',' + JSON.stringify(a).replace(/"/g, '&quot;') + ')"' : '') +
          '>' + (n || '·') + '</td>';
      });
      h += '<td style="font-weight:700">' + ni(motivos[m]) + '</td></tr>';
    });
    h += '</tbody></table>';
    if (motivos['(sem motivo)']) {
      h += '<p style="font-size:.7rem;color:var(--text2);margin:.5rem 0 0"><strong>' + ni(motivos['(sem motivo)']) +
        ' desqualificações sem motivo.</strong> No Diagnóstico (Site) o preenchimento é 0% — a propriedade não é preenchida naquele funil. Isso é o dado, não falha da tela.</p>';
    }
    el.innerHTML = h;
  }

  // ── DRILLS: todo card mostra CRIADO → TRILHA → STATUS ATUAL ────────────────────
  // A trilha é o que torna o número auditável. Sem ela o drill diz "estes leads" e
  // deixa a pergunta seguinte ("por que este entrou nessa conta?") sem resposta.
  function trilhaHtml(l) {
    if (!l.passos || !l.passos.length) {
      return '<span style="color:var(--text2)">sem movimento na janela</span>';
    }
    return l.passos.map(function (p, i) {
      var rank = { '(criacao)': -1, novo: 0, tentativa: 1, conectado: 2, qualificado: 3, desqualificado: 9 };
      var rd = rank[p.de] == null ? 0 : rank[p.de], rp = rank[p.para] == null ? 0 : rank[p.para];
      var sim = p.de === '(criacao)' ? '＋' : p.para === 'desqualificado' ? '✖' : rp > rd ? '↑' : rp < rd ? '↓' : '→';
      var cor = p.de === '(criacao)' ? COR.novo : p.para === 'desqualificado' ? C_RUIM : rp > rd ? C_BOM : rp < rd ? COR.tentativa : C_NEUTRO;
      return '<span style="display:inline-block;white-space:nowrap;margin:0 .3rem .2rem 0;padding:.1rem .35rem;border-radius:4px;' +
        'background:var(--card2);border-left:2px solid ' + cor + ';font-size:.68rem">' +
        sim + ' ' + esc(pt(p.para)) + ' <span style="color:var(--text2)">' + fmtBR(p.dia) + (p.hora ? ' ' + p.hora : '') + '</span></span>';
    }).join('');
  }

  function tabelaAudit(list, modo) {
    if (!list.length) return '<p style="color:var(--text2);padding:1rem 0">Nenhum lead.</p>';
    var ord = ordena(list, 'leads', function (r, c) {
      if (c === 'lead') return r.lead || '';
      if (c === 'status_atual') return r.status_atual || r.etapa || '';
      if (c === 'criado') return r.criado || '';
      return r[c];
    });
    var cap = ord.length > 300;
    var rows = ord.slice(0, 300).map(function (l) {
      var url = 'https://app.hubspot.com/contacts/44715285/record/0-136/' + l.lead_id;
      var st = l.status_atual || l.etapa;
      return '<tr>' +
        '<td style="text-align:left;max-width:190px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
          '<a href="' + url + '" target="_blank" rel="noopener" style="color:var(--teal);text-decoration:none">' + esc(l.lead || l.lead_id) + '</a></td>' +
        '<td style="text-align:left;max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(l.empresa || '—') + '</td>' +
        '<td style="text-align:left;white-space:nowrap">' + esc(l.bdr || '—') + '</td>' +
        '<td style="white-space:nowrap">' + fmtBRfull(l.criado) + '</td>' +
        '<td style="text-align:left;min-width:230px">' + (l.passos ? trilhaHtml(l) : (l.atingiu_tentativa_etapa ? '↑ chegou a Tentativa+' : '— sem avanço de etapa')) + '</td>' +
        '<td style="white-space:nowrap;font-weight:600">' +
          '<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + (COR[st] || C_NEUTRO) + ';margin-right:.35rem"></span>' + esc(pt(st)) + '</td>' +
        (modo === 'disq'
          ? '<td style="text-align:left;max-width:190px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(l.motivo || '(sem motivo)') + '</td>' +
            '<td style="text-align:left;font-size:.68rem;min-width:200px">' + razaoHtml(l) + '</td>' +
            '<td style="text-align:left;white-space:nowrap">' + esc(l.autor || '—') + '</td>'
          : '<td style="font-size:.68rem;white-space:nowrap">' + reguasHtml(l) + '</td>') +
        '<td>' + ni(l.colaboradores) + '</td>' +
        '<td style="white-space:nowrap">' + esc(l.tier_colaboradores || '—') + '</td>' +
        '<td>' + ni(l.vidas) + '</td>' +
        '<td style="text-align:left;max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(l.origem || '—') + '</td>' +
        '</tr>';
    }).join('');
    var head = th('leads', 'lead', 'Lead', 'left') +
      '<th style="text-align:left">Empresa</th><th style="text-align:left">BDR</th>' +
      th('leads', 'criado', 'Criado') +
      '<th style="text-align:left">Trilha na janela (avançou)</th>' +
      th('leads', 'status_atual', 'Status atual', 'left') +
      (modo === 'disq' ? '<th style="text-align:left">Motivo</th><th style="text-align:left">Razão (contexto auditável)</th><th style="text-align:left">Quem</th>'
                       : '<th style="text-align:left">Canais de toque</th>') +
      th('leads', 'colaboradores', 'Colabs') + '<th>Tier</th>' + th('leads', 'vidas', 'Vidas') +
      '<th style="text-align:left">Origem</th>';
    return '<table class="lb" style="font-size:.74rem"><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table>' +
      (cap ? '<p style="font-size:.72rem;color:var(--text2);margin:.4rem 0 0">Mostrando 300 de ' + ni(ord.length) + ' — ordene por outra coluna para ver outro recorte.</p>' : '');
  }

  // Diz QUAL canal tocou, não só "houve toque". "✖ sem toque" sem dizer o que foi
  // procurado foi exatamente o que gerou a desconfiança justa do dono no caso Rui
  // Medeiros: a tela afirmava ausência sem declarar o universo que ela olhava.
  function reguasHtml(l) {
    var c = [];
    if (l.ligacoes_conectadas) c.push('☎ ' + l.ligacoes_conectadas);
    if (l.emails_enviados) c.push('✉ ' + l.emails_enviados);
    if (l.linkedin_enviados) c.push('in ' + l.linkedin_enviados);
    if (l.whatsapp_manual) c.push('wa ' + l.whatsapp_manual);
    if (l.reunioes) c.push('◷ ' + l.reunioes);
    var etapa = l.atingiu_tentativa_etapa ? '✅ etapa' : '— etapa';
    if (c.length) return etapa + ' / <span style="color:' + C_BOM_T + '">✅ ' + c.join(' · ') + '</span>';
    if (l.so_automacao) return etapa + ' / <span style="color:var(--text2)">🤖 só automação (' + (l.toques_automacao || 0) + ')</span>';
    return etapa + ' / <span style="color:var(--red)">✖ nenhum toque</span>';
  }

  // A "razão" que o portal não tem em campo próprio: de que etapa saiu, se houve toque
  // antes, e a marca das duas CONTRADIÇÕES. É o que permite auditar o motivo declarado
  // em vez de acreditar nele.
  function razaoHtml(d) {
    var p = [];
    if (d.etapa_de_origem) p.push('saiu de <strong>' + esc(pt(d.etapa_de_origem)) + '</strong>');
    if (d.teve_toque) p.push('<span style="color:' + C_BOM_T + '">✅ ' + (d.toques_manuais || 0) + ' toque(s)</span>' +
      (d.primeiro_toque ? ' desde ' + fmtBR(d.primeiro_toque) : ''));
    else if (d.toques_automacao) p.push('<span style="color:var(--text2)">🤖 só automação</span>');
    else p.push('<span style="color:var(--red)">✖ nenhum toque</span>');
    if (d.contradiz_motivo) p.push('<strong style="color:var(--red)">⚠ motivo diz "sem tentativa" mas houve toque</strong>');
    if (d.desqualificado_sem_toque) p.push('<strong style="color:var(--red)">⚠ desqualificado sem nunca tocar</strong>');
    return p.join(' · ');
  }

  function abre(titulo, list, modo, nota) {
    window._lfLastDrill = function () { abre(titulo, list, modo, nota); };
    openModal(titulo + ' (' + ni(list.length) + ')',
      (nota ? '<p style="font-size:.72rem;color:var(--text2);margin:0 0 .6rem;line-height:1.5">' + nota + '</p>' : '') +
      tabelaAudit(list, modo));
  }

  function movimentados() { return (D && D.waterfall && D.waterfall.leads) || []; }

  function drillMacro(rotulo) {
    var m = D.macro, L = movimentados();
    var f, nota;
    if (/Entrou no funil/.test(rotulo)) { f = function (l) { return l.passos.some(function (p) { return p.de === '(criacao)' && ABERTAS[p.para]; }); }; nota = 'Leads cuja <strong>entrada inaugural</strong> no funil caiu numa etapa aberta na janela.'; }
    else if (/Reativados/.test(rotulo)) { f = function (l) { return l.passos.some(function (p) { return (p.de === 'qualificado' || p.de === 'desqualificado') && ABERTAS[p.para]; }); }; nota = 'Leads que <strong>voltaram</strong> de qualificado ou desqualificado para uma etapa aberta.'; }
    else if (/Qualificados/.test(rotulo)) { f = function (l) { return l.passos.some(function (p) { return p.para === 'qualificado' && ABERTAS[p.de]; }); }; nota = 'Leads que <strong>saíram do funil por cima</strong>: de etapa aberta para Qualificado.'; }
    else if (/Desqualificados/.test(rotulo)) { f = function (l) { return l.passos.some(function (p) { return p.para === 'desqualificado' && ABERTAS[p.de]; }); }; nota = 'Leads que <strong>saíram do funil por baixo</strong>: de etapa aberta para Desqualificado.'; }
    else if (/Saiu do recorte/.test(rotulo)) {
      return openModal('− Saiu do recorte (troca de pipeline)',
        '<p style="font-size:.8rem;line-height:1.7"><strong>' + ni(m.saiu_do_recorte) + ' leads</strong> estavam em etapa aberta de um funil do recorte e foram movidos para um pipeline <strong>fora</strong> dele — na prática, despejados no Backup.</p>' +
        '<p style="font-size:.78rem;color:var(--text2);line-height:1.7">Esta barra existe porque sem ela o waterfall <strong>não fechava em janela longa</strong>, e não por erro de dado: a entrada desses leads era contada (a criação caiu num funil do recorte) e a saída não, porque só movimento com destino DENTRO do recorte era considerado. ' +
        'Medido na janela completa de 936 dias: o resíduo era <strong>−1.285 em 4.297 (30%)</strong> e caiu para <strong>+1 (0,02%)</strong>. ' +
        'Em janela curta o efeito é zero — foi por isso que passou despercebido. Bug que só aparece na escala é bug que espera a escala.</p>');
    }
    else if (/Resíduo/.test(rotulo)) {
      return openModal('± Resíduo do waterfall',
        '<p style="font-size:.8rem;line-height:1.7">O resíduo é <strong>' + sgn(m.residuo) + ' lead</strong> — ' +
        pct(Math.abs(m.residuo), m.aberto_fim) + ' do saldo de fecho.</p>' +
        '<p style="font-size:.78rem;color:var(--text2);line-height:1.7">' + esc(m.conferencia) + '</p>' +
        '<p style="font-size:.78rem;color:var(--text2);line-height:1.7">Ele existe por duas causas medidas: lead que <strong>entra no recorte por troca de pipeline</strong> ' +
        '(1.456 leads já trocaram), e os <strong>2 de 18.296</strong> leads em que a etapa derivada de <code>fact_stage_entry</code> discorda de <code>dim_lead</code>. ' +
        'Ele aparece como barra própria em vez de ser diluído nas outras: waterfall que não fecha e não avisa é ficção que ninguém confere.</p>');
    }
    else { // Aberto @ início / @ fim
      var aberto = movimentados().filter(function (l) { return ABERTAS[l.status_atual]; });
      return abre('Waterfall macro | ' + rotulo, aberto, null,
        'Barra de <strong>saldo</strong>: ' + ni(/início/.test(rotulo) ? m.aberto_inicio : m.aberto_fim) + ' leads em etapa aberta. ' +
        'A lista abaixo são apenas os leads <strong>que se movimentaram na janela</strong> e hoje estão em etapa aberta — o saldo inclui quem não se movimentou e por isso não tem trilha para auditar.');
    }
    abre('Waterfall macro | ' + rotulo, L.filter(f), null, nota);
  }

  function drillStatus(etapa) {
    var L = movimentados();
    var ent = L.filter(function (l) { return l.passos.some(function (p) { return p.para === etapa; }); });
    var sai = L.filter(function (l) { return l.passos.some(function (p) { return p.de === etapa; }); });
    var uniao = ent.concat(sai.filter(function (l) { return ent.indexOf(l) < 0; }));
    var s = (D.waterfall.por_status || []).filter(function (x) { return x.etapa === etapa; })[0] || {};
    abre('Etapa | ' + pt(etapa), uniao, null,
      'Saldo início <strong>' + ni(s.saldo_inicio) + '</strong> · entradas <strong>+' + ni(s.entradas) + '</strong> · saídas <strong>−' + ni(s.saidas) +
      '</strong> · saldo fim <strong>' + ni(s.saldo_fim) + '</strong>. A lista traz quem <strong>entrou ou saiu</strong> desta etapa na janela, com a trilha completa; ' +
      'quem já estava e não se moveu conta no saldo e não aparece aqui.');
  }

  function drillSeta(key) {
    var p = key.split('>'), de = p[0], para = p[1];
    var L = movimentados().filter(function (l) {
      return l.passos.some(function (x) { return x.de === de && x.para === para; });
    });
    var n = D.waterfall.setas[key] || 0;
    abre('Movimentação | ' + (de === '(criacao)' ? 'Começou em' : pt(de)) + ' → ' + pt(para), L, null,
      ni(n) + ' movimentações no período. Um lead que fez a mesma passagem duas vezes conta duas na seta e aparece uma vez aqui — a trilha mostra as duas.');
  }

  function drillDia(dia) {
    var L = movimentados().filter(function (l) { return l.passos.some(function (p) { return p.dia === dia; }) || l.criado === dia; });
    abre('Dia | ' + fmtBRfull(dia), L, null, 'Leads criados nesse dia ou que se movimentaram nesse dia.');
  }

  function drillDim(k) {
    var byId = {}; movimentados().forEach(function (l) { byId[l.lead_id] = l; });
    var list = (D.coorte.leads || []).filter(function (l) { return dimOf(l) === k; }).map(function (l) {
      var m = byId[l.lead_id];
      return m ? Object.assign({}, l, { passos: m.passos, status_atual: m.status_atual, n_movimentos: m.n_movimentos }) : l;
    });
    var agg = ((D.coorte.por_dimensao || {})[reguaDim] || []).filter(function (r) { return r.valor === k; })[0];
    abre('Funil de Leads | ' + k, list, null,
      'Coorte: leads <strong>criados</strong> na janela nesta fatia. A trilha aparece para quem também se movimentou na janela.' +
      (agg && agg.criados !== list.length
        ? '<br><strong>' + ni(agg.criados) + '</strong> na agregação contra <strong>' + ni(list.length) +
          '</strong> nesta lista: a lista por lead é capada em 1.500 (mais recentes) e a agregação cobre tudo.'
        : ''));
  }

  function drillDisq(f) {
    var lista = (D.desqualificacoes || []).filter(function (d) {
      return (!f.dia || d.dia === f.dia) && (!f.motivo || d.motivo === f.motivo) && (!f.autor || d.autor === f.autor);
    });
    var byId = {}; movimentados().forEach(function (l) { byId[l.lead_id] = l; });
    var list = lista.map(function (d) {
      var m = byId[d.lead_id];
      return m ? Object.assign({}, d, { passos: m.passos, status_atual: m.status_atual, criado: m.criado }) : d;
    });
    var titulo = 'Desqualificações' + (f.dia ? ' em ' + fmtBRfull(f.dia) : '') + (f.motivo ? ' | ' + f.motivo : '') + (f.autor ? ' | ' + f.autor : '');
    var contra = list.filter(function (d) { return d.contradiz_motivo; }).length;
    var semToque = list.filter(function (d) { return d.desqualificado_sem_toque; }).length;
    abre(titulo, list, 'disq',
      'Autor é quem <strong>fez o movimento</strong> (updated_by_user_id), não o dono atual do lead. BDR é o dono <strong>no instante</strong> da desqualificação. ' +
      'O portal tem <strong>um</strong> campo de motivo e nenhum de razão livre — a coluna Razão é o contexto que audita o motivo.' +
      ((contra || semToque) ? '<br><strong style="color:var(--red)">⚠ ' +
        (contra ? contra + ' com motivo "sem tentativa de contato" que TIVERAM toque' : '') +
        (contra && semToque ? ' · ' : '') +
        (semToque ? semToque + ' desqualificados sem nunca terem sido tocados' : '') + '</strong>' : ''));
  }
  function drillDisqCel(motivo, autor) { drillDisq({ motivo: motivo, autor: autor }); }

  window.AxLeadFunnel = {
    sectionHtml: function () { return '<div id="lf-host" style="display:contents">' + sectionHtml() + '</div>'; },
    render: paint,
    load: function (f) { load(f); },
    sort: doSort,
    switchFunil: switchFunil,
    switchDim: switchDim,
    switchWf: switchWf,
    drillMacro: drillMacro,
    drillStatus: drillStatus,
    drillSeta: drillSeta,
    drillDia: drillDia,
    drillDim: drillDim,
    drillDisq: drillDisq,
    drillDisqCel: drillDisqCel,
    isLoaded: function () { return !!D; }
  };
})();
