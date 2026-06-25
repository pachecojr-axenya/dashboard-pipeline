'use strict';
/**
 * GET  /api/meta-receita — retorna a meta de receita ANUAL global (R$).
 * POST /api/meta-receita — body: { meta: number } — salva globalmente (todos os usuários).
 *
 * Persistência: Vercel KV (chave global `meta:receita_anual`) quando configurado
 * (KV_REST_API_URL / KV_REST_API_TOKEN) — durável e compartilhado entre todos.
 * Fallback: /tmp/meta-receita.json (per-instância, reseta no cold start/redeploy),
 * mesmo padrão do /api/bdr-metas. Default: R$ 1.150.000.
 */

const { setCORSHeaders, requireAuth, methodCheck } = require('./_helpers');
const kv = require('../lib/kv');
const fs = require('fs');
const os = require('os');
const path = require('path');

const KV_KEY      = 'meta:receita_anual';
const TMP_FILE    = path.join(os.tmpdir(), 'meta-receita.json'); // /tmp na Vercel; temp do SO local
const DEFAULT_META = 1150000;

async function readMeta() {
  if (kv.isConfigured()) {
    try {
      const v = await kv.getJSON(KV_KEY);
      if (v && typeof v.meta === 'number' && isFinite(v.meta)) return v.meta;
    } catch (e) { /* cai p/ fallback */ }
  }
  try {
    const j = JSON.parse(fs.readFileSync(TMP_FILE, 'utf8'));
    if (j && typeof j.meta === 'number' && isFinite(j.meta)) return j.meta;
  } catch (e) { /* sem arquivo */ }
  return DEFAULT_META;
}

async function writeMeta(meta) {
  if (kv.isConfigured()) {
    try { await kv.setJSON(KV_KEY, { meta: meta }); return; } catch (e) { /* cai p/ /tmp */ }
  }
  fs.writeFileSync(TMP_FILE, JSON.stringify({ meta: meta }), 'utf8');
}

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET', 'POST'])) return;

  const user = requireAuth(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    return res.status(200).json({ success: true, meta: await readMeta() });
  }

  // POST
  const body = req.body || {};
  const meta = Number(body.meta);
  if (!isFinite(meta) || meta < 0) {
    return res.status(400).json({ success: false, error: 'meta deve ser um número >= 0' });
  }
  try {
    await writeMeta(meta);
    return res.status(200).json({ success: true, meta: await readMeta() });
  } catch (e) {
    console.error('[meta-receita] write error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};
