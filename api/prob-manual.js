'use strict';
/**
 * GET  /api/prob-manual — mapa efetivo de overrides de probabilidade por deal
 *      (seed versionado em lib/prob-manual.js + KV por cima). Consumido pelo
 *      prob-engine.js no browser (autoload) — a P. Ajust. final desses deals é
 *      substituída pelo valor forçado em TODOS os painéis.
 * POST /api/prob-manual — upsert de UM deal na camada KV:
 *      body: { dealId: string, prob: number 0..1 | null, note?: string }
 *      prob null → remove/anula o override (inclusive o do seed).
 *
 * Mesmo padrão de persistência do /api/faturamento-manual (KV; fallback /tmp local).
 */
const { setCORSHeaders, requireAuth } = require('./_helpers');
const PM = require('../lib/prob-manual');

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!requireAuth(req, res)) return;

  try {
    if (req.method === 'GET') {
      const map = await PM.readAll();
      return res.status(200).json({ success: true, map });
    }
    if (req.method === 'POST') {
      const b = req.body || {};
      const dealId = b.dealId != null ? String(b.dealId) : '';
      if (!dealId) return res.status(400).json({ success: false, error: 'informe dealId' });
      let entry = null;
      if (b.prob != null) {
        const p = Number(b.prob);
        if (isNaN(p) || p < 0 || p > 1) return res.status(400).json({ success: false, error: 'prob deve estar entre 0 e 1' });
        entry = { prob: p, note: b.note ? String(b.note).slice(0, 200) : undefined, at: new Date().toISOString().slice(0, 10) };
      } else {
        entry = { prob: null, at: new Date().toISOString().slice(0, 10) }; // tombstone: anula seed
      }
      const r = await PM.writeOne(dealId, entry);
      const map = await PM.readAll();
      return res.status(200).json({ success: true, persisted: r.where, map });
    }
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  } catch (e) {
    console.error('[prob-manual]', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};
