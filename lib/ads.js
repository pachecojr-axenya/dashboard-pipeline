'use strict';
/**
 * lib/ads.js — Clientes de mídia paga (Meta Ads + LinkedIn Ads).
 *
 * Entrega spend na granularidade ATÔMICA de dia × campanha. Semana e mês são
 * derivados no consumidor (api/growth-performance.js) — nunca puxamos "o mês"
 * como um número fechado, porque isso impede o corte por dia/semana e esconde
 * campanha.
 *
 * Zero deps (regra do repo: nada de npm).
 *
 * Env vars:
 *   META_ADS_TOKEN            — token de long-lived user com ads_read
 *   META_AD_ACCOUNT_ID        — ex.: act_1348847725589056
 *   LINKEDIN_AD_ACCOUNT_ID    — ex.: 518843783 (só o número, sem urn)
 *   LINKEDIN_CLIENT_ID        — app OAuth
 *   LINKEDIN_CLIENT_SECRET    — app OAuth
 *   LINKEDIN_REFRESH_TOKEN    — refresh token (validade ~1 ano)
 *   LINKEDIN_ACCESS_TOKEN     — opcional, bootstrap; expira em 60 dias
 *
 * Gotchas medidos em 2026-08-06 (não regredir):
 *  - LinkedIn exige header `LinkedIn-Version: 202503`. Versões 202406+ devolvem
 *    426 NONEXISTENT_VERSION.
 *  - `dateRange` do LinkedIn é objeto REST.li literal na querystring, NÃO JSON:
 *    (start:(year:2026,month:7,day:1),end:(...)). Fim é INCLUSIVO.
 *  - Nome de campanha do LinkedIn NÃO pode ser buscado em /rest/adCampaigns
 *    (400: "modified to include advertiser account id in the url path"). O
 *    caminho válido é /rest/adAccounts/{id}/adCampaigns?ids=List(123,456) — e os
 *    ids são NUMÉRICOS, não URNs (URN devolve NumberFormatException).
 *  - O access token do LinkedIn expira em 60 dias. Aqui ele se renova sozinho no
 *    401 EXPIRED_ACCESS_TOKEN e o novo valor fica em cache no KV, senão o painel
 *    quebraria silenciosamente a cada 2 meses.
 *  - Meta pagina /insights; sem seguir paging.next o mês vem truncado.
 *  - Campanha PAUSED continua acumulando spend residual — nunca tratar
 *    "pausado" como R$ 0.
 */

const kv = require('./kv');
const env = require('./env');

const META_API = 'https://graph.facebook.com/v20.0';
const LI_API = 'https://api.linkedin.com/rest';
const LI_VERSION = '202503';
const TIMEOUT_MS = 25_000;

// ── HTTP -----------------------------------------------------------------

async function _fetchJSON(url, options = {}, label = 'ads') {
  const res = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* corpo não-JSON */ }
  if (!res.ok) {
    const err = new Error(`${label} HTTP ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

function _requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} não configurado nas variáveis de ambiente do Vercel.`);
  return v;
}

/** Datas no formato YYYY-MM-DD -> partes numéricas. */
function _parts(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) throw new Error(`Data inválida (esperado YYYY-MM-DD): ${iso}`);
  return { year: +m[1], month: +m[2], day: +m[3] };
}

// ── META ----------------------------------------------------------------

/**
 * Spend Meta por dia × campanha.
 * @returns {Promise<{rows: Array, currency: string|null}>}
 *   rows: [{ channel:'Meta', date, campaignId, campaignName, spend, impressions, clicks }]
 */
async function metaSpend({ from, to }) {
  const token = _requireEnv('META_ADS_TOKEN');
  const account = _requireEnv('META_AD_ACCOUNT_ID');
  _parts(from); _parts(to);

  const qs = new URLSearchParams({
    level: 'campaign',
    time_increment: '1',
    time_range: JSON.stringify({ since: from, until: to }),
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,account_currency',
    limit: '500',
    access_token: token,
  });

  const rows = [];
  let currency = null;
  let url = `${META_API}/${account}/insights?${qs.toString()}`;
  let guard = 0;
  while (url && guard++ < 40) {
    const page = await _fetchJSON(url, {}, 'Meta Ads');
    for (const r of page.data || []) {
      currency = currency || r.account_currency || null;
      rows.push({
        channel: 'Meta',
        date: r.date_start,
        campaignId: r.campaign_id || '',
        campaignName: r.campaign_name || '(sem nome)',
        spend: Number(r.spend || 0),
        impressions: Number(r.impressions || 0),
        clicks: Number(r.clicks || 0),
      });
    }
    url = page.paging && page.paging.next ? page.paging.next : null;
  }
  return { rows, currency };
}

// ── LINKEDIN ------------------------------------------------------------

const LI_TOKEN_KEY = () => env.kvKey('growth:linkedin_access_token');

async function _liCachedToken() {
  if (kv.isConfigured()) {
    try {
      const c = await kv.getJSON(LI_TOKEN_KEY());
      if (c && c.accessToken) return c.accessToken;
    } catch { /* KV indisponível não pode derrubar o painel */ }
  }
  return process.env.LINKEDIN_ACCESS_TOKEN || null;
}

/**
 * Troca o refresh token por um access token novo (60 dias) e guarda no KV.
 * O refresh token do LinkedIn vale ~1 ano e é rotacionado na resposta; como não
 * temos escrita em Secret Manager daqui, o rotacionado vai para o KV e o env
 * segue como fallback de bootstrap.
 */
