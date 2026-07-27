'use strict';
/**
 * lib/prob-manual.js | Overrides MANUAIS de probabilidade por deal | fonte única.
 *
 * Força a P. Ajust. FINAL de deals específicos (decisão do dono): o valor substitui
 * o resultado do cálculo automático (régua/C07 + ajuste ±10% do AE) no ProbEngine —
 * vale para TODOS os painéis (Planilha, CRO, Board, Overall e Delta/servidor).
 *
 * Duas camadas:
 *   1. SEED versionado aqui (auditável no git: quem, quando, por quê). Funciona em
 *      produção sem depender de escrita no KV.
 *   2. KV (`forecast:prob_manual`, quando configurado) tem precedência por dealId e
 *      permite ajustar sem deploy via POST /api/prob-manual. Entrada com prob:null
 *      no KV REMOVE o override (inclusive o do seed).
 *
 * Chave = hs_id do deal (string). prob em fração 0..1.
 */
const kv = require('./kv');
const fs = require('fs');
const os = require('os');
const path = require('path');

const KV_KEY = 'forecast:prob_manual';
const TMP_FILE = path.join(os.tmpdir(), 'prob-manual.json');

// Decisões do dono em 2026-07-27 (sessão Forecast):
const SEED = {
  '62853528445': { prob: 0, by: 'Pacheco | 2026-07-27', note: 'DUX Company | P. Ajust. final forçada para 0%' },
  '52091223109': { prob: 0.10, by: 'Pacheco | 2026-07-27', note: 'Grupo Maringá | P. Ajust. final forçada para 10%' },
};

async function _readStored() {
  if (kv.isConfigured && kv.isConfigured()) {
    try { const v = await kv.getJSON(KV_KEY); if (v && typeof v === 'object') return v; } catch (e) { /* fallback */ }
  }
  try { const j = JSON.parse(fs.readFileSync(TMP_FILE, 'utf8')); if (j && typeof j === 'object') return j; } catch (e) { /* sem arquivo */ }
  return {};
}

async function _writeStored(map) {
  if (kv.isConfigured && kv.isConfigured()) { await kv.setJSON(KV_KEY, map); return 'kv'; }
  fs.writeFileSync(TMP_FILE, JSON.stringify(map));
  return 'tmp';
}

// Mapa efetivo: seed + KV (KV vence por dealId; prob null/inválida remove).
async function readAll() {
  const stored = await _readStored();
  const out = {};
  const put = (id, e) => {
    if (!e || typeof e !== 'object') return;
    const p = e.prob;
    if (p == null || isNaN(p) || p < 0 || p > 1) { delete out[id]; return; }
    out[id] = e;
  };
  Object.keys(SEED).forEach(id => put(id, SEED[id]));
  Object.keys(stored).forEach(id => put(id, stored[id]));
  return out;
}

// Upsert de UM deal na camada armazenada (KV/tmp). entry=null remove o registro
// armazenado (o seed volta a valer); {prob:null} grava tombstone que anula o seed.
async function writeOne(dealId, entry) {
  const stored = await _readStored();
  if (entry === null) delete stored[String(dealId)];
  else stored[String(dealId)] = entry;
  const where = await _writeStored(stored);
  return { where, stored };
}

module.exports = { readAll, writeOne, SEED, KV_KEY };
