'use strict';
/**
 * POST /api/auth/google
 * Recebe Google ID token, verifica server-side, retorna JWT de sessão.
 *
 * Body: { "credential": "<google_id_token>" }
 * Response: { success: true, user: {...}, token: "<jwt>" }
 */

const { verifyGoogleToken, buildSessionCookie } = require('../../lib/auth');
const { setCORSHeaders, methodCheck } = require('../_helpers');

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['POST'])) return;

  const { credential } = req.body || {};

  if (!credential || typeof credential !== 'string') {
    return res.status(400).json({ success: false, error: 'Google credential ausente' });
  }

  if (credential.length > 5000) {
    return res.status(400).json({ success: false, error: 'Token inválido' });
  }

  const result = await verifyGoogleToken(credential);

  if (result.success) {
    res.setHeader('Set-Cookie', buildSessionCookie(result.token));
    return res.status(200).json({
      success: true,
      user: result.user
    });
  }

  return res.status(401).json({ success: false, error: result.error });
};
