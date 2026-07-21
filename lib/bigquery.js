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
 * axenya_forecast_{prd,dev}, southamerica-east1). NUNCA growth-487021 nem o
 * projeto pessoal usado pela service account legada da planilha.
 *
 * A "foto" no BQ preserva 1:1 as 36 colunas de lib/snapshot-format.js (HEADERS),
 * gravadas em colunas estaveis c00..c35 (sem acento/espaco) + snapshot_date e
 * snapshot_type. A leitura reconstroi o MESMO array-de-arrays que o Sheet
 * devolve (linha 0 = HEADERS), entao forecast-compute.js nao muda nada.
 *
 * DUAS tabelas (decisao do dono 2026-07-16, replicando a logica da planilha):
 *   - forecast_snapshots_daily       : 1 linha/deal/dia. Granular. Fonte das
 *     DATAS LIVRES. Particionada por snapshot_date. Volume alto (~250 deals/dia).
 *   - forecast_snapshots_weekly_gold : datamart LEVE, so sextas + ultimo dia do
 *     mes = ESPELHO da planilha. Derivado do daily (paridade garantida). E o que
 *     as telas /forecast e /forecast-delta consomem por padrao (lista de fotos).
 *
 * Regra de ingestao (espelha api/snapshot.js / a planilha): todo dia grava daily;
 * sexta/mes tambem materializa a foto do dia no weekly_gold. As datas do
 * weekly_gold sao EXATAMENTE as datas de foto da planilha.
 *
 * Exports principais:
 *   isConfigured(); ensureTables(); insertSnapshotRows(date,type,rows,cap,table);
 *   deriveWeeklyFromDaily(date,type); hasSnapshot(date,table);
 *   listSnapshotDates(table); readSnapshotRows(date,table); query(sql,params).
 */

const crypto = require('crypto');
const env = require('./env');
const { HEADERS } = require('./snapshot-format');

const LOCATION = 'southamerica-east1';
const TABLE_DAILY = 'forecast_snapshots_daily';
const TABLE_WEEKLY = 'forecast_snapshots_weekly_gold';
const TABLE = TABLE_DAILY; // default/compat
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
function dataset() { return env.forecastDataset(); }
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

// -- DDL: tabelas de snapshots (particionadas por snapshot_date) --
function snapshotSchema() {
  const fields = [
    { name: 'snapshot_date', type: 'DATE', mode: 'REQUIRED' },
    { name: 'snapshot_type', type: 'STRING', mode: 'NULLABLE' }, // diario | semanal | mensal
    { name: 'captured_at', type: 'TIMESTAMP', mode: 'NULLABLE' },
  ];
  for (let i = 0; i < NUM_COLS; i++) fields.push({ name: colName(i), type: 'STRING', mode: 'NULLABLE' });
  return fields;
}

async function _ensureOne(token, ds, tableId, desc) {
  try {
    await bqReq(token, 'GET', '/datasets/' + ds + '/tables/' + tableId);
    return false;
  } catch (e) {
    if (!/BigQuery 404/.test(e.message)) throw e;
  }
  await bqReq(token, 'POST', '/datasets/' + ds + '/tables', {
    tableReference: { projectId: PROJECT, datasetId: ds, tableId },
    schema: { fields: snapshotSchema() },
    timePartitioning: { type: 'DAY', field: 'snapshot_date' },
    description: desc,
  });
  return true;
}

// Cria as DUAS tabelas se nao existirem (idempotente).
async function ensureTables() {
  const token = await getAccessToken();
  const ds = dataset();
  const daily = await _ensureOne(token, ds, TABLE_DAILY,
    'Foto deal-level DIARIA do pipe. c00..c35 = HEADERS de snapshot-format.js. Granular, fonte das datas livres do /forecast-delta. Origem: api/snapshot.js.');
  const weekly = await _ensureOne(token, ds, TABLE_WEEKLY,
    'Datamart LEVE: fotos semanais (sexta) + mensais = espelho da planilha. Derivado do daily. Consumo padrao de /forecast e /forecast-delta.');
  return { daily, weekly };
}

// Compat: mantem o nome antigo apontando pro ensureTables.
async function ensureSnapshotTable() { return ensureTables(); }

