'use strict';
/**
 * GET  /api/bdr-metas   — retorna metas globais dos BDRs
 * POST /api/bdr-metas   — body: { metas: {name: goal} } — salva globalmente
 *
 * Persistência: /tmp/bdr-metas.json (Vercel Lambda; reseta se instância reciclar).
 * Fallback: defaults hardcoded (mesmos valores do settings-modal.js).
 */

const { setCORSHeaders, requireAuth, methodCheck } = require('./_helpers');
const fs = require('fs');

const DATA_FILE = '/tmp/bdr-metas.json';

const BDR_DEFAULTS = {
  'Anderson Souza':23,'Cintia Rodrigues':25,'Gabriele Almeida':23,
  'Priscilla Feliciello':23,'Letícia Romão':15,'Allan Valença':10,
  'Bruna Reis':7,'Emmanuelle Braga':10,'Felipe Andrade':10,
  'Giovana Nunes':10,'Marcelli Netto':10,'Thauan Pontes':10,'Yokyko Muramoto':10,
};

function readMetas() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return Object.assign({}, BDR_DEFAULTS, JSON.parse(raw));
  } catch (e) {
    return Object.assign({}, BDR_DEFAULTS);
  }
}

function writeMetas(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data), 'utf8');
}

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET', 'POST'])) return;
  const user = requireAuth(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    return res.status(200).json({ success: true, metas: readMetas() });
  }

  // POST
  const body = req.body || {};
  const metas = body.metas;
  if (!metas || typeof metas !== 'object' || Array.isArray(metas)) {
    return res.status(400).json({ success: false, error: 'metas deve ser um objeto {nome: meta}' });
  }
  try {
    writeMetas(metas);
    return res.status(200).json({ success: true, metas: readMetas() });
  } catch (e) {
    console.error('[bdr-metas] write error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};
