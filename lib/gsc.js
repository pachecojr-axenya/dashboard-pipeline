'use strict';
/**
 * lib/gsc.js — Cliente Google Search Console (Search Analytics API v3).
 *
 * Zero deps (regra do repo). Autenticação = Service Account JWT RS256 -> access
 * token OAuth2 no escopo `webmasters.readonly`, mesmo padrão de lib/bigquery.js
 * e lib/sheets.js.
 *
 * Env vars:
 *   GSC_SERVICE_ACCOUNT_JSON  — JSON da service account com acesso à propriedade
 *                               (fallback: GOOGLE_SERVICE_ACCOUNT_JSON)
 *   GSC_SITE_URL              — opcional. Default: sc-domain:axenya.com
 *
 * Gotchas MEDIDOS em 2026-08-06 nesta propriedade (não regredir):
 *
 *  1. `dataState` importa muito. Com `all`, os 2 últimos dias vêm PARCIAIS — o
 *     dia corrente apareceu com 1 clique contra ~130 dos dias fechados. Num
 *     gráfico isso lê como queda de 99%. Toda conta de comparação usa `final`;
 *     `all` só serve para dizer "existe dado parcial depois de X".
 *  2. `dimensions:['date','query']` estoura em 25.000 linhas E `startRow:25000`
 *     devolve 0 — não há paginação além do teto. Por isso NUNCA cruzamos data
 *     com entidade: pedimos o agregado da janela A e o da janela B e subtraímos.
 *  3. A dimensão `query` é anonimizada pelo Google em cauda longa: no período de
 *     90 dias medido ela cobriu 27,5% dos cliques e 20,4% das impressões do site.
 *     A tabela de consultas NÃO é o site inteiro e a página tem que dizer isso.
 *  4. A dimensão `page` infla impressão (129,5% do total do site) porque duas
 *     URLs na mesma SERP contam impressão cada uma. Cliques por página batem
 *     (100,5%). Logo: impressão por página não é comparável ao total do site.
 *  5. `position` e `ctr` NÃO são somáveis. Média simples de posição deu 7,90 e a
 *     ponderada por impressão 8,00 no mesmo conjunto. Agregação sempre ponderada
 *     por impressão (posição) e recalculada de clicks/impressions (CTR).
 *  6. `searchAppearance` volta vazio nesta propriedade — não usar como dimensão.
 *  7. O horizonte disponível era 501 dias (desde 2025-03-24); a API corta em ~16
 *     meses. Pedir mais que isso não dá erro, só volta menos linhas.
 */

const crypto = require('crypto');
const kv = require('./kv');
const env = require('./env');

const API = 'https://www.googleapis.com/webmasters/v3';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const DEFAULT_SITE = 'sc-domain:axenya.com';
const TIMEOUT_MS = 25_000;
const TOKEN_TTL_MS = 50 * 60 * 1000; // token vale 1h; renovamos com folga
const MAX_ROWS = 25_000;

// ── credencial ------------------------------------------------------------

function _rawSA() {
  return process.env.GSC_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
}

function isConfigured() {
  return !!_rawSA();
}

function siteUrl() {
  return process.env.GSC_SITE_URL || DEFAULT_SITE;
}

function _parseSA() {
  const raw = _rawSA();
  if (!raw) throw new Error('GSC_SERVICE_ACCOUNT_JSON não configurado');
  const sa = JSON.parse(raw.replace(/^\uFEFF/, '').trim());
  if (!sa.client_email || !sa.private_key) throw new Error('service account sem client_email/private_key');
  return sa;
}

/** E-mail da SA — serve para a UI dizer QUEM precisa de acesso na propriedade. */
function serviceAccountEmail() {
  try { return _parseSA().client_email; } catch { return null; }
}

// ── auth ------------------------------------------------------------------

function _b64url(input) {
  const str = typeof input === 'string' ? input : JSON.stringify(input);
  return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

let _memToken = null; // { token, exp } — cache de processo (lambda quente)

function _tokenKey() {
  return env.kvKey('gsc:token');
}

async function _mintToken() {
  const sa = _parseSA();
  const now = Math.floor(Date.now() / 1000);
  const unsigned = _b64url({ alg: 'RS256', typ: 'JWT' }) + '.' + _b64url({
    iss: sa.client_email,
    scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });
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
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* corpo não-JSON */ }
  if (!res.ok || !json || !json.access_token) {
    throw new Error(`GSC token HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return json.access_token;
}

async function getAccessToken() {
  const now = Date.now();
  if (_memToken && _memToken.exp > now) return _memToken.token;

  if (kv.isConfigured()) {
    try {
      const cached = await kv.getJSON(_tokenKey());
      if (cached && cached.token && cached.exp > now) {
        _memToken = cached;
        return cached.token;
      }
    } catch { /* KV indisponível não pode derrubar a leitura */ }
  }

  const token = await _mintToken();
  _memToken = { token, exp: now + TOKEN_TTL_MS };
  if (kv.isConfigured()) {
    try { await kv.setJSON(_tokenKey(), _memToken); } catch { /* idem */ }
  }
  return token;
}

// ── HTTP ------------------------------------------------------------------

async function _call(path, options, label) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = await getAccessToken();
    const res = await fetch(`${API}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* corpo não-JSON */ }
    if (res.ok) return json || {};

    lastErr = new Error(`${label} HTTP ${res.status}: ${text.slice(0, 300)}`);
    lastErr.status = res.status;
    lastErr.body = json;

    // 401: token pode ter sido invalidado; joga o cache fora e tenta de novo.
    if (res.status === 401) {
      _memToken = null;
      if (kv.isConfigured()) { try { await kv.delKey(_tokenKey()); } catch { /* noop */ } }
      continue;
    }
    // 429/5xx: quota ou instabilidade — backoff curto.
    if (res.status === 429 || res.status >= 500) {
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
      continue;
    }
    throw lastErr;
  }
  throw lastErr;
}

