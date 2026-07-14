'use strict';
/**
 * lib/semantic.js | Porta Node da camada semântica (Fase 2 do Dashboard 2.0).
 *
 * Única forma sancionada de um handler/lib consumir `semantic/referencia.json`.
 * Os helpers reproduzem o COMPORTAMENTO 1.0 (paridade); divergências deliberadas
 * do catálogo (ex.: ativa_default de Stand by) NÃO passam por aqui até a Fase 4 —
 * ver referencia._meta.semantica_ativa_default.
 */
const referencia = require('../semantic/referencia.json');

const PIPELINES = {
  vendas: referencia.pipelines.vendas.id,
  bid: referencia.pipelines.bid.id,
};

function pipelineLabels() {
  const out = {};
  Object.keys(referencia.pipelines).forEach(k => {
    const p = referencia.pipelines[k];
    out[p.id] = p.label.pt;
  });
  return out;
}

// Etapas que o 1.0 conhece (mapeada_no_1_0 !== false).
function mapeadas() {
  return referencia.etapas.filter(e => e.mapeada_no_1_0 !== false);
}

/**
 * Mapa { stage_id → nome } no recorte de um consumidor.
 * opts.pipeline: 'vendas' | 'bid' (omitir = ambos)
 * opts.alias:   { id → rótulo } para consumidores que usam um alias histórico
 *               (ex.: funnel-stages chama 1317543716 de 'Standby')
 * opts.exclude: [ids] que o consumidor não mapeia (ex.: funnel-stages não tem
 *               Reunião Pré-RFP)
 */
function stageMap(opts) {
  opts = opts || {};
  const out = {};
  mapeadas().forEach(e => {
    if (opts.pipeline && e.pipeline !== opts.pipeline) return;
    if (opts.exclude && opts.exclude.indexOf(e.id) !== -1) return;
    out[e.id] = (opts.alias && opts.alias[e.id]) || e.nome;
  });
  return out;
}

// Filtro de ativos do 1.0: todas as etapas mapeadas exceto Perdido — Stand by
// INCLUÍDO (a intenção ativa_default=false do catálogo só vale com a config da
// Fase 4/ADR-007; regra documentada em semantic/regras.json → filtro_deals_ativos).
function activeStageIds() {
  return mapeadas().filter(e => e.nome !== 'Perdido').map(e => e.id);
}

function lostStageIds() {
  return mapeadas().filter(e => e.nome === 'Perdido').map(e => e.id);
}

function stageProb(regua) {
  return referencia.reguas_probabilidade[regua].valores;
}

module.exports = { referencia, PIPELINES, pipelineLabels, stageMap, activeStageIds, lostStageIds, stageProb };
