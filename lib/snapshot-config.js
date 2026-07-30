'use strict';
/**
 * lib/snapshot-config.js — "config sidecar" por data de foto (Fase 2 do Delta).
 *
 * A foto de 35/36 colunas NÃO calcula nada (regra 2026-07-02) — mas a AVALIAÇÃO
 * de uma foto depende de config que muda com o tempo: régua de probabilidade por
 * etapa, overrides manuais por deal (prob-manual) e faturamento manual (KV).
 * Este módulo persiste essa config POR DATA, junto do snapshot, para o Delta
 * poder calcular o "Δ convicção" (A avaliada com a config vigente em A; B com a
 * de B) sem reescrever o passado quando alguém edita uma probabilidade hoje.
 *
 * Armazenamento (mesma filosofia dos snapshots):
 *   - BQ: tabela `snapshot_config` (snapshot_date DATE + config JSON string),
 *     particionada por data. Fonte canônica.
 *   - Fallback sem BQ (dev local): /tmp/snapshot-config/<date>.json.
 * Escrita idempotente por data (não sobrescreve: a config vigente NA CAPTURA é
 * o registro histórico; recapturas no mesmo dia mantêm a primeira).
 *
 * Shape persistido:
 *   { stageProb: {Etapa: prob}, probManual: {dealId:{prob,...}}, faturamentoManual: {...},
 *     savedAt: ISO, source: 'cron'|'manual_weekly'|string }
 */
const bq = require('./bigquery');
const kv = require('./kv');
const PM = require('./prob-manual');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TABLE_CONFIG = 'snapshot_config';
const TMP_DIR = path.join(os.tmpdir(), 'snapshot-config');
const FM_KV_KEY = 'forecast:faturamento_manual';

// Régua vigente de probabilidade por etapa: a MESMA fonte única do front
// (semantic/referencia.json → reguas.forecast_flat), que só muda via deploy.
function currentStageProb() {
  try {
    const ref = require('../semantic/referencia.json');
    // chave real do JSON fonte é reguas_probabilidade (o semantic-ref.js gerado renomeia p/ reguas)
    const reguas = (ref && (ref.reguas_probabilidade || ref.reguas)) || {};
    const v = reguas.forecast_flat && reguas.forecast_flat.valores;
    if (v && typeof v === 'object') return v;
  } catch (e) { /* fallback abaixo */ }
  return require('./forecast-compute').STAGE_PROB_DEFAULT;
}

async function _readFaturamentoManual() {
  if (kv.isConfigured && kv.isConfigured()) {
    try { const v = await kv.getJSON(FM_KV_KEY); if (v && typeof v === 'object') return v; } catch (e) { /* vazio */ }
  }
  try {
    const j = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'faturamento-manual.json'), 'utf8'));
    if (j && typeof j === 'object') return j;
  } catch (e) { /* sem arquivo */ }
  return {};
}

// Config de avaliação VIGENTE agora (o que o sidecar congela na captura).
async function currentConfig(source) {
  return {
    stageProb: currentStageProb(),
    probManual: await PM.readAll(),
    faturamentoManual: await _readFaturamentoManual(),
    savedAt: new Date().toISOString(),
    source: source || 'cron',
  };
}

// ── BQ ───────────────────────────────────────────────────────────────────────
async function _ensureConfigTable(token) {
  try {
    await bq.bqReq(token, 'GET', '/datasets/' + bq.dataset() + '/tables/' + TABLE_CONFIG);
    return false;
  } catch (e) {
    if (!/BigQuery 404/.test(e.message)) throw e;
  }
  await bq.bqReq(token, 'POST', '/datasets/' + bq.dataset() + '/tables', {
    tableReference: { projectId: bq.PROJECT, datasetId: bq.dataset(), tableId: TABLE_CONFIG },
    schema: { fields: [
      { name: 'snapshot_date', type: 'DATE', mode: 'REQUIRED' },
      { name: 'saved_at', type: 'TIMESTAMP', mode: 'NULLABLE' },
      { name: 'source', type: 'STRING', mode: 'NULLABLE' },
      { name: 'config', type: 'STRING', mode: 'NULLABLE' },   // JSON: {stageProb, probManual, faturamentoManual}
    ] },
    timePartitioning: { type: 'DAY', field: 'snapshot_date' },
    description: 'Config sidecar por foto (Fase 2 do Delta): régua de prob por etapa + prob-manual + faturamento manual vigentes NA DATA. Origem: api/snapshot.js via lib/snapshot-config.js.',
  });
  return true;
}

