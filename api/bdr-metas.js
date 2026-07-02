'use strict';
/**
 * GET  /api/bdr-metas   — retorna metas globais dos BDRs
 *   { success, metas: {nome: meta}, monthly: {"2026-07": {nome: meta}} }
 *   metas   = formato legado (meta mensal única por BDR) — fallback dos meses sem meta mensal.
 *   monthly = metas POR MÊS por BDR (modal "Metas" do painel BDR, 2026-07-02).
 * POST /api/bdr-metas   — body: { metas?: {nome: meta}, monthly?: {ym: {nome: meta}} }
 *   Salva o que vier (merge por chave de mês); ausentes ficam como estão.
 *
 * Persistência: Upstash KV (Regra do projeto: dado editável global vive no KV).
 * Fallback quando KV não configurado (dev local): /tmp/bdr-metas.json (efêmero).
 */

const { setCORSHeaders, requireAuth, methodCheck } = require('./_helpers');
const kv = require('../lib/kv');
const fs = require('fs');

const KV_KEY = 'bdr:metas';
// os.tmpdir() = /tmp no Lambda e %TEMP% no Windows (dev local).
const TMP_FILE = require('path').join(require('os').tmpdir(), 'bdr-metas.json');

// Grafias = EXATAMENTE as da BDR_LIST (public/settings-modal.js) — o lookup do front é por
// nome canônico do drawer. (Corrigido 2026-07-02: 'Letícia'→'Leticia', 'Emmanuelle'→'Emanuelle'.)
const BDR_DEFAULTS = {
  'Anderson Souza':23,'Cintia Rodrigues':25,'Gabriele Almeida':23,
  'Priscilla Feliciello':23,'Leticia Romão':15,'Allan Valença':10,
  'Bruna Reis':7,'Emanuelle Braga':10,'Felipe Andrade':10,
  'Giovana Nunes':10,'Marcelli Netto':10,'Thauan Pontes':10,'Yokyko Muramoto':10,
};

// Estado = { metas: {nome: meta}, monthly: {ym: {nome: meta}} }
async function readState() {
  let raw = null;
  if (kv.isConfigured()) {
    try { raw = await kv.getJSON(KV_KEY); } catch (e) { console.error('[bdr-metas] kv get:', e.message); }
  }
  if (!raw) {
    try { raw = JSON.parse(fs.readFileSync(TMP_FILE, 'utf8')); } catch (e) { raw = null; }
  }
  // Formato antigo no /tmp era o objeto flat {nome: meta} direto — migra para {metas, monthly}.
  if (raw && !raw.metas && !raw.monthly) raw = { metas: raw, monthly: {} };
  const state = raw || { metas: {}, monthly: {} };
  state.metas = Object.assign({}, BDR_DEFAULTS, state.metas || {});
  state.monthly = state.monthly || {};
  return state;
}

async function writeState(state) {
  if (kv.isConfigured()) { await kv.setJSON(KV_KEY, state); return; }
  fs.writeFileSync(TMP_FILE, JSON.stringify(state), 'utf8');
}

function _validGoals(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  return Object.values(obj).every(v => typeof v === 'number' && isFinite(v) && v >= 0);
}

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET', 'POST'])) return;
  const user = requireAuth(req, res);
  if (!user) return;

  try {
    const state = await readState();

    if (req.method === 'GET') {
      return res.status(200).json({ success: true, metas: state.metas, monthly: state.monthly });
    }

    // POST — merge do que vier
    const body = req.body || {};
    if (body.metas !== undefined) {
      if (!_validGoals(body.metas)) return res.status(400).json({ success: false, error: 'metas deve ser {nome: número ≥ 0}' });
      state.metas = Object.assign({}, BDR_DEFAULTS, body.metas);
    }
    if (body.monthly !== undefined) {
      if (!body.monthly || typeof body.monthly !== 'object' || Array.isArray(body.monthly)) {
        return res.status(400).json({ success: false, error: 'monthly deve ser {"YYYY-MM": {nome: número}}' });
      }
      for (const ym of Object.keys(body.monthly)) {
        if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ success: false, error: 'chave de mês inválida: ' + ym });
        if (!_validGoals(body.monthly[ym])) return res.status(400).json({ success: false, error: 'metas do mês ' + ym + ' devem ser {nome: número ≥ 0}' });
        // merge por mês: sobrescreve o mês inteiro enviado (o modal envia o mês completo)
        state.monthly[ym] = body.monthly[ym];
      }
    }
    await writeState(state);
    return res.status(200).json({ success: true, metas: state.metas, monthly: state.monthly });
  } catch (e) {
    console.error('[bdr-metas]', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};
