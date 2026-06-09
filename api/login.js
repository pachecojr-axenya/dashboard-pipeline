'use strict';
/**
 * POST /api/login
 * Autentica usuário e retorna JWT.
 * Rate limiting: 5 tentativas por email, lockout 60s.
 *
 * FIXME(B01): Este endpoint está QUEBRADO. `attemptLogin` não existe em lib/auth.js.
 * O login por senha foi substituído pelo Google OAuth (api/auth/google.js).
 * Este arquivo é DEAD CODE e deve ser removido.
 * Se login por senha for necessário no futuro, reimplementar do zero com bcrypt/scrypt.
 */

const { attemptLogin } = require('../lib/auth');
const { setCORSHeaders, methodCheck } = require('./_helpers');

module.exports = function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['POST'])) return;

  const { email, password } = req.body || {};

  // Validação básica de input
  if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
    return res.status(400).json({ success: false, error: 'Email e senha são obrigatórios' });
  }

  // Sanitização básica (sem trim de password — pode ter espaços intencionais)
  if (email.length > 200 || password.length > 200) {
    return res.status(400).json({ success: false, error: 'Input inválido' });
  }

  const result = attemptLogin(email, password);

  if (result.success) {
    // Retorna JWT — o shim armazena em sessionStorage
    return res.status(200).json({
      success: true,
      user: result.user,
      token: result.token
    });
  }

  // Não revelar se o email existe ou não (mensagem genérica)
  return res.status(401).json({ success: false, error: result.error });
}
