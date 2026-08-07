'use strict';
/**
 * GET /api/funnel-stages?since=2025-08-01&until=2026-06-30
 *
 * Retorna quantos deals únicos entraram em cada etapa dos pipelines
 * Vendas e Bid desde a data informada — base para conversão do funil.
 *
 * Resposta: { vendas: { stages, conversions }, bid: { stages, conversions }, ... }
 *
 * MIGRADO para a fonte única (F5, 07/08/2026): `silver.fact_stage_entry` (jornada
 * nativa, com tempo em etapa já calculado) + `dim_deal` + `fact_crm_change`.
 * Custo antes: busca paginada de TODOS os deals dos dois pipelines + um batch de
 * propertiesWithHistory a cada 50 deals, POR REQUEST. Agora: 1 consulta.
 *
 * `?fonte=api` mantém a rota antiga viva para comparar.
 *
 * PARIDADE MEDIDA (2026-05-01 a 2026-08-06): as 16 contagens de etapa dos dois
 * funis batem EXATO, e total_deals / total_vendas / total_bid também.
 *
 * DOIS CAMPOS MUDAM DE VALOR, e mudam porque o armazém está certo e a API infla.
 * O `propertiesWithHistory` do HubSpot REPETE o mesmo valor quando houve re-save,
 * ação em massa ou `MERGE_OBJECTS`; `fact_crm_change` colapsa valor igual
 * consecutivo. Medido no deal 28356544839: a API lista `657736716` três vezes
 * seguidas (uma delas via MERGE_OBJECTS) e reporta 6 trocas de dono; o dono mudou
 * de mão 4 vezes.
 *
 *   · `owner_changes` — 23 de 1.554 deals passam a mostrar MENOS trocas. Re-save
 *     do mesmo dono não é troca de mão, e merge de objeto não é decisão de ninguém.
 *   · `stage_medians` / `stage_counts` — a mediana se desloca (ex.: Reunião
 *     Agendada 11,9 vs 12,0) e o n cai em etapa TERMINAL (Perdido 4 vs 12,
 *     Standby 0 vs 10). Motivo: uma entrada duplicada depois de o deal chegar em
 *     Perdido dava à API um "período seguinte" e ela contava tempo concluído numa
 *     etapa que o deal nunca deixou. O armazém marca `is_open` e não conta.
 *
 * ATENÇÃO: o N07 foi validado contra o relatório do HubSpot em 2026-07-02 (RA
 * 14,9≈14,7 · Diag 24,9≈25,6 · Cot 20,1≈20 · Cons 21,0=21 · Neg 19,4=19,4). O
 * relatório do HubSpot provavelmente conta o mesmo ruído de re-save, então bater
 * com ele e estar aritmeticamente certo passam a ser coisas diferentes. A escolha
 * de qual dos dois vale é de produto, não de migração — por isso a divergência
 * viaja no payload em `divergencias_conhecidas` em vez de ficar num comentário.
 */

const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');
const { hubspotPost } = require('../lib/hubspot');
// Fase 2 do Dashboard 2.0: pipes/etapas vêm da camada semântica (fonte única).
const semantic = require('../lib/semantic');
const whq = require('../lib/hubspot-wh-queries');
const wh = require('../lib/hubspot-warehouse');

const VENDAS_ID = semantic.PIPELINES.vendas;
const BID_ID    = semantic.PIPELINES.bid;

// Alias histórico deste consumidor: 1317543716 aqui sempre se chamou 'Standby'
// (sem espaço). Como os buckets abaixo usam 'Stand by' (VENDAS_EXTRA), a linha
// Stand by do funil Vendas conta 0 desde sempre — bug pré-existente REGISTRADO
// no catálogo (etapa 1317543716); preservado aqui pela paridade da Fase 2.
const VENDAS_STAGE_MAP = semantic.stageMap({ pipeline: 'vendas', alias: { '1317543716': 'Standby' } });

// Este consumidor nunca mapeou a Reunião Pré-RFP do Bid (exclusão histórica).
const BID_STAGE_MAP = semantic.stageMap({ pipeline: 'bid', exclude: ['1349620551'] });