async function _bqSave(date, cfg) {
  const token = await bq.getAccessToken();
  await _ensureConfigTable(token);
  // Idempotente por data: a config da captura ORIGINAL é o registro histórico.
  const q = 'SELECT COUNT(*) AS n FROM `' + bq.PROJECT + '.' + bq.dataset() + '.' + TABLE_CONFIG + '` WHERE snapshot_date = @d';
  const { rows } = await bq.query(q, [{ name: 'd', type: 'DATE', value: date }]);
  if (rows.length && Number(rows[0].n) > 0) return { saved: false, reason: 'já existia' };
  const resp = await bq.bqReq(token, 'POST', '/datasets/' + bq.dataset() + '/tables/' + TABLE_CONFIG + '/insertAll', {
    kind: 'bigquery#tableDataInsertAllRequest',
    rows: [{ insertId: 'cfg:' + date, json: {
      snapshot_date: date, saved_at: cfg.savedAt, source: cfg.source || null,
      config: JSON.stringify({ stageProb: cfg.stageProb, probManual: cfg.probManual, faturamentoManual: cfg.faturamentoManual }),
    } }],
  });
  if (resp.insertErrors && resp.insertErrors.length) throw new Error('BQ insertAll (snapshot_config): ' + JSON.stringify(resp.insertErrors.slice(0, 2)));
  return { saved: true };
}

async function _bqLoad(date) {
  const q = 'SELECT config, saved_at, source FROM `' + bq.PROJECT + '.' + bq.dataset() + '.' + TABLE_CONFIG + '` WHERE snapshot_date = @d LIMIT 1';
  const { rows } = await bq.query(q, [{ name: 'd', type: 'DATE', value: date }]);
  if (!rows.length || !rows[0].config) return null;
  const parsed = JSON.parse(rows[0].config);
  return { stageProb: parsed.stageProb || null, probManual: parsed.probManual || {}, faturamentoManual: parsed.faturamentoManual || {}, savedAt: rows[0].saved_at || null, source: rows[0].source || null };
}

// ── Fallback local (dev sem BQ) ──────────────────────────────────────────────
function _tmpFile(date) { return path.join(TMP_DIR, date + '.json'); }
function _tmpSave(date, cfg) {
  try { fs.mkdirSync(TMP_DIR, { recursive: true }); } catch (e) { /* já existe */ }
  if (fs.existsSync(_tmpFile(date))) return { saved: false, reason: 'já existia' };
  fs.writeFileSync(_tmpFile(date), JSON.stringify(cfg));
  return { saved: true };
}
function _tmpLoad(date) {
  try { return JSON.parse(fs.readFileSync(_tmpFile(date), 'utf8')); } catch (e) { return null; }
}

// ── API pública ──────────────────────────────────────────────────────────────
// Grava o sidecar da data (config vigente agora). Nunca lança para o chamador
// derrubar o snapshot das 35 colunas: sidecar é ADITIVO — falha vira {saved:false,error}.
async function save(date, source) {
  try {
    const cfg = await currentConfig(source);
    return await saveRaw(date, cfg);
  } catch (e) {
    console.error('[snapshot-config][save]', e.message);
    return { saved: false, error: e.message };
  }
}

// Grava um cfg ARBITRÁRIO (backfill retroativo): mesma idempotência por data —
// nunca sobrescreve um sidecar já capturado ao vivo. BQ indisponível/sem permissão
// (ex.: credencial local sem role BigQuery) → cai no /tmp com aviso, não engole.
async function saveRaw(date, cfg) {
  try {
    if (bq.isConfigured()) {
      try { return await _bqSave(date, cfg); }
      catch (e) { console.error('[snapshot-config][saveRaw] BQ falhou (' + e.message.slice(0, 80) + ') → /tmp'); }
    }
    return _tmpSave(date, cfg);
  } catch (e) {
    console.error('[snapshot-config][saveRaw]', e.message);
    return { saved: false, error: e.message };
  }
}

// Lê o sidecar da data. null = foto sem config snapshotada (fotos antigas) —
// o chamador aplica a config ATUAL com flag visível, nunca silenciosamente.
async function load(date) {
  try {
    if (bq.isConfigured()) {
      try { const v = await _bqLoad(date); if (v) return v; }
      catch (e) { /* BQ indisponível/sem permissão → tenta o fallback local */ }
    }
    return _tmpLoad(date);
  } catch (e) {
    console.error('[snapshot-config][load]', e.message);
    return null;
  }
}

module.exports = { save, saveRaw, load, currentConfig, currentStageProb, TABLE_CONFIG };
