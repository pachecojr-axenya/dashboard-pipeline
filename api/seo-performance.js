'use strict';
/**
 * GET /api/seo-performance
 *   ?base=dod|wow|mom|qoq|yoy   janela ancorada no último dia fechado
 *   &from=YYYY-MM-DD&to=...     janela LIVRE (tem precedência sobre base)
 *   &cmpFrom=...&cmpTo=...      janela de referência manual (default: a anterior
 *                               imediata, do mesmo tamanho)
 *   &end=YYYY-MM-DD             recua a âncora das janelas de base
 *   &q=busca                    filtra as entidades no conjunto COMPLETO
 *   &refresh=1                  ignora cache
 *
 * Performance de busca orgânica ao vivo do Google Search Console (propriedade
 * sc-domain:axenya.com). Entrega três coisas que o relatório nativo do GSC não
 * junta na mesma tela: linha do tempo com granularidade trocável, comparação
 * DoD/WoW/MoM/QoQ/YoY simultânea, e MOVIMENTAÇÃO por entidade (o que subiu,
 * caiu, nasceu e morreu entre as duas janelas), agrupável por categoria.
 *
 * Decisões que economizam chamada e garantem consistência:
 *
 *  - **Uma única série diária alimenta todos os KPIs.** Foi medido em 2026-08-06
 *    que somar a série por data reproduz o agregado sem dimensão da API com
 *    igualdade de float (clicks 8108, impressions 676778, position 6.400175537
 *    nos dois). Então DoD, WoW, MoM, QoQ e YoY saem todos do MESMO array e é
 *    impossível o KPI divergir do gráfico — que é o bug clássico deste tipo de
 *    painel.
 *  - **Só as movimentações por entidade dependem da base escolhida** (4 chamadas:
 *    query e page × janela atual e anterior). Trocar a base no front refaz só
 *    isso; os KPIs já estão na resposta.
 *  - **Tudo em `dataState: 'final'`.** Os 2 últimos dias com `all` vêm parciais
 *    (o dia corrente apareceu com 1 clique contra ~130) e leriam como colapso.
 *    A defasagem real é devolvida em `frescor` para a UI declarar o corte.
 *
 * Semântica de categoria, marca, seção, janelas e deltas: `lib/seo-analytics.js`.
 * Gotchas da API do Google: `lib/gsc.js`.
 */

const gsc = require('../lib/gsc');
const seo = require('../lib/seo-analytics');
const kv = require('../lib/kv');
const env = require('../lib/env');
const { setCORSHeaders, requireAuth, methodCheck } = require('./_helpers');

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // GSC fecha dado 1× ao dia
// 455 = 65 semanas EXATAS. Qualquer número que não seja múltiplo de 7 deixa um
// bucket semanal órfão de 1 a 6 dias no começo da série, e o bucket seguinte
// passa a comparar semana cheia contra semana quebrada.
const DIAS_TIMELINE = 455;

// O corte de payload atende TRÊS ordenações diferentes, e não uma só. Cortar
// apenas pelas maiores variações (como era antes) descartava silenciosamente:
//  - a linha de altíssima impressão que não mexeu nada, que é justamente a que
//    interessa na visão AGREGADA;
//  - o termo NOVO sem clique, cujo Δcliques é 0 e por isso caía para o fim da
//    lista, escondendo exatamente o que a visão de novos existe para mostrar.
// A seleção é a UNIÃO dos topos das três ordenações, com as contagens declaradas
// em `movimentos.corte` para a tela poder dizer o que ficou de fora.
const CAPS = {
  consultas: { movimento: 1200, agregado: 1200, novos: 800 },
  paginas: { movimento: 800, agregado: 800, novos: 400 },
};

// ── helpers -------------------------------------------------------------

function isValidDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
}

function hojeISO() {
  // O GSC opera em datas de calendário do Pacífico; usar a data local do Brasil
  // pode pedir um dia que ainda não existe lá. Pedir "hoje UTC" é seguro porque
  // a resposta é limitada pelo último dia fechado de qualquer forma.
  return new Date().toISOString().slice(0, 10);
}

