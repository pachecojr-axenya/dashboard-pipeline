/**
 * bdr-lead-funnel.js — Funil de Leads no OBJETO CERTO (0-136), via /api/bdr-lead-funnel.
 *
 * Substitui, na prática, o "Funil de Lead Status" que saía de `hs_lead_status` no
 * CONTATO e media ~10% do funil (jul/26: 234 contatos contra 2.302 leads).
 *
 * QUEBRA DE SÉRIE, e ela está na tela e não só no código: o número sobe ~10x porque é
 * outro OBJETO, não porque o time ficou 10x mais produtivo. A faixa de premissa no
 * topo da seção existe para ninguém comparar com print antigo sem saber disso.
 *
 * Marca de estado nunca só por cor (há BDR daltônico no time): as setas do waterfall
 * carregam ↑/↓/✖ e palavra, não só verde/vermelho.
 *
 * Reusa os helpers globais de bdr.html: _novoMkChart, _novoTheme, NOVO_FONT, _ni, _ne,
 * openModal, _filterState, _infoBtn, _subTabs, _setActive, ChartDataLabels.
 */
(function () {
  'use strict';

  var D = null, ERR = null, LOADING = false, REQ = 0;
  var funil = 'todos';          // todos | principal | diagnostico
  var reguaDim = 'bdr';         // bdr | porte | origem | tier | vidas
  var CAN = ['novo', 'tentativa', 'conectado', 'qualificado', 'desqualificado'];
  var COR = {
    novo: 'rgba(88,166,255,.85)',
    tentativa: 'rgba(210,153,34,.85)',
    conectado: 'rgba(58,184,183,.9)',
    qualificado: 'rgba(63,185,80,.85)',
    desqualificado: 'rgba(248,81,73,.75)'
  };

  function pt(c) { return (D && D.rotulos && D.rotulos[c]) || c; }
  function fmtBR(s) { var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '/' + m[2] : String(s || '—'); }
  function pct(a, b) { return b ? (a / b * 100).toFixed(1).replace('.', ',') + '%' : '—'; }

  // ── carga ──────────────────────────────────────────────────────────────────────
  function load(force) {
    var st = (typeof _filterState === 'function') ? _filterState() : {};
    var hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
    var until = st.end || hoje;
    var since = st.start || (until.slice(0, 8) + '01');
    var url = '/api/bdr-lead-funnel?funil=' + funil + '&since=' + since + '&until=' + until + (force ? '&refresh=1' : '');
    var myReq = ++REQ;
    LOADING = true; ERR = null;
    fetch(url, { credentials: 'include' })
      .then(function (r) { if (!r.ok) return r.text().then(function (t) { throw new Error(t || ('HTTP ' + r.status)); }); return r.json(); })
      .then(function (d) {
        if (myReq !== REQ) return;            // resposta velha de um filtro anterior
        LOADING = false;
        if (!d || !d.success) throw new Error((d && d.error) || 'resposta inválida');
        D = d; paint();
      })
      .catch(function (e) {
        if (myReq !== REQ) return;
        LOADING = false; ERR = String(e && e.message || e); paint();
      });
  }

  function switchFunil(f) { funil = f; if (typeof _setActive === 'function') _setActive('lf-funil-tabs', f); D = null; paint(); load(true); }
  function switchDim(m) { reguaDim = m; if (typeof _setActive === 'function') _setActive('lf-dim-tabs', m); tabelaRegua(); }

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
        'Falha ao carregar o funil de leads: ' + (typeof _ne === 'function' ? _ne(ERR) : ERR) +
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

    var tabsDim = (typeof _subTabs === 'function') ? _subTabs('lf-dim-tabs', reguaDim, [
      { mode: 'bdr', label: 'BDR', fn: 'AxLeadFunnel.switchDim' },
      { mode: 'porte', label: 'Colaboradores', fn: 'AxLeadFunnel.switchDim' },
      { mode: 'tier', label: 'Tier colabs', fn: 'AxLeadFunnel.switchDim' },
      { mode: 'vidas', label: 'Vidas', fn: 'AxLeadFunnel.switchDim' },
      { mode: 'origem', label: 'Origem', fn: 'AxLeadFunnel.switchDim' }
    ]) : '';

    return hdr + aviso + barraFunil +
      painel('Waterfall | movimentações entre etapas no período',
        'Cada seta é uma movimentação de etapa registrada no histórico do lead, atribuída ao pipeline DO EVENTO (não ao pipeline atual — 1.456 leads trocaram de pipeline). "Começou em" = entrada inaugural no funil. Automação e integração aparecem separadas do esforço do BDR: 24% das movimentações não têm autor humano. Clique numa seta para ver os leads.', 'waterfall') +
      card('Snapshot de agora | leads por etapa',
        'Estado ATUAL do funil, direto de dim_lead. É estado, não série — por isso sai do snapshot e não do histórico. A defasagem da extração das 06:30 é declarada no selo à direita da barra de funil.', 'snapshot', 300) +
      card('Criados e movimentados por dia',
        'Barras = leads criados no dia (entrada no funil). Linhas = movimentações que chegaram em cada etapa naquele dia. É a taxa por dia: quantos leads novos por dia, quantos passaram para tentativa, conectado, qualificado ou desqualificado.', 'pordia', 320, null, true) +
      painel('Taxa de contato | AS DUAS RÉGUAS, lado a lado',
        'A tela NÃO escolhe entre as duas réguas. ETAPA = o lead chegou a Tentativa+ no histórico de etapa. ATIVIDADE REAL = houve ligação conectada, e-mail enviado ou LinkedIn enviado (nota não conta: nota não é ação). Medido em jul/26: 89,4% contra 46,7%, com 1.009 leads movidos para Tentativa sem UM toque no CRM — a premissa "teve que passar, senão não tem como" não se sustenta no dado. Clique numa linha para ver os leads.', 'regua', tabsDim) +
      card('Desqualificações por dia',
        'Entradas em Desqualificado por dia, empilhadas por MOTIVO (o objeto Leads tem o campo — o contato nunca teve). Preenchimento: Lead pipeline 99,2%, Diagnóstico Site 0,0% (1.056 sem motivo). Clique num dia para o drill com motivo, autor, porte e origem.', 'disq', 300, null, true) +
      painel('Desqualificações | motivo × quem', 'Cruzamento motivo × autor da movimentação, pelo autor REAL do evento (updated_by_user_id), não pelo dono atual do lead. "Automação" e "Integração" são bucket próprio: ninguém digitou, então não é esforço do BDR. Medido em jul/26: a automação move lead ADIANTE (inscrição em sequência) e quase nunca desqualifica — 1.499 desqualificações por gente contra 1 por integração. Clique numa célula para ver os leads.', 'disqmatrix');
  }

  // ── render ─────────────────────────────────────────────────────────────────────
  function paint() {
    var host = document.getElementById('lf-host');
    if (!host) return;
    host.innerHTML = sectionHtml();
    if (typeof _initTabSubs === 'function') try { _initTabSubs(); } catch (e) {}
    if (!D) { if (!LOADING) load(); return; }
    selo();
    waterfall();
    snapshot();
    porDia();
    tabelaRegua();
    disq();
    disqMatrix();
  }

  function selo() {
    var el = document.getElementById('lf-selo'); if (!el || !D) return;
    var n = (D.waterfall && D.waterfall.movimentos) || 0;
    var cam = (D.diagnostics && D.diagnostics.camadas) || {};
    el.innerHTML = 'camada: <strong>' + (cam.coorte || 'silver') + '</strong> · ' +
      (D.coorte ? D.coorte.criados.toLocaleString('pt-BR') : 0) + ' leads criados · ' +
      n.toLocaleString('pt-BR') + ' movimentações';
  }

  // Waterfall: setas de→para, ordenado pelo funil. Nunca só cor (BDR daltônico).
  function waterfall() {
    var el = document.getElementById('lf-waterfall'); if (!el || !D) return;
    var setas = D.waterfall.setas || {};
    var keys = Object.keys(setas).sort(function (a, b) { return setas[b] - setas[a]; });
    if (!keys.length) { el.innerHTML = '<p style="color:var(--text2);padding:1rem 0">Nenhuma movimentação de etapa no período.</p>'; return; }

    var rank = { '(criacao)': -1, novo: 0, tentativa: 1, conectado: 2, qualificado: 3, desqualificado: 9 };
    var total = keys.reduce(function (a, k) { return a + setas[k]; }, 0);
    var max = Math.max.apply(null, keys.map(function (k) { return setas[k]; }));

    var linhas = keys.map(function (k) {
      var p = k.split('>'), de = p[0], para = p[1];
      var rd = rank[de] == null ? 0 : rank[de], rp = rank[para] == null ? 0 : rank[para];
      var tipo, marca;
      if (de === '(criacao)') { tipo = 'entrada'; marca = '＋ entrou'; }
      else if (para === 'desqualificado') { tipo = 'saida'; marca = '✖ desqualificou'; }
      else if (rp > rd) { tipo = 'avanco'; marca = '↑ avançou'; }
      else if (rp < rd) { tipo = 'retorno'; marca = '↓ voltou'; }
      else { tipo = 'lateral'; marca = '→ lateral'; }
      var cor = tipo === 'avanco' ? COR.qualificado : tipo === 'saida' ? COR.desqualificado
        : tipo === 'entrada' ? COR.novo : tipo === 'retorno' ? COR.tentativa : 'rgba(140,140,150,.6)';
      var w = max ? Math.round(setas[k] / max * 100) : 0;
      var rot = (de === '(criacao)' ? 'Começou em' : pt(de)) + ' → ' + pt(para);
      return '<tr style="cursor:pointer" onclick="AxLeadFunnel.drillSeta(\'' + k + '\')">' +
        '<td style="text-align:left;white-space:nowrap;font-weight:600">' + rot + '</td>' +
        '<td style="white-space:nowrap;font-size:.72rem;color:var(--text2)">' + marca + '</td>' +
        '<td style="text-align:right;font-weight:700;white-space:nowrap">' + setas[k].toLocaleString('pt-BR') + '</td>' +
        '<td style="min-width:140px"><div style="height:8px;background:var(--card2);border-radius:4px;overflow:hidden">' +
        '<div style="width:' + w + '%;height:100%;background:' + cor + '"></div></div></td>' +
        '<td style="text-align:right;font-size:.72rem;color:var(--text2);white-space:nowrap">' + pct(setas[k], total) + '</td></tr>';
    }).join('');

    el.innerHTML = '<table class="lb" style="font-size:.78rem;width:100%"><thead><tr>' +
      '<th style="text-align:left">Movimentação</th><th style="text-align:left">Natureza</th>' +
      '<th style="text-align:right">Leads</th><th></th><th style="text-align:right">% do total</th>' +
      '</tr></thead><tbody>' + linhas + '</tbody>' +
      '<tfoot><tr><td style="text-align:left;font-weight:700">Total</td><td></td>' +
      '<td style="text-align:right;font-weight:700">' + total.toLocaleString('pt-BR') + '</td><td></td><td></td></tr></tfoot></table>';
  }

  function snapshot() {
    if (!D || typeof _novoMkChart !== 'function') return;
    var th = _novoTheme();
    var s = D.snapshot.por_etapa || {};
    var ordem = CAN.filter(function (c) { return s[c]; });
    var total = ordem.reduce(function (a, c) { return a + s[c]; }, 0);
    var cv = document.getElementById('lf-snapshot');
    if (cv) cv.style.height = Math.max(ordem.length * 38 + 40, 150) + 'px';
    _novoMkChart('lf-snapshot', {
      type: 'bar', plugins: [ChartDataLabels],
      data: { labels: ordem.map(pt), datasets: [{ data: ordem.map(function (c) { return s[c]; }), backgroundColor: ordem.map(function (c) { return COR[c]; }), borderRadius: 4 }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false, layout: { padding: { right: 90 } },
        plugins: {
          legend: { display: false },
          datalabels: { anchor: 'end', align: 'right', color: th.cText, font: { family: NOVO_FONT, size: 11, weight: 'bold' }, formatter: function (v) { return v.toLocaleString('pt-BR') + ' (' + (total ? Math.round(v / total * 100) : 0) + '%)'; } },
          tooltip: { callbacks: { label: function (c) { return c.parsed.x.toLocaleString('pt-BR') + ' leads | ' + pct(c.parsed.x, total) + ' do funil'; } } }
        },
        scales: { x: { grid: { color: th.cGrid }, ticks: { color: th.cText2, font: { family: NOVO_FONT }, precision: 0 } }, y: { grid: { display: false }, ticks: { color: th.cText, font: { family: NOVO_FONT }, autoSkip: false } } }
      }
    });
  }

  function porDia() {
    if (!D || typeof _novoMkChart !== 'function') return;
    var th = _novoTheme();
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
        plugins: { legend: { display: true, labels: { color: th.cText2, font: { family: NOVO_FONT, size: 10 }, padding: 8 } }, tooltip: { mode: 'index', intersect: false } },
        scales: { x: { grid: { display: false }, ticks: { color: th.cText2, font: { family: NOVO_FONT, size: 9 }, maxRotation: 0, autoSkip: true } }, y: { grid: { color: th.cGrid }, ticks: { color: th.cText2, font: { family: NOVO_FONT }, precision: 0 } } }
      }
    });
  }

  // Dimensões da tabela das duas réguas. "(não preenchido)" é CATEGORIA VISÍVEL:
  // esconder o vazio é o que faz um corte de 6,9% de cobertura parecer análise.
  function dimOf(l) {
    if (reguaDim === 'bdr') return l.bdr || '(sem dono)';
    if (reguaDim === 'origem') return l.origem || '(sem origem)';
    if (reguaDim === 'tier') return l.tier_colaboradores || '(não preenchido)';
    if (reguaDim === 'vidas') {
      if (l.vidas == null) return '(não preenchido)';
      return l.vidas < 50 ? '< 50 vidas' : l.vidas < 200 ? '50–200' : l.vidas < 500 ? '200–500' : '500+';
    }
    if (l.colaboradores == null) return '(não preenchido)';
    return l.colaboradores < 50 ? '< 50' : l.colaboradores < 200 ? '50–200' : l.colaboradores < 500 ? '200–500' : '500+';
  }

  function tabelaRegua() {
    var el = document.getElementById('lf-regua'); if (!el || !D) return;
    var leads = D.coorte.leads || [];
    if (!leads.length) { el.innerHTML = '<p style="color:var(--text2);padding:1rem 0">Nenhum lead criado no período.</p>'; return; }

    var rows = {};
    leads.forEach(function (l) {
      var k = dimOf(l);
      var r = rows[k] = rows[k] || { n: 0, etapa: 0, ativ: 0, ambos: 0, qual: 0, deal: 0, dq: 0, list: [] };
      r.n++; r.list.push(l);
      if (l.atingiu_tentativa_etapa) r.etapa++;
      if (l.atividade_real) r.ativ++;
      if (l.atingiu_tentativa_etapa && l.atividade_real) r.ambos++;
      if (l.qualificado) r.qual++;
      if (l.deal_id) r.deal++;
      if (l.desqualificado) r.dq++;
    });
    var keys = Object.keys(rows).sort(function (a, b) { return rows[b].n - rows[a].n; }).slice(0, 25);
    window._lfReguaRows = rows; window._lfReguaKeys = keys;

    var tot = { n: 0, etapa: 0, ativ: 0, ambos: 0, qual: 0, deal: 0, dq: 0 };
    keys.forEach(function (k) { Object.keys(tot).forEach(function (f) { tot[f] += rows[k][f]; }); });

    var barra = function (a, b, cor) {
      var p = b ? Math.round(a / b * 100) : 0;
      return '<td style="min-width:104px"><div style="display:flex;align-items:center;gap:.4rem;justify-content:flex-end">' +
        '<div style="flex:1;max-width:62px;height:6px;background:var(--card2);border-radius:3px;overflow:hidden">' +
        '<div style="width:' + p + '%;height:100%;background:' + cor + '"></div></div>' +
        '<span style="white-space:nowrap">' + pct(a, b) + '</span></div></td>';
    };
    var rotDim = { bdr: 'BDR', porte: 'Colaboradores', tier: 'Tier colabs', vidas: 'Vidas', origem: 'Origem' }[reguaDim];

    var html = '<div style="font-size:.72rem;color:var(--text2);margin:.1rem 0 .5rem">' +
      '<strong style="color:var(--text)">Gap das réguas:</strong> ' +
      tot.etapa.toLocaleString('pt-BR') + ' passaram de etapa (' + pct(tot.etapa, tot.n) + ') contra ' +
      tot.ativ.toLocaleString('pt-BR') + ' com atividade real (' + pct(tot.ativ, tot.n) + '). ' +
      '<strong style="color:var(--red)">' + (tot.etapa - tot.ambos).toLocaleString('pt-BR') + ' leads foram movidos de etapa sem nenhum toque registrado.</strong>' +
      '</div>';

    html += '<table class="lb" style="font-size:.78rem;width:100%"><thead><tr>' +
      '<th style="text-align:left">' + rotDim + '</th><th>Criados</th>' +
      '<th>Tx contato<br><span style="font-weight:400;font-size:.66rem;color:var(--text2)">por ETAPA</span></th>' +
      '<th>Tx contato<br><span style="font-weight:400;font-size:.66rem;color:var(--text2)">por ATIVIDADE</span></th>' +
      '<th>Etapa sem<br>toque</th><th>Qualificados</th><th>Com deal</th><th>Desqualif.</th></tr></thead><tbody>';
    keys.forEach(function (k, idx) {
      var r = rows[k];
      var lacuna = r.etapa - r.ambos;
      html += '<tr style="cursor:pointer" onclick="AxLeadFunnel.drillDim(' + idx + ')">' +
        '<td style="text-align:left;white-space:nowrap;max-width:210px;overflow:hidden;text-overflow:ellipsis;font-weight:600">' + (typeof _ne === 'function' ? _ne(k) : k) + '</td>' +
        '<td>' + r.n.toLocaleString('pt-BR') + '</td>' +
        barra(r.etapa, r.n, COR.tentativa) + barra(r.ativ, r.n, COR.conectado) +
        '<td style="color:' + (lacuna ? 'var(--red)' : 'var(--text2)') + '">' + lacuna.toLocaleString('pt-BR') + '</td>' +
        '<td>' + r.qual.toLocaleString('pt-BR') + '</td><td>' + r.deal.toLocaleString('pt-BR') + '</td>' +
        '<td>' + r.dq.toLocaleString('pt-BR') + '</td></tr>';
    });
    html += '</tbody><tfoot><tr><td style="text-align:left;font-weight:700">Total</td>' +
      '<td style="font-weight:700">' + tot.n.toLocaleString('pt-BR') + '</td>' +
      '<td style="font-weight:700;text-align:right">' + pct(tot.etapa, tot.n) + '</td>' +
      '<td style="font-weight:700;text-align:right">' + pct(tot.ativ, tot.n) + '</td>' +
      '<td style="font-weight:700">' + (tot.etapa - tot.ambos).toLocaleString('pt-BR') + '</td>' +
      '<td style="font-weight:700">' + tot.qual.toLocaleString('pt-BR') + '</td>' +
      '<td style="font-weight:700">' + tot.deal.toLocaleString('pt-BR') + '</td>' +
      '<td style="font-weight:700">' + tot.dq.toLocaleString('pt-BR') + '</td></tr></tfoot></table>';
    el.innerHTML = html;
  }

  function disq() {
    if (!D || typeof _novoMkChart !== 'function') return;
    var th = _novoTheme();
    var lista = D.desqualificacoes || [];
    if (!lista.length) { return; }
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
          legend: { display: true, labels: { color: th.cText2, font: { family: NOVO_FONT, size: 9 }, padding: 6, boxWidth: 10 } },
          datalabels: { display: function (c) { return c.datasetIndex === c.chart.data.datasets.length - 1; }, anchor: 'end', align: 'top', color: th.cText, font: { family: NOVO_FONT, size: 9, weight: 'bold' }, formatter: function (v, c) { var t = 0; c.chart.data.datasets.forEach(function (d) { t += (d.data[c.dataIndex] || 0); }); return t || ''; } },
          tooltip: { mode: 'index', intersect: false, filter: function (i) { return i.parsed.y > 0; } }
        },
        scales: { x: { stacked: true, grid: { display: false }, ticks: { color: th.cText2, font: { family: NOVO_FONT, size: 9 }, maxRotation: 0, autoSkip: true } }, y: { stacked: true, grid: { color: th.cGrid }, ticks: { color: th.cText2, font: { family: NOVO_FONT }, precision: 0 } } },
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
      cols.map(function (a) { return '<th style="font-size:.66rem;max-width:90px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (typeof _ne === 'function' ? _ne(a) : a) + '</th>'; }).join('') +
      '<th>Total</th></tr></thead><tbody>';
    rows.forEach(function (m) {
      h += '<tr><td style="text-align:left;max-width:230px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600">' + (typeof _ne === 'function' ? _ne(m) : m) + '</td>';
      cols.forEach(function (a) {
        var n = lista.filter(function (x) { return x.motivo === m && x.autor === a; }).length;
        var alpha = max ? (0.10 + 0.62 * (n / max)) : 0;
        h += '<td style="' + (n ? 'background:rgba(248,81,73,' + alpha.toFixed(2) + ');cursor:pointer' : 'color:var(--text2)') + '"' +
          (n ? ' onclick="AxLeadFunnel.drillDisqCel(' + JSON.stringify(m).replace(/"/g, '&quot;') + ',' + JSON.stringify(a).replace(/"/g, '&quot;') + ')"' : '') +
          '>' + (n || '·') + '</td>';
      });
      h += '<td style="font-weight:700">' + motivos[m].toLocaleString('pt-BR') + '</td></tr>';
    });
    h += '</tbody></table>';
    if (motivos['(sem motivo)']) {
      h += '<p style="font-size:.7rem;color:var(--text2);margin:.5rem 0 0">' +
        '<strong>' + motivos['(sem motivo)'].toLocaleString('pt-BR') + ' desqualificações sem motivo.</strong> ' +
        'No Diagnóstico (Site) o preenchimento é 0% — a propriedade não é preenchida naquele funil. Isso é o dado, não falha da tela.</p>';
    }
    el.innerHTML = h;
  }

  // ── drills ─────────────────────────────────────────────────────────────────────
  function tabelaLeads(list, cols) {
    if (!list.length) return '<p style="color:var(--text2);padding:1rem 0">Nenhum lead.</p>';
    var cap = list.length > 300;
    var rows = list.slice(0, 300).map(function (l) {
      var url = 'https://app.hubspot.com/contacts/44715285/record/0-136/' + l.lead_id;
      return '<tr>' +
        '<td style="text-align:left;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><a href="' + url + '" target="_blank" rel="noopener" style="color:var(--teal);text-decoration:none">' + (typeof _ne === 'function' ? _ne(l.lead || l.lead_id) : (l.lead || l.lead_id)) + '</a></td>' +
        '<td style="text-align:left;max-width:170px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (typeof _ne === 'function' ? _ne(l.empresa || '—') : (l.empresa || '—')) + '</td>' +
        '<td style="text-align:left;white-space:nowrap">' + (typeof _ne === 'function' ? _ne(l.bdr || '—') : (l.bdr || '—')) + '</td>' +
        (cols === 'disq'
          ? '<td style="text-align:left;max-width:210px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (typeof _ne === 'function' ? _ne(l.motivo || '—') : (l.motivo || '—')) + '</td>' +
            '<td style="text-align:left;white-space:nowrap">' + (typeof _ne === 'function' ? _ne(l.autor || '—') : (l.autor || '—')) + '</td>' +
            '<td style="white-space:nowrap">' + fmtBR(l.dia) + '</td>'
          : '<td style="white-space:nowrap">' + pt(l.etapa) + '</td>' +
            '<td style="font-size:.7rem;white-space:nowrap">' + (l.atingiu_tentativa_etapa ? '✅ etapa' : '—') + ' / ' + (l.atividade_real ? '✅ toque' : '✖ sem toque') + '</td>' +
            '<td style="white-space:nowrap">' + fmtBR(l.criado) + '</td>') +
        '<td>' + (l.colaboradores != null ? l.colaboradores.toLocaleString('pt-BR') : '—') + '</td>' +
        '<td style="white-space:nowrap">' + (l.tier_colaboradores || '—') + '</td>' +
        '<td>' + (l.vidas != null ? l.vidas.toLocaleString('pt-BR') : '—') + '</td>' +
        '<td style="text-align:left;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (typeof _ne === 'function' ? _ne(l.origem || '—') : (l.origem || '—')) + '</td>' +
        '</tr>';
    }).join('');
    var head = cols === 'disq'
      ? '<th style="text-align:left">Lead</th><th style="text-align:left">Empresa</th><th style="text-align:left">Dono no instante</th><th style="text-align:left">Motivo</th><th style="text-align:left">Quem</th><th>Dia</th>'
      : '<th style="text-align:left">Lead</th><th style="text-align:left">Empresa</th><th style="text-align:left">BDR</th><th>Etapa</th><th>Réguas</th><th>Criado</th>';
    return '<table class="lb" style="font-size:.76rem"><thead><tr>' + head +
      '<th>Colabs</th><th>Tier</th><th>Vidas</th><th style="text-align:left">Origem</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      (cap ? '<p style="font-size:.72rem;color:var(--text2);margin:.4rem 0 0">Mostrando 300 de ' + list.length.toLocaleString('pt-BR') + '.</p>' : '');
  }

  function drillSeta(key) {
    if (!D) return;
    // O waterfall é agregado no servidor; o drill usa a coorte (leads criados na
    // janela) filtrada pelo destino. Movimento de lead criado ANTES da janela não
    // aparece aqui — declarado no rodapé em vez de silenciado.
    var p = key.split('>'), para = p[1];
    var list = (D.coorte.leads || []).filter(function (l) {
      if (para === 'desqualificado') return l.desqualificado;
      if (para === 'qualificado') return l.qualificado;
      if (para === 'conectado') return l.atingiu_conectado_etapa;
      if (para === 'tentativa') return l.atingiu_tentativa_etapa;
      return true;
    });
    var n = D.waterfall.setas[key] || 0;
    openModal('Waterfall | ' + (p[0] === '(criacao)' ? 'Começou em' : pt(p[0])) + ' → ' + pt(para) + ' (' + n.toLocaleString('pt-BR') + ' movimentações)',
      '<p style="font-size:.72rem;color:var(--text2);margin:0 0 .6rem">Movimentações no período: <strong>' + n.toLocaleString('pt-BR') + '</strong>. ' +
      'A lista abaixo são os leads <strong>criados na janela</strong> que atingiram ' + pt(para) + ' — lead criado antes da janela conta na seta e não aparece na lista.</p>' +
      tabelaLeads(list));
  }
  function drillDim(idx) {
    var keys = window._lfReguaKeys || [], rows = window._lfReguaRows || {};
    var k = keys[idx]; if (k == null || !rows[k]) return;
    openModal('Funil de Leads | ' + k + ' (' + rows[k].n.toLocaleString('pt-BR') + ' leads)', tabelaLeads(rows[k].list));
  }
  function drillDisq(f) {
    if (!D) return;
    var list = (D.desqualificacoes || []).filter(function (d) { return (!f.dia || d.dia === f.dia) && (!f.motivo || d.motivo === f.motivo) && (!f.autor || d.autor === f.autor); });
    var titulo = 'Desqualificações' + (f.dia ? ' em ' + fmtBR(f.dia) : '') + (f.motivo ? ' | ' + f.motivo : '') + (f.autor ? ' | ' + f.autor : '');
    openModal(titulo + ' (' + list.length.toLocaleString('pt-BR') + ')', tabelaLeads(list, 'disq'));
  }
  function drillDisqCel(motivo, autor) { drillDisq({ motivo: motivo, autor: autor }); }

  window.AxLeadFunnel = {
    sectionHtml: function () { return '<div id="lf-host" style="display:contents">' + sectionHtml() + '</div>'; },
    render: paint,
    load: function (f) { load(f); },
    switchFunil: switchFunil,
    switchDim: switchDim,
    drillSeta: drillSeta,
    drillDim: drillDim,
    drillDisq: drillDisq,
    drillDisqCel: drillDisqCel,
    isLoaded: function () { return !!D; }
  };
})();
