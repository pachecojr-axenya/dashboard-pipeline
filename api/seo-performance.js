'use strict';
/**
 * GET /api/seo-performance?base=dod|wow|mom|qoq|yoy[&end=YYYY-MM-DD][&q=busca][&refresh=1]
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
const CAP_CONSULTAS = 2000;
const CAP_PAGINAS = 1000;

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

// ── resumo por base -----------------------------------------------------

/**
 * KPIs de TODAS as bases a partir da série diária. `cobertura` diz quantos dias
 * da janela existem de fato na série — janela incompleta (YoY antes do início do
 * histórico) é declarada, não silenciada.
 */
function resumoTodasAsBases(dias, ultimoFechado) {
  const out = {};
  seo.basesDisponiveis().forEach(b => {
    const w = seo.windowsFor(b.base, ultimoFechado);
    const a = seo.aggregate(slice(dias, w.atual));
    const p = seo.aggregate(slice(dias, w.anterior));
    const ref = seo.aggregate(slice(dias, w.mesmoDiaSemanaAnterior));
    out[b.base] = {
      base: b.base, label: b.label, desc: b.desc,
      janelas: { atual: w.atual, anterior: w.anterior },
      diasComDado: { atual: a.linhas, anterior: p.linhas },
      janelaCompleta: a.linhas === w.atual.dias && p.linhas === w.anterior.dias,
      atual: limpaAgregado(a),
      anterior: limpaAgregado(p),
      delta: limpaDelta(seo.deltaOf(a, p)),
      mesmoDiaSemanaAnterior: b.base === 'dod' ? limpaAgregado(ref) : null,
    };
  });
  return out;
}

// ── higiene -------------------------------------------------------------

function higieneDe({ frescor, coberturaConsultas, coberturaPaginas, resumo, base, oportunidades }) {
  const av = [];

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

function build({ base, dias, frescor, qAtual, qAnterior, pAtual, pAnterior, dAtual, dAnterior, cAtual, cAnterior, busca }) {
  const ultimoFechado = frescor.ultimoFechado;
  const w = seo.windowsFor(base, ultimoFechado);
  const resumo = resumoTodasAsBases(dias, ultimoFechado);

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

  const consultasFiltradas = filtra(movConsultas);
  const paginasFiltradas = filtra(movPaginas);

  const coberturaConsultas = seo.coverageOf(totalAtual, seo.aggregate(qAtual));
  const coberturaPaginas = seo.coverageOf(totalAtual, seo.aggregate(pAtual));

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
      consultas: consultasFiltradas.slice(0, CAP_CONSULTAS)
        .map(m => compact(m, x => ({ cat: x.categoria, mk: x.marca ? 1 : 0 }))),
      paginas: paginasFiltradas.slice(0, CAP_PAGINAS)
        .map(m => compact(m, x => ({ sec: x.secao, rot: x.rotulo }))),
      categorias: categorias.map(limpaRollup),
      secoes: secoes.map(limpaRollup),
      marca: marca.map(limpaRollup),
      oportunidades,
      corte: {
        consultas: { total: consultasFiltradas.length, enviadas: Math.min(consultasFiltradas.length, CAP_CONSULTAS), universo: movConsultas.length },
        paginas: { total: paginasFiltradas.length, enviadas: Math.min(paginasFiltradas.length, CAP_PAGINAS), universo: movPaginas.length },
        busca: busca || null,
      },
    },

    cortes: {
      dispositivos: seo.buildMovements(dAtual, dAnterior).map(m => compact(m)),
      paises: seo.buildMovements(cAtual, cAnterior)
        .sort((a, b) => b.atual.clicks - a.atual.clicks)
        .slice(0, 25)
        .map(m => compact(m)),
    },

    cobertura: { consultas: coberturaConsultas, paginas: coberturaPaginas },
    higiene: higieneDe({ frescor, coberturaConsultas, coberturaPaginas, resumo, base, oportunidades }),
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
  const base = seo.BASES[q.base] ? q.base : 'wow';
  const endPedido = isValidDate(q.end) ? q.end : null;
  const busca = typeof q.q === 'string' ? q.q.slice(0, 120) : '';
  const refresh = q.refresh === '1' || q.refresh === 'true';

  const cacheKey = `seo-perf:${base}:${endPedido || 'auto'}:${seo.norm(busca)}`;

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

    const w = seo.windowsFor(base, ultimoFechado);
    const inicioTimeline = seo.shiftDays(ultimoFechado, -(DIAS_TIMELINE - 1));
    // YoY olha 364 dias para trás: a série tem que cobrir a janela anterior.
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
      ...build({ base, dias, frescor: frescorEfetivo, qAtual, qAnterior, pAtual, pAnterior, dAtual, dAnterior, cAtual, cAnterior, busca }),
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
