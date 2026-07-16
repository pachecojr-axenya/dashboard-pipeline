'use strict';
/**
 * lib/env.js — Separação de ambientes (dev / preview / production).
 *
 * Fonte da verdade única para: ambiente corrente, projeto GCP, datasets BigQuery
 * por ambiente, prefixo de chave KV e feature flags. Ver
 * openspec/changes/bdr-intraday-history-drilldown/design.md §1.
 *
 * Regras:
 *  - `preview` (Vercel) e local contam como **development** para efeito de dados
 *    (não contaminam produção).
 *  - Projeto GCP é SEMPRE gen-lang-client-0423905839; NUNCA growth-487021.
 *  - dev/preview NUNCA escrevem no dataset _prd.
 *
 * Zero deps.
 */

const GCP_PROJECT = 'gen-lang-client-0423905839';
const CI_DATASET = 'axenya_commercial_intel_prd'; // fundação Commercial Intelligence (read-only)

function resolveName() {
  const v = (process.env.VERCEL_ENV || '').toLowerCase();
  if (v === 'production') return 'production';
  if (v === 'preview') return 'preview';
  if (v) return 'development';
  const n = (process.env.NODE_ENV || '').toLowerCase();
  if (n === 'production') return 'production';
  return 'development';
}

const name = resolveName();
const isProd = name === 'production';
const prefix = isProd ? 'prd' : 'dev';

module.exports = {
  name,
  isProd,
  gcpProject: GCP_PROJECT,

  /** Dataset BQ do dashboard, por ambiente (destino de escrita). */
  bqDataset() {
    return isProd ? 'axenya_bdr_intraday_prd' : 'axenya_bdr_intraday_dev';
  },

  /** Dataset BQ exclusivo do Forecast (HubSpot -> BQ), por ambiente. */
  forecastDataset() {
    return isProd ? 'axenya_forecast_prd' : 'axenya_forecast_dev';
  },

  /** Fundação CI — sempre a de produção, somente leitura. */
  ciDataset() {
    return CI_DATASET;
  },

  /** Chave KV namespaced por ambiente: dev e prod não colidem. */
  kvKey(ns) {
    return `${prefix}:${ns}`;
  },

  /** Feature flag por env var BDR_FLAG_<NAME> (default: off). */
  flag(nameFlag) {
    const raw = process.env[`BDR_FLAG_${String(nameFlag).toUpperCase()}`];
    return raw === '1' || String(raw).toLowerCase() === 'true';
  },
};
