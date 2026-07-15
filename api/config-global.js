'use strict';
/**
 * GET  /api/config-global — configuração GLOBAL do dashboard (todos os usuários).
 * POST /api/config-global — atualiza; body: { prob_fonte?, etapas_ativas? }.
 *
 * Fase 4b do Dashboard 2.0 (ADR-007 + ADR-008, decisões do dono em 2026-07-15):
 *  - prob_fonte: 'calculada' (C07 do funil, com fallback na régua única) | 'premissas'
 *    (régua única direto). Default 'calculada' = comportamento atual de CRO/Board.
 *    O grupo Forecast IGNORA este toggle na v1 (D1).
 *  - etapas_ativas: { <stage_id>: bool } — override do filtro de deals ativos
 *    (ADR-007; ex.: tirar Reunião Agendada do pipe ativo). Vazio = comportamento atual.
 *
 * Persistência: KV global (D3) na chave `forecast:config_global`, com metadados
 * ADR-004 (quem/quando/anterior). Fallback /tmp como nos irmãos (meta-receita).
 */

const { setCORSHeaders, requireAuth, methodCheck } = require('./_helpers');
const kv = require('../lib/kv');
const fs = require('fs');
const os = require('os');
const path = require('path');

const KV_KEY   = 'forecast:config_global';
const TMP_FILE = path.join(os.tmpdir(), 'config-global.json');

const PROB_FONTES = ['calculada', 'premissas'];
const DEFAULTS = { prob_fonte: 'calculada', etapas_ativas: {} };

async function readCfg() {
  if (kv.isConfigured()) {
    try {
      const v = await kv.getJSON(KV_KEY);
      if (v && typeof v === 'object') return v;
    } catch (e) { /* fallback */ }
  }
  try {
    const j = JSON.parse(fs.readFileSync(TMP_FILE, 'utf8'));
    if (j && typeof j === 'object') return j;
  } catch (e) { /* sem arquivo */ }
  return {};
}

async function writeCfg(obj) {
  if (kv.isConfigured()) {
    try { await kv.setJSON(KV_KEY, obj); return; } catch (e) { /* fallback */ }
  }
  fs.writeFileSync(TMP_FILE, JSON.stringify(obj), 'utf8');
}

// Config efetiva = defaults + persistido (aditivo; chaves desconhecidas ignoradas).
function effective(raw) {
  const out = { ...DEFAULTS };
  if (raw && PROB_FONTES.includes(raw.prob_fonte)) out.prob_fonte = raw.prob_fonte;
  if (raw && raw.etapas_ativas && typeof raw.etapas_ativas === 'object') {
    const ea = {};
    for (const k of Object.keys(raw.etapas_ativas)) {
      if (/^\d{10}$/.test(k) && typeof raw.etapas_ativas[k] === 'boolean') ea[k] = raw.etapas_ativas[k];
    }
    out.etapas_ativas = ea;
  }
  return out;
}

async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET', 'POST'])) return;

  const user = requireAuth(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    const raw = await readCfg();
    return res.status(200).json({ success: true, config: effective(raw), meta: raw.meta || null });
  }

  try {
    const body = req.body || {};
    const raw = await readCfg();
    const anterior = effective(raw);

    if ('prob_fonte' in body) {
      if (!PROB_FONTES.includes(body.prob_fonte)) {
        return res.status(400).json({ success: false, error: 'prob_fonte inválida (calculada|premissas)' });
      }
      raw.prob_fonte = body.prob_fonte;
    }
    if ('etapas_ativas' in body && body.etapas_ativas && typeof body.etapas_ativas === 'object') {
      raw.etapas_ativas = { ...(raw.etapas_ativas || {}) };
      for (const k of Object.keys(body.etapas_ativas)) {
        if (!/^\d{10}$/.test(k)) continue;
        if (body.etapas_ativas[k] === null) delete raw.etapas_ativas[k];  // volta ao default
        else raw.etapas_ativas[k] = !!body.etapas_ativas[k];
      }
    }

    raw.meta = {
      em: new Date().toISOString(),
      por: (user && (user.email || user.name)) || 'desconhecido',
      anterior,
    };

    await writeCfg(raw);
    return res.status(200).json({ success: true, config: effective(raw), meta: raw.meta });
  } catch (e) {
    console.error('[config-global] write error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
}

// readCfg/effective exportados para consumidores server-side (ex.: forecast-table
// aplica etapas_ativas) usarem a MESMA cadeia de leitura KV → /tmp deste endpoint.
module.exports = handler;
module.exports.readCfg = readCfg;
module.exports.effective = effective;
