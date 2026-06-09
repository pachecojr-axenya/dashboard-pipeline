'use strict';
/**
 * GET /api/settings  — retorna settings do usuário (persistidos em KV)
 * POST /api/settings — salva settings (apenas campos permitidos), per-user KV
 *
 * Tokens (HubSpot/Claude) vêm do env — nunca são persistidos nem retornados
 * em texto, só como status `[configurado]`. Preferências do usuário são
 * armazenadas em KV com chave `user:<email>:settings` quando KV está
 * configurado; caso contrário, o endpoint volta a ecoar (cliente usa
 * sessionStorage como fallback).
 */

const { setCORSHeaders, requireAuth, methodCheck } = require('./_helpers');
const kv = require('../lib/kv');

const ALLOWED_SETTINGS_KEYS = [
  'autoRefreshMinutes',
  'revenuePlan',
  'jarvisModel',
  'lastPull',
  'lastDealCount',
  'lastCSPull'
];
const DEFAULT_SETTINGS = {
  autoRefreshMinutes: 30,
  revenuePlan: 0,
  jarvisModel: null
};

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET', 'POST'])) return;

  const user = requireAuth(req, res);
  if (!user) return;

  const key = kv.userKey(user, 'settings');

  try {
    if (req.method === 'GET') {
      let persisted = {};
      if (kv.isConfigured()) {
        persisted = (await kv.getJSON(key)) || {};
      }
      return res.status(200).json({
        success: true,
        settings: {
          ...DEFAULT_SETTINGS,
          ...persisted,
          hubspotToken: process.env.HUBSPOT_TOKEN ? '[configurado]' : null,
          claudeApiKey: process.env.CLAUDE_API_KEY ? '[configurado]' : null
        }
      });
    }

    const { settings } = req.body || {};
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return res.status(400).json({ success: false, error: 'Settings inválido' });
    }

    const filtered = {};
    for (const k of ALLOWED_SETTINGS_KEYS) {
      if (settings[k] !== undefined) filtered[k] = settings[k];
    }

    if (kv.isConfigured()) {
      const existing = (await kv.getJSON(key)) || {};
      const merged = { ...existing, ...filtered };
      await kv.setJSON(key, merged);
      return res.status(200).json({ success: true, settings: merged });
    }
    return res.status(200).json({ success: true, settings: filtered, persisted: false });
  } catch (e) {
    console.error('[settings]', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};
