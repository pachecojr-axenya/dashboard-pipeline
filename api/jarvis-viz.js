'use strict';
/**
 * /api/jarvis-viz  (PER-USER)
 *
 *   GET                              → { success, charts: [spec...] }
 *   POST { action: "save",   spec }  → { success, spec }   (upsert by spec.id)
 *   POST { action: "delete", id }    → { success }
 *
 * Per-user store for saved Jarvis chart specs. KV-backed; 503 if KV missing
 * so the client can fall back to sessionStorage.
 */

const { setCORSHeaders, requireAuth, methodCheck } = require('./_helpers');
const kv = require('../lib/kv');

const MAX_SPEC_BYTES = 32_000;   // per-spec cap
const MAX_SPECS      = 200;

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET', 'POST'])) return;
  const user = requireAuth(req, res);
  if (!user) return;

  if (!kv.isConfigured()) {
    return res.status(503).json({
      success: false,
      error: 'KV não configurado (KV_REST_API_URL/KV_REST_API_TOKEN ausentes). Client usará fallback local.'
    });
  }

  const key = kv.userKey(user, 'jarvis-viz');

  try {
    if (req.method === 'GET') {
      const list = (await kv.getJSON(key)) || [];
      return res.status(200).json({ success: true, charts: Array.isArray(list) ? list : [] });
    }

    const { action, spec, id } = req.body || {};

    if (action === 'save') {
      if (!spec || typeof spec !== 'object' || typeof spec.id !== 'string' || !spec.id.trim()) {
        return res.status(400).json({ success: false, error: 'spec.id (string) required' });
      }
      const serialized = JSON.stringify(spec);
      if (serialized.length > MAX_SPEC_BYTES) {
        return res.status(413).json({ success: false, error: `spec excede ${MAX_SPEC_BYTES} bytes` });
      }
      const entry = {
        ...spec,
        savedAt: new Date().toISOString(),
        savedBy: user.email || 'unknown'
      };
      const list = (await kv.getJSON(key)) || [];
      const arr = Array.isArray(list) ? list : [];
      const i = arr.findIndex(x => x && x.id === spec.id);
      if (i >= 0) arr[i] = entry;
      else arr.push(entry);
      if (arr.length > MAX_SPECS) arr.splice(0, arr.length - MAX_SPECS);
      await kv.setJSON(key, arr);
      return res.status(200).json({ success: true, spec: entry });
    }

    if (action === 'delete') {
      if (!id || typeof id !== 'string') {
        return res.status(400).json({ success: false, error: 'id (string) required' });
      }
      const list = (await kv.getJSON(key)) || [];
      const arr = Array.isArray(list) ? list : [];
      const next = arr.filter(x => x && x.id !== id);
      await kv.setJSON(key, next);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ success: false, error: 'action deve ser "save" ou "delete"' });
  } catch (e) {
    console.error('[jarvis-viz]', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};
