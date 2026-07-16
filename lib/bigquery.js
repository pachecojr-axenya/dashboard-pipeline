'use strict';
/**
 * bigquery.js — Cliente BigQuery REST (zero dependencias externas)
 *
 * Mesmo padrao de autenticacao do lib/sheets.js: Service Account JWT RS256 ->
 * access token OAuth2, tudo com fetch nativo. So muda o scope (bigquery) e os
 * endpoints. Credencial lida de GOOGLE_SERVICE_ACCOUNT_JSON (a MESMA env var ja
 * usada pelo Sheets client em producao).
 *
 * Motivacao (2026-07-16): destravar "datas livres" no /forecast-delta. Hoje a
 * foto deal-level so existe as sextas (Google Sheet, uma aba por foto). Em BQ,
 * cada dia vira linhas com snapshot_date -> comparar QUALQUER par de datas com
 * snapshot vira um SELECT, sem depender do cadence semanal do Sheet.
 *
 * Projeto/dataset/location: fonte unica em lib/env.js (gen-lang-client-...,
 * axenya_bdr_intraday_{prd,dev}, southamerica-east1). NUNCA growth-487021.
 *
 * A "foto" no BQ preserva 1:1 as 36 colunas de lib/snapshot-format.js (HEADERS),
 * gravadas em colunas estaveis c00..c35 (sem acento/espaco) + snapshot_date e
 * snapshot_type. A leitura reconstroi o MESMO array-de-arrays que o Sheet
 * devolve (linha 0 = HEADERS), entao forecast-compute.js nao muda nada.
 *
 * Exports:
 *   isConfigured()                         - ha credencial de service account?
 *   ensureSnapshotTable()                  - cria a tabela se nao existir (idempotente)
 *   insertSnapshotRows(date, type, rows)   - grava 1 foto deal-level (streaming insert)
 *   hasSnapshot(date)                      - ja existe foto nessa data?
 *   listSnapshotDates()                    - datas disponiveis (desc) + tipo
 *   readSnapshotRows(date)                 - foto de 1 data no formato [[HEADERS],[...]]
 *   query(sql, params)                     - SELECT parametrizado (so leitura)
 */

const crypto = require('crypto');
const env = require('./env');
const { HEADERS } = require('./snapshot-format');

const LOCATION = 'southamerica-east1';
const TABLE = 'forecast_snapshots';
const NUM_COLS = HEADERS.length; // 36

// Nomes de coluna BQ estaveis: c00..c35 (independentes de acento/espaco do HEADER).
function colName(i) { return 'c' + String(i).padStart(2, '0'); }

