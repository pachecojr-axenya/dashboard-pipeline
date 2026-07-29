'use strict';
/**
 * GET /api/cs-accounts
 * Base real de clientes para o CS Dashboard: empresas com kam_responsavel
 * (+ deals de vigência e mapa de owners). Reusa o pullCSData legado do
 * app Electron — mesma fonte, agora servida via web.
 * Cache em memória de 5 min: o pull completo leva ~6s no HubSpot.
 */

const { pullCSData } = require('../lib/hubspot');
const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');

const TTL_MS = 5 * 60 * 1000;
let _cache = null;
let _inflight = null;

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET'])) return;

  const user = requireAuth(req, res);
  if (!user) return;

  let token;
  try {
    token = getHubspotToken();
  } catch (e) {
    return res.status(503).json({ error: e.message });
  }

  if (_cache && Date.now() - _cache.ts < TTL_MS) {
    res.setHeader('X-CS-Cache', 'hit');
    return res.status(200).json(_cache.data);
  }

  try {
    if (!_inflight) {
      _inflight = pullCSData(token).finally(() => { _inflight = null; });
    }
    const data = await _inflight;
    _cache = { ts: Date.now(), data };
    res.setHeader('X-CS-Cache', 'miss');
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).json(data);
  } catch (e) {
    console.error('[cs-accounts] Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