// ── API ------------------------------------------------------------------

/** Propriedades visíveis para a service account. Diagnóstico de permissão. */
async function listSites() {
  const j = await _call('/sites', { method: 'GET' }, 'GSC /sites');
  return (j.siteEntry || []).map(s => ({ siteUrl: s.siteUrl, permissionLevel: s.permissionLevel }));
}

/**
 * searchAnalytics.query.
 * @param {object} o
 * @param {string} o.startDate YYYY-MM-DD (inclusivo)
 * @param {string} o.endDate   YYYY-MM-DD (inclusivo)
 * @param {string[]} [o.dimensions] [] devolve o agregado EXATO da propriedade
 * @param {'final'|'all'} [o.dataState]
 * @param {number} [o.rowLimit]
 * @param {object[]} [o.dimensionFilterGroups]
 * @returns {Promise<Array<{keys:string[],clicks:number,impressions:number,ctr:number,position:number}>>}
 */
async function query(o) {
  const body = {
    startDate: o.startDate,
    endDate: o.endDate,
    dimensions: o.dimensions || [],
    rowLimit: Math.min(o.rowLimit || 1000, MAX_ROWS),
    dataState: o.dataState || 'final',
  };
  if (o.dimensionFilterGroups) body.dimensionFilterGroups = o.dimensionFilterGroups;
  if (o.startRow) body.startRow = o.startRow;
  if (o.type) body.type = o.type;

  const path = `/sites/${encodeURIComponent(siteUrl())}/searchAnalytics/query`;
  const j = await _call(path, { method: 'POST', body: JSON.stringify(body) }, `GSC ${(body.dimensions.join('+') || 'total')}`);
  return j.rows || [];
}

/** Agregado da propriedade inteira na janela. É o número EXATO (sem dimensão). */
async function total({ startDate, endDate, dataState }) {
  const rows = await query({ startDate, endDate, dimensions: [], rowLimit: 1, dataState });
  const r = rows[0];
  if (!r) return { clicks: 0, impressions: 0, ctr: 0, position: 0, vazio: true };
  return { clicks: r.clicks || 0, impressions: r.impressions || 0, ctr: r.ctr || 0, position: r.position || 0 };
}

/** Série diária. rowLimit generoso porque 1 linha = 1 dia. */
async function daily({ startDate, endDate, dataState }) {
  const rows = await query({ startDate, endDate, dimensions: ['date'], rowLimit: 2000, dataState });
  return rows.map(r => ({
    date: r.keys[0],
    clicks: r.clicks || 0,
    impressions: r.impressions || 0,
    ctr: r.ctr || 0,
    position: r.position || 0,
  }));
}

/** Entidades (query|page|device|country) agregadas na janela. */
async function byDimension({ startDate, endDate, dimension, dataState, rowLimit }) {
  const rows = await query({
    startDate, endDate, dimensions: [dimension], dataState,
    rowLimit: rowLimit || MAX_ROWS,
  });
  return rows.map(r => ({
    key: r.keys[0],
    clicks: r.clicks || 0,
    impressions: r.impressions || 0,
    ctr: r.ctr || 0,
    position: r.position || 0,
  }));
}

/**
 * Último dia com dado FECHADO e último dia com QUALQUER dado.
 * A defasagem do GSC é de ~2 dias e varia; nunca assumir "ontem".
 */
async function freshness(hojeISO) {
  const end = hojeISO;
  const start = _shift(hojeISO, -14);
  const [fin, all] = await Promise.all([
    daily({ startDate: start, endDate: end, dataState: 'final' }),
    daily({ startDate: start, endDate: end, dataState: 'all' }),
  ]);
  const lastFinal = fin.length ? fin[fin.length - 1].date : null;
  const lastAny = all.length ? all[all.length - 1].date : null;
  return {
    ultimoFechado: lastFinal,
    ultimoQualquer: lastAny,
    defasagemDias: lastFinal ? Math.round((Date.parse(end) - Date.parse(lastFinal)) / 86400000) : null,
    diasParciais: (lastFinal && lastAny) ? Math.round((Date.parse(lastAny) - Date.parse(lastFinal)) / 86400000) : 0,
  };
}

function _shift(iso, days) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

module.exports = {
  isConfigured,
  siteUrl,
  serviceAccountEmail,
  getAccessToken,
  listSites,
  query,
  total,
  daily,
  byDimension,
  freshness,
  MAX_ROWS,
};