async function _liRefreshToken() {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: _requireEnv('LINKEDIN_REFRESH_TOKEN'),
    client_id: _requireEnv('LINKEDIN_CLIENT_ID'),
    client_secret: _requireEnv('LINKEDIN_CLIENT_SECRET'),
  });
  const j = await _fetchJSON('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  }, 'LinkedIn OAuth');
  if (!j || !j.access_token) throw new Error('LinkedIn OAuth não devolveu access_token.');
  if (kv.isConfigured()) {
    try {
      await kv.setJSON(LI_TOKEN_KEY(), {
        accessToken: j.access_token,
        expiresIn: j.expires_in || null,
        savedAt: new Date().toISOString(),
      });
    } catch { /* segue com o token em memória */ }
  }
  return j.access_token;
}

function _liHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'LinkedIn-Version': LI_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
  };
}

function _isExpiredToken(err) {
  if (!err || err.status !== 401) return false;
  const code = err.body && (err.body.serviceErrorCode || err.body.code);
  return code === 65602 || code === 'EXPIRED_ACCESS_TOKEN' || /expired/i.test(err.message);
}

/** GET no LinkedIn com refresh automático de token no 401. */
async function _liGet(path, label) {
  let token = await _liCachedToken();
  if (!token) token = await _liRefreshToken();
  try {
    return await _fetchJSON(`${LI_API}${path}`, { headers: _liHeaders(token) }, label);
  } catch (e) {
    if (!_isExpiredToken(e)) throw e;
    const fresh = await _liRefreshToken();
    return await _fetchJSON(`${LI_API}${path}`, { headers: _liHeaders(fresh) }, `${label} (pós-refresh)`);
  }
}

/** Nomes das campanhas por id numérico (batch de 40). */
async function _liCampaignNames(ids) {
  const account = _requireEnv('LINKEDIN_AD_ACCOUNT_ID');
  const names = {};
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40);
    try {
      const j = await _liGet(
        `/adAccounts/${encodeURIComponent(account)}/adCampaigns?ids=List(${chunk.join(',')})`,
        'LinkedIn adCampaigns'
      );
      for (const [k, v] of Object.entries((j && j.results) || {})) {
        names[String(k)] = (v && v.name) || '';
      }
    } catch { /* nome é enfeite: sem ele a campanha aparece pelo id */ }
  }
  return names;
}

/**
 * Spend LinkedIn por dia × campanha.
 * @returns {Promise<{rows: Array, currency: string|null}>}
 */
async function linkedinSpend({ from, to }) {
  const account = _requireEnv('LINKEDIN_AD_ACCOUNT_ID');
  const a = _parts(from), b = _parts(to);
  const dateRange = `(start:(year:${a.year},month:${a.month},day:${a.day}),`
    + `end:(year:${b.year},month:${b.month},day:${b.day}))`;
  const path = `/adAnalytics?q=analytics`
    + `&dateRange=${dateRange}`
    + `&timeGranularity=DAILY&pivot=CAMPAIGN`
    + `&accounts=List(${encodeURIComponent(`urn:li:sponsoredAccount:${account}`)})`
    + `&fields=costInLocalCurrency,impressions,clicks,pivotValues,dateRange`;

  const j = await _liGet(path, 'LinkedIn adAnalytics');
  const elements = (j && j.elements) || [];

  const ids = [...new Set(elements.flatMap(e =>
    (e.pivotValues || []).map(p => String(p).split(':').pop())
  ))].filter(Boolean);
  const names = ids.length ? await _liCampaignNames(ids) : {};

  const rows = elements.map(e => {
    const s = (e.dateRange && e.dateRange.start) || {};
    const id = String((e.pivotValues || [])[0] || '').split(':').pop() || '';
    const date = (s.year && s.month && s.day)
      ? `${s.year}-${String(s.month).padStart(2, '0')}-${String(s.day).padStart(2, '0')}`
      : null;
    return {
      channel: 'LinkedIn',
      date,
      campaignId: id,
      campaignName: names[id] || (id ? `Campanha ${id}` : '(sem nome)'),
      spend: Number(e.costInLocalCurrency || 0),
      impressions: Number(e.impressions || 0),
      clicks: Number(e.clicks || 0),
    };
  }).filter(r => r.date);

  return { rows, currency: null };
}

/**
 * Spend consolidado dos canais conectados.
 * Falha de um canal NÃO derruba o outro — vira entrada em `errors`, para a UI
 * poder dizer "LinkedIn indisponível" em vez de mostrar R$ 0 mentindo.
 */
async function fetchSpend({ from, to }) {
  const out = { rows: [], errors: [], channels: [] };
  const jobs = [
    ['Meta', metaSpend],
    ['LinkedIn', linkedinSpend],
  ];
  const settled = await Promise.allSettled(jobs.map(([, fn]) => fn({ from, to })));
  settled.forEach((r, i) => {
    const channel = jobs[i][0];
    if (r.status === 'fulfilled') {
      out.rows.push(...r.value.rows);
      out.channels.push(channel);
    } else {
      out.errors.push({ channel, error: String(r.reason && r.reason.message || r.reason).slice(0, 300) });
    }
  });
  return out;
}

module.exports = { fetchSpend, metaSpend, linkedinSpend };