// Indice de cada HEADER canonico -> posicao BQ (c00..c35). Estavel.
const _HEADER_POS = {};
HEADERS.forEach((h, i) => { _HEADER_POS[String(h).trim()] = i; });

// -- Escrita: grava uma foto deal-level (streaming insertAll) --
// dealRows: array de arrays. header: array de nomes de coluna daquela foto.
//   Se header for informado, o valor de cada deal e casado a coluna BQ POR NOME
//   (robusto a fotos de 35 col sem "É POC?" ou a qualquer reordenacao). Sem
//   header, assume posicional c00..c35 (compat: shape do buildRow, 36 col).
// table: TABLE_DAILY (default) ou TABLE_WEEKLY.
async function insertSnapshotRows(snapshotDate, snapshotType, dealRows, capturedAt, table, header) {
  if (!Array.isArray(dealRows) || !dealRows.length) return { inserted: 0 };
  const token = await getAccessToken();
  const ds = dataset();
  const tbl = table || TABLE_DAILY;
  const cap = capturedAt || new Date().toISOString();

  // Mapa posicao-na-foto -> posicao-BQ, quando temos o header da foto.
  let colMap = null, idIdx = 0;
  if (Array.isArray(header) && header.length) {
    colMap = header.map((name) => { const p = _HEADER_POS[String(name).trim()]; return p == null ? -1 : p; });
    const di = header.findIndex((n) => String(n).trim() === 'Deal ID');
    idIdx = di >= 0 ? di : 0;
  }

  const toObj = (r) => {
    const o = { snapshot_date: snapshotDate, snapshot_type: snapshotType || 'diario', captured_at: cap };
    for (let i = 0; i < NUM_COLS; i++) o[colName(i)] = null;
    if (colMap) {
      // por NOME: cada valor vai para a coluna BQ do header correspondente
      for (let i = 0; i < r.length && i < colMap.length; i++) {
        const bqPos = colMap[i];
        if (bqPos >= 0) { const v = r[i]; o[colName(bqPos)] = (v == null ? null : String(v)); }
      }
    } else {
      // posicional (buildRow, 36 col)
      for (let i = 0; i < NUM_COLS; i++) { const v = r[i]; o[colName(i)] = (v == null ? null : String(v)); }
    }
    return o;
  };

  let total = 0;
  for (let i = 0; i < dealRows.length; i += 500) {
    const chunk = dealRows.slice(i, i + 500);
    // insertId por deal+data = dedup nativo do streaming (reexecucao no mesmo dia nao duplica).
    const rows = chunk.map((r) => ({
      insertId: snapshotDate + ':' + (r[idIdx] == null ? 'na' : String(r[idIdx])),
      json: toObj(r),
    }));
    const resp = await bqReq(token, 'POST', '/datasets/' + ds + '/tables/' + tbl + '/insertAll', {
      kind: 'bigquery#tableDataInsertAllRequest',
      skipInvalidRows: false,
      ignoreUnknownValues: false,
      rows,
    });
    if (resp.insertErrors && resp.insertErrors.length) {
      throw new Error('BQ insertAll errors (' + tbl + '): ' + JSON.stringify(resp.insertErrors.slice(0, 3)));
    }
    total += chunk.length;
  }
  return { inserted: total };
}

// Datamart gold: materializa no weekly_gold a foto que ja existe no daily de uma
// data (paridade garantida — le do daily e regrava no weekly). Idempotente: se a
// data ja existe no weekly, nao duplica (streaming dedup por insertId). Usado na
// sexta / ultimo dia do mes, espelhando a regra da planilha.
async function deriveWeeklyFromDaily(snapshotDate, snapshotType) {
  const rows = await readSnapshotRows(snapshotDate, TABLE_DAILY);
  if (rows.length < 2) return { inserted: 0, reason: 'sem foto daily em ' + snapshotDate };
  // rows[0] = HEADERS canonicos (readSnapshotRows sempre reconstroi com HEADERS).
  const r = await insertSnapshotRows(snapshotDate, snapshotType || 'semanal', rows.slice(1), null, TABLE_WEEKLY, rows[0]);
  return r;
}