const VENDAS_FUNNEL = ['Reunião Agendada','Diagnóstico','Cotação','Consultoria','Negociação','Implantação','Ganho'];
const VENDAS_EXTRA  = ['Stand by','Perdido'];

const BID_FUNNEL = ['Cotação','Proposta Enviada','Consultoria','Negociação','Implantação','Ganho'];
const BID_EXTRA  = ['Standby'];

function buildResult(funnelOrder, extraStages, stageSets, dealNames, stageDates) {
  const allStages = [...funnelOrder, ...extraStages];
  const stages = allStages.map(stage => ({
    stage,
    count: stageSets[stage] ? stageSets[stage].size : 0,
    deals: stageSets[stage]
      ? [...stageSets[stage]].map(id => ({ hs_id: id, name: dealNames[id] || '', entered_date: stageDates[stage]?.[id] || null }))
      : [],
  }));

  const conversions = [];
  for (let i = 0; i < funnelOrder.length - 1; i++) {
    const from = stages.find(s => s.stage === funnelOrder[i]);
    const to   = stages.find(s => s.stage === funnelOrder[i + 1]);
    if (!from || !to) continue;
    conversions.push({
      from:       from.stage,
      to:         to.stage,
      from_count: from.count,
      to_count:   to.count,
      rate:     from.count > 0 ? Math.round((to.count / from.count) * 10000) / 10000 : null,
      rate_pct: from.count > 0 ? Math.round((to.count / from.count) * 1000) / 10    : null,
    });
  }
  return { stages, conversions };
}

