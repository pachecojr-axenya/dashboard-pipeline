'use strict';
/**
 * POST /api/auth/logout
 * Limpa o cookie de sessão (HttpOnly) expirando-o imediatamente.
 */

const { clearSessionCookieHeader } = require('../../lib/auth');
const { setCORSHeaders, methodCheck } = require('../_helpers');

module.exports = function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['POST'])) return;

  res.setHeader('Set-Cookie', clearSessionCookieHeader());
  return res.status(200).json({ success: true });
};