// -- Leitura --
function decodeCell(value, field) {
  if (field && field.mode === 'REPEATED') {
    return Array.isArray(value) ? value.map((item) => decodeCell(item && Object.prototype.hasOwnProperty.call(item, 'v') ? item.v : item, { ...field, mode: 'NULLABLE' })) : [];
  }
  if (field && (field.type === 'RECORD' || field.type === 'STRUCT') && value && value.f) {
    const output = {};
    (value.f || []).forEach((cell, index) => {
      const child = (field.fields || [])[index] || {};
      output[child.name || String(index)] = decodeCell(cell.v, child);
    });
    return output;
  }
  return value;
}
// SELECT via jobs.query. params: [{name,type,value}] -> query parameters tipados.
async function query(sql, params) {
  if (params && params.some((p) => Array.isArray(p.value) || String(p.type || '').toUpperCase() === 'ARRAY')) {
    throw new Error('BigQuery client não suporta ARRAY params');
  }
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
    (r.f || []).forEach((cell, i) => { o[fields[i].name] = decodeCell(cell.v, fields[i]); });
    return o;
  });
  return { fields: fields.map((f) => f.name), rows };
}

// Datas de snapshot disponiveis, da mais recente a mais antiga.
// table default = WEEKLY (lista de fotos "legada", espelho da planilha).
// Passe TABLE_DAILY para as datas livres (granularidade diaria).
async function listSnapshotDates(table) {
  const ds = dataset();
  const tbl = table || TABLE_WEEKLY;
  const q = 'SELECT snapshot_date AS d, ANY_VALUE(snapshot_type) AS t, COUNT(*) AS n'
    + ' FROM `' + PROJECT + '.' + ds + '.' + tbl + '`'
    + ' GROUP BY snapshot_date ORDER BY snapshot_date DESC';
  const { rows } = await query(q);
  return rows.map((r) => ({ tab: String(r.d), tipo: r.t || 'diario', count: Number(r.n) }));
}

async function hasSnapshot(snapshotDate, table) {
  return (await snapshotCount(snapshotDate, table)) > 0;
}

async function snapshotCount(snapshotDate, table) {
  const ds = dataset();
  const tbl = table || TABLE_DAILY;
  const q = 'SELECT COUNT(*) AS n FROM `' + PROJECT + '.' + ds + '.' + tbl + '` WHERE snapshot_date = @d';
  const { rows } = await query(q, [{ name: 'd', type: 'DATE', value: snapshotDate }]);
  return rows.length ? Number(rows[0].n) : 0;
}

// Metadados mínimos de uma partição. `snapshot_type=semanal_manual` identifica
// captura intencional feita após a reunião de forecast e torna a foto imutável
// para o cron posterior do mesmo dia.
async function snapshotMeta(snapshotDate, table) {
  const ds = dataset();
  const tbl = table || TABLE_DAILY;
  const q = 'SELECT COUNT(*) AS n, ANY_VALUE(snapshot_type) AS t, MAX(captured_at) AS captured_at'
    + ' FROM `' + PROJECT + '.' + ds + '.' + tbl + '` WHERE snapshot_date = @d';
  const { rows } = await query(q, [{ name: 'd', type: 'DATE', value: snapshotDate }]);
  if (!rows.length) return { count: 0, type: null, capturedAt: null };
  return { count: Number(rows[0].n || 0), type: rows[0].t || null, capturedAt: rows[0].captured_at || null };
}

// Le a foto de UMA data e devolve no MESMO shape do Sheet: [[HEADERS],[valores...]].
// table default = DAILY (granular: cobre qualquer data). Weekly cobre so sextas.
async function readSnapshotRows(snapshotDate, table) {
  const ds = dataset();
  const tbl = table || TABLE_DAILY;
  const cols = [];
  for (let i = 0; i < NUM_COLS; i++) cols.push(colName(i));
  const q = 'SELECT ' + cols.join(', ') + ' FROM `' + PROJECT + '.' + ds + '.' + tbl + '` WHERE snapshot_date = @d';
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
  isConfigured, HEADERS, NUM_COLS, colName, LOCATION,
  TABLE, TABLE_DAILY, TABLE_WEEKLY,
  getAccessToken, bqReq, dataset, PROJECT,
  ensureTables, ensureSnapshotTable, insertSnapshotRows, deriveWeeklyFromDaily,
  query, decodeCell, listSnapshotDates, hasSnapshot, snapshotCount, snapshotMeta, readSnapshotRows,
};
