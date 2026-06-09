'use strict';
/**
 * GET /api/auth/me
 * Retorna o usuário da sessão atual (cookie HttpOnly). 401 se não autenticado.
 * Usado pelo frontend para checar "já estou logado?" sem reprompt do Google.
 */

const { verifyRequest } = require('../../lib/auth');
const { setCORSHeaders, methodCheck } = require('../_helpers');

module.exports = function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET'])) return;

  // Bypass para desenvolvimento local
  if (process.env.LOCAL_DEV_BYPASS === 'true') {
    return res.status(200).json({
      success: true,
      user: { name: 'Dev Local', email: 'dev@axenya.com', role: 'staff', picture: null }
    });
  }

  const payload = verifyRequest(req);
  if (!payload) {
    return res.status(401).json({ success: false, error: 'Não autenticado' });
  }

  return res.status(200).json({
    success: true,
    user: {
      name: payload.name,
      email: payload.email,
      role: payload.role,
      picture: payload.picture || null
    }
  });
};
