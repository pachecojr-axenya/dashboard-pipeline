'use strict';
/**
 * /api/user-state — generic per-user JSON key/value store.
 *
 *   GET  /api/user-state?key=<ns>            → { success, value }
 *   POST /api/user-state { key, value }      → { success, value }
 *   POST /api/user-state { action: "reset" } → { success, cleared: [keys...] }
 *
 * Used for buckets that were client-only (jarvis chat history, KPI snapshots,
 * AI analysis cache, dashboard layout, etc.). Server namespaces each entry as
 * `user:<email>:<key>`. Keys are restricted to a known allow-list.
 *
 * Returns 503 when KV isn't configured so the client falls back to
 * sessionStorage seamlessly.
 */

const { setCORSHeaders, requireAuth, methodCheck } = require('./_helpers');
const kv = require('../lib/kv');

const ALLOWED_KEYS = [
  'jarvis-history',
  'kpi-snapshots',
  'ai-cache',
  'dashboard-layout'
];
const MAX_BYTES = 256_000;

function validateKey(k) {
  if (typeof k !== 'string') return 'key must be a string';
  if (!ALLOWED_KEYS.includes(k)) return `key must be one of: ${ALLOWED_KEYS.join(', ')}`;
  return null;
}

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET', 'POST'])) return;
  const user = requireAuth(req, res);
  if (!user) return;

  if (!kv.isConfigured()) {
    return res.status(503).json({
      success: false,
      error: 'KV não configurado. Cliente usará fallback local.'
    });
  }

  try {
    if (req.method === 'GET') {
      const rawKey = req.query && req.query.key;
      const err = validateKey(rawKey);
      if (err) return res.status(400).json({ success: false, error: err });
      const value = await kv.getJSON(kv.userKey(user, rawKey));
      return res.status(200).json({ success: true, value: value == null ? null : value });
    }

    const body = req.body || {};

    if (body.action === 'reset') {
      const cleared = [];
      for (const k of ALLOWED_KEYS) {
        await kv.delKey(kv.userKey(user, k));
        cleared.push(k);
      }
      await kv.delKey(kv.userKey(user, 'settings'));
      cleared.push('settings');
      await kv.delKey(kv.userKey(user, 'jarvis-viz'));
      cleared.push('jarvis-viz');
      return res.status(200).json({ success: true, cleared });
    }

    const { key, value } = body;
    const err = validateKey(key);
    if (err) return res.status(400).json({ success: false, error: err });
    if (value === undefined) {
      return res.status(400).json({ success: false, error: 'value is required (pass null to clear)' });
    }
    const serialized = JSON.stringify(value);
    if (serialized.length > MAX_BYTES) {
      return res.status(413).json({ success: false, error: `value excede ${MAX_BYTES} bytes` });
    }
    if (value === null) {
      await kv.delKey(kv.userKey(user, key));
      return res.status(200).json({ success: true, value: null });
    }
    await kv.setJSON(kv.userKey(user, key), value);
    return res.status(200).json({ success: true, value });
  } catch (e) {
    console.error('[user-state]', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};