// -- Auth: Service Account JWT RS256 -> access token (scope bigquery) --
function b64url(input) {
  const str = typeof input === 'string' ? input : JSON.stringify(input);
  return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function isConfigured() {
  return !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
}

async function getAccessToken() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON nao configurado');
  }
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON.replace(/^\uFEFF/, '').trim());
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: 'RS256', typ: 'JWT' });
  const payload = b64url({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/bigquery',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  });
  const unsigned = header + '.' + payload;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  const sig = signer.sign(sa.private_key, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: unsigned + '.' + sig,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Google auth (BQ) falhou: ' + JSON.stringify(data));
  return data.access_token;
}

// -- REST helpers --
const PROJECT = env.gcpProject;
function dataset() { return env.bqDataset(); }
function apiBase() { return 'https://bigquery.googleapis.com/bigquery/v2/projects/' + PROJECT; }

async function bqReq(token, method, path, body) {
  const res = await fetch(apiBase() + path, {
    method,
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('BigQuery ' + res.status + ': ' + JSON.stringify(data));
  return data;
}

// -- DDL: tabela de snapshots (particionada por snapshot_date) --
function snapshotSchema() {
  const fields = [
    { name: 'snapshot_date', type: 'DATE', mode: 'REQUIRED' },
    { name: 'snapshot_type', type: 'STRING', mode: 'NULLABLE' }, // diario | semanal | mensal
    { name: 'captured_at', type: 'TIMESTAMP', mode: 'NULLABLE' },
  ];
  for (let i = 0; i < NUM_COLS; i++) fields.push({ name: colName(i), type: 'STRING', mode: 'NULLABLE' });
  return fields;
}

async function ensureSnapshotTable() {
  const token = await getAccessToken();
  const ds = dataset();
  try {
    await bqReq(token, 'GET', '/datasets/' + ds + '/tables/' + TABLE);
    return { created: false };
  } catch (e) {
    if (!/BigQuery 404/.test(e.message)) throw e;
  }
  await bqReq(token, 'POST', '/datasets/' + ds + '/tables', {
    tableReference: { projectId: PROJECT, datasetId: ds, tableId: TABLE },
    schema: { fields: snapshotSchema() },
    timePartitioning: { type: 'DAY', field: 'snapshot_date' },
    description: 'Foto deal-level do pipe por dia. Colunas c00..c35 = HEADERS de lib/snapshot-format.js. Origem: api/snapshot.js. Consumo: api/history.js (compare do /forecast-delta).',
  });
  return { created: true };
}

// -- Escrita: grava uma foto deal-level (streaming insertAll) --
// dealRows: array de arrays de 36 posicoes (mesmo shape do buildRow do Sheet).
async function insertSnapshotRows(snapshotDate, snapshotType, dealRows, capturedAt) {
  if (!Array.isArray(dealRows) || !dealRows.length) return { inserted: 0 };
  const token = await getAccessToken();
  const ds = dataset();
  const cap = capturedAt || new Date().toISOString();
  const toObj = (r) => {
    const o = { snapshot_date: snapshotDate, snapshot_type: snapshotType || 'diario', captured_at: cap };
    for (let i = 0; i < NUM_COLS; i++) { const v = r[i]; o[colName(i)] = (v == null ? null : String(v)); }
    return o;
  };
  let total = 0;
  for (let i = 0; i < dealRows.length; i += 500) {
    const chunk = dealRows.slice(i, i + 500);
    // insertId por deal+data = dedup nativo do streaming (reexecucao no mesmo dia nao duplica).
    const rows = chunk.map((r) => ({
      insertId: snapshotDate + ':' + (r[0] == null ? 'na' : String(r[0])),
      json: toObj(r),
    }));
    const resp = await bqReq(token, 'POST', '/datasets/' + ds + '/tables/' + TABLE + '/insertAll', {
      kind: 'bigquery#tableDataInsertAllRequest',
      skipInvalidRows: false,
      ignoreUnknownValues: false,
      rows,
    });
    if (resp.insertErrors && resp.insertErrors.length) {
      throw new Error('BQ insertAll errors: ' + JSON.stringify(resp.insertErrors.slice(0, 3)));
    }
    total += chunk.length;
  }
  return { inserted: total };
}

// -- Leitura --
// SELECT via jobs.query. params: [{name,type,value}] -> query parameters tipados.
async function query(sql, params) {
  const token = await getAccessToken();
  const body = { query: sql, useLegacySql: false, location: LOCATION, timeoutMs: 25000 };
  if (params && params.length) {
    body.parameterMode = 'NAMED';
    body.queryParameters = params.map((p) => ({
      name: p.name,
      parameterType: { type: p.type || 'STRING' },
      parameterValue: { value: p.value == null ? null : String(p.value) },
    }));
  }
  const data = await bqReq(token, 'POST', '/queries', body);
  const fields = (data.schema && data.schema.fields) || [];
  const rows = (data.rows || []).map((r) => {
    const o = {};
    (r.f || []).forEach((cell, i) => { o[fields[i].name] = cell.v; });
    return o;
  });
  return { fields: fields.map((f) => f.name), rows };
}

// Datas de snapshot disponiveis, da mais recente a mais antiga.
async function listSnapshotDates() {
  const ds = dataset();
  const q = 'SELECT snapshot_date AS d, ANY_VALUE(snapshot_type) AS t, COUNT(*) AS n'
    + ' FROM `' + PROJECT + '.' + ds + '.' + TABLE + '`'
    + ' GROUP BY snapshot_date ORDER BY snapshot_date DESC';
  const { rows } = await query(q);
  return rows.map((r) => ({ tab: String(r.d), tipo: r.t || 'diario', count: Number(r.n) }));
}

async function hasSnapshot(snapshotDate) {
  const ds = dataset();
  const q = 'SELECT COUNT(*) AS n FROM `' + PROJECT + '.' + ds + '.' + TABLE + '` WHERE snapshot_date = @d';
  const { rows } = await query(q, [{ name: 'd', type: 'DATE', value: snapshotDate }]);
  return rows.length ? Number(rows[0].n) > 0 : false;
}

// Le a foto de UMA data e devolve no MESMO shape do Sheet: [[HEADERS],[valores...]].
async function readSnapshotRows(snapshotDate) {
  const ds = dataset();
  const cols = [];
  for (let i = 0; i < NUM_COLS; i++) cols.push(colName(i));
  const q = 'SELECT ' + cols.join(', ') + ' FROM `' + PROJECT + '.' + ds + '.' + TABLE + '` WHERE snapshot_date = @d';
  const { rows } = await query(q, [{ name: 'd', type: 'DATE', value: snapshotDate }]);
  if (!rows.length) return [];
  const out = [HEADERS.slice()];
  rows.forEach((r) => {
    const line = [];
    for (let i = 0; i < NUM_COLS; i++) { const v = r[colName(i)]; line.push(v == null ? '' : String(v)); }
    out.push(line);
  });
  return out;
}

module.exports = {
  isConfigured, HEADERS, NUM_COLS, colName, LOCATION, TABLE,
  getAccessToken, bqReq, dataset, PROJECT,
  ensureSnapshotTable, insertSnapshotRows, query, listSnapshotDates, hasSnapshot, readSnapshotRows,
};