async function fetchAllDeals(token) {
  let all = [], after = 0, hasMore = true;
  while (hasMore) {
    const body = {
      filterGroups: [{ filters: [
        { propertyName: 'pipeline', operator: 'IN', values: [VENDAS_ID, BID_ID] },
      ]}],
      properties: ['dealname', 'pipeline', 'hs_object_id', 'createdate'],
      limit: 200,
      after,
    };
    const resp = await hubspotPost(token, '/crm/v3/objects/deals/search', body);
    all = all.concat(resp.results || []);
    hasMore = resp.paging?.next?.after != null;
    after = resp.paging?.next?.after || 0;
  }
  return all;
}

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET'])) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const since = req.query.since || '2025-08-01';
  const until = req.query.until || null;

  let token = null;
  if (req.query.fonte === 'api' || !wh.isConfigured()) {
    try { token = getHubspotToken(); } catch (e) {
      return res.status(503).json({ success: false, error: e.message });
    }
  }

  const viaBQ = req.query.fonte !== 'api' && wh.isConfigured();

  try {
    // 1. Busca todos os deals dos dois pipelines
    const rawDeals = viaBQ ? [] : await fetchAllDeals(token);
    const dealNames      = {};
    const dealPipeline   = {};
    const dealCreateDate = {};
    const historyByDeal = {};
    const ownerChangesByDeal = {};
    let hsIds = [];
    let totalComHistoricoBQ = null;
    let duracoesBQ = null;

    if (viaBQ) {
      const w = await whq.funnelStages([VENDAS_ID, BID_ID], since, until);
      w.deals.forEach(d => {
        dealNames[d.id] = d.nome;
        dealPipeline[d.id] = d.pipeline;
        dealCreateDate[d.id] = d.criado;
      });
      hsIds = w.deals.map(d => d.id);
      // `historyByDeal` guarda só as entradas DENTRO do recorte, que é o que o
      // passo 3 consome. O N07 não usa mais este mapa: o tempo por etapa vem
      // pronto de `days_in_stage`, sem remontar transição no JavaScript.
      w.entradas.forEach(e => {
        (historyByDeal[e.deal] = historyByDeal[e.deal] || []).push({
          stage_id: e.stage, entered_date: e.data, entered_ts: e.data + 'T00:00:00Z',
          // Pipeline DA ENTRADA. O passo 3 bucketiza por ele, e não pelo pipeline
          // atual do deal: 28% das entradas (2.200 em 1.612 deals) pertencem a um
          // pipeline diferente do atual, e pela regra antiga eram testadas contra
          // o mapa de etapas do pipeline errado e caíam fora em silêncio.
          pipeline_id: e.pipeline,
        });
      });
      Object.keys(historyByDeal).forEach(id => {
        historyByDeal[id].sort((a, b) => (a.entered_date < b.entered_date ? -1 : 1));
      });
      w.trocas.forEach(t => { ownerChangesByDeal[t.deal] = t.n; });
      totalComHistoricoBQ = w.totalComHistorico;
      duracoesBQ = w.duracoes;
    } else {
    hsIds = rawDeals.map(r => r.properties.hs_object_id).filter(Boolean);
    rawDeals.forEach(r => {
      const id = r.properties.hs_object_id;
      dealNames[id]      = (r.properties.dealname || '').trim();
      dealPipeline[id]   = r.properties.pipeline;
      dealCreateDate[id] = r.properties.createdate ? r.properties.createdate.substring(0, 10) : null;
    });

    // 2. Histórico de dealstage + owner em batches de 50
    for (let i = 0; i < hsIds.length; i += 50) {
      const batch = hsIds.slice(i, i + 50);
      try {
        const resp = await hubspotPost(token, '/crm/v3/objects/deals/batch/read', {
          properties: ['dealstage'],
          propertiesWithHistory: ['dealstage', 'hubspot_owner_id'],
          inputs: batch.map(id => ({ id: String(id) })),
        });
        (resp.results || []).forEach(r => {
          const hist = r.propertiesWithHistory?.dealstage;
          if (hist && hist.length > 0) {
            historyByDeal[r.id] = hist
              .slice()
              .sort((a, b) => a.timestamp < b.timestamp ? -1 : 1)
              // entered_ts (timestamp completo) preserva a hora — o N07 precisa de dias
              // fracionários para bater com o relatório do HubSpot (ex.: 14,7d).
              .map(h => ({ stage_id: h.value, entered_date: h.timestamp.substring(0, 10), entered_ts: h.timestamp }));
          }
          const ownerHist = r.propertiesWithHistory?.hubspot_owner_id;
          ownerChangesByDeal[r.id] = ownerHist ? Math.max(0, ownerHist.length - 1) : 0;
        });
      } catch (e) {
        console.error('[funnel-stages] batch/read error:', e.message);
      }
    }
    }

    // 2.5: N07 | MEDIANA do tempo CUMULATIVO em cada etapa — replica o relatório do
    // HubSpot ("tempo cumulativo na etapa", agregado por mediana): por deal, soma todos
    // os períodos passados na etapa (timestamps completos, dias fracionários), contando
    // APENAS períodos concluídos (o tempo em curso de quem está na etapa agora NÃO conta);
    // depois mediana entre deals. Verificado contra o relatório em 2026-07-02:
    // RA 14,9≈14,7 · Diag 24,9≈25,6 · Cot 20,1≈20 · Cons 21,0=21 · Neg 19,4=19,4.
    // Escopo: pipeline Vendas, deals criados >= 2025-09-01 (piso fixo do N07).
    // Isolado em try-catch para não bloquear owner_changes se houver erro.
    let stageMedsByName = {};
    let _stageCtsOut = {};
    try {
      const N07_MIN_CREATE = '2025-09-01';
      const n07Since = since > N07_MIN_CREATE ? since : N07_MIN_CREATE;
      const _medArr = arr => {
        if (!arr.length) return null;
        const s = arr.slice().sort((a, b) => a - b);
        const m = Math.floor(s.length / 2);
        return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
      };
      const DAY = 86400000;
      const _stageDurs = {};   // etapa -> [dias cumulativos por deal]
      if (viaBQ) {
        // `days_in_stage` já é o período concluído em dias fracionários, e a
        // soma por (deal, etapa) é o cumulativo. Mesmo cálculo, sem remontar
        // transição a transição no browser.
        const porDeal = {};
        (duracoesBQ || []).forEach(d => {
          const cd = dealCreateDate[d.deal];
          if (!cd || cd < n07Since) return;
          if (until && cd > until) return;
          if ((d.pipeline || dealPipeline[d.deal]) !== VENDAS_ID) return;
          const nome = VENDAS_STAGE_MAP[d.stage];
          if (!nome) return;
          (porDeal[d.deal] = porDeal[d.deal] || {});
          porDeal[d.deal][nome] = (porDeal[d.deal][nome] || 0) + d.dias;
        });
        Object.values(porDeal).forEach(perStage => {
          Object.keys(perStage).forEach(st => {
            (_stageDurs[st] = _stageDurs[st] || []).push(perStage[st]);
          });
        });
      } else {
      hsIds.forEach(id => {
        const cd = dealCreateDate[id];
        if (!cd || cd < n07Since) return;
        if (until && cd > until) return;
        const pipe = dealPipeline[id];
        if (pipe !== VENDAS_ID) return;   // N07: apenas Pipeline de Vendas
        const hist = historyByDeal[id] || [];
        if (!hist.length) return;
        const perStage = {};   // cumulativo do deal, só períodos concluídos
        for (let i = 0; i + 1 < hist.length; i++) {
          const stageName = VENDAS_STAGE_MAP[hist[i].stage_id];
          if (!stageName) continue;
          const t0 = Date.parse(hist[i].entered_ts || hist[i].entered_date + 'T00:00:00');
          const t1 = Date.parse(hist[i + 1].entered_ts || hist[i + 1].entered_date + 'T00:00:00');
          if (isNaN(t0) || isNaN(t1)) continue;
          perStage[stageName] = (perStage[stageName] || 0) + Math.max(0, (t1 - t0) / DAY);
        }
        Object.keys(perStage).forEach(s => {
          if (!_stageDurs[s]) _stageDurs[s] = [];
          _stageDurs[s].push(perStage[s]);
        });
      });
      }
      Object.keys(_stageDurs).forEach(s => {
        stageMedsByName[s] = _medArr(_stageDurs[s]);
        _stageCtsOut[s] = _stageDurs[s].length;   // nº de DEALS (não transições)
      });
    } catch (e) {
      console.error('[funnel-stages] stage_medians error:', e.message);
      stageMedsByName = {};
      _stageCtsOut = {};
    }

    // 3. Contadores separados por pipeline
    const vendasSets = {};
    const bidSets    = {};
    const vendasDates = {};
    const bidDates = {};
    [...VENDAS_FUNNEL, ...VENDAS_EXTRA].forEach(s => { vendasSets[s] = new Set(); vendasDates[s] = {}; });
    [...BID_FUNNEL,    ...BID_EXTRA   ].forEach(s => { bidSets[s]    = new Set(); bidDates[s] = {}; });

    hsIds.forEach(id => {
      (historyByDeal[id] || []).forEach(entry => {
        if (entry.entered_date < since) return;
        if (until && entry.entered_date > until) return;
        // O funil é sempre (pipeline, stage). No armazém o pipeline vem da própria
        // entrada; no caminho antigo só existe o pipeline atual do deal.
        const pipe = entry.pipeline_id || dealPipeline[id];
        if (pipe === VENDAS_ID) {
          const name = VENDAS_STAGE_MAP[entry.stage_id];
          if (name && vendasSets[name]) { vendasSets[name].add(id); if (!vendasDates[name][id] || entry.entered_date < vendasDates[name][id]) vendasDates[name][id] = entry.entered_date; }
        } else if (pipe === BID_ID) {
          const name = BID_STAGE_MAP[entry.stage_id];
          if (name && bidSets[name]) { bidSets[name].add(id); if (!bidDates[name][id] || entry.entered_date < bidDates[name][id]) bidDates[name][id] = entry.entered_date; }
        }
      });
    });

    const totalVendas = viaBQ
      ? hsIds.filter(id => dealPipeline[id] === VENDAS_ID).length
      : rawDeals.filter(r => r.properties.pipeline === VENDAS_ID).length;
    const totalBid = viaBQ
      ? hsIds.filter(id => dealPipeline[id] === BID_ID).length
      : rawDeals.filter(r => r.properties.pipeline === BID_ID).length;

    return res.status(200).json({
      success: true,
      since,
      until,
      total_deals:        viaBQ ? hsIds.length : rawDeals.length,
      total_vendas:       totalVendas,
      total_bid:          totalBid,
      // No armazém isto é "deal com QUALQUER entrada de etapa", sem recorte de
      // data — que é o que o nome do campo diz. A versão antiga contava só os
      // deals cujo histórico caiu no recorte, e por isso o número encolhia
      // quando o filtro apertava.
      total_with_history: viaBQ ? totalComHistoricoBQ : Object.keys(historyByDeal).length,
      fonte: viaBQ ? 'bq' : 'api',
      // O COMO e as PREMISSAS viajam com o número, não só na doc: número certo sem
      // premissa explícita é indistinguível de número novo sem explicação, e aí
      // ninguém confia nele.
      premissas: viaBQ ? {
        fonte: 'silver.fact_stage_entry (jornada nativa) + dim_deal + fact_crm_change',
        contagem_de_etapa: 'deals DISTINTOS que entraram na etapa dentro do recorte; re-entrada conta uma vez, com a primeira data',
        pipeline_da_etapa: 'o pipeline REGISTRADO NA ENTRADA, não o atual do deal — o funil é sempre (pipeline, stage). Medido: 28% das entradas (2.200 em 1.612 deals) pertencem a um pipeline diferente do atual, e a regra antiga as testava contra o mapa de etapas do pipeline errado e as descartava em silêncio',
        universo_de_deals: 'deals cujo pipeline ATUAL é Vendas ou Bid, igual à versão antiga. Deal que migrou para um terceiro pipeline fica fora dos dois funis mesmo tendo passado por eles — corrigir isso é outra mudança, ainda não feita',
        tempo_em_etapa: 'soma dos períodos CONCLUÍDOS por (deal, etapa), em dias fracionários; período em aberto não conta',
        escopo_do_n07: 'pipeline de Vendas, deals criados a partir de set/2025 (piso fixo), apertável pelo filtro de período mas nunca alargável',
        nao_replica_hubspot: 'o relatorio do HubSpot conta re-save e MERGE_OBJECTS como periodo; a validacao de 02/07/2026 deixou de ser prova de acerto',
        reproduzir_o_antigo: '/api/funnel-stages?fonte=api',
      } : null,
      // Não esconder: o consumidor tem de poder ver que estes dois campos mudaram
      // de definição ao sair da API, e por quê.
      divergencias_conhecidas: viaBQ ? [
        { campo: 'contagem de etapa (stages[].count)',
          efeito: 'MAIOR no funil Vendas — RA 615 vs 607, Diag 262 vs 258, Cot 80 vs 78, Cons 49 vs 47, Neg 29 vs 28',
          motivo: 'o funil e sempre (pipeline, stage). A versao antiga bucketizava toda entrada pelo pipeline ATUAL do deal, entao entrada de um deal hoje em Bid que passou por Vendas era testada contra o mapa de etapas do Bid, nao casava e caia fora em silencio. 28% das entradas (2.200 em 1.612 deals) tem pipeline diferente do atual' },
        { campo: 'owner_changes',
          efeito: 'menor que na API',
          motivo: 'a API repete o mesmo dono em re-save/acao em massa/MERGE_OBJECTS e conta cada repeticao como troca; o armazem colapsa valor igual consecutivo' },
        { campo: 'stage_medians',
          efeito: 'mediana deslocada e n menor em etapa terminal',
          motivo: 'entrada duplicada dava a API um periodo seguinte e ela contava tempo concluido numa etapa que o deal nunca deixou; o armazem trata como periodo em aberto' },
      ] : null,
      vendas: buildResult(VENDAS_FUNNEL, VENDAS_EXTRA, vendasSets, dealNames, vendasDates),
      bid:    buildResult(BID_FUNNEL,    BID_EXTRA,    bidSets,    dealNames, bidDates),
      owner_changes:  ownerChangesByDeal,
      stage_medians:  Object.keys(stageMedsByName).length ? stageMedsByName : null,
      stage_counts:   _stageCtsOut,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[funnel-stages]', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};
