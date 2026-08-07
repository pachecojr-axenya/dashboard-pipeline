'use strict';
/**
 * lib/hubspot-warehouse.js — acesso ao armazém canônico `axenya_hubspot_prd_*`.
 *
 * Fonte única do HubSpot no BigQuery (star schema, reconciliação diária, 68
 * checks). Construído nas fases F0–F4/F6–F8; esta camada é o consumo (F5).
 *   · Código do ETL: 15_Workspaces/GCP_Axenya/scripts/hubspot-platform/
 *   · Handoff F5:    20_Company/Sales/Pipeline_Dashboard/2026-08-07_Handoff_F5_*.md
 *
 * Princípio da migração, e ele decide o que entra aqui:
 *   LEITURA ANALÍTICA MIGRA; ESCRITA, AÇÃO E TEMPO REAL FICAM AO VIVO.
 * Endpoint que escreve no CRM (`bdr-list-attack`), que monitora em tempo real
 * (`watcher-deals`) ou cuja lógica não está modelada (`forecast-table`,
 * `growth-performance`, CS) continua batendo na API do HubSpot. Não há ganho em
 * forçar.
 *
 * RESSALVA DOS TICKETS, explícita: só o **Pipeline de Cotação (847948895, 187
 * tickets)** está no armazém. Os outros 18 pipelines (109.013 tickets) NÃO
 * estão. Endpoint de ticket que precise deles tem de ficar na API — use
 * `cotacaoOnly()` para decidir, nunca presuma cobertura total.
 *
 * Zero deps: reaproveita o cliente REST de lib/bigquery.js (SA JWT -> token).
 */

const bq = require('./bigquery');

const PROJECT = 'gen-lang-client-0423905839';
const BRONZE = 'axenya_hubspot_prd_bronze';
const SILVER = 'axenya_hubspot_prd_silver';
const GOLD = 'axenya_hubspot_prd_gold';

// Único pipeline de ticket modelado no armazém. Ver ressalva no topo.
const COTACAO_PIPELINE_ID = '847948895';

/** `PROJECT.dataset.tabela` com backticks, pronto para interpolar em SQL. */
function t(layer, table) {
  const ds = { bronze: BRONZE, silver: SILVER, gold: GOLD }[layer];
  if (!ds) throw new Error(`camada desconhecida: ${layer}`);
  if (!/^[a-z0-9_]+$/.test(String(table))) throw new Error(`tabela inválida: ${table}`);
  return '`' + PROJECT + '.' + ds + '.' + table + '`';
}

/**
 * true quando o recorte de tickets pedido cabe no armazém (só Cotação).
 * Qualquer outro pipeline — ou "todos" — devolve false e o chamador MANTÉM a
 * rota antiga na API. Migrar pela metade e não dizer é o que faz a tela mostrar
 * 187 de 109.200 tickets como se fosse o total.
 */
function cotacaoOnly(pipelineId) {
  return String(pipelineId || '') === COTACAO_PIPELINE_ID;
}

/**
 * Normaliza TIMESTAMP do BigQuery REST para ISO 8601 UTC.
 *
 * O endpoint /queries devolve TIMESTAMP como STRING de epoch em SEGUNDOS com
 * fração ("1784567311.617586"), não como "YYYY-MM-DD HH:MM:SS". Sem normalizar,
 * `new Date(valor)` no browser dá Invalid Date e a UI mostra "NaN/NaN NaN:NaN".
 * Mesma função de api/bdr-workload-history.js, aqui para os endpoints migrados
 * não reimplementarem cada um a sua.
 */
function timestamp(v) {
  if (v == null || v === '') return null;
  const value = String(v).trim();
  if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) {
    const d = new Date(Math.round(Number(value) * 1000));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)) {
    const d = new Date(value.replace(' ', 'T') + 'Z');
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function num(v) { return v == null || v === '' ? 0 : Number(v); }
function str(v) { return v == null ? null : String(v); }
function ymd(v) { return v == null ? null : String(v).slice(0, 10); }

function isConfigured() { return bq.isConfigured(); }

/** SELECT no armazém. params no formato de lib/bigquery.js: [{name,type,value}]. */
async function query(sql, params) {
  if (!isConfigured()) {
    throw new Error('Armazém HubSpot indisponível: GOOGLE_SERVICE_ACCOUNT_JSON ausente');
  }
  return bq.query(sql, params);
}

module.exports = {
  PROJECT, BRONZE, SILVER, GOLD, COTACAO_PIPELINE_ID,
  t, cotacaoOnly, timestamp, num, str, ymd, isConfigured, query,
};
