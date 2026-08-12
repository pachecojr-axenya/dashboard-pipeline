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
  var convDim = 'bdr';          // dimensão da tabela de CONVERSÃO (tabs próprias)
  var wfView = 'status';        // status | mov  — "ver pelo status" é o default pedido
  // SÓ BDRs, ligado por padrão. A tabela chamada "BDR" listava todo dono de lead —
  // SuperAdmin com 613 leads, closers, Placement, ex-BDR arquivado — rankeados junto
  // com o time. Quem não é BDR não some da existência: sai do corte de gente e o
  // rodapé diz quantos e quantos leads foram para trás do filtro.
  var soBdr = true;
  /**
   * FILTRO DE CAMPO: um par (dimensão, valor) que agora recorta a SEÇÃO INTEIRA.
   *
   * Mudou de lado em 12/08/2026, a pedido do dono ("todos esses gráficos precisam
   * desses filtros"). Antes ele era só do browser e alcançava três cards; agora vai
   * como parâmetro para o servidor e vale para coorte, série, os dois waterfalls,
   * snapshot, criados por dia e desqualificações.
   *
   * O CUSTO É UMA IDA AO BANCO, e ele é aceito de propósito: filtro que recorta a
   * tabela e deixa o gráfico ao lado com o time inteiro é pior do que filtro nenhum,
   * porque as duas leituras ficam na mesma tela parecendo comparáveis.
   *
   * O CRUZAMENTO passou a existir: com o recorte em "BDR = X", a tabela por tier mostra
   * a distribuição de tier daquele BDR. Cada linha do payload vem marcada com `rec`
   * (dentro/fora do recorte), então as combos continuam com todos os valores enquanto a
   * conta usa só a fatia.
   */
  var filtroDim = null, filtroVal = null;
  var serieView = 'ate_qual';   // ate_qual | passo | volume
  // Granularidade da linha do tempo e do gráfico por período. null = deixa o servidor
  // escolher o padrão adaptativo (dia até 31d, semana até 120, mês até 550, trimestre).
  var gran = null;
  // Séries escondidas pelo clique na legenda, por visão. O eixo de % se reescala ao
  // que sobrou visível — sem isto, olhar UMA taxa de 8% num eixo 0–100 é olhar uma
  // linha reta colada no chão.
  var escondidas = {};
  // Quebra da linha do tempo: uma linha por valor da dimensão (BDR, canal, tier, vidas)
  // em vez de uma linha só do total.
  var quebraDim = null;
  // Visão da tabela por dimensão: contato (as três réguas), funil (conversão) ou
  // penetração (empresas). Ver tabelaRegua().
  var reguaView = 'contato';
  // Matriz de desqualificação: motivo × QUEM fez, ou motivo × EVIDÊNCIA registrada.
  var disqView = 'autor';
  // Ordenação por tabela. dir: 1 asc, -1 desc.
  var sort = {
    wf:    { col: 'saldo_fim', dir: -1 },
    mov:   { col: 'n',         dir: -1 },
    // A conversão nasce ordenada por VOLUME, não por taxa: taxa de 3 leads no topo
    // do rank é ruído com cara de campeão.
    conv:  { col: 'criados',   dir: -1 },
    // No corte por BDR o rank nasce por TRABALHO NA JANELA, não por "criados":
    // ordenar por criados joga para o fim quem trabalhou carteira antiga, que é
    // exatamente quem a coluna de trabalho existe para tornar visível.
    regua: { col: 'trab_toques', dir: -1 },
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

  /**
   * AS FICHAS DOS CARDS — o que faz o ícone "i" ABRIR alguma coisa.
   *
   * Defeito relatado pelo dono em 12/08/2026: *"o ícone de informação deveria abrir
   * aquela telinha dizendo o que tem ali"*. Ele não abria, e o motivo estava em
   * `_infoBtn` (bdr.html): o botão só ganha `onclick` quando existe uma ficha com aquela
   * chave em `BDR_HELP_CHARTS`. Sem ficha, o ícone renderiza igual e não faz nada — a
   * pior combinação possível, porque parece clicável.
   *
   * As fichas ficam AQUI, junto do código que desenha os cards, e não no HTML: card e
   * memória de cálculo que moram em arquivos diferentes é como um dos dois envelhece
   * sem o outro. `fields` nomeia as propriedades e tabelas de onde o número sai, no
   * mesmo formato das fichas antigas do painel.
   */
  var FICHAS = [
    { key: 'conv', title: 'Conversão do funil | do lead criado ao deal',
      desc: 'Coorte de leads CRIADOS na janela, seguida até hoje. A régua é ACUMULADA: "chegou a Conectado+" quer dizer que o lead VISITOU a etapa em algum momento, não que esteja nela agora — por isso os passos encaixam e a conversão do processo é o PRODUTO deles. NÃO é "movimentações no período", régua que conta o mesmo lead a cada toque e infla ~4x. A coorte recente ainda está viva: o período corrente sempre converte menos que um fechado.',
      formula: 'passo = leads que atingiram a etapa ÷ leads que atingiram a etapa anterior · processo = qualificados ÷ criados · Qualificado→Deal usa a INTERSEÇÃO (qualificado E com deal), senão a taxa passa de 100%',
      fields: [['hs_pipeline_stage', 'Etapa do lead; o histórico vem de fact_stage_entry (visitas) e fact_crm_change (movimentos).'], ['hs_createdate', 'Define a coorte: o lead entra pela data de criação, não pela data em que converteu.'], ['bridge_association lead→deal', 'Deal originado do lead.']] },
    { key: 'serie', title: 'Linha do tempo da conversão',
      desc: 'A mesma coorte dos cards com o eixo do tempo aberto: cada ponto é a coorte criada naquele período, seguida até hoje. Período é escolha (dia, semana ISO, mês, trimestre); "Auto" usa dia até 31 dias, semana até 120, mês até 550 e trimestre acima. QUEBRAR desenha uma linha por BDR, canal, tier ou vidas (máximo 6, as maiores por volume). O eixo de % se ajusta ao mínimo e máximo das linhas VISÍVEIS — clicar na legenda reescala. O último ponto é PARCIAL (tracejado e com *): a coorte ainda vai converter.',
      formula: 'taxa do período = numerador ÷ denominador DENTRO da coorte daquele período · eixo % = [mín − 10% da amplitude, máx + 10%], com amplitude mínima de 5 p.p.',
      fields: [['hs_createdate', 'Bucket do eixo (dia/semana ISO/mês/trimestre), em America/Sao_Paulo.'], ['fact_stage_entry', 'Etapas visitadas por lead, que alimentam cada taxa.']] },
    { key: 'convtab', title: 'Conversão por dimensão',
      desc: 'A mesma conversão de coorte, aberta por dimensão. Cada passo é medido SOBRE A ETAPA ANTERIOR — é o que separa "perde no primeiro contato" de "perde na qualificação". A última coluna é o processo inteiro. Com um filtro ativo em outra dimensão, esta tabela mostra o CRUZAMENTO (ex.: o tier daquele BDR).',
      formula: 'cada célula = etapa ÷ etapa anterior, dentro da fatia da dimensão',
      fields: [['hubspot_owner_id', 'Dono do lead, colapsado para o nome canônico do roster de BDR.'], ['tier_colaboradores', 'Tier do contato, lido do bronze (não existe no silver).'], ['company_lives_bucket', 'Faixa de vidas do armazém (dim_lead_context).']] },
    { key: 'macro', title: 'Waterfall macro | o funil que abre, recebe, perde e fecha',
      desc: 'Aberto@início + entrou + entrou sem registro + reativados (+ recebidos de outro BDR) − qualificados − desqualificados − saiu do recorte (− passados para outro BDR) = Aberto@fim. ABERTO = Novo + Tentativa + Conectado; qualificado e desqualificado são SAÍDAS do funil de prospecção. O que a aritmética não explica vira a barra "Resíduo", exposta em vez de diluída: waterfall que não fecha no saldo é ficção.',
      formula: 'saldo em T = última entrada de fact_stage_entry com entered_at ≤ T (dim_lead só sabe o agora) · resíduo = fecho medido − fecho calculado',
      fields: [['fact_stage_entry', 'Entradas de etapa com timestamp; é dela que sai o saldo em qualquer instante.'], ['fact_crm_change (hs_pipeline_stage)', 'Movimentos de→para dentro da janela.'], ['fact_owner_assignment', 'Dono NO INSTANTE do movimento e as transferências de carteira.']] },
    { key: 'poretapa', title: 'Waterfall por etapa | entradas contra saídas',
      desc: 'O mesmo período do macro, aberto por etapa: barras para cima são entradas, para baixo são saídas, e o losango marca o saldo no fim. Barras opostas de tamanho parecido significam etapa que GIROU muito e ANDOU pouco — informação que a coluna de saldo esconde, porque saldo é a diferença e a diferença não sabe o tamanho do fluxo.',
      formula: 'entradas = movimentos que CHEGARAM na etapa · saídas = movimentos que SAÍRAM dela · líquido = entradas − saídas',
      fields: [['fact_crm_change (hs_pipeline_stage)', 'Uma linha por movimentação de etapa.']] },
    { key: 'waterfall', title: 'Waterfall detalhado',
      desc: 'Duas leituras do mesmo período. POR STATUS: como cada etapa ganhou e perdeu, com saldo no início, entradas, saídas, saldo no fim e o resíduo por etapa. POR MOVIMENTAÇÃO: cada seta de→para, com a natureza marcada por símbolo e palavra (nunca só por cor — há BDR daltônico no time).',
      formula: 'por etapa: saldo início + entradas − saídas = saldo fim (± resíduo)',
      fields: [['fact_crm_change', 'old_value → new_value da propriedade de etapa.'], ['dim_lead', 'Status atual do lead, para a trilha do drill.']] },
    { key: 'snapshot', title: 'Snapshot de agora | estado e giro',
      desc: 'À esquerda o ESTADO: quantos leads estão em cada etapa agora. À direita o GIRO da janela: quanto entrou e saiu de cada etapa. As duas leituras juntas porque estoque sozinho não distingue etapa parada de etapa que girou muito e voltou ao mesmo lugar. Estado e giro NÃO somam entre si: um é foto, o outro é filme.',
      formula: 'estado = COUNT de dim_lead por etapa canônica · giro = entradas e saídas de fact_crm_change na janela',
      fields: [['dim_lead.hs_pipeline_stage', 'Etapa atual (extração das 06:30; o selo do topo mostra a defasagem).']] },
    { key: 'pordia', title: 'Criados e movimentados por período',
      desc: 'Barras = leads CRIADOS no período, vindos da agregação do BigQuery (não da lista do drill, que é capada em 1.500 e desenhava menos de 10% da coorte em janela longa). Linhas = movimentações que CHEGARAM em cada etapa. Segue a granularidade escolhida na linha do tempo.',
      formula: 'criados = GROUP BY dia sobre a coorte · movimentações = fact_crm_change agrupado pelo mesmo período',
      fields: [['hs_createdate', 'Data de criação do lead.'], ['fact_crm_change', 'Data da movimentação de etapa.']] },
    { key: 'regua', title: 'Esforço, funil e penetração por dimensão',
      desc: 'TRÊS VISÕES. CONTATO: as três réguas empilhadas — TENTOU (discou ou mandou mensagem; discagem que não conectou CONTA, decisão do head de BDRs em 12/08/2026), FALOU COM (mensagem enviada, ligação conectada ou reunião realizada) e CONVERSOU (voz atendida, com duração). FUNIL: criou, avançou, qualificou, perdeu. PENETRAÇÃO: empresas distintas, empresas novas e leads por empresa. No corte por pessoa, "Trabalhou na janela" é atribuída a QUEM TOCOU, não ao dono do lead.',
      formula: 'tx contato por ATIVIDADE = leads com toque real ÷ criados · tx por ETAPA = leads que chegaram a Tentativa+ ÷ criados · discagens por conversa = discagens ÷ ligações conectadas · leads por empresa = criados ÷ empresas distintas',
      fields: [['fact_engagement.is_connected', 'Ligação atendida; a discagem sem conexão entra como tentativa.'], ['fact_engagement.disposition_label', 'Desfecho da ligação (Sem resposta, Ocupado, Número errado…).'], ['fact_engagement.duration_ms', 'Tempo ao telefone, somado só nas conectadas.'], ['fact_engagement.channel_type', 'WhatsApp e LinkedIn; WhatsApp de INTEGRATION vai para o bucket de automação.'], ['bridge_association lead→company', 'Empresa do lead, para a penetração.']] },
    { key: 'disq', title: 'Desqualificações por período',
      desc: 'Entradas em Desqualificado empilhadas por MOTIVO. O objeto Leads tem o campo (o contato nunca teve), mas o preenchimento é desigual: Lead pipeline 99,2%, Diagnóstico Site 0,0% (1.056 sem motivo). "(sem motivo)" ali é o dado, não falha da tela.',
      formula: 'COUNT de movimentos com destino = Desqualificado, por dia × motivo',
      fields: [['motivos_de_desqualificacao', '17 valores fechados; não existe campo de razão livre no lead.']] },
    { key: 'disqmatrix', title: 'Desqualificações | motivo × quem',
      desc: 'Cruzamento motivo × autor REAL do evento (updated_by_user_id), não o dono atual do lead. "Automação" e "Integração" são bucket próprio: ninguém digitou, então não é esforço do BDR. Medido em jul/26: 1.499 desqualificações por gente contra 1 por integração — a automação move lead ADIANTE, quase nunca desqualifica.',
      formula: 'COUNT por (motivo, autor), com autor = Automação/Integração quando source_type não é humano',
      fields: [['fact_crm_change.updated_by_user_id', 'Quem fez o movimento.'], ['fact_crm_change.source_type', 'CRM_UI, AUTOMATION_PLATFORM, INTEGRATION.']] }
  ];
  /**
   * O registro é PREGUIÇOSO, e isso não é estilo: este arquivo é carregado no <head>,
   * e `BDR_HELP_CHARTS` só nasce no script inline do <body>. Registrar na carga do
   * módulo falharia em silêncio — exatamente o modo de falha que o ícone morto tinha.
   * Idempotente porque a seção repinta a cada filtro, e ficha duplicada faria o drawer
   * listar o mesmo card várias vezes.
   */
  function registraFichas() {
    try {
      if (!window.BDR_HELP_CHARTS || !window.BDR_HELP_CHARTS.push) return;
      FICHAS.forEach(function (f) {
        var ja = window.BDR_HELP_CHARTS.some(function (x) { return x.key === f.key; });
        if (!ja) window.BDR_HELP_CHARTS.push(f);
      });
    } catch (e) { /* a ficha é enriquecimento; sem ela o tooltip ainda funciona */ }
  }

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
    else if (tabela === 'conv') tabelaConversao();
    else if (tabela === 'leads') { if (window._lfLastDrill) window._lfLastDrill(); }
  }

  // ── A COORTE, agregada, com o filtro de gente aplicado ────────────────────────
  // O servidor manda cada dimensão quebrada por `bdr` (é BDR sim/não). Colapsar aqui
  // é o que permite ligar/desligar o filtro sem uma segunda ida ao banco — e o filtro
  // vale para TODA dimensão, não só para a de gente: se valesse só ali, o corte por
  // porte continuaria contando lead de executivo e as duas tabelas da mesma tela
  // mediriam universos diferentes com a mesma cara.
  var CAMPOS = ['criados', 'com_atividade', 'por_etapa', 'conectados', 'ambos',
    'so_automacao', 'toque_herdado', 'nunca_tocados', 'qualificados', 'com_deal',
    'qual_com_deal', 'deal_sem_qualificar', 'desqualificados', 'trab_leads', 'trab_toques',
    // esforço + penetração (leva 6)
    'com_tentativa', 'com_conversa', 'discagens', 'conectadas', 'numero_errado',
    'duracao_conectada_s', 'empresas', 'empresas_novas'];

  /**
   * `todas` = ignora o recorte e soma tudo. É o modo das COMBOS de filtro, que precisam
   * dos valores que estão FORA do recorte para o usuário poder trocar de fatia sem
   * limpar o filtro antes. Todo o resto da tela usa o padrão (só o recorte).
   */
  function linhasDim(dim, incluirNaoBdr, todas) {
    var raw = (D && D.coorte && D.coorte.por_dimensao && D.coorte.por_dimensao[dim]) || [];
    var m = {}, ordem = [];
    raw.forEach(function (r) {
      if (soBdr && !incluirNaoBdr && r.bdr === false) return;
      if (!todas && r.rec === false) return;
      var a = m[r.valor];
      if (!a) {
        a = m[r.valor] = { valor: r.valor, roster: r.roster !== false, bdr: r.bdr !== false, papel: r.papel || null };
        CAMPOS.forEach(function (f) { a[f] = 0; });
        ordem.push(r.valor);
      }
      // Um valor de dimensão pode chegar em duas linhas (BDR e não-BDR); o papel que
      // fica é o de quem é BDR, porque é o que a linha passa a representar.
      if (r.bdr === false && a.papel == null) a.papel = r.papel || null;
      CAMPOS.forEach(function (f) { a[f] += r[f] || 0; });
    });
    return ordem.map(function (k) { return m[k]; });
  }

  /**
   * O QUE O FILTRO TIROU, em três baldes — sem isto, filtrar é esconder.
   *
   * Um número só ("52 donos, 4.905 leads") não deixa auditar, porque os três casos
   * pedem julgamento diferente: LEAD SEM DONO é órfão do CRM e não é trabalho de
   * ninguém (2.218 na janela completa, o maior balde de longe); BDR ARQUIVADO é
   * trabalho real de gente que saiu; NÃO-BDR é executivo/closer/Placement, que é o
   * caso que o filtro existe para resolver. Jogar os três na mesma frase esconderia
   * que o corte mais pesado não tem nada a ver com executivo.
   */
  function excluidos(dim) {
    var raw = (D && D.coorte && D.coorte.por_dimensao && D.coorte.por_dimensao[dim]) || [];
    var donos = {}, criados = 0, toques = 0;
    var baldes = { sem_dono: 0, arquivado: 0, nao_bdr: 0 };
    raw.forEach(function (r) {
      if (r.bdr !== false) return;
      criados += r.criados || 0;
      toques += r.trab_toques || 0;
      var papel = r.papel || 'não é BDR';
      var balde = /sem dono|desconhecido/i.test(r.valor + ' ' + papel) ? 'sem_dono'
        : /arquivad/i.test(papel) ? 'arquivado' : 'nao_bdr';
      baldes[balde] += r.criados || 0;
      if (dim === 'bdr' && (r.criados || r.trab_toques)) donos[r.valor] = papel;
    });
    return { criados: criados, toques: toques, donos: donos, n_donos: Object.keys(donos).length, baldes: baldes };
  }
  function baldesTxt(ex) {
    var p = [];
    if (ex.baldes.nao_bdr) p.push('<strong>' + ni(ex.baldes.nao_bdr) + '</strong> de executivo/closer/Placement');
    if (ex.baldes.arquivado) p.push('<strong>' + ni(ex.baldes.arquivado) + '</strong> de BDR arquivado (gente que saiu)');
    if (ex.baldes.sem_dono) p.push('<strong>' + ni(ex.baldes.sem_dono) + '</strong> <em>sem dono nenhum</em> no CRM — lead órfão, não é trabalho de ninguém');
    return p.join('; ');
  }

  function soma(linhas, campo) {
    return linhas.reduce(function (a, r) { return a + (r[campo] || 0); }, 0);
  }

  // AS DIMENSÕES DA TELA, em um lugar só — a ordem é a de utilidade, não a alfabética.
  // `canal_macro` vem primeiro entre os atributos porque "só outbound" é o corte mais
  // pedido; `origem` fica por último e carrega o aviso de contaminação onde aparece.
  var DIMENSOES = ['bdr', 'canal_macro', 'canal', 'tier', 'vidas', 'porte', 'origem'];
  var ROT_DIM = {
    bdr: 'BDR', canal_macro: 'Canal', canal: 'Canal (detalhe)', porte: 'Colaboradores',
    tier: 'Tier colabs', vidas: 'Vidas', origem: 'Origem (crua)'
  };

  /**
   * O RECORTE ATIVO — o que os cards, o funil e a linha do tempo estão medindo.
   *
   * Sem filtro é a coorte inteira (somada pela dimensão BDR, que é partição). Com
   * filtro é UMA fatia de UM campo. A mesma função serve os três, e isso não é
   * economia de código: é o que garante que o card e o gráfico logo abaixo dele não
   * possam divergir por terem sido somados em dois lugares.
   */
  // Com o recorte aplicado NO BANCO, o foco é simplesmente a coorte que voltou — não
  // há mais o passo de "achar a fatia no meio do todo", e é isso que faz card, gráfico
  // e waterfall não poderem divergir: eles não recortam, eles recebem recortado.
  function linhasFoco() { return linhasDim('bdr'); }
  function focoLabel() {
    return filtroDim && filtroVal != null ? ROT_DIM[filtroDim] + ' = ' + filtroVal : 'time inteiro';
  }
  function temFiltro() { return !!(filtroDim && filtroVal != null); }

  // ── A SÉRIE, agrupada por período ─────────────────────────────────────────────
  var CAMPOS_SERIE = ['criados', 'com_atividade', 'por_etapa', 'conectados', 'qualificados',
    'qual_com_deal', 'com_deal', 'desqualificados', 'com_tentativa', 'com_conversa',
    'discagens', 'empresas'];

  /**
   * A série do recorte, somada por período.
   *
   * `dimSerie` permite QUEBRAR o gráfico por uma dimensão (uma linha por BDR, por
   * canal, por tier) em vez de somar tudo — é o "ver essas taxas por BDR / por canal /
   * por tier na linha do tempo" que o dono pediu. Quando ele é nulo, a série é uma só.
   */
  function serieBuckets(quebraPor, valor) {
    var S = (D && D.coorte && D.coorte.serie) || {};
    var dim = quebraPor || 'bdr';
    var raw = ((S.por_dimensao || {})[dim] || []).filter(function (r) {
      if (soBdr && r.bdr === false) return false;
      if (r.rec === false) return false;
      if (valor != null && r.valor !== valor) return false;
      return true;
    });
    var m = {};
    raw.forEach(function (r) {
      var a = m[r.bucket];
      if (!a) {
        a = m[r.bucket] = { bucket: r.bucket };
        CAMPOS_SERIE.forEach(function (f) { a[f] = 0; });
      }
      CAMPOS_SERIE.forEach(function (f) { a[f] += r[f] || 0; });
    });
    return Object.keys(m).sort().map(function (k) { return m[k]; });
  }

  /** Os valores de uma dimensão na série, ordenados por volume — para a quebra. */
  function valoresDaSerie(dim, teto) {
    var S = (D && D.coorte && D.coorte.serie) || {};
    var m = {};
    ((S.por_dimensao || {})[dim] || []).forEach(function (r) {
      if (soBdr && r.bdr === false) return;
      if (r.rec === false) return;
      m[r.valor] = (m[r.valor] || 0) + (r.criados || 0);
    });
    return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; }).slice(0, teto || 6);
  }

  // '2026-08' → 'ago/26' · '2026-W32' → 'S32/26'. Rótulo curto porque 12 pontos com
  // rótulo longo viram um eixo ilegível na primeira tela estreita.
  var MES_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function rotBucket(b) {
    var d = String(b).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (d) return d[3] + '/' + d[2];
    var w = String(b).match(/^(\d{4})-W(\d{2})$/);
    if (w) return 'S' + w[2] + '/' + w[1].slice(2);
    var q = String(b).match(/^(\d{4})-Q(\d)$/);
    if (q) return 'T' + q[2] + '/' + q[1].slice(2);
    var m = String(b).match(/^(\d{4})-(\d{2})$/);
    return m ? MES_PT[+m[2] - 1] + '/' + m[1].slice(2) : String(b);
  }
  var GRAN_PT = { dia: 'dia', semana: 'semana ISO', mes: 'mês', trimestre: 'trimestre' };
  function granAtual() { return ((D && D.granularidade) || {}).escolhida || 'semana'; }

  /**
   * OS PASSOS DE CONVERSÃO, a partir da agregação — a mesma conta do servidor, aqui
   * aplicada ao recorte que está na tela (dimensão × filtro de gente).
   *
   * A régua é de COORTE e é ACUMULADA: "chegou a Conectado+" quer dizer que o lead
   * VISITOU a etapa, não que esteja nela agora. Por isso os passos encaixam e a
   * conversão do processo é o produto deles — não uma sexta conta independente.
   */
  function passosDe(linhas) {
    var criados = soma(linhas, 'criados'), tent = soma(linhas, 'por_etapa'),
        con = soma(linhas, 'conectados'), qual = soma(linhas, 'qualificados'),
        deal = soma(linhas, 'com_deal'), dq = soma(linhas, 'desqualificados'),
        qualDeal = soma(linhas, 'qual_com_deal'), dealSemQual = soma(linhas, 'deal_sem_qualificar');
    return {
      criados: criados, tentativa: tent, conectado: con, qualificado: qual, deal: deal, desq: dq,
      // Deal SEM passar por Qualificado. O passo usa a interseção, senão a taxa
      // estoura 100% (medido em ago/26: 11 deals para 10 qualificados) — e o avulso
      // não some, vira nota: virou negócio sem a etapa registrada.
      qual_com_deal: qualDeal, deal_sem_qualificar: dealSemQual,
      passos: [
        { rot: 'Novo → Tentativa+', n: tent, base: criados, cor: COR.tentativa, nivel: 'tentativa' },
        { rot: 'Tentativa+ → Conectado+', n: con, base: tent, cor: COR.conectado, nivel: 'conectado' },
        { rot: 'Conectado+ → Qualificado', n: qual, base: con, cor: COR.qualificado, nivel: 'qualificado' },
        { rot: 'Qualificado → Deal', n: qualDeal, base: qual, cor: C_BOM, nivel: 'deal' }
      ],
      processo: { n: qual, base: criados },
      ate_deal: { n: deal, base: criados },
      descarte: { n: dq, base: criados }
    };
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
  // A CHAVE CARREGA O RECORTE E A GRANULARIDADE. Sem isso, aplicar um filtro repintaria
  // o dado velho e a tela pareceria ignorar o clique — é o mesmo defeito "preso em
  // agosto" da leva 4, só que na dimensão do filtro.
  function chaveJanela() {
    var j = janelaAtual();
    return funil + '|' + (j.tudo ? 'tudo' : j.since) + '|' + j.until +
      '|' + (gran || 'auto') + '|' + (filtroDim && filtroVal != null ? filtroDim + '=' + filtroVal : '-');
  }

  function load(force) {
    var j = janelaAtual();
    var qs = j.tudo ? 'tudo=1&until=' + j.until : 'since=' + j.since + '&until=' + j.until;
    var url = '/api/bdr-lead-funnel?funil=' + funil + '&' + qs +
      (gran ? '&gran=' + gran : '') +
      (filtroDim && filtroVal != null
        ? '&dim=' + encodeURIComponent(filtroDim) + '&val=' + encodeURIComponent(filtroVal) : '') +
      (force ? '&refresh=1' : '');
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
  function switchDim(m) {
    reguaDim = m;
    // A ordem padrão acompanha a dimensão: trabalho em pessoa, criados em atributo.
    sort.regua = { col: m === 'bdr' ? 'trab_toques' : 'n', dir: -1 };
    if (typeof _setActive === 'function') _setActive('lf-dim-tabs', m);
    tabelaRegua();
  }
  function switchReguaView(v) {
    reguaView = v;
    if (typeof _setActive === 'function') _setActive('lf-regua-view-tabs', v);
    tabelaRegua();
  }
  function switchDisqView(v) {
    disqView = v;
    if (typeof _setActive === 'function') _setActive('lf-disq-view-tabs', v);
    disqMatrix();
  }
  function switchWf(v) { wfView = v; if (typeof _setActive === 'function') _setActive('lf-wf-tabs', v); waterfallTabela(); }
  function switchConvDim(m) {
    convDim = m;
    if (typeof _setActive === 'function') _setActive('lf-conv-dim-tabs', m);
    tabelaConversao();
  }
  // O filtro de gente muda TODA a seção de coorte (conversão, funil e as duas
  // tabelas), então repinta em vez de atualizar um card só.
  function toggleSoBdr() { soBdr = !soBdr; paint(); }
  // Trocar a DIMENSÃO limpa o valor de propósito: manter "Priscilla" selecionada ao
  // pular para a dimensão Porte deixaria um filtro que não casa com nada, e a tela
  // ficaria vazia sem dizer por quê.
  function setFiltroDim(d) { filtroDim = d || null; filtroVal = null; paint(); }
  function setFiltroVal(v) { filtroVal = (v === '' || v == null) ? null : v; paint(); }
  function limpaFiltro() { filtroDim = null; filtroVal = null; paint(); }
  function switchSerie(v) { serieView = v; if (typeof _setActive === 'function') _setActive('lf-serie-tabs', v); serieChart(); }
  // Trocar a granularidade recarrega: o agrupamento é feito no BigQuery, e refazê-lo no
  // browser exigiria mandar sempre o grão diário de TODAS as dimensões — 7 dimensões ×
  // 937 dias é payload que não cabe.
  function switchGran(g) { gran = g === 'auto' ? null : g; if (typeof _setActive === 'function') _setActive('lf-gran-tabs', g); paint(); }
  // A QUEBRA é só de desenho (os dados já vieram por dimensão), então não recarrega.
  function switchQuebra(d) {
    quebraDim = d === 'nenhuma' ? null : d;
    if (typeof _setActive === 'function') _setActive('lf-quebra-tabs', d);
    escondidas = {};
    serieChart();
  }

  // ── HTML da seção ──────────────────────────────────────────────────────────────
  function sectionHtml() {
    registraFichas();
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

    // MARCA DE ESTADO NUNCA SÓ POR COR: o botão do filtro carrega ✅/✖️ e a palavra,
    // porque há BDR daltônico no time e "verde = ligado" é ilegível para ele.
    var btnBdr = '<button type="button" onclick="AxLeadFunnel.toggleSoBdr()" ' +
      'style="background:' + (soBdr ? 'var(--teal)' : 'var(--card2)') + ';color:' + (soBdr ? '#fff' : 'var(--text2)') + ';' +
      'border:1px solid var(--border);border-radius:8px;padding:.3rem .7rem;font-size:.74rem;font-weight:600;cursor:pointer" ' +
      'title="Tira do corte de gente quem não é BDR: executivo/closer, Placement, admin e ex-BDR arquivado. Ninguém some do dado — desligue para ver todos os donos de lead.">' +
      (soBdr ? '✅ Só BDRs' : '✖️ Todos os donos') + '</button>';

    var barraFunil = '<div class="novo-card" style="grid-column:1/-1;display:flex;align-items:center;gap:1rem;flex-wrap:wrap;padding:.6rem .9rem">' +
      '<span style="font-size:.72rem;color:var(--text2);font-weight:600;text-transform:uppercase;letter-spacing:.06em">Funil</span>' +
      tabsFunil + btnBdr +
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
    var abasDim = function (id, atual, fn) {
      return (typeof _subTabs === 'function')
        ? _subTabs(id, atual, DIMENSOES.map(function (d) { return { mode: d, label: ROT_DIM[d], fn: fn }; }))
        : '';
    };
    var tabsDim = abasDim('lf-dim-tabs', reguaDim, 'AxLeadFunnel.switchDim');
    var tabsDisqView = (typeof _subTabs === 'function') ? _subTabs('lf-disq-view-tabs', disqView, [
      { mode: 'autor', label: 'Por quem fez', fn: 'AxLeadFunnel.switchDisqView' },
      { mode: 'evidencia', label: 'Por evidência', fn: 'AxLeadFunnel.switchDisqView' }
    ]) : '';
    var tabsReguaView = (typeof _subTabs === 'function') ? _subTabs('lf-regua-view-tabs', reguaView, [
      { mode: 'contato', label: 'Contato', fn: 'AxLeadFunnel.switchReguaView' },
      { mode: 'funil', label: 'Funil', fn: 'AxLeadFunnel.switchReguaView' },
      { mode: 'penetracao', label: 'Penetração', fn: 'AxLeadFunnel.switchReguaView' }
    ]) : '';
    var tabsConvDim = abasDim('lf-conv-dim-tabs', convDim, 'AxLeadFunnel.switchConvDim');

    var tipConv = 'CONVERSÃO DE COORTE: leads CRIADOS na janela, seguidos até hoje. A régua é ACUMULADA — "chegou a Conectado+" quer dizer que o lead VISITOU a etapa, não que esteja nela agora — e por isso os passos encaixam (todo Conectado+ é Tentativa+) e a conversão do processo é o PRODUTO dos passos, não uma conta à parte. ' +
      'NÃO é "movimentações no período": essa régua conta o mesmo lead a cada toque e infla o número várias vezes. ' +
      'Cada taxa carrega NUMERADOR e DENOMINADOR ao lado, porque 50% de 4 e 50% de 400 pedem decisões diferentes. ' +
      'DUAS ARMADILHAS DE LEITURA, e elas são do método, não do dado: (1) a coorte recente ainda está viva, então o mês corrente sempre converte menos que um mês fechado — comparar os dois subestima o corrente; (2) "Qualificado → Deal" fica perto de 100% por construção, porque o deal nasce da qualificação: ali o número interessante é o VOLUME, não a taxa. ' +
      'O passo mais estreito é o que a operação tem para atacar. Clique em qualquer etapa para ver os leads.';
    var tipConvTab = 'A mesma conversão de coorte, aberta por dimensão. Cada passo mostra a taxa SOBRE A ETAPA ANTERIOR (não sobre o total) — é o que separa "perde no primeiro contato" de "perde na qualificação", e essas duas falhas pedem coaching diferente. A coluna final é o processo inteiro, criado → qualificado. ' +
      'Toda coluna com ⇅ ordena; a ordem nasce por VOLUME de propósito, porque taxa de 3 leads no topo do rank é ruído com cara de campeão. Clique numa linha para os leads.';

    var tabsSerie = (typeof _subTabs === 'function') ? _subTabs('lf-serie-tabs', serieView, [
      { mode: 'ate_qual', label: 'Até Qualificado', fn: 'AxLeadFunnel.switchSerie' },
      { mode: 'passo', label: 'Passo a passo', fn: 'AxLeadFunnel.switchSerie' },
      { mode: 'contato', label: 'Esforço × contato', fn: 'AxLeadFunnel.switchSerie' },
      { mode: 'volume', label: 'Volume', fn: 'AxLeadFunnel.switchSerie' }
    ]) : '';
    // GRANULARIDADE e QUEBRA vivem no cabeçalho do próprio card, não na barra global:
    // são controles DAQUELE gráfico, e controle de gráfico longe do gráfico é o que faz
    // alguém mudar a escala e não perceber que mudou.
    var tabsGran = (typeof _subTabs === 'function') ? _subTabs('lf-gran-tabs', gran || 'auto', [
      { mode: 'auto', label: 'Auto', fn: 'AxLeadFunnel.switchGran' },
      { mode: 'dia', label: 'Dia', fn: 'AxLeadFunnel.switchGran' },
      { mode: 'semana', label: 'Semana', fn: 'AxLeadFunnel.switchGran' },
      { mode: 'mes', label: 'Mês', fn: 'AxLeadFunnel.switchGran' },
      { mode: 'trimestre', label: 'Trimestre', fn: 'AxLeadFunnel.switchGran' }
    ]) : '';
    var tabsQuebra = (typeof _subTabs === 'function') ? _subTabs('lf-quebra-tabs', quebraDim || 'nenhuma', [
      { mode: 'nenhuma', label: 'Time todo', fn: 'AxLeadFunnel.switchQuebra' },
      { mode: 'bdr', label: 'por BDR', fn: 'AxLeadFunnel.switchQuebra' },
      { mode: 'canal_macro', label: 'por Canal', fn: 'AxLeadFunnel.switchQuebra' },
      { mode: 'tier', label: 'por Tier', fn: 'AxLeadFunnel.switchQuebra' },
      { mode: 'vidas', label: 'por Vidas', fn: 'AxLeadFunnel.switchQuebra' }
    ]) : '';
    var controlesSerie = '<div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;margin-left:auto">' +
      '<span style="font-size:.66rem;color:var(--text2);text-transform:uppercase;letter-spacing:.05em">Período</span>' + tabsGran +
      '<span style="font-size:.66rem;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;margin-left:.4rem">Quebrar</span>' + tabsQuebra +
      '</div>';
    var tipSerie = 'A MESMA coorte dos cards, com o eixo do tempo aberto — cada ponto é a coorte de leads CRIADOS naquele período, seguida até hoje. Barras = leads criados (escala à esquerda); linhas = taxas (escala à direita). ' +
      '"Até Qualificado" responde a pergunta do desfecho: de quem chegou a cada etapa, quanto virou Qualificado. "Passo a passo" mede cada degrau sobre o anterior. "Esforço × contato" mostra as três réguas no tempo (tentou / falou com / conversou por voz). "Volume" larga a taxa e mostra os absolutos, porque taxa sem volume esconde a escala. ' +
      'PERÍODO é escolha sua: dia, semana ISO, mês ou trimestre. "Auto" usa o padrão adaptativo (dia até 31 dias, semana até 120, mês até 550, trimestre acima). QUEBRAR desenha uma linha por BDR, canal, tier ou faixa de vidas em vez de uma linha só do time — no máximo 6 linhas, as maiores por volume, e o rodapé diz quantas ficaram de fora. ' +
      'O EIXO DE % NÃO É FIXO EM 0–100: ele se ajusta ao mínimo e ao máximo das linhas VISÍVEIS, e clicar na legenda para esconder uma linha reescala o eixo na hora. O intervalo em vigor está escrito no rodapé — compare dois prints só depois de conferir que a escala é a mesma. ' +
      'O ÚLTIMO PONTO É PARCIAL e está tracejado: a coorte recente ainda está viva e ainda vai converter — ler a queda do fim como piora é o erro clássico de gráfico de coorte. ' +
      'O filtro de campo no card acima vale aqui e em toda a seção. Clique num ponto para ver os leads daquela coorte.';

    return hdr + aviso + barraFunil +
      painel('Conversão do funil | do lead criado ao deal', tipConv, 'conv') +
      card('Linha do tempo da conversão | coorte por período de criação', tipSerie, 'serie', 400, tabsSerie + controlesSerie, true) +
      painel('Conversão por dimensão | onde o funil aperta', tipConvTab, 'convtab', tabsConvDim) +
      card('Waterfall macro | o funil aberto que abre, recebe, perde e fecha',
        'Aberto@início + entrou no funil + reativados − qualificados − desqualificados = Aberto@fim. ABERTO = Novo + Tentativa + Conectado; qualificado e desqualificado são SAÍDAS do funil de prospecção (um vira deal, o outro morre), e contá-los no saldo faria o funil só crescer. A barra "Resíduo" é o que a aritmética não explica — ela aparece em vez de ser diluída nas outras, porque waterfall que não fecha no saldo é ficção. O saldo de abertura usa a etapa do lead em T0 derivada de fact_stage_entry (dim_lead só sabe o agora); método validado em 18.294 de 18.296 leads. Clique numa barra para os leads.',
        'macro', 340, null, true) +
      card('Waterfall por etapa | entradas contra saídas',
        'O mesmo período do macro, aberto por etapa: barras para CIMA são entradas, para BAIXO são saídas, e o rótulo é o líquido com sinal. O losango marca o saldo no fim. Barras opostas de tamanho parecido significam etapa que girou muito e andou pouco — é o que a tabela de saldo não mostra de relance. Clique numa etapa para os leads que entraram ou saíram dela.',
        'poretapa', 340, null, true) +
      painel('Waterfall detalhado',
        'Duas leituras do mesmo período. POR STATUS: como cada etapa ganhou e perdeu — saldo no início, entradas, saídas, saldo no fim, e o resíduo por etapa. POR MOVIMENTAÇÃO: cada seta de→para, com a natureza marcada por símbolo e palavra (nunca só por cor). Toda coluna com ⇅ ordena. Clique numa linha para os leads, com criado, trilha e status atual.',
        'waterfall', tabsWf) +
      // O SNAPSHOT OCUPA A LARGURA e ganha o painel de fluxo ao lado. Antes era um card
      // estreito com cinco barras curtas e um vazio do tamanho de outro card à direita —
      // e o vazio não era só feio: o estoque sozinho não diz se a etapa está parada ou
      // girando. Estado à esquerda, movimento do período à direita, no mesmo cartão.
      '<div class="novo-card" style="grid-column:1/-1">' +
        '<div class="novo-card-header"><h3>Snapshot de agora | estado e giro do funil</h3>' +
        i('À ESQUERDA o ESTADO: quantos leads estão em cada etapa AGORA, direto de dim_lead. À DIREITA o GIRO do período selecionado: quanto entrou e saiu de cada etapa, e o líquido. ' +
          'As duas leituras juntas porque estoque sozinho não distingue etapa PARADA de etapa que girou muito e voltou ao mesmo lugar — e é essa diferença que decide onde mexer. ' +
          'O estado segue o recorte e a defasagem da extração das 06:30 está no selo da barra de funil; o giro segue a janela do filtro global.', 'snapshot') + '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1.2rem;align-items:start;margin-top:.4rem">' +
          '<div><canvas id="lf-snapshot" style="max-height:320px"></canvas></div>' +
          '<div id="lf-snapshot-giro" style="overflow-x:auto"></div>' +
        '</div></div>' +
      card('Criados e movimentados por dia',
        'Barras = leads criados no dia (entrada no funil). Linhas = movimentações que chegaram em cada etapa naquele dia. É a taxa por dia: quantos leads novos, quantos passaram para tentativa, conectado, qualificado ou desqualificado.', 'pordia', 320, null, true) +
      painel('Esforço, funil e penetração | por ' + (ROT_DIM[reguaDim] || reguaDim),
        'A tela NÃO escolhe entre as duas réguas. ETAPA = o lead chegou a Tentativa+ no histórico de etapa. ATIVIDADE REAL = houve ligação conectada, e-mail enviado, LinkedIn, WhatsApp manual ou reunião realizada (nota não conta: nota não é ação). Medido em jul/26: 89,4% contra 46,7%, com 1.009 leads movidos para Tentativa sem UM toque no CRM — a premissa "teve que passar, senão não tem como" não se sustenta no dado. ' +
        'O TOQUE SÓ CONTA APÓS A CRIAÇÃO DO LEAD (correção de 11/08/2026): a régua liga toque→lead pelo contato, e o contato tem vida anterior ao lead — sem o limite, "falou com" contava trabalho de outro ciclo, às vezes de outra pessoa. Em ago/26 isso valia 19 leads (210 → 191), o mais antigo com toque de 18/07/2024. O toque anterior não é descartado: vira a coluna "Toque só antes do lead". ' +
        'NO CORTE POR BDR HÁ DUAS RÉGUAS DE PESSOA e elas respondem coisas diferentes. "Criaram/Falaram com" é COORTE (leads criados na janela) atribuída ao DONO do lead — certa para atributo de lead, enganosa para pessoa, porque quem trabalha carteira antiga aparece com denominador minúsculo. "Trabalhou na janela" é o que a pessoa fez no período em lead de qualquer safra, atribuída a QUEM TOCOU: dos 1.585 toques de ago/26, 378 (24%) foram feitos por alguém diferente do dono atual do lead. Todo BDR do roster tem linha mesmo zerada, porque linha ausente lê como "não fez nada" e é indistinguível de "não foi medido". ' +
        'TRÊS VISÕES da mesma tabela, porque vinte colunas é planilha e ninguém lê: CONTATO (tentou, falou, conversou, discagens), FUNIL (criou, avançou, qualificou, perdeu) e PENETRAÇÃO (empresas alcançadas e leads por empresa). ' +
        'A régua de TENTATIVA inclui a discagem que NÃO conectou — decisão do head de BDRs em 12/08/2026: ligação que falhou é esforço de contato. "Falou com" continua exigindo que algo tenha chegado do outro lado, e "Conversou" é só voz atendida. Medido em 01/07–11/08: 9.365 discagens para 704 conexões (7,5%). ' +
        'Toda coluna com ⇅ ordena; clique numa linha para os leads.',
        'regua', tabsReguaView + tabsDim) +
      card('Desqualificações por dia',
        'Entradas em Desqualificado por dia, empilhadas por MOTIVO (o objeto Leads tem o campo — o contato nunca teve). Preenchimento: Lead pipeline 99,2%, Diagnóstico Site 0,0% (1.056 sem motivo). Clique num dia para o drill.', 'disq', 300, null, true) +
      painel('Desqualificações | motivo × quem, ou motivo × evidência',
        'DUAS LEITURAS do mesmo conjunto. QUEM: cruzamento com o autor REAL do evento (updated_by_user_id), não o dono atual do lead — "Automação" e "Integração" ficam em bucket próprio porque ninguém digitou. Medido em jul/26: 1.499 desqualificações por gente contra 1 por integração, ou seja a automação move lead adiante e quase nunca desqualifica. ' +
        'EVIDÊNCIA: o submotivo derivado do que o CRM registrou (nenhum esforço, discou N vezes sem atender, telefone errado, mensagem sem conversa, falou por voz e não avançou). Ele existe porque o portal NÃO tem campo de razão livre — nem no lead, nem no contato, e no negócio o motivo do declínio também é lista fechada; as notas cobrem 8,3% das desqualificações e a maior parte é template. ' +
        'O submotivo por evidência cobre 100% e separa dois problemas que o motivo declarado junta: "não houve tentativa" com 12 discagens não atendidas é lista ruim; sem nenhuma discagem é cadência que não aconteceu. Clique numa célula para ver os leads.',
        'disqmatrix', tabsDisqView);
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
    painelConversao();
    serieChart();
    tabelaConversao();
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
    // As barras de TRANSFERÊNCIA só existem quando o recorte é uma pessoa: lead que
    // troca de dono muda a carteira sem ser movimento de etapa, e sem elas o waterfall
    // de um BDR não fechava (resíduo medido de +10 em 68 antes delas existirem).
    // "Entrou sem registro" é a entrada que só o fact_stage_entry viu — ver a premissa
    // homônima no payload.
    var passos = [
      ['Aberto @ início', m.aberto_inicio, C_TOTAL, 'total'],
      ['＋ Entrou no funil', m.entrada_no_funil, C_BOM, 'delta'],
      ['＋ Entrou sem registro', m.entrada_sem_registro || 0, C_BOM, 'delta'],
      ['＋ Reativados', m.reativados, C_BOM, 'delta'],
      ['＋ Recebeu de outro BDR', m.recebeu_transferencia || 0, C_BOM, 'delta'],
      ['− Qualificados', -m.qualificados, C_TOTAL, 'delta'],
      ['− Desqualificados', -m.desqualificados, C_RUIM, 'delta'],
      ['− Passou para outro BDR', -(m.passou_transferencia || 0), C_NEUTRO, 'delta'],
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
        '. ABERTO = Novo + Tentativa + Conectado.' +
        (temFiltro() && filtroDim === 'bdr'
          ? '<br><strong style="color:var(--text)">Recorte por pessoa:</strong> as barras de transferência existem porque lead que troca de dono muda a carteira sem ser movimento de etapa. ' +
            'A atribuição aqui é pelo dono <strong>no instante</strong> do movimento — o trabalho fica com quem o fez, mesmo que o lead hoje seja de outra pessoa.'
          : '');
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

    // O GIRO, ao lado do estado. Mesmos dados do waterfall por status, em formato de
    // leitura rápida: uma etapa com 400 parados e giro zero pede ação diferente de uma
    // com 400 parados que recebeu 300 e perdeu 300 no mesmo período.
    var gi = document.getElementById('lf-snapshot-giro');
    if (!gi) return;
    var st = (D.waterfall && D.waterfall.por_status) || [];
    if (!st.length) { gi.innerHTML = ''; return; }
    var maxFluxo = Math.max.apply(null, st.map(function (r) { return Math.max(r.entradas, r.saidas) || 1; }));
    var linhas = st.filter(function (r) { return r.entradas || r.saidas || r.saldo_fim; }).map(function (r) {
      var liq = r.liquido;
      var marca = liq > 0 ? '↑ ganhou' : liq < 0 ? '↓ perdeu' : '→ estável';
      var wIn = Math.round(r.entradas / maxFluxo * 100), wOut = Math.round(r.saidas / maxFluxo * 100);
      return '<tr style="cursor:pointer" onclick="AxLeadFunnel.drillStatus(\'' + r.etapa + '\')">' +
        '<td style="text-align:left;white-space:nowrap;font-weight:600">' +
          '<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + (COR[r.etapa] || C_NEUTRO) + ';margin-right:.4rem"></span>' +
          esc(r.rotulo) + '</td>' +
        '<td style="font-weight:700">' + ni(r.saldo_fim) + '</td>' +
        '<td style="min-width:96px"><div style="display:flex;flex-direction:column;gap:2px">' +
          '<div style="display:flex;align-items:center;gap:.3rem"><div style="width:' + wIn + '%;height:5px;background:' + C_BOM + ';border-radius:2px;min-width:2px"></div>' +
          '<span style="font-size:.66rem;color:' + C_BOM + '">+' + ni(r.entradas) + '</span></div>' +
          '<div style="display:flex;align-items:center;gap:.3rem"><div style="width:' + wOut + '%;height:5px;background:' + C_RUIM + ';border-radius:2px;min-width:2px"></div>' +
          '<span style="font-size:.66rem;color:' + C_RUIM + '">−' + ni(r.saidas) + '</span></div>' +
        '</div></td>' +
        '<td style="white-space:nowrap;font-weight:600">' + sgn(liq) + ' <span style="font-weight:400;font-size:.66rem;color:var(--text2)">' + marca + '</span></td>' +
        '</tr>';
    }).join('');
    gi.innerHTML = '<div style="font-size:.7rem;color:var(--text2);font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin:.1rem 0 .5rem">' +
      'Giro no período — ' + fmtBR((D.janela || {}).since) + ' a ' + fmtBR((D.janela || {}).until) + '</div>' +
      '<table class="lb" style="font-size:.76rem;width:100%"><thead><tr>' +
      '<th style="text-align:left">Etapa</th><th style="text-align:right">No fim<br>do período</th>' +
      '<th style="text-align:right">Entrou / saiu</th><th style="text-align:right">Líquido</th>' +
      '</tr></thead><tbody>' + linhas + '</tbody></table>' +
      '<p style="font-size:.69rem;color:var(--text2);margin:.5rem 0 0;line-height:1.5">' +
      '<strong style="color:var(--text)">No fim do período</strong> é o saldo no último dia da janela, derivado do histórico de etapas; ' +
      'o gráfico ao lado é o estado de <strong>hoje</strong>, direto de dim_lead. ' +
      'Quando a janela termina antes de hoje os dois DIVERGEM de propósito — e mesmo com a janela até hoje sobra uma diferença de ordem de 2 leads em 18 mil, ' +
      'que é a divergência declarada entre a etapa derivada e a etapa registrada. ' +
      '<strong style="color:var(--text)">Entrou/saiu</strong> é fluxo: não soma com saldo, um é foto e o outro é filme. Clique numa linha para os leads.</p>';
  }

  /**
   * CRIADOS E MOVIMENTADOS POR PERÍODO.
   *
   * DOIS CONSERTOS em 12/08/2026:
   *
   * 1. OS CRIADOS SAÍAM DA LISTA CAPADA. A contagem vinha de `coorte.leads`, que é a
   *    lista do drill e vem cortada em 1.500 — em janela longa o gráfico desenhava os
   *    1.500 leads mais recentes e chamava aquilo de "criados por dia". Na janela
   *    completa isso era menos de 10% da coorte, com a forma errada e sem nenhum aviso.
   *    Agora sai de `serie.__dia`, um GROUP BY próprio que cobre 100% da coorte.
   *
   * 2. RESPEITA A GRANULARIDADE do card acima. Em 937 dias, "por dia" são 937 barras de
   *    um pixel; agrupar é o que torna a janela longa legível. O grão do payload é
   *    sempre diário e a agregação para cima acontece aqui — para cima sempre dá, para
   *    baixo nunca daria.
   */
  function chaveGran(ymd) {
    var g = granAtual();
    if (g === 'dia') return ymd;
    var d = new Date(ymd + 'T12:00:00');
    if (g === 'mes') return ymd.slice(0, 7);
    if (g === 'trimestre') return ymd.slice(0, 4) + '-Q' + (Math.floor(d.getMonth() / 3) + 1);
    // Semana ISO: quinta-feira da semana decide o ano, senão a virada de ano quebra.
    var t = new Date(d.valueOf());
    t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
    var jan4 = new Date(t.getFullYear(), 0, 4);
    var sem = 1 + Math.round(((t - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
    return t.getFullYear() + '-W' + (sem < 10 ? '0' + sem : sem);
  }

  function porDia() {
    if (!D || typeof _novoMkChart !== 'function') return;
    var th_ = _novoTheme();

    // Criados: agregação completa do banco, nunca a lista do drill.
    var criados = {};
    (((D.coorte.serie || {}).por_dimensao || {}).__dia || []).forEach(function (r) {
      if (soBdr && r.bdr === false) return;
      if (r.rec === false) return;
      var k = chaveGran(r.bucket);
      criados[k] = (criados[k] || 0) + (r.criados || 0);
    });
    // Movimentações: o waterfall já vem por dia, e é o mesmo recorte.
    var pd = D.waterfall.por_dia || {};
    var mov = {};
    Object.keys(pd).forEach(function (dia) {
      var k = chaveGran(dia);
      mov[k] = mov[k] || {};
      Object.keys(pd[dia]).forEach(function (c) { mov[k][c] = (mov[k][c] || 0) + pd[dia][c]; });
    });

    var chaves = Object.keys(criados).concat(Object.keys(mov))
      .filter(function (d, i, a) { return d && a.indexOf(d) === i; }).sort();
    if (!chaves.length) return;

    var linha = function (c, cor) {
      return { type: 'line', label: pt(c), data: chaves.map(function (d) { return (mov[d] && mov[d][c]) || 0; }),
        borderColor: cor, backgroundColor: cor, pointRadius: chaves.length > 60 ? 0 : 2,
        borderWidth: 2, tension: .3, datalabels: { display: false } };
    };
    var totalCriados = chaves.reduce(function (a, k) { return a + (criados[k] || 0); }, 0);

    _novoMkChart('lf-pordia', {
      type: 'bar', plugins: [ChartDataLabels],
      data: {
        labels: chaves.map(rotBucket),
        datasets: [
          { label: 'Leads criados', data: chaves.map(function (d) { return criados[d] || 0; }),
            backgroundColor: 'rgba(88,166,255,.45)', borderRadius: 2, datalabels: { display: false } },
          linha('tentativa', COR.tentativa), linha('conectado', COR.conectado),
          linha('qualificado', COR.qualificado), linha('desqualificado', COR.desqualificado)
        ]
      },
      options: {
        responsive: true, layout: { padding: { top: 16 } },
        plugins: { legend: { display: true, labels: { color: th_.cText2, font: { family: NOVO_FONT, size: 10 }, padding: 8 } }, tooltip: { mode: 'index', intersect: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: th_.cText2, font: { family: NOVO_FONT, size: 9 }, maxRotation: 45, autoSkip: true, maxTicksLimit: 30 } },
          y: { grid: { color: th_.cGrid }, ticks: { color: th_.cText2, font: { family: NOVO_FONT }, precision: 0 } }
        },
        // O drill só faz sentido no grão diário: agrupado, um clique pegaria um mês
        // inteiro de leads e a lista viria capada sem dizer.
        onClick: function (e, el) { if (!el.length || granAtual() !== 'dia') return; drillDia(chaves[el[0].index]); }
      }
    });

    var cv = document.getElementById('lf-pordia');
    if (cv && cv.parentNode) {
      var velha = cv.parentNode.querySelector('.lf-pordia-nota');
      if (velha) velha.remove();
      var p = document.createElement('p');
      p.className = 'lf-pordia-nota';
      p.style.cssText = 'font-size:.71rem;color:var(--text2);margin:.5rem 0 0;line-height:1.5';
      p.innerHTML = 'Agrupado por <strong>' + esc(GRAN_PT[granAtual()] || granAtual()) + '</strong> (segue o seletor da linha do tempo). ' +
        'Barras = <strong>' + ni(totalCriados) + '</strong> leads criados no recorte, da agregação do banco — <strong>não</strong> da lista do drill, que é capada. ' +
        'Linhas = movimentações que CHEGARAM em cada etapa no período. ' +
        (granAtual() === 'dia' ? 'Clique numa barra para ver os leads do dia.' : 'O clique para drill só existe no grão diário.');
      cv.parentNode.appendChild(p);
    }
  }

  // A FAIXA VEM DO SQL. O front LÊ o rótulo, nunca recalcula — a agregação da tabela é
  // um GROUP BY no BigQuery, e recalcular a faixa aqui faria as duas definições
  // derivarem: a tabela diria "50–200" para um conjunto e o drill para outro.
  function dimOf(l) {
    return l['dim_' + reguaDim] || (reguaDim === 'bdr' ? (l.bdr || '(sem dono)') : '(sem valor)');
  }

  // ── CONVERSÃO: os cards de taxa + o funil em barras ───────────────────────────
  // O funil é HTML e não canvas de propósito: cada etapa precisa carregar TRÊS
  // números (absoluto, % do topo e % do passo anterior) mais o rótulo da queda, e
  // enfiar isso em datalabel de gráfico vira sopa ilegível na primeira largura de
  // tela apertada.
  /**
   * A BARRA DE FILTRO DE CAMPO. Dois selects em vez de chips: são 27 BDRs e 15
   * origens, e uma parede de chips vira ruído antes de virar navegação.
   *
   * A segunda combo carrega o VOLUME no rótulo ("Priscilla Feliciello · 2.398"),
   * porque escolher uma fatia sem saber o tamanho dela é como se escolhe uma taxa de
   * 100% que tem denominador 2.
   */
  function barraFiltroHtml() {
    var opDim = DIMENSOES.map(function (d) {
      return '<option value="' + d + '"' + (filtroDim === d ? ' selected' : '') + '>' + ROT_DIM[d] + '</option>';
    }).join('');
    var opVal = '';
    if (filtroDim) {
      // As opções vêm do universo COMPLETO (terceiro argumento), não do recorte: com o
      // filtro aplicado, listar só o recorte deixaria uma opção só na combo e seria
      // impossível trocar de fatia sem limpar o filtro antes.
      opVal = linhasDim(filtroDim, false, true).slice().sort(function (a, b) { return b.criados - a.criados; })
        .map(function (r) {
          return '<option value="' + esc(r.valor) + '"' + (filtroVal === r.valor ? ' selected' : '') + '>' +
            esc(r.valor) + ' · ' + ni(r.criados) + '</option>';
        }).join('');
    }
    var sel = 'background:var(--card2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:.3rem .55rem;font-size:.75rem;max-width:260px';
    return '<div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin:0 0 .8rem">' +
      '<span style="font-size:.72rem;color:var(--text2);font-weight:600;text-transform:uppercase;letter-spacing:.06em">Filtrar por campo</span>' +
      '<select style="' + sel + '" onchange="AxLeadFunnel.setFiltroDim(this.value)">' +
        '<option value=""' + (filtroDim ? '' : ' selected') + '>— campo —</option>' + opDim + '</select>' +
      (filtroDim ? '<select style="' + sel + '" onchange="AxLeadFunnel.setFiltroVal(this.value)">' +
        '<option value=""' + (filtroVal == null ? ' selected' : '') + '>— todos os valores —</option>' + opVal + '</select>' : '') +
      (filtroDim || filtroVal != null
        ? '<button type="button" onclick="AxLeadFunnel.limpaFiltro()" style="background:var(--card2);color:var(--teal);border:1px solid var(--border);border-radius:8px;padding:.3rem .7rem;font-size:.74rem;font-weight:600;cursor:pointer">✖ limpar</button>'
        : '') +
      '<span style="font-size:.72rem;color:var(--text2)">Medindo: <strong style="color:var(--text)">' + esc(focoLabel()) + '</strong>' +
      (filtroVal != null
        ? ' — <strong style="color:var(--teal)">a seção inteira</strong> segue este recorte: cards, funil, linha do tempo, os dois waterfalls, snapshot, por dia e desqualificações'
        : '') + '</span>' +
      (LOADING ? '<span style="font-size:.72rem;color:var(--text2)">recalculando no banco…</span>' : '') +
      '</div>';
  }

  function painelConversao() {
    var el = document.getElementById('lf-conv'); if (!el || !D) return;
    var linhas = linhasFoco();
    var P = passosDe(linhas);
    if (!P.criados) {
      el.innerHTML = barraFiltroHtml() +
        '<p style="color:var(--text2);padding:1rem 0">Nenhum lead criado no período para <strong>' + esc(focoLabel()) + '</strong>' + (soBdr ? ', com o filtro "só BDRs" ligado' : '') + '.</p>';
      return;
    }

    var tile = function (rot, n, base, cor, sub, nivel) {
      var p = base ? (n / base * 100) : null;
      return '<div style="flex:1 1 150px;min-width:150px;background:var(--card2);border-radius:10px;padding:.6rem .75rem;' +
        'border-left:3px solid ' + cor + ';cursor:pointer" onclick="AxLeadFunnel.drillEtapa(\'' + nivel + '\')" title="Clique para ver os leads">' +
        '<div style="font-size:.68rem;color:var(--text2);font-weight:600;letter-spacing:.02em">' + rot + '</div>' +
        '<div style="font-size:1.35rem;font-weight:800;color:var(--text);line-height:1.35">' + (p == null ? '—' : p.toFixed(1).replace('.', ',') + '%') + '</div>' +
        '<div style="font-size:.68rem;color:var(--text2)">' + ni(n) + ' de ' + ni(base) + (sub ? ' · ' + sub : '') + '</div></div>';
    };

    var faixa = function (rot, conteudo) {
      return '<div style="font-size:.7rem;color:var(--text2);font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin:.2rem 0 .35rem">' + rot + '</div>' +
        '<div style="display:flex;gap:.6rem;flex-wrap:wrap;margin:0 0 .9rem">' + conteudo + '</div>';
    };
    // DOIS GRUPOS, porque são duas perguntas. O passo a passo diz onde o funil aperta;
    // "até Qualificado" diz quanto cada etapa VALE como previsão de desfecho — e é a
    // segunda que responde "quanto vale ter conectado com alguém".
    var tiles =
      faixa('Passo a passo | cada etapa sobre a anterior',
        P.passos.map(function (s) {
          return tile(s.rot, s.n, s.base, s.cor, 'perde ' + ni(s.base - s.n), s.nivel);
        }).join('')) +
      faixa('Cada etapa até Qualificado | o que a etapa vale como desfecho',
        tile('Criado → Qualificado', P.qualificado, P.criados, C_TOTAL, 'processo inteiro', 'qualificado') +
        tile('Tentativa+ → Qualificado', P.qualificado, P.tentativa, COR.tentativa, 'de quem foi tentado', 'qualificado') +
        tile('Conectado+ → Qualificado', P.qualificado, P.conectado, COR.conectado, 'de quem conectou', 'qualificado') +
        tile('Descarte | Criado → Desqualificado', P.descarte.n, P.descarte.base, C_RUIM, 'saiu por baixo', 'desqualificado'));

    // O funil propriamente dito: largura proporcional ao topo, com a queda nomeada
    // ENTRE as barras — é ali que mora a decisão, não no tamanho da barra.
    var etapas = [
      { rot: 'Criados na janela', n: P.criados, cor: COR.novo, nivel: 'criados' },
      { rot: 'Chegaram a Tentativa+', n: P.tentativa, cor: COR.tentativa, nivel: 'tentativa' },
      { rot: 'Chegaram a Conectado+', n: P.conectado, cor: COR.conectado, nivel: 'conectado' },
      { rot: 'Qualificados', n: P.qualificado, cor: COR.qualificado, nivel: 'qualificado' },
      // A barra usa a INTERSEÇÃO (qualificado E com deal): o funil tem de descer.
      // O deal que nasceu sem passar por Qualificado está na nota abaixo.
      { rot: 'Viraram deal', n: P.qual_com_deal, cor: C_BOM, nivel: 'deal' }
    ];
    var funilHtml = etapas.map(function (e, i) {
      var w = P.criados ? Math.max(e.n / P.criados * 100, e.n ? 1.5 : 0) : 0;
      var ant = i ? etapas[i - 1] : null;
      var queda = ant ? ant.n - e.n : 0;
      var salto = i
        ? '<div style="display:flex;align-items:center;gap:.5rem;font-size:.7rem;color:var(--text2);margin:.1rem 0 .1rem .2rem">' +
          '<span style="color:' + (ant.n && e.n / ant.n >= 0.5 ? C_BOM_T : 'var(--red)') + ';font-weight:700">↓ ' + pct(e.n, ant.n) + '</span>' +
          '<span>passa ' + ni(e.n) + ' · perde ' + ni(queda) + '</span></div>'
        : '';
      return salto +
        '<div style="display:flex;align-items:center;gap:.6rem;margin:.12rem 0;cursor:pointer" onclick="AxLeadFunnel.drillEtapa(\'' + e.nivel + '\')">' +
        '<div style="width:190px;min-width:120px;font-size:.76rem;color:var(--text);font-weight:600">' + e.rot + '</div>' +
        '<div style="flex:1;background:var(--card2);border-radius:5px;overflow:hidden;height:26px;position:relative">' +
        '<div style="width:' + w.toFixed(2) + '%;height:100%;background:' + e.cor + ';border-radius:5px"></div></div>' +
        '<div style="width:150px;min-width:110px;text-align:right;font-size:.78rem;font-weight:700;white-space:nowrap">' + ni(e.n) +
        ' <span style="font-weight:400;color:var(--text2);font-size:.72rem">' + pct(e.n, P.criados) + ' do topo</span></div></div>';
    }).join('');

    var ex = excluidos('bdr');
    // O denominador do "quanto ficou de fora" é a COORTE INTEIRA, não a fatia em foco:
    // com um filtro de campo ativo, dividir pelo recorte daria um percentual que não
    // significa nada — 4.905 sobre os 137 leads de um BDR.
    var totalCoorte = soma(linhasDim('bdr'), 'criados') + ex.criados;
    var notaFiltro = soBdr && (ex.criados || ex.n_donos)
      ? '<br><strong style="color:var(--text)">Filtro "só BDRs" ligado:</strong> ficaram de fora <strong>' + ni(ex.criados) +
        '</strong> leads criados (' + pct(ex.criados, totalCoorte) + ' da coorte) e ' + ni(ex.toques) + ' toques, de ' + ni(ex.n_donos) + ' donos — ' +
        baldesTxt(ex) + '. Desligue o botão para incluí-los.'
      : (!soBdr ? '<br><strong style="color:var(--text)">Filtro desligado:</strong> a conta inclui TODO dono de lead — executivo, Placement, admin, ex-BDR arquivado e lead sem dono, junto com o time.' : '');

    el.innerHTML = barraFiltroHtml() + tiles + funilHtml +
      '<p style="font-size:.71rem;color:var(--text2);margin:.7rem 0 0;line-height:1.6">' +
      (filtroVal != null ? 'Recorte ativo: <strong style="color:var(--text)">' + esc(focoLabel()) + '</strong>. ' : '') +
      'Coorte de <strong>' + ni(P.criados) + '</strong> leads criados na janela, seguidos até hoje; a régua é acumulada, então todo Conectado+ também é Tentativa+ e a conversão do processo é o produto dos passos. ' +
      'A coorte recente <strong>ainda está viva</strong>: mês corrente sempre converte menos que mês fechado, e comparar os dois subestima o corrente. ' +
      '"Qualificado → Deal" fica perto de 100% <strong>por construção</strong> (o deal nasce da qualificação) — ali leia o volume, não a taxa.' +
      (P.deal_sem_qualificar
        ? '<br><strong style="color:var(--text)">' + ni(P.deal_sem_qualificar) + ' lead(s) com deal SEM ter passado por Qualificado</strong> no histórico de etapa — ' +
          'por isso o passo usa a interseção (' + ni(P.qual_com_deal) + ' de ' + ni(P.qualificado) + ') e não o total de ' + ni(P.deal) + ' com deal: ' +
          'sem esse cuidado a taxa passava de 100%, que é onde a régua avisa que o funil não é linear no CRM.'
        : '') +
      notaFiltro + '</p>';
  }

  // ── LINHA DO TEMPO da conversão ───────────────────────────────────────────────
  // Barras = volume criado (esquerda); linhas = taxa (direita). O último ponto é
  // PARCIAL e sai tracejado: a coorte recente ainda vai converter, e desenhar a queda
  // final como se fosse resultado é o erro clássico do gráfico de coorte.
  //
  // TRÊS COISAS MUDARAM EM 12/08/2026, todas pedidas pelo dono:
  //   1. GRANULARIDADE é escolha (dia/semana/mês/trimestre), não mais só automática;
  //   2. QUEBRA por dimensão — uma linha por BDR, canal, tier ou vidas, em vez de uma
  //      linha só do time;
  //   3. o EIXO DE % se ajusta ao que está visível, em vez de ficar preso em 0–100.
  var PALETA_QUEBRA = [
    'rgba(88,166,255,.95)', 'rgba(63,185,80,.95)', 'rgba(210,153,34,.95)',
    'rgba(147,112,219,.95)', 'rgba(58,184,183,.95)', 'rgba(248,81,73,.9)',
    'rgba(236,72,153,.9)', 'rgba(140,140,150,.9)'
  ];
  var FORMAS = ['circle', 'rectRot', 'triangle', 'rect', 'star', 'cross'];

  /**
   * O EIXO DA DIREITA ACOMPANHA AS TAXAS VISÍVEIS.
   *
   * Pedido literal: "se eu deixo só criado para qualificado, meu eixo Y da direita
   * deveria ser refatorado para mostrar apenas o mínimo até o máximo dessa taxa". Num
   * eixo 0–100, uma taxa que vive entre 3% e 7% é uma linha reta colada no chão — o
   * gráfico existe e não mostra nada.
   *
   * DUAS SALVAGUARDAS, porque zoom sem régua engana tanto quanto eixo achatado:
   *   · uma folga de 10% da amplitude em cada ponta, para a linha não encostar na borda;
   *   · amplitude MÍNIMA de 5 pontos percentuais, senão uma variação de 0,2 p.p. ocupa a
   *     altura inteira do cartão e parece um terremoto.
   * E o rodapé sempre diz o intervalo em que o eixo está, para ninguém comparar dois
   * prints com escalas diferentes achando que são a mesma.
   */
  function escalaDireita(datasets) {
    var vals = [];
    datasets.forEach(function (d) {
      if (d.yAxisID !== 'y1' || d.hidden) return;
      (d.data || []).forEach(function (v) { if (v != null && isFinite(v)) vals.push(v); });
    });
    if (!vals.length) return { min: 0, max: 100 };
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    var amp = mx - mn;
    if (amp < 5) { var meio = (mx + mn) / 2; mn = meio - 2.5; mx = meio + 2.5; amp = 5; }
    mn -= amp * 0.1; mx += amp * 0.1;
    return { min: Math.max(0, +mn.toFixed(1)), max: Math.min(100, +mx.toFixed(1)) };
  }

  function serieChart() {
    if (!D || typeof _novoMkChart !== 'function') return;
    var cv = document.getElementById('lf-serie'); if (!cv) return;
    var th_ = _novoTheme();
    var host = cv.parentNode;
    var velha = host && host.querySelector('.lf-serie-nota');
    if (velha) velha.remove();

    var B = serieBuckets();
    if (!B.length) {
      if (host) {
        var p0 = document.createElement('p');
        p0.className = 'lf-serie-nota';
        p0.style.cssText = 'font-size:.75rem;color:var(--text2);margin:.6rem 0 0';
        p0.textContent = 'Sem coorte no período para ' + focoLabel() + '.';
        host.appendChild(p0);
      }
      return;
    }
    var parcial = (D.coorte.serie || {}).bucket_parcial;
    var iParcial = B.map(function (b) { return b.bucket; }).indexOf(parcial);
    var labels = B.map(function (b) { return rotBucket(b.bucket) + (b.bucket === parcial ? ' *' : ''); });

    var dash = function () {
      return iParcial > 0 ? { borderDash: function (ctx) { return ctx.p1DataIndex === iParcial ? [6, 4] : undefined; } } : undefined;
    };
    var iLinha = 0;
    var linha = function (label, cor, dados, eixo) {
      var forma = FORMAS[iLinha++ % FORMAS.length];
      return { type: 'line', label: label, data: dados, borderColor: cor, backgroundColor: cor,
        yAxisID: eixo || 'y1', tension: .25, borderWidth: 2, pointRadius: 3.5, pointHoverRadius: 6,
        pointStyle: forma, spanGaps: true, segment: dash(),
        hidden: !!escondidas[label], datalabels: { display: false } };
    };
    var C_PROCESSO = 'rgba(147,112,219,.95)';   // roxo: nenhuma etapa usa, então não colide

    // A MÉTRICA de cada visão, em um lugar só — é ela que a quebra por dimensão repete
    // para cada valor. Sem isto, quebrar por BDR precisaria duplicar as três visões.
    var METRICA = {
      ate_qual: { rot: 'Criado → Qualificado', taxa: true, f: function (b) { return b.criados ? +(b.qualificados / b.criados * 100).toFixed(1) : null; } },
      passo:    { rot: 'Novo → Tentativa+',    taxa: true, f: function (b) { return b.criados ? +(b.por_etapa / b.criados * 100).toFixed(1) : null; } },
      volume:   { rot: 'Leads criados',        taxa: false, f: function (b) { return b.criados; } },
      contato:  { rot: 'Falou com',            taxa: true, f: function (b) { return b.criados ? +(b.com_atividade / b.criados * 100).toFixed(1) : null; } }
    };

    var ds, notaQuebra = '';
    if (quebraDim) {
      // QUEBRA: uma linha por valor da dimensão, todas medindo a MESMA métrica. Mais de
      // 6 linhas num gráfico deixa de ser leitura e vira mancha, então entra o top 6 por
      // volume e o rodapé diz quantos ficaram de fora — capar calado seria fingir
      // cobertura.
      var vals = valoresDaSerie(quebraDim, 6);
      var totalVals = Object.keys((function () {
        var m = {};
        (((D.coorte.serie || {}).por_dimensao || {})[quebraDim] || []).forEach(function (r) {
          if (soBdr && r.bdr === false) return;
          if (r.rec === false) return;
          m[r.valor] = 1;
        });
        return m;
      })()).length;
      var M = METRICA[serieView] || METRICA.ate_qual;
      ds = vals.map(function (v, i) {
        var Bv = serieBuckets(quebraDim, v);
        var porBucket = {};
        Bv.forEach(function (b) { porBucket[b.bucket] = b; });
        var dados = B.map(function (b) {
          var bb = porBucket[b.bucket];
          return bb ? M.f(bb) : null;
        });
        return linha(String(v), PALETA_QUEBRA[i % PALETA_QUEBRA.length], dados, M.taxa ? 'y1' : 'y');
      });
      notaQuebra = 'Quebrado por <strong>' + esc(ROT_DIM[quebraDim] || quebraDim) + '</strong>, medindo <strong>' +
        esc(M.rot) + '</strong>' +
        (totalVals > vals.length ? ' — mostrando os <strong>' + vals.length + '</strong> maiores de ' + ni(totalVals) + ' valores, por volume de leads criados' : '') +
        '. Clique na legenda para isolar uma linha; o eixo se ajusta ao que ficou visível. ';
    } else {
      var taxa = function (num, den) { return B.map(function (b) { return b[den] ? +(b[num] / b[den] * 100).toFixed(1) : null; }); };
      var barras = { type: 'bar', label: 'Leads criados', data: B.map(function (b) { return b.criados; }),
        backgroundColor: B.map(function (b) { return b.bucket === parcial ? 'rgba(88,166,255,.35)' : 'rgba(88,166,255,.55)'; }),
        borderRadius: 3, yAxisID: 'y', order: 9, hidden: !!escondidas['Leads criados'],
        datalabels: { anchor: 'end', align: 'top', color: th_.cText2, font: { family: NOVO_FONT, size: 9 }, formatter: function (v) { return v ? ni(v) : ''; } } };

      if (serieView === 'volume') {
        ds = [barras,
          linha('Chegaram a Tentativa+', COR.tentativa, B.map(function (b) { return b.por_etapa; }), 'y'),
          linha('Chegaram a Conectado+', COR.conectado, B.map(function (b) { return b.conectados; }), 'y'),
          linha('Qualificados', C_BOM_T, B.map(function (b) { return b.qualificados; }), 'y')];
      } else if (serieView === 'passo') {
        ds = [barras,
          linha('Novo → Tentativa+', COR.tentativa, taxa('por_etapa', 'criados')),
          linha('Tentativa+ → Conectado+', COR.conectado, B.map(function (b) { return b.por_etapa ? +(b.conectados / b.por_etapa * 100).toFixed(1) : null; })),
          // Verde CHEIO, não o verde translúcido da etapa: ao lado do turquesa do
          // "conectado" o tom fraco quase encosta, e aí só a forma do ponto separava.
          linha('Conectado+ → Qualificado', C_BOM_T, B.map(function (b) { return b.conectados ? +(b.qualificados / b.conectados * 100).toFixed(1) : null; }))];
      } else if (serieView === 'contato') {
        // A VISÃO DE ESFORÇO no eixo do tempo: tentou, falou, conversou. É aqui que
        // "tentou mais e converteu menos" vira uma pergunta respondível.
        ds = [barras,
          linha('Tentou (esforço)', COR.tentativa, taxa('com_tentativa', 'criados')),
          linha('Falou com (atividade)', COR.conectado, taxa('com_atividade', 'criados')),
          linha('Conversou (voz)', C_BOM_T, taxa('com_conversa', 'criados'))];
      } else {
        ds = [barras,
          linha('Criado → Qualificado', C_PROCESSO, taxa('qualificados', 'criados')),
          linha('Tentativa+ → Qualificado', COR.tentativa, B.map(function (b) { return b.por_etapa ? +(b.qualificados / b.por_etapa * 100).toFixed(1) : null; })),
          linha('Conectado+ → Qualificado', COR.conectado, B.map(function (b) { return b.conectados ? +(b.qualificados / b.conectados * 100).toFixed(1) : null; }))];
      }
      // As linhas ficam por cima das barras, sempre: barra desenhada em cima da linha
      // esconde justamente o ponto que se quer ler.
      ds.forEach(function (d, i) { if (i) d.order = 1; });
    }

    var esc1 = escalaDireita(ds);
    var temTaxa = ds.some(function (d) { return d.yAxisID === 'y1'; });

    _novoMkChart('lf-serie', {
      type: 'bar', plugins: [ChartDataLabels],
      data: { labels: labels, datasets: ds },
      options: {
        // padding de 34 e não 22: com a legenda de 4 itens em cima, o rótulo da barra
        // mais alta encostava no texto da legenda.
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 34 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true, labels: { color: th_.cText2, font: { family: NOVO_FONT, size: 10 }, padding: 8, usePointStyle: true },
            // CLICAR NA LEGENDA REESCALA O EIXO. É o pedido do dono: deixar só uma taxa
            // visível tem de reenquadrar o eixo naquela taxa, não mantê-lo em 0–100.
            onClick: function (e, item, legend) {
              var ch = legend.chart, i = item.datasetIndex;
              var meta = ch.getDatasetMeta(i);
              var novoOculto = meta.hidden === null ? !ch.data.datasets[i].hidden : !meta.hidden;
              meta.hidden = novoOculto;
              escondidas[ch.data.datasets[i].label] = novoOculto;
              var visiveis = ch.data.datasets.map(function (d, k) {
                return { yAxisID: d.yAxisID, data: d.data, hidden: !!ch.getDatasetMeta(k).hidden };
              });
              var nova = escalaDireita(visiveis);
              ch.options.scales.y1.min = nova.min;
              ch.options.scales.y1.max = nova.max;
              ch.update();
              var selo = document.getElementById('lf-serie-escala');
              if (selo) selo.textContent = 'eixo % em ' + nova.min.toString().replace('.', ',') + '–' + nova.max.toString().replace('.', ',') + '%';
            }
          },
          tooltip: {
            callbacks: {
              label: function (c) {
                var v = c.parsed.y;
                if (v == null) return c.dataset.label + ': —';
                var ehTaxa = c.dataset.yAxisID === 'y1';
                return c.dataset.label + ': ' + (ehTaxa ? String(v).replace('.', ',') + '%' : ni(v));
              },
              afterBody: function (items) {
                var b = B[items[0].dataIndex];
                var l = ['', ni(b.criados) + ' criados · ' + ni(b.por_etapa) + ' tentativa+ · ' + ni(b.conectados) + ' conectado+ · ' +
                  ni(b.qualificados) + ' qualificados · ' + ni(b.desqualificados) + ' desqualificados'];
                if (b.bucket === parcial) l.push('⚠ COORTE PARCIAL: ainda está viva e vai converter mais');
                return l;
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: th_.cText2, font: { family: NOVO_FONT, size: 10 }, maxRotation: 45, autoSkip: true, maxTicksLimit: 26 } },
          y: { position: 'left', beginAtZero: true, grid: { color: th_.cGrid },
            ticks: { color: th_.cText2, font: { family: NOVO_FONT }, precision: 0, callback: function (v) { return ni(v); } },
            title: { display: true, text: serieView === 'volume' ? 'leads' : 'leads criados', color: th_.cText2, font: { family: NOVO_FONT, size: 10 } } },
          // beginAtZero SAIU: era ele que segurava o eixo em 0 e achatava qualquer taxa
          // pequena. O mínimo agora vem da própria série (ver escalaDireita).
          y1: { position: 'right', display: temTaxa, min: esc1.min, max: esc1.max, grid: { display: false },
            ticks: { color: th_.cText2, font: { family: NOVO_FONT }, callback: function (v) { return (Math.round(v * 10) / 10).toString().replace('.', ',') + '%'; } } }
        },
        onClick: function (e, el) { if (!el.length) return; drillBucket(B[el[0].index].bucket); }
      }
    });

    if (host) {
      var p = document.createElement('p');
      p.className = 'lf-serie-nota';
      p.style.cssText = 'font-size:.71rem;color:var(--text2);margin:.5rem 0 0;line-height:1.6';
      var g = (D.granularidade || {});
      p.innerHTML = 'Coorte por <strong>período de criação</strong> do lead (<strong>' +
        esc(GRAN_PT[granAtual()] || granAtual()) + '</strong>' +
        (g.pedida ? ', escolhido' : ', padrão para esta janela') + '), medindo <strong>' + esc(focoLabel()) + '</strong>' +
        (soBdr ? ', só donos que são BDR' : ', todos os donos de lead') + '. ' +
        notaQuebra +
        (iParcial >= 0 ? '<strong style="color:var(--text)">' + rotBucket(parcial) + ' está marcado com * e tracejado: coorte PARCIAL</strong> — ela ainda vai converter, então a queda no fim é maturidade, não piora. ' : '') +
        'Período fechado contra período fechado é comparação legítima; qualquer um deles contra o corrente, não. ' +
        '<span id="lf-serie-escala" style="color:var(--text)">eixo % em ' + String(esc1.min).replace('.', ',') + '–' + String(esc1.max).replace('.', ',') + '%</span>. ' +
        'Clique num ponto para ver os leads da coorte.';
      host.appendChild(p);
    }
  }

  // ── CONVERSÃO por dimensão ────────────────────────────────────────────────────
  function tabelaConversao() {
    var el = document.getElementById('lf-convtab'); if (!el || !D) return;
    var agg = linhasDim(convDim);
    if (!agg.length) { el.innerHTML = '<p style="color:var(--text2);padding:1rem 0">Nenhum lead criado no período.</p>'; return; }

    var todas = agg.map(function (r) {
      return {
        k: r.valor, roster: r.roster, papel: r.papel,
        criados: r.criados, tent: r.por_etapa, con: r.conectados,
        // `deal` aqui é a INTERSEÇÃO com qualificado — ver passosDe(): o total de
        // com_deal pode superar os qualificados e faria a taxa passar de 100%.
        qual: r.qualificados, deal: r.qual_com_deal, dq: r.desqualificados,
        // As taxas são de PASSO (sobre a etapa anterior), menos a última, que é o
        // processo inteiro. Misturar as duas na mesma linha sem dizer qual é qual foi
        // como o "funil" antigo fazia parecer que 90% chegava ao fim.
        tx1: r.criados ? r.por_etapa / r.criados : 0,
        tx2: r.por_etapa ? r.conectados / r.por_etapa : 0,
        tx3: r.conectados ? r.qualificados / r.conectados : 0,
        tx4: r.qualificados ? r.qual_com_deal / r.qualificados : 0,
        // Cada etapa medida contra o DESFECHO, não contra o degrau seguinte: é o que
        // diz quanto vale ter tentado e quanto vale ter conectado.
        txtq: r.por_etapa ? r.qualificados / r.por_etapa : 0,
        txe2e: r.criados ? r.qualificados / r.criados : 0,
        txdq: r.criados ? r.desqualificados / r.criados : 0
      };
    });
    var ord = ordena(todas, 'conv', function (r, c) { return c === 'k' ? r.k : r[c]; }).slice(0, 25);
    var T = passosDe(agg);
    var rotDim = ROT_DIM[convDim] || convDim;

    // Célula de taxa com barra: o percentual sozinho não deixa comparar linhas de
    // relance, e a barra sozinha não deixa auditar.
    var cel = function (a, b, cor) {
      var p = b ? Math.round(a / b * 100) : 0;
      return '<td style="min-width:112px"><div style="display:flex;align-items:center;gap:.4rem;justify-content:flex-end">' +
        '<span style="color:var(--text2);font-size:.7rem">' + ni(a) + '</span>' +
        '<div style="flex:1;max-width:44px;height:6px;background:var(--card2);border-radius:3px;overflow:hidden">' +
        '<div style="width:' + p + '%;height:100%;background:' + cor + '"></div></div>' +
        '<span style="white-space:nowrap;font-weight:600">' + pct(a, b) + '</span></div></td>';
    };

    var html = '<div style="font-size:.74rem;color:var(--text2);margin:.1rem 0 .6rem;line-height:1.6">' +
      'Cada passo é medido <strong>sobre a etapa anterior</strong>, não sobre o total — é o que separa "perde no primeiro contato" de "perde na qualificação". ' +
      'A última coluna é o processo inteiro (criado → qualificado). ' +
      (convDim === 'bdr'
        ? 'No corte por pessoa a coorte é atribuída ao <strong>dono do lead</strong>: quem trabalha carteira antiga aparece com denominador pequeno, e a coluna <em>Trabalhou na janela</em> da tabela de taxa de contato é a régua complementar.'
        : 'Corte por atributo do LEAD, onde a coorte é a régua certa — o atributo nasce com o lead.') +
      (convDim === 'origem'
        ? '<br><span style="color:var(--red)">⚠ Corte contaminado na FONTE:</span> <code>axenya_origem_canonica</code> devolve <strong>booleano</strong> em 64% dos leads. "true" não é uma origem.'
        : '') +
      // Filtro de campo ativo numa dimensão diferente da tabela: a tela AVISA em vez
      // de fingir que a tabela seguiu o filtro. O cruzamento entre dois campos não
      // existe nesta agregação, e mostrar a tabela cheia sem dizer isso seria deixar
      // duas leituras contraditórias na mesma tela.
      (filtroVal != null
        ? (convDim === filtroDim
            ? '<br><strong style="color:var(--text)">Filtro ativo em ' + esc(focoLabel()) + '</strong> — a linha dele está nesta tabela; as outras seguem visíveis para comparação.'
            : '<br><span style="color:var(--red)">⚠ Esta tabela NÃO segue o filtro de ' + esc(focoLabel()) + '</span>: o cruzamento entre dois campos ' +
              '(' + esc(ROT_DIM[filtroDim]) + ' × ' + esc(ROT_DIM[convDim]) + ') não existe nesta agregação, que sai por dimensão isolada. ' +
              'Os cards e a linha do tempo acima seguem o filtro; esta tabela mostra a coorte inteira do recorte de gente.')
        : '') +
      '</div>';

    html += '<table class="lb" style="font-size:.78rem;width:100%;min-width:1080px"><thead><tr>' +
      th('conv', 'k', rotDim, 'left') +
      th('conv', 'criados', 'Criados') +
      th('conv', 'tx1', 'Novo → Tentativa+') +
      th('conv', 'tx2', 'Tentativa+ → Conectado+') +
      th('conv', 'tx3', 'Conectado+ → Qualificado') +
      th('conv', 'tx4', 'Qualificado → Deal') +
      th('conv', 'txtq', 'Tentativa+ → Qualif.<br><span style="font-weight:400;font-size:.66rem;color:var(--text2)">até o desfecho</span>') +
      th('conv', 'txdq', 'Descarte') +
      th('conv', 'txe2e', 'Processo<br><span style="font-weight:400;font-size:.66rem;color:var(--text2)">criado → qualificado</span>') +
      '</tr></thead><tbody>';
    ord.forEach(function (r) {
      var selo = convDim === 'bdr' && !r.roster
        ? ' <span style="font-weight:400;font-size:.64rem;color:var(--text2)" title="' + esc(r.papel || 'fora do roster canônico') + '">(' + esc(r.papel || 'fora do roster') + ')</span>'
        : '';
      html += '<tr style="cursor:pointer' + (r.criados ? '' : ';opacity:.62') + '" onclick="AxLeadFunnel.drillConv(' + JSON.stringify(r.k).replace(/"/g, '&quot;') + ')">' +
        '<td style="text-align:left;white-space:nowrap;max-width:250px;overflow:hidden;text-overflow:ellipsis;font-weight:600">' + esc(r.k) + selo + '</td>' +
        '<td style="font-weight:700">' + ni(r.criados) + '</td>' +
        cel(r.tent, r.criados, COR.tentativa) + cel(r.con, r.tent, COR.conectado) +
        cel(r.qual, r.con, COR.qualificado) + cel(r.deal, r.qual, C_BOM) +
        cel(r.qual, r.tent, COR.tentativa) +
        cel(r.dq, r.criados, C_RUIM) + cel(r.qual, r.criados, C_TOTAL) + '</tr>';
    });
    html += '</tbody><tfoot><tr><td style="text-align:left;font-weight:700">Total</td>' +
      '<td style="font-weight:700">' + ni(T.criados) + '</td>' +
      '<td style="font-weight:700;text-align:right">' + pct(T.tentativa, T.criados) + '</td>' +
      '<td style="font-weight:700;text-align:right">' + pct(T.conectado, T.tentativa) + '</td>' +
      '<td style="font-weight:700;text-align:right">' + pct(T.qualificado, T.conectado) + '</td>' +
      '<td style="font-weight:700;text-align:right">' + pct(T.qual_com_deal, T.qualificado) + '</td>' +
      '<td style="font-weight:700;text-align:right">' + pct(T.qualificado, T.tentativa) + '</td>' +
      '<td style="font-weight:700;text-align:right">' + pct(T.desq, T.criados) + '</td>' +
      '<td style="font-weight:700;text-align:right">' + pct(T.qualificado, T.criados) + '</td>' +
      '</tr></tfoot></table>' +
      '<p style="font-size:.71rem;color:var(--text2);margin:.45rem 0 0">' +
      (todas.length > 25 ? 'Mostrando 25 de ' + ni(todas.length) + ' valores de ' + rotDim + ' — o Total soma TODOS. ' : '') +
      'Agregado no BigQuery: cobre <strong>100% da coorte</strong>' + (soBdr ? ' do recorte de BDRs' : ' de todos os donos de lead') + ', não a lista capada do drill. ' +
      'Taxa com denominador de um dígito é ruído: leia a coluna <em>Criados</em> antes de rankear.' +
      '</p>';
    el.innerHTML = html;
  }

  /**
   * A TABELA POR DIMENSÃO, em TRÊS VISÕES.
   *
   * Ela tinha 14 colunas e o dono pediu mais seis (empresas, penetração, esforço,
   * discagens). Vinte colunas numa tabela é uma planilha com barra de rolagem — cada
   * coluna existe, nenhuma é lida. As três visões respondem perguntas distintas e cada
   * uma cabe na tela:
   *
   *   CONTATO     — tentou, falou, conversou. Esforço contra resultado.
   *   FUNIL       — criou, avançou, qualificou, perdeu. Conversão.
   *   PENETRAÇÃO  — empresas alcançadas e quantos leads por empresa.
   *
   * As colunas de TRABALHO NA JANELA (leads tocados e toques) aparecem nas três quando
   * o corte é por pessoa: é a régua que impede a tabela de dizer "criou 5, falou com 5"
   * para quem tocou 41 leads no período.
   */
  function tabelaRegua() {
    var el = document.getElementById('lf-regua'); if (!el || !D) return;
    // A TABELA LÊ A AGREGAÇÃO DO BIGQUERY, não a lista de leads. A lista vem capada
    // para o drill; somar ela daria total errado em janela longa — e daria errado de um
    // jeito plausível, que é o pior tipo.
    var agg = linhasDim(reguaDim);
    if (!agg.length) { el.innerHTML = '<p style="color:var(--text2);padding:1rem 0">Nenhum lead criado no período.</p>'; return; }

    var ehBdr = reguaDim === 'bdr';
    var todas = agg.map(function (r) {
      return {
        k: r.valor, papel: r.papel, n: r.criados, ativ: r.com_atividade, etapa: r.por_etapa, ambos: r.ambos,
        auto: r.so_automacao, herd: r.toque_herdado || 0, nunca: r.nunca_tocados,
        qual: r.qualificados, deal: r.com_deal, dq: r.desqualificados,
        con: r.conectados,
        trab_leads: r.trab_leads || 0, trab_toques: r.trab_toques || 0,
        roster: r.roster !== false,
        lacuna: r.por_etapa - r.ambos,
        tx_etapa: r.criados ? r.por_etapa / r.criados : 0,
        tx_ativ: r.criados ? r.com_atividade / r.criados : 0,
        // esforço
        tent: r.com_tentativa || 0, conversa: r.com_conversa || 0,
        disc: r.discagens || 0, conectadas: r.conectadas || 0,
        errado: r.numero_errado || 0, min_tel: Math.round((r.duracao_conectada_s || 0) / 60),
        tx_tent: r.criados ? (r.com_tentativa || 0) / r.criados : 0,
        tx_conversa: r.criados ? (r.com_conversa || 0) / r.criados : 0,
        disc_por_conversa: r.conectadas ? (r.discagens || 0) / r.conectadas : 0,
        // penetração
        emp: r.empresas || 0, emp_novas: r.empresas_novas || 0,
        por_emp: r.empresas ? r.criados / r.empresas : 0
      };
    });
    // Coluna que não existe nesta visão não pode reger a ordem: cair em `undefined`
    // ordenaria tudo por -Infinity e o rank viraria ordem de chegada do BigQuery.
    var COLS_DA_VISAO = {
      contato: ['k', 'n', 'tent', 'ativ', 'conversa', 'tx_tent', 'tx_ativ', 'tx_etapa', 'lacuna', 'disc', 'disc_por_conversa', 'errado', 'min_tel', 'nunca', 'trab_leads', 'trab_toques'],
      funil: ['k', 'n', 'etapa', 'con', 'qual', 'deal', 'dq', 'tx_etapa', 'trab_leads', 'trab_toques'],
      penetracao: ['k', 'n', 'emp', 'emp_novas', 'por_emp', 'auto', 'herd', 'nunca', 'trab_leads', 'trab_toques']
    };
    var permitidas = COLS_DA_VISAO[reguaView] || COLS_DA_VISAO.contato;
    if (permitidas.indexOf(sort.regua.col) < 0 || (!ehBdr && /^trab_/.test(sort.regua.col))) {
      sort.regua = { col: ehBdr && reguaView === 'contato' ? 'trab_toques' : 'n', dir: -1 };
    }
    var ord = ordena(todas, 'regua', function (r, c) { return c === 'k' ? r.k : r[c]; }).slice(0, 25);

    var t = todas.reduce(function (a, r) {
      ['n', 'etapa', 'ativ', 'ambos', 'qual', 'deal', 'dq', 'auto', 'herd', 'nunca', 'con',
       'tent', 'conversa', 'disc', 'conectadas', 'errado', 'min_tel', 'emp', 'emp_novas'].forEach(function (f) { a[f] += r[f]; });
      return a;
    }, { n: 0, etapa: 0, ativ: 0, ambos: 0, qual: 0, deal: 0, dq: 0, auto: 0, herd: 0, nunca: 0, con: 0,
         tent: 0, conversa: 0, disc: 0, conectadas: 0, errado: 0, min_tel: 0, emp: 0, emp_novas: 0 });
    // Total do time vem do payload (DISTINCT no banco), NÃO da soma das linhas: lead
    // tocado por dois BDRs conta em cada linha e uma vez só no time.
    var tj = (D.trabalho_na_janela || { leads_tocados: 0, toques: 0 });
    var PEN = (D.coorte && D.coorte.penetracao) || {};

    var barra = function (a, b, cor) {
      var p = b ? Math.round(a / b * 100) : 0;
      return '<td style="min-width:104px"><div style="display:flex;align-items:center;gap:.4rem;justify-content:flex-end">' +
        '<div style="flex:1;max-width:62px;height:6px;background:var(--card2);border-radius:3px;overflow:hidden">' +
        '<div style="width:' + p + '%;height:100%;background:' + cor + '"></div></div>' +
        '<span style="white-space:nowrap">' + pct(a, b) + '</span></div></td>';
    };
    var rotDim = ROT_DIM[reguaDim] || reguaDim;
    var num = function (v, cor) { return '<td style="' + (cor ? 'color:' + cor + ';font-weight:600' : '') + '">' + ni(v) + '</td>'; };
    var dec = function (v, casas) { return '<td>' + (v ? v.toFixed(casas == null ? 1 : casas).replace('.', ',') : '—') + '</td>'; };

    // ── cabeçalho e corpo, por visão ──────────────────────────────────────────
    var thTrab = ehBdr
      ? th('regua', 'trab_leads', 'Trabalhou<br><span style="font-weight:400;font-size:.66rem;color:var(--text2)">leads na janela</span>') +
        th('regua', 'trab_toques', 'Toques<br><span style="font-weight:400;font-size:.66rem;color:var(--text2)">na janela</span>')
      : '';
    var tdTrab = function (r) {
      return ehBdr
        ? '<td style="font-weight:600;color:' + (r.trab_leads ? C_BOM_T : 'var(--text2)') + '">' + ni(r.trab_leads) + '</td>' +
          '<td style="font-weight:600;color:' + (r.trab_toques ? C_BOM_T : 'var(--text2)') + '">' + ni(r.trab_toques) + '</td>'
        : '';
    };
    var tfTrab = ehBdr ? '<td style="font-weight:700">' + ni(tj.leads_tocados) + '</td><td style="font-weight:700">' + ni(tj.toques) + '</td>' : '';

    var cab, corpo, rodape, minW;
    if (reguaView === 'funil') {
      minW = ehBdr ? 1040 : 820;
      cab = th('regua', 'k', rotDim, 'left') + thTrab +
        th('regua', 'n', 'Criaram') +
        th('regua', 'etapa', 'Tentativa+') + th('regua', 'con', 'Conectado+') +
        th('regua', 'qual', 'Qualificados') + th('regua', 'deal', 'Com deal') + th('regua', 'dq', 'Desqualif.') +
        th('regua', 'tx_etapa', 'Tx contato<br><span style="font-weight:400;font-size:.66rem;color:var(--text2)">por ETAPA</span>');
      corpo = function (r) {
        return tdTrab(r) + num(r.n) + num(r.etapa) + num(r.con) + num(r.qual) + num(r.deal) + num(r.dq) +
          barra(r.etapa, r.n, COR.tentativa);
      };
      rodape = tfTrab + '<td style="font-weight:700">' + ni(t.n) + '</td><td style="font-weight:700">' + ni(t.etapa) + '</td>' +
        '<td style="font-weight:700">' + ni(t.con) + '</td><td style="font-weight:700">' + ni(t.qual) + '</td>' +
        '<td style="font-weight:700">' + ni(t.deal) + '</td><td style="font-weight:700">' + ni(t.dq) + '</td>' +
        '<td style="font-weight:700;text-align:right">' + pct(t.etapa, t.n) + '</td>';
    } else if (reguaView === 'penetracao') {
      minW = ehBdr ? 1080 : 860;
      cab = th('regua', 'k', rotDim, 'left') + thTrab +
        th('regua', 'n', 'Leads<br>criados') +
        th('regua', 'emp', 'Empresas<br><span style="font-weight:400;font-size:.66rem;color:var(--text2)">distintas</span>') +
        th('regua', 'emp_novas', 'Empresas<br><span style="font-weight:400;font-size:.66rem;color:var(--text2)">novas na janela</span>') +
        th('regua', 'por_emp', 'Leads por<br>empresa') +
        th('regua', 'auto', 'Só<br>automação') + th('regua', 'herd', 'Toque<br>pré-lead') + th('regua', 'nunca', 'Nunca<br>tocados');
      corpo = function (r) {
        return tdTrab(r) + num(r.n) + num(r.emp) + num(r.emp_novas) + dec(r.por_emp, 2) +
          num(r.auto, 'var(--text2)') + num(r.herd, 'var(--text2)') + num(r.nunca, r.nunca ? 'var(--red)' : 'var(--text2)');
      };
      rodape = tfTrab + '<td style="font-weight:700">' + ni(t.n) + '</td>' +
        '<td style="font-weight:700">' + ni(PEN.empresas || t.emp) + '</td>' +
        '<td style="font-weight:700">' + ni(PEN.empresas_novas || t.emp_novas) + '</td>' +
        '<td style="font-weight:700">' + (PEN.leads_por_empresa != null ? String(PEN.leads_por_empresa).replace('.', ',') : '—') + '</td>' +
        '<td style="font-weight:700">' + ni(t.auto) + '</td><td style="font-weight:700">' + ni(t.herd) + '</td>' +
        '<td style="font-weight:700">' + ni(t.nunca) + '</td>';
    } else {
      minW = ehBdr ? 1320 : 1080;
      cab = th('regua', 'k', rotDim, 'left') + thTrab +
        th('regua', 'n', 'Criaram<br><span style="font-weight:400;font-size:.66rem;color:var(--text2)">X leads</span>') +
        th('regua', 'tent', 'Tentou<br><span style="font-weight:400;font-size:.66rem;color:var(--text2)">esforço</span>') +
        th('regua', 'ativ', 'Falou com<br><span style="font-weight:400;font-size:.66rem;color:var(--text2)">atividade</span>') +
        th('regua', 'conversa', 'Conversou<br><span style="font-weight:400;font-size:.66rem;color:var(--text2)">voz atendida</span>') +
        th('regua', 'tx_ativ', 'Tx contato<br><span style="font-weight:400;font-size:.66rem;color:var(--text2)">por ATIVIDADE</span>') +
        th('regua', 'tx_etapa', 'Tx contato<br><span style="font-weight:400;font-size:.66rem;color:var(--text2)">por ETAPA</span>') +
        th('regua', 'lacuna', 'Etapa sem<br>toque') +
        th('regua', 'disc', 'Discagens') +
        th('regua', 'disc_por_conversa', 'Discagens<br><span style="font-weight:400;font-size:.66rem;color:var(--text2)">por conversa</span>') +
        th('regua', 'errado', 'Número<br>errado') +
        th('regua', 'min_tel', 'Min ao<br>telefone') +
        th('regua', 'nunca', 'Nunca<br>tocados');
      corpo = function (r) {
        return tdTrab(r) + num(r.n) +
          num(r.tent, r.tent ? COR.tentativa : 'var(--text2)') +
          num(r.ativ, r.ativ ? C_BOM_T : 'var(--text2)') +
          num(r.conversa, r.conversa ? C_BOM_T : 'var(--text2)') +
          barra(r.ativ, r.n, COR.conectado) + barra(r.etapa, r.n, COR.tentativa) +
          '<td style="color:' + (r.lacuna ? 'var(--red)' : 'var(--text2)') + '">' + ni(r.lacuna) + '</td>' +
          num(r.disc) + dec(r.disc_por_conversa) +
          '<td style="color:' + (r.errado ? 'var(--text)' : 'var(--text2)') + '">' + ni(r.errado) + '</td>' +
          num(r.min_tel) +
          '<td style="color:' + (r.nunca ? 'var(--red)' : 'var(--text2)') + '">' + ni(r.nunca) + '</td>';
      };
      rodape = tfTrab + '<td style="font-weight:700">' + ni(t.n) + '</td>' +
        '<td style="font-weight:700">' + ni(t.tent) + '</td><td style="font-weight:700">' + ni(t.ativ) + '</td>' +
        '<td style="font-weight:700">' + ni(t.conversa) + '</td>' +
        '<td style="font-weight:700;text-align:right">' + pct(t.ativ, t.n) + '</td>' +
        '<td style="font-weight:700;text-align:right">' + pct(t.etapa, t.n) + '</td>' +
        '<td style="font-weight:700">' + ni(t.etapa - t.ambos) + '</td>' +
        '<td style="font-weight:700">' + ni(t.disc) + '</td>' +
        '<td style="font-weight:700">' + (t.conectadas ? (t.disc / t.conectadas).toFixed(1).replace('.', ',') : '—') + '</td>' +
        '<td style="font-weight:700">' + ni(t.errado) + '</td>' +
        '<td style="font-weight:700">' + ni(t.min_tel) + '</td>' +
        '<td style="font-weight:700">' + ni(t.nunca) + '</td>';
    }

    // ── texto de leitura, por visão ───────────────────────────────────────────
    var intro;
    if (reguaView === 'penetracao') {
      intro = '<strong style="color:var(--text)">' + ni(t.n) + ' leads em ' + ni(PEN.empresas || t.emp) + ' empresas</strong>' +
        (PEN.leads_por_empresa != null ? ' — <strong>' + String(PEN.leads_por_empresa).replace('.', ',') + ' leads por empresa</strong>' : '') + '. ' +
        '<strong>' + ni(PEN.empresas_novas || t.emp_novas) + '</strong> dessas empresas nasceram dentro da janela; as outras já existiam, ou seja o trabalho foi de APROFUNDAR conta, não de abrir. ' +
        'Os dois movimentos são legítimos e pedem leitura diferente: muitos leads por empresa é penetração em conta grande, um por empresa é varredura de topo. ' +
        (ehBdr ? '<br>O total de empresas é DISTINCT do recorte e pode ser menor que a soma das linhas: empresa trabalhada por dois BDRs conta em cada um e uma vez no time.' : '');
    } else if (reguaView === 'funil') {
      intro = '<strong style="color:var(--text)">' + ni(t.n) + ' criados → ' + ni(t.etapa) + ' tentativa+ → ' + ni(t.con) + ' conectado+ → ' + ni(t.qual) + ' qualificados</strong>' +
        ' (' + ni(t.deal) + ' com deal, ' + ni(t.dq) + ' desqualificados). A régua é de COORTE e acumulada: "chegou a Conectado+" quer dizer que o lead VISITOU a etapa.';
    } else {
      intro = '<strong style="color:var(--text)">Criaram ' + ni(t.n) + ', tentaram ' + ni(t.tent) + ', falaram com ' + ni(t.ativ) + ', conversaram por voz com ' + ni(t.conversa) + '</strong>. ' +
        'As TRÊS RÉGUAS empilham: <em>tentou</em> conta a discagem que não conectou (decisão do head de BDRs, 12/08/2026); ' +
        '<em>falou com</em> exige que algo tenha chegado do outro lado (mensagem enviada, voz conectada, reunião realizada); ' +
        '<em>conversou</em> é só voz atendida.<br>' +
        'Pela régua de <strong>etapa</strong> seriam ' + ni(t.etapa) + ' (' + pct(t.etapa, t.n) + '), e a diferença é o alerta: ' +
        '<strong style="color:var(--red)">' + ni(t.etapa - t.ambos) + ' movidos de etapa sem nenhum toque registrado</strong>. ' +
        '<strong>' + ni(t.nunca) + ' nunca foram tocados</strong> por ninguém' +
        (t.auto ? ' e <strong>' + ni(t.auto) + '</strong> só por automação' : '') + '.' +
        (t.conectadas
          ? '<br><strong style="color:var(--text)">' + ni(t.disc) + ' discagens para ' + ni(t.conectadas) + ' conexões</strong> — ' +
            (t.disc / t.conectadas).toFixed(1).replace('.', ',') + ' discagens por conversa, ' + ni(t.min_tel) + ' minutos ao telefone' +
            (t.errado ? ' e ' + ni(t.errado) + ' número(s) errado(s), que é problema de DADO e não de cadência' : '') + '. ' +
            'Discagem alta com conexão baixa aponta lista, não esforço.'
          : '');
    }

    var html = '<div style="font-size:.74rem;color:var(--text2);margin:.1rem 0 .6rem;line-height:1.6">' + intro +
      (reguaDim === 'origem'
        ? '<br><span style="color:var(--red)">⚠ Este corte está contaminado na FONTE:</span> ' +
          '<code>axenya_origem_canonica</code> devolve <strong>booleano</strong> em 64% dos leads (9.836 "true" + 1.040 "false"). ' +
          '<strong>"true" não é uma origem.</strong> Use o corte <strong>Canal</strong>, que é a cascata de evidências que substitui este — ' +
          'ele classifica 85% da coorte contra 36% aqui. Este corte fica visível só para auditar a cascata.'
        : '') +
      (ehBdr
        ? '<br><span style="color:var(--text)">A coluna de coorte é <strong>coorte</strong>, e coorte não é o mês da pessoa.</span> ' +
          'No mesmo período o time tocou <strong>' + ni(tj.leads_tocados) + ' leads</strong> de qualquer safra, com <strong>' +
          ni(tj.toques) + ' toques</strong> — é a coluna <em>Trabalhou na janela</em>, atribuída a <strong>quem tocou</strong>, ' +
          'não ao dono do lead.'
        : '') +
      '</div>';

    html += '<table class="lb" style="font-size:.78rem;width:100%;min-width:' + minW + 'px"><thead><tr>' + cab +
      '</tr></thead><tbody>';
    ord.forEach(function (r) {
      // Linha inteira em zero é AFIRMAÇÃO ("medimos e não houve"), não lacuna.
      var vazia = ehBdr && !r.n && !r.trab_toques;
      var selo = ehBdr && !r.roster
        ? ' <span style="font-weight:400;font-size:.64rem;color:var(--text2)" title="Dono de lead fora do roster canônico de BDR">(' + esc(r.papel || 'fora do roster') + ')</span>'
        : '';
      html += '<tr style="cursor:pointer' + (vazia ? ';opacity:.62' : '') + '" onclick="AxLeadFunnel.drillDim(' + JSON.stringify(r.k).replace(/"/g, '&quot;') + ')">' +
        '<td style="text-align:left;white-space:nowrap;max-width:230px;overflow:hidden;text-overflow:ellipsis;font-weight:600">' + esc(r.k) + selo + '</td>' +
        corpo(r) + '</tr>';
    });
    html += '</tbody><tfoot><tr><td style="text-align:left;font-weight:700">Total</td>' + rodape + '</tr></tfoot></table>' +
      '<p style="font-size:.71rem;color:var(--text2);margin:.45rem 0 0">' +
      (todas.length > 25 ? 'Mostrando 25 de ' + ni(todas.length) + ' valores de ' + rotDim + ' — o Total soma TODOS. ' : '') +
      'Os números desta tabela são agregados no BigQuery e cobrem <strong>100% da coorte</strong>. ' +
      (ehBdr
        ? 'Linha zerada é <strong>afirmação</strong>: o BDR está no roster, foi medido, e não criou nem tocou lead do recorte na janela — não é dado faltando. '
        : '') +
      (function () {
        var ex = excluidos(reguaDim);
        if (!soBdr) return '<br>Filtro <strong>desligado</strong>: a tabela inclui todo dono de lead, BDR ou não. ';
        if (!ex.criados && !ex.n_donos) return '';
        return '<br>Filtro <strong>"só BDRs"</strong> ligado: saíram ' + ni(ex.criados) + ' leads de ' + ni(ex.n_donos) + ' donos — ' +
          baldesTxt(ex) + '. Desligue o botão no topo da seção para vê-los. ';
      })() +
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
    // A COLUNA da matriz é a visão: QUEM fez, ou a EVIDÊNCIA que o CRM registrou.
    var campoCol = disqView === 'evidencia' ? 'submotivo' : 'autor';
    var autores = {}, motivos = {};
    lista.forEach(function (d) {
      var c = d[campoCol] || '(sem dado)';
      autores[c] = (autores[c] || 0) + 1;
      motivos[d.motivo] = (motivos[d.motivo] || 0) + 1;
    });
    var cols = Object.keys(autores).sort(function (a, b) { return autores[b] - autores[a]; }).slice(0, 10);
    var rows = Object.keys(motivos).sort(function (a, b) { return motivos[b] - motivos[a]; }).slice(0, 12);
    var max = 0;
    var celula = function (m, a) { return lista.filter(function (x) { return x.motivo === m && (x[campoCol] || '(sem dado)') === a; }); };
    rows.forEach(function (m) { cols.forEach(function (a) { var n = celula(m, a).length; if (n > max) max = n; }); });

    /**
     * O NOME DO AUTOR NO CABEÇALHO ERA CORTADO — achado pelo smoke de pixel, não por
     * leitura de código: "GABRIELE ALMEIDA" virava "GABRIELE ALM…" em dez colunas, e o
     * `max-width:90px` com `text-overflow:ellipsis` fazia isso em SILÊNCIO, sem barra de
     * rolagem que denunciasse.
     *
     * O conserto é abreviar de propósito ("Gabriele A.") em vez de cortar por acidente:
     * a abreviação é legível, cabe, e o nome inteiro fica no `title`. E a tabela ganha
     * `min-width` para o contêiner ROLAR quando não couber — o mesmo defeito, e a mesma
     * correção, da tabela de 14 colunas da leva 5.
     */
    // A ABREVIAÇÃO VALE SÓ PARA NOME DE GENTE. Aplicada aos submotivos, ela transformava
    // "Discou 4–9x, ninguém atendeu" em "Discou a." — o smoke de pixel pegou isso na
    // primeira rodada. Rótulo que descreve uma categoria não é nome próprio e não pode
    // virar inicial.
    var abrevia = function (nome) {
      if (disqView !== 'autor') return nome;
      var p = String(nome).trim().split(/\s+/);
      if (p.length < 2 || /^(Automação|Integração)$/i.test(nome)) return nome;
      return p[0] + ' ' + p[p.length - 1].charAt(0) + '.';
    };
    var larguraCol = disqView === 'autor' ? 96 : 132;
    var larguraMin = 240 + cols.length * larguraCol;
    var h = '<table class="lb" style="font-size:.72rem;width:100%;min-width:' + larguraMin + 'px"><thead><tr><th style="text-align:left">Motivo</th>' +
      cols.map(function (a) {
        // Na visão por evidência o rótulo é uma frase: ela QUEBRA em duas linhas em vez
        // de ser cortada, porque cortar aqui esconderia justamente a distinção entre
        // "discou e ninguém atendeu" e "não discou".
        return '<th style="font-size:.66rem;' + (disqView === 'autor' ? 'white-space:nowrap' : 'white-space:normal;line-height:1.25;min-width:110px') +
          '" title="' + esc(a) + '">' + esc(abrevia(a)) + '</th>';
      }).join('') +
      '<th>Total</th></tr></thead><tbody>';
    rows.forEach(function (m) {
      h += '<tr><td style="text-align:left;max-width:230px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600">' + esc(m) + '</td>';
      cols.forEach(function (a) {
        var n = celula(m, a).length;
        var alpha = max ? (0.10 + 0.62 * (n / max)) : 0;
        h += '<td style="' + (n ? 'background:rgba(248,81,73,' + alpha.toFixed(2) + ');cursor:pointer' : 'color:var(--text2)') + '"' +
          (n ? ' onclick="AxLeadFunnel.drillDisqCel(' + JSON.stringify(m).replace(/"/g, '&quot;') + ',' + JSON.stringify(a).replace(/"/g, '&quot;') + ',' + JSON.stringify(campoCol).replace(/"/g, '&quot;') + ')"' : '') +
          '>' + (n || '·') + '</td>';
      });
      h += '<td style="font-weight:700">' + ni(motivos[m]) + '</td></tr>';
    });
    h += '</tbody></table>';
    if (disqView === 'evidencia') {
      h += '<p style="font-size:.7rem;color:var(--text2);margin:.5rem 0 0;line-height:1.6">' +
        '<strong style="color:var(--text)">Submotivo por EVIDÊNCIA, não por texto.</strong> O portal não tem campo de razão livre — nem no lead, nem no contato, e no negócio o "motivo do declínio" também é lista fechada. ' +
        'O único texto livre são as notas, e elas cobrem 8,3% das desqualificações (76 delas são template automático e 139 não têm sinal): minerar isso produziria clusters de template com nome de insight. ' +
        'Esta coluna decompõe o motivo declarado pelo que o CRM REGISTROU, e cobre 100% dos casos. ' +
        'A leitura que ela destrava: <em>"Não houve tentativa de contato"</em> com 12 discagens não atendidas e o mesmo motivo sem nenhuma discagem são problemas OPOSTOS — o primeiro é lista ruim, o segundo é cadência que não aconteceu.</p>';
    }
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
    // A DISCAGEM QUE NÃO CONECTOU aparece SEMPRE, inclusive junto com os toques que
    // deram certo: ela é o esforço, e sem ela o lead com 12 ligações não atendidas
    // continuava lendo como "nunca tocado" — o defeito que a régua de 12/08 conserta.
    var disc = l.discagens ? '<span style="color:' + COR.tentativa + '">📞 ' + l.discagens + ' discada(s)' +
      (l.ligacoes_conectadas ? ', ' + l.ligacoes_conectadas + ' atendida(s)' : ' — nenhuma atendida') +
      (l.numero_errado ? ' · ⚠ ' + l.numero_errado + ' número errado' : '') + '</span>' : '';
    if (c.length) return etapa + ' / <span style="color:' + C_BOM_T + '">✅ ' + c.join(' · ') + '</span>' + (disc ? ' / ' + disc : '');
    if (disc) return etapa + ' / ' + disc + ' <span style="color:var(--text2)">(tentativa sem contato)</span>';
    if (l.so_automacao) return etapa + ' / <span style="color:var(--text2)">🤖 só automação (' + (l.toques_automacao || 0) + ')</span>';
    // Afirmar ausência exige declarar o universo: aqui o universo INCLUI o histórico do
    // contato anterior ao lead, e dizer "nenhum toque" quando havia toque de outro ciclo
    // é o que gera desconfiança justa. O toque herdado é nomeado, e não creditado.
    if (l.toques_manuais_antes || l.toques_automacao_antes) {
      var a = [];
      if (l.toques_manuais_antes) a.push(l.toques_manuais_antes + ' manual(is)');
      if (l.toques_automacao_antes) a.push('🤖 ' + l.toques_automacao_antes);
      return etapa + ' / <span style="color:var(--text2)">↩ ' + a.join(' · ') +
        ' no contato ANTES deste lead — herdado, não conta como esforço no lead</span>';
    }
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

  // A coorte, com a trilha colada para quem também se movimentou na janela, e com o
  // filtro de gente aplicado — se o drill ignorasse o filtro, clicar num total de
  // 2.289 abriria uma lista de 2.302 e a tela se contradiria em um clique.
  function coorteFiltrada(filtro) {
    var byId = {}; movimentados().forEach(function (l) { byId[l.lead_id] = l; });
    return (D.coorte.leads || []).filter(function (l) {
      if (soBdr && l.owner_bdr === false) return false;
      // O drill herda o filtro de campo. Se não herdasse, clicar num card de "Priscilla"
      // abriria a lista do time inteiro e o total do modal não bateria com o card.
      if (filtroDim && filtroVal != null && l['dim_' + filtroDim] !== filtroVal) return false;
      return filtro(l);
    }).map(function (l) {
      var m = byId[l.lead_id];
      return m ? Object.assign({}, l, { passos: m.passos, status_atual: m.status_atual, n_movimentos: m.n_movimentos }) : l;
    });
  }
  function notaCap(agg, list) {
    if (agg == null || agg === list.length) return '';
    // O CASO ZERO PRECISA DE OUTRA FRASE. Numa janela longa, a lista por lead cobre só
    // os 1.500 mais recentes, então o drill de um período antigo abre VAZIO — e "lista
    // vazia" lê como "não há leads", que é o oposto do que a agregação diz. Aqui a tela
    // afirma o que ela sabe (o número) e por que não pode mostrar a lista.
    if (!list.length) {
      return '<br><strong style="color:var(--red)">A agregação conta ' + ni(agg) + ' leads e esta lista está vazia</strong> — ' +
        'não é ausência de lead: o detalhe por lead vem capado nos <strong>1.500 mais recentes</strong> da janela, e este recorte está fora desse corte. ' +
        'Para ver os leads, estreite o período no filtro da página; a conta acima já cobre 100% da coorte.';
    }
    return '<br><strong>' + ni(agg) + '</strong> na agregação contra <strong>' + ni(list.length) +
      '</strong> nesta lista: a lista por lead é capada em 1.500 (mais recentes) e a agregação cobre tudo.';
  }

  function drillDim(k) {
    var list = coorteFiltrada(function (l) { return dimOf(l) === k; });
    var linha = linhasDim(reguaDim).filter(function (r) { return r.valor === k; })[0];
    abre('Funil de Leads | ' + k, list, null,
      'Coorte: leads <strong>criados</strong> na janela nesta fatia. A trilha aparece para quem também se movimentou na janela.' +
      notaCap(linha && linha.criados, list));
  }

  function drillConv(k) {
    var dimAntes = reguaDim;
    reguaDim = convDim;                       // dimOf lê o corte ativo
    var list = coorteFiltrada(function (l) { return dimOf(l) === k; });
    reguaDim = dimAntes;
    var linha = linhasDim(convDim).filter(function (r) { return r.valor === k; })[0];
    abre('Conversão | ' + k, list, null,
      'Coorte desta fatia: leads <strong>criados</strong> na janela. A coluna "Trilha" mostra por onde cada um passou — é ali que a taxa de conversão vira auditável.' +
      notaCap(linha && linha.criados, list));
  }

  // Cada etapa do funil abre os leads que a ATINGIRAM (régua acumulada), não os que
  // estão nela agora. Abrir "quem está lá" num funil de coorte daria uma lista menor
  // que o número clicado, e a tela passaria a se desmentir sozinha.
  function drillEtapa(nivel) {
    var f = {
      criados: function () { return true; },
      tentativa: function (l) { return l.atingiu_tentativa_etapa; },
      conectado: function (l) { return l.atingiu_conectado_etapa; },
      qualificado: function (l) { return l.qualificado; },
      deal: function (l) { return !!l.deal_id; },
      desqualificado: function (l) { return l.desqualificado; }
    }[nivel] || function () { return true; };
    var rot = { criados: 'Criados na janela', tentativa: 'Chegaram a Tentativa+',
      conectado: 'Chegaram a Conectado+', qualificado: 'Qualificados',
      deal: 'Viraram deal', desqualificado: 'Desqualificados' }[nivel] || nivel;
    var P = passosDe(linhasFoco());
    var esperado = { criados: P.criados, tentativa: P.tentativa, conectado: P.conectado,
      qualificado: P.qualificado, deal: P.deal, desqualificado: P.descarte.n }[nivel];
    var list = coorteFiltrada(f);
    abre('Conversão | ' + rot + (filtroVal != null ? ' | ' + focoLabel() : ''), list, null,
      'Régua <strong>acumulada</strong>: são os leads da coorte que <strong>visitaram</strong> esta etapa em algum momento, não os que estão nela agora.' +
      (soBdr ? ' Só donos que são BDR.' : ' Todos os donos de lead.') +
      (filtroVal != null ? ' Recorte: <strong>' + esc(focoLabel()) + '</strong>.' : '') +
      notaCap(esperado, list));
  }

  // Semana ISO em JS, para o drill do gráfico casar com o FORMAT_DATE('%G-W%V') do
  // BigQuery. Reimplementar a régua do bucket é o tipo de duplicação que costuma
  // derivar — por isso a chave é comparada, não reconstruída por aproximação.
  function isoWeekKey(ymd) {
    var m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    var dow = d.getUTCDay() || 7;               // domingo = 7
    d.setUTCDate(d.getUTCDate() + 4 - dow);     // quinta da mesma semana define o ano ISO
    var ano = d.getUTCFullYear();
    var jan1 = new Date(Date.UTC(ano, 0, 1));
    var semana = Math.ceil(((d - jan1) / 86400000 + 1) / 7);
    return ano + '-W' + String(semana).padStart(2, '0');
  }
  function bucketDoLead(l) {
    var gran = (D.coorte.serie || {}).granularidade;
    return gran === 'semana' ? isoWeekKey(l.criado) : String(l.criado || '').slice(0, 7);
  }
  function drillBucket(bucket) {
    var B = serieBuckets().filter(function (b) { return b.bucket === bucket; })[0] || {};
    var list = coorteFiltrada(function (l) { return bucketDoLead(l) === bucket; });
    var parcial = (D.coorte.serie || {}).bucket_parcial === bucket;
    abre('Coorte de ' + rotBucket(bucket) + (filtroVal != null ? ' | ' + focoLabel() : ''), list, null,
      'Leads <strong>criados</strong> neste período, seguidos até hoje: ' + ni(B.criados) + ' criados · ' +
      ni(B.por_etapa) + ' chegaram a Tentativa+ · ' + ni(B.conectados) + ' a Conectado+ · ' +
      ni(B.qualificados) + ' qualificados · ' + ni(B.desqualificados) + ' desqualificados.' +
      (parcial ? ' <strong style="color:var(--text)">Coorte PARCIAL</strong> — ainda está viva e vai converter mais.' : '') +
      notaCap(B.criados, list));
  }

  function drillDisq(f) {
    var lista = (D.desqualificacoes || []).filter(function (d) {
      return (!f.dia || d.dia === f.dia) && (!f.motivo || d.motivo === f.motivo) &&
        (!f.autor || d.autor === f.autor) && (!f.submotivo || d.submotivo === f.submotivo);
    });
    var byId = {}; movimentados().forEach(function (l) { byId[l.lead_id] = l; });
    var list = lista.map(function (d) {
      var m = byId[d.lead_id];
      return m ? Object.assign({}, d, { passos: m.passos, status_atual: m.status_atual, criado: m.criado }) : d;
    });
    var titulo = 'Desqualificações' + (f.dia ? ' em ' + fmtBRfull(f.dia) : '') + (f.motivo ? ' | ' + f.motivo : '') +
      (f.autor ? ' | ' + f.autor : '') + (f.submotivo ? ' | ' + f.submotivo : '');
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
  // O terceiro argumento diz por QUAL campo a coluna filtra — a matriz troca de eixo
  // entre "quem fez" e "que evidência havia", e o drill precisa acompanhar.
  function drillDisqCel(motivo, valor, campo) {
    var f = { motivo: motivo };
    f[campo === 'submotivo' ? 'submotivo' : 'autor'] = valor;
    drillDisq(f);
  }

  window.AxLeadFunnel = {
    sectionHtml: function () { return '<div id="lf-host" style="display:contents">' + sectionHtml() + '</div>'; },
    render: paint,
    load: function (f) { load(f); },
    sort: doSort,
    switchFunil: switchFunil,
    switchDim: switchDim,
    switchConvDim: switchConvDim,
    switchSerie: switchSerie,
    switchGran: switchGran,
    switchQuebra: switchQuebra,
    switchReguaView: switchReguaView,
    switchDisqView: switchDisqView,
    switchWf: switchWf,
    toggleSoBdr: toggleSoBdr,
    setFiltroDim: setFiltroDim,
    setFiltroVal: setFiltroVal,
    limpaFiltro: limpaFiltro,
    drillEtapa: drillEtapa,
    drillBucket: drillBucket,
    drillConv: drillConv,
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
