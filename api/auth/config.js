'use strict';
/**
 * GET /api/auth/config
 * Retorna o Google Client ID para o frontend inicializar o GIS.
 * O client_id NÃO é secret — é público por design (aparece no HTML do Google Sign-In).
 */

const { setCORSHeaders, methodCheck } = require('../_helpers');

module.exports = function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET'])) return;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(503).json({ error: 'GOOGLE_CLIENT_ID não configurado' });
  }

  return res.status(200).json({ clientId });
};