/** Linha compacta de movimentação. Payload de QoQ tem milhares delas. */
function compact(m, extra) {
  const row = {
    k: m.chave,
    c: m.atual.clicks, c0: m.anterior.clicks,
    i: m.atual.impressions, i0: m.anterior.impressions,
    p: round2(m.atual.position), p0: round2(m.anterior.position),
    dc: m.delta.clicks, di: m.delta.impressions, dp: round2(m.delta.position),
    st: m.status,
  };
  if (extra) Object.assign(row, extra(m));
  return row;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function round4(n) {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

function limpaAgregado(a) {
  return {
    clicks: a.clicks, impressions: a.impressions,
    ctr: round4(a.ctr), position: round2(a.position),
  };
}

function limpaDelta(d) {
  return {
    clicks: d.clicks, clicksPct: d.clicksPct == null ? null : round4(d.clicksPct),
    impressions: d.impressions, impressionsPct: d.impressionsPct == null ? null : round4(d.impressionsPct),
    ctr: round4(d.ctr), position: round2(d.position), posicaoMelhorou: d.posicaoMelhorou,
  };
}

/** Fatia da série diária dentro de uma janela [from,to] inclusiva. */
function slice(dias, w) {
  return dias.filter(d => d.date >= w.from && d.date <= w.to);
}

const ORD_AGREGADO = (a, b) => (b.atual.clicks - a.atual.clicks) || (b.atual.impressions - a.atual.impressions);
const ORD_NOVOS = (a, b) => (b.atual.impressions - a.atual.impressions) || (b.atual.clicks - a.atual.clicks);

/**
 * União dos topos das três ordenações. `movs` já chega ordenado por maior
 * movimento absoluto de clique, então essa ordem é preservada e as linhas extras
 * (alta impressão parada, novos sem clique) entram depois.
 */
function selecionaLinhas(movs, cap) {
  const novosTodos = movs.filter(m => m.status === seo.STATUS.NOVO).sort(ORD_NOVOS);
  const fatias = [
    movs.slice(0, cap.movimento),
    movs.slice().sort(ORD_AGREGADO).slice(0, cap.agregado),
    novosTodos.slice(0, cap.novos),
  ];
  const vistos = new Set();
  const linhas = [];
  fatias.forEach(fatia => {
    fatia.forEach(m => {
      if (vistos.has(m.chave)) return;
      vistos.add(m.chave);
      linhas.push(m);
    });
  });
  return {
    linhas,
    novos: novosTodos,
    corte: {
      universo: movs.length,
      enviadas: linhas.length,
      porMovimento: Math.min(movs.length, cap.movimento),
      porAgregado: Math.min(movs.length, cap.agregado),
      novosEnviados: Math.min(novosTodos.length, cap.novos),
      novosTotal: novosTodos.length,
    },
  };
}

// ── resumo por base -----------------------------------------------------

/**
 * KPIs de TODAS as bases a partir da série diária. `cobertura` diz quantos dias
 * da janela existem de fato na série — janela incompleta (YoY antes do início do
 * histórico) é declarada, não silenciada.
 */
function resumoDe(w, dias, extra) {
  const a = seo.aggregate(slice(dias, w.atual));
  const p = seo.aggregate(slice(dias, w.anterior));
  return {
    base: w.base, label: w.label, desc: w.desc,
    janelas: { atual: w.atual, anterior: w.anterior },
    diasComDado: { atual: a.linhas, anterior: p.linhas },
    janelaCompleta: a.linhas === w.atual.dias && p.linhas === w.anterior.dias,
    atual: limpaAgregado(a),
    anterior: limpaAgregado(p),
    delta: limpaDelta(seo.deltaOf(a, p)),
    mesmoDiaSemanaAnterior: null,
    ...(extra || {}),
  };
}

function resumoTodasAsBases(dias, ultimoFechado, wCustom) {
  const out = {};
  seo.basesDisponiveis().forEach(b => {
    const w = seo.windowsFor(b.base, ultimoFechado);
    out[b.base] = resumoDe({ ...w, base: b.base, label: b.label, desc: b.desc }, dias, {
      mesmoDiaSemanaAnterior: b.base === 'dod'
        ? limpaAgregado(seo.aggregate(slice(dias, w.mesmoDiaSemanaAnterior)))
        : null,
    });
  });
  // A janela livre entra no MESMO resumo para o strip de comparação e os KPIs
  // lerem tudo do mesmo lugar, sem caminho alternativo de cálculo.
  if (wCustom) {
    out.custom = resumoDe(wCustom, dias, {
      multiploDe7: wCustom.multiploDe7,
      mesmoTamanho: wCustom.mesmoTamanho,
      referenciaManual: wCustom.referenciaManual,
    });
  }
  return out;
}

// ── higiene -------------------------------------------------------------

function higieneDe({ frescor, coberturaConsultas, coberturaPaginas, resumo, base, oportunidades, janelas, corteConsultas }) {
  const av = [];

  // Janela livre: o dono escolheu as datas na mão, então os dois vieses possíveis
  // (composição de dia da semana e tamanho diferente) precisam ser ditos.
  if (base === 'custom') {
    if (!janelas.multiploDe7) {
      av.push({
        nivel: 'medio', titulo: 'Intervalo escolhido não é múltiplo de 7 dias',
        detalhe: `A janela tem ${janelas.atual.dias} dias, então as duas pontas não têm a mesma quantidade de sábados e domingos. Nesta propriedade fim de semana rende cerca de 1/4 de um dia útil, então parte da variação é calendário. Os números ABSOLUTOS da visão agregada não são afetados; a coluna de variação é.`,
      });
    }
    if (!janelas.mesmoTamanho) {
      av.push({
        nivel: 'alto', titulo: 'Janelas de tamanhos diferentes',
        detalhe: `A janela atual tem ${janelas.atual.dias} dias e a de referência ${janelas.anterior.dias}. A variação de cliques e impressões está comparando períodos de duração diferente e não deve ser lida como performance.`,
      });
    }
  }

  // "Novo" é sempre relativo à janela de referência: com 1 dia de referência,
  // quase tudo aparece como novo e a visão perde sentido.
  if (corteConsultas && corteConsultas.novosTotal > 0 && janelas.anterior.dias < 7) {
    av.push({
      nivel: 'medio', titulo: `"Novo" com janela de referência de ${janelas.anterior.dias} dia(s)`,
      detalhe: `São ${corteConsultas.novosTotal} consultas sem impressão na referência. Com uma referência tão curta isso não significa termo novo no site: uma consulta que simplesmente não apareceu naquele único dia já conta como nova. Para ler novos de verdade, use MoM, QoQ ou uma janela livre de pelo menos 28 dias.`,
    });
  }

  if (frescor.defasagemDias != null && frescor.defasagemDias > 3) {
    av.push({
      nivel: 'alto', titulo: 'Dado do Search Console atrasado',
      detalhe: `O último dia fechado é ${frescor.ultimoFechado}, ${frescor.defasagemDias} dias atrás. O normal nesta propriedade é 2. Todas as janelas terminam nessa data.`,
    });
  }

  if (coberturaConsultas.pctClicks != null && coberturaConsultas.pctClicks < 0.4) {
    av.push({
      nivel: 'medio', titulo: 'A tabela de consultas não é o site inteiro',
      detalhe: `As consultas nomeadas explicam ${(coberturaConsultas.pctClicks * 100).toFixed(1)}% dos cliques e ${(coberturaConsultas.pctImpressions * 100).toFixed(1)}% das impressões da janela. O Google anonimiza cauda longa, então somar a coluna de cliques NUNCA vai dar o total do site.`,
    });
  }

  if (coberturaPaginas.pctImpressions != null && coberturaPaginas.pctImpressions > 1.1) {
    av.push({
      nivel: 'baixo', titulo: 'Impressão por página conta duas vezes',
      detalhe: `A soma por página dá ${(coberturaPaginas.pctImpressions * 100).toFixed(0)}% das impressões do site porque duas URLs na mesma página de resultado contam impressão cada uma. Compare página com página, nunca com o total do site.`,
    });
  }

  const r = resumo[base];
  if (r && !r.janelaCompleta) {
    av.push({
      nivel: 'medio', titulo: `Janela de ${r.label} incompleta`,
      detalhe: `A janela pede ${r.janelas.atual.dias} dias em cada ponta e o histórico disponível entregou ${r.diasComDado.atual} (atual) e ${r.diasComDado.anterior} (anterior). O Search Console guarda ~16 meses.`,
    });
  }

  if (oportunidades.length) {
    av.push({
      nivel: 'baixo', titulo: `${oportunidades.length} consultas com impressão alta e zero clique`,
      detalhe: `Aparecem na busca mas ninguém clica, todas com posição pior que 5. A maior é "${oportunidades[0].k}" com ${oportunidades[0].i} impressões na posição ${oportunidades[0].p}. É título/meta ou intenção errada, não é falta de indexação.`,
    });
  }

  return av;
}

// ── construção da resposta ----------------------------------------------

function build({ base, w, dias, frescor, qAtual, qAnterior, pAtual, pAnterior, dAtual, dAnterior, cAtual, cAnterior, busca }) {
  const ultimoFechado = frescor.ultimoFechado;
  const resumo = resumoTodasAsBases(dias, ultimoFechado, base === 'custom' ? w : null);

  const totalAtual = seo.aggregate(slice(dias, w.atual));

  // Movimentações completas (sem corte) — os rollups precisam do universo todo.
  const movConsultas = seo.buildMovements(qAtual, qAnterior, {
    enrich: k => ({ categoria: seo.categoryOf(k), marca: seo.isBrand(k) }),
  });
  const movPaginas = seo.buildMovements(pAtual, pAnterior, {
    enrich: k => ({ secao: seo.sectionOf(k), rotulo: seo.pageLabel(k) }),
  });

  const categorias = seo.rollupMovements(movConsultas, m => m.categoria);
  const marca = seo.rollupMovements(movConsultas, m => (m.marca ? 'Marca' : 'Não-marca'));
  const secoes = seo.rollupMovements(movPaginas, m => m.secao);

  // Oportunidade: impressão relevante, zero clique, fora do top 5.
  const oportunidades = movConsultas
    .filter(m => m.atual.clicks === 0 && m.atual.impressions >= 100 && m.atual.position > 5)
    .sort((a, b) => b.atual.impressions - a.atual.impressions)
    .slice(0, 50)
    .map(m => compact(m, x => ({ cat: x.categoria, mk: x.marca ? 1 : 0 })));

  // Busca server-side: permite achar termo que ficou fora do corte de payload.
  const alvo = seo.norm(busca || '');
  const filtra = arr => (alvo ? arr.filter(m => seo.norm(m.chave).indexOf(alvo) >= 0) : arr);

  const selConsultas = selecionaLinhas(filtra(movConsultas), CAPS.consultas);
  const selPaginas = selecionaLinhas(filtra(movPaginas), CAPS.paginas);

  const agQAtual = seo.aggregate(qAtual);
  const agPAtual = seo.aggregate(pAtual);
  const coberturaConsultas = seo.coverageOf(totalAtual, agQAtual);
  const coberturaPaginas = seo.coverageOf(totalAtual, agPAtual);

  const enrichConsulta = x => ({ cat: x.categoria, mk: x.marca ? 1 : 0 });
  const enrichPagina = x => ({ sec: x.secao, rot: x.rotulo });

  return {
    site: gsc.siteUrl(),
    serviceAccount: gsc.serviceAccountEmail(),
    frescor,
    base,
    janelas: w,
    basesDisponiveis: seo.basesDisponiveis(),
    resumo,

    timeline: {
      dia: seo.serieComDelta(seo.rollupDaily(dias, 'dia')).map(b => ({
        key: b.key, clicks: b.clicks, impressions: b.impressions,
        ctr: round4(b.ctr), position: round2(b.position),
        dow: seo.dowOf(b.key), fds: seo.isWeekend(b.key) ? 1 : 0,
        dc: b.deltaClicks, dpct: b.deltaPct == null ? null : round4(b.deltaPct),
      })),
      semana: seo.serieComDelta(seo.rollupDaily(dias, 'semana')).map(limpaBucket),
      mes: seo.serieComDelta(seo.rollupDaily(dias, 'mes')).map(limpaBucket),
      trimestre: seo.serieComDelta(seo.rollupDaily(dias, 'trimestre')).map(limpaBucket),
    },

    movimentos: {
      consultas: selConsultas.linhas.map(m => compact(m, enrichConsulta)),
      paginas: selPaginas.linhas.map(m => compact(m, enrichPagina)),
      // Novos vêm em array próprio, ordenado por impressão, porque o Δcliques de
      // um termo novo sem clique é 0 e ele afundaria na ordem de movimentação.
      novos: selConsultas.novos.slice(0, CAPS.consultas.novos).map(m => compact(m, enrichConsulta)),
      novasPaginas: selPaginas.novos.slice(0, CAPS.paginas.novos).map(m => compact(m, enrichPagina)),
      categorias: categorias.map(limpaRollup),
      secoes: secoes.map(limpaRollup),
      marca: marca.map(limpaRollup),
      oportunidades,
      corte: {
        consultas: selConsultas.corte,
        paginas: selPaginas.corte,
        busca: busca || null,
      },
    },

    // Total da DIMENSÃO na janela atual, para a visão agregada calcular o "% do
    // total" sobre o universo inteiro e não sobre as linhas que couberam no
    // payload — senão a coluna de participação mentiria quando há corte.
    totaisDimensao: {
      consultas: limpaAgregado(agQAtual),
      paginas: limpaAgregado(agPAtual),
      site: limpaAgregado(totalAtual),
    },

    cortes: {
      dispositivos: seo.buildMovements(dAtual, dAnterior).map(m => compact(m)),
      paises: seo.buildMovements(cAtual, cAnterior)
        .sort((a, b) => b.atual.clicks - a.atual.clicks)
        .slice(0, 25)
        .map(m => compact(m)),
    },

    cobertura: { consultas: coberturaConsultas, paginas: coberturaPaginas },
    higiene: higieneDe({
      frescor, coberturaConsultas, coberturaPaginas, resumo, base, oportunidades,
      janelas: w, corteConsultas: selConsultas.corte,
    }),
  };
}

/**
 * Bucket parcial NÃO carrega delta. O mês corrente com 4 de 31 dias comparado ao
 * mês fechado anterior devolvia -88,5% de clique, que é só calendário e leria
 * como colapso de tráfego. A UI mostra o volume do bucket parcial e marca como
 * parcial; a variação fica em branco de propósito.
 */
function limpaBucket(b, i, arr) {
  const prev = i > 0 ? arr[i - 1] : null;
  const comparavel = !b.parcial && !!prev && !prev.parcial;
  return {
    key: b.key, label: b.label, from: b.from, to: b.to, dias: b.dias, parcial: !!b.parcial,
    clicks: b.clicks, impressions: b.impressions, ctr: round4(b.ctr), position: round2(b.position),
    dc: comparavel ? b.deltaClicks : null,
    dpct: comparavel && b.deltaPct != null ? round4(b.deltaPct) : null,
    dp: comparavel && b.deltaPosition != null ? round2(b.deltaPosition) : null,
  };
}

function limpaRollup(r) {
  return {
    k: r.chave, itens: r.itens,
    atual: limpaAgregado(r.atual), anterior: limpaAgregado(r.anterior),
    delta: limpaDelta(r.delta), st: r.status,
  };
}

// ── handler -------------------------------------------------------------

let _mem = { key: null, at: 0, data: null };

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET'])) return;
  if (!requireAuth(req, res)) return;

  if (!gsc.isConfigured()) {
    return res.status(503).json({
      success: false,
      error: 'GSC_SERVICE_ACCOUNT_JSON não configurado — a service account precisa estar no ambiente e ter acesso à propriedade no Search Console.',
    });
  }

  const q = req.query || {};
  // Janela LIVRE tem precedência sobre a base ancorada: se o dono digitou de/até,
  // é isso que ele quer ver, não a semana corrente.
  const temRangeLivre = isValidDate(q.from) && isValidDate(q.to);
  const base = temRangeLivre ? 'custom' : (seo.BASES[q.base] ? q.base : 'wow');
  const endPedido = isValidDate(q.end) ? q.end : null;
  const busca = typeof q.q === 'string' ? q.q.slice(0, 120) : '';
  const refresh = q.refresh === '1' || q.refresh === 'true';

  const cacheKey = temRangeLivre
    ? `seo-perf:custom:${q.from}:${q.to}:${q.cmpFrom || ''}:${q.cmpTo || ''}:${seo.norm(busca)}`
    : `seo-perf:${base}:${endPedido || 'auto'}:${seo.norm(busca)}`;

  if (!refresh && _mem.key === cacheKey && Date.now() - _mem.at < CACHE_TTL_MS) {
    return res.status(200).json({ ..._mem.data, cached: 'memory' });
  }
  if (!refresh && kv.isConfigured()) {
    try {
      const c = await kv.getJSON(env.kvKey(cacheKey));
      if (c && c.at && Date.now() - new Date(c.at).getTime() < CACHE_TTL_MS) {
        return res.status(200).json({ ...c.data, cached: 'kv' });
      }
    } catch { /* cache é conveniência */ }
  }

  try {
    const frescor = await gsc.freshness(hojeISO());
    if (!frescor.ultimoFechado) {
      return res.status(200).json({
        success: true, generatedAt: new Date().toISOString(),
        site: gsc.siteUrl(), serviceAccount: gsc.serviceAccountEmail(),
        vazio: true,
        error: 'O Search Console não devolveu nenhum dia fechado nos últimos 14 dias para esta propriedade.',
      });
    }
    // `end` manual nunca pode passar do último dia fechado: mostraria janela vazia.
    const ultimoFechado = endPedido && endPedido < frescor.ultimoFechado ? endPedido : frescor.ultimoFechado;
    const frescorEfetivo = { ...frescor, ultimoFechado, ancoraManual: !!(endPedido && endPedido < frescor.ultimoFechado) };

    let w;
    if (temRangeLivre) {
      // Data futura ou dentro da faixa parcial devolveria janela vazia sem
      // explicação; o corte no último dia fechado é declarado em `janelas`.
      const to = q.to > frescor.ultimoFechado ? frescor.ultimoFechado : q.to;
      const from = q.from > to ? to : q.from;
      w = seo.customWindows(from, to, isValidDate(q.cmpFrom) ? q.cmpFrom : null, isValidDate(q.cmpTo) ? q.cmpTo : null);
      w.limitadoAoFechado = q.to > frescor.ultimoFechado;
      w.pedido = { from: q.from, to: q.to };
    } else {
      const wb = seo.windowsFor(base, ultimoFechado);
      w = { ...wb, label: seo.BASES[base].label, desc: seo.BASES[base].desc };
    }

    const inicioTimeline = seo.shiftDays(ultimoFechado, -(DIAS_TIMELINE - 1));
    // YoY olha 364 dias para trás e a janela livre pode ir mais longe ainda: a
    // série diária tem que cobrir a janela de referência, senão o KPI da
    // comparação vem zerado sem motivo aparente.
    const inicio = w.anterior.from < inicioTimeline ? w.anterior.from : inicioTimeline;

    const [dias, qAtual, qAnterior, pAtual, pAnterior, dAtual, dAnterior, cAtual, cAnterior] = await Promise.all([
      gsc.daily({ startDate: inicio, endDate: ultimoFechado, dataState: 'final' }),
      gsc.byDimension({ startDate: w.atual.from, endDate: w.atual.to, dimension: 'query', dataState: 'final' }),
      gsc.byDimension({ startDate: w.anterior.from, endDate: w.anterior.to, dimension: 'query', dataState: 'final' }),
      gsc.byDimension({ startDate: w.atual.from, endDate: w.atual.to, dimension: 'page', dataState: 'final' }),
      gsc.byDimension({ startDate: w.anterior.from, endDate: w.anterior.to, dimension: 'page', dataState: 'final' }),
      gsc.byDimension({ startDate: w.atual.from, endDate: w.atual.to, dimension: 'device', dataState: 'final', rowLimit: 10 }),
      gsc.byDimension({ startDate: w.anterior.from, endDate: w.anterior.to, dimension: 'device', dataState: 'final', rowLimit: 10 }),
      gsc.byDimension({ startDate: w.atual.from, endDate: w.atual.to, dimension: 'country', dataState: 'final', rowLimit: 300 }),
      gsc.byDimension({ startDate: w.anterior.from, endDate: w.anterior.to, dimension: 'country', dataState: 'final', rowLimit: 300 }),
    ]);

    const data = {
      success: true,
      generatedAt: new Date().toISOString(),
      ...build({ base, w, dias, frescor: frescorEfetivo, qAtual, qAnterior, pAtual, pAnterior, dAtual, dAnterior, cAtual, cAnterior, busca }),
    };

    _mem = { key: cacheKey, at: Date.now(), data };
    if (kv.isConfigured()) {
      try { await kv.setJSON(env.kvKey(cacheKey), { at: new Date().toISOString(), data }); }
      catch { /* segue sem cache compartilhado */ }
    }
    return res.status(200).json(data);
  } catch (e) {
    if (_mem.key === cacheKey && _mem.data) {
      return res.status(200).json({ ..._mem.data, cached: 'memory', stale: true, staleError: e.message });
    }
    return res.status(500).json({ success: false, error: e.message });
  }
};

// Exposto só para scripts/test-seo-performance.js fixar a regra do corte de
// payload sem chamar a API do Google. Vercel usa o handler (o export default),
// então pendurar a função aqui não muda o runtime.
module.exports.selecionaLinhas = selecionaLinhas;
module.exports.CAPS = CAPS;
