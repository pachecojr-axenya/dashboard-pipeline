'use strict';
/**
 * auth.js — Autenticação via Google OAuth + JWT session (zero dependências externas)
 *
 * Fluxo:
 * 1. Frontend usa Google Identity Services (GIS) para obter ID token
 * 2. POST /api/auth/google envia o ID token
 * 3. Backend verifica o ID token com Google (fetch tokeninfo)
 * 4. Valida domínio @axenya.com
 * 5. Emite JWT de sessão (HMAC-SHA256, 48h)
 *
 * Segurança:
 * - ID token verificado server-side contra Google tokeninfo endpoint
 * - Domínio restrito a @axenya.com (hd claim) + whitelist via ALLOWED_EMAILS
 * - JWT assinado com HMAC-SHA256 usando SESSION_SECRET
 * - Zero dependências externas
 */

const crypto = require('crypto');

// ===== DOMÍNIO PERMITIDO =====
const ALLOWED_DOMAIN = 'axenya.com'; // usado apenas para definir o papel (staff x guest), NÃO para liberar acesso

// ===== LISTA DE E-MAILS AUTORIZADOS =====
// SOMENTE os e-mails abaixo (ou os de ALLOWED_EMAILS) podem acessar o dashboard.
// Edite esta lista para liberar/remover pessoas — vale para @axenya.com E para externos.
// Em produção também é possível adicionar via env var ALLOWED_EMAILS (separada por vírgula),
// sem editar o código: ALLOWED_EMAILS=fulano@axenya.com,parceiro@empresa.com
const AUTHORIZED_EMAILS = [
  'jpacheco@axenya.com', 'i@axenya.com', 'a@axenya.com', 'arodrigues@axenya.com', 'cintia@axenya.com'
  // 'outra.pessoa@axenya.com',
  // 'parceiro@empresa.com',
];

// Une a lista do arquivo com a env var ALLOWED_EMAILS (ambas normalizadas, sem duplicatas).
function getAllowedEmails() {
  const raw = process.env.ALLOWED_EMAILS || '';
  const fromEnv = raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  const fromFile = AUTHORIZED_EMAILS.map(e => e.trim().toLowerCase()).filter(Boolean);
  return Array.from(new Set(fromFile.concat(fromEnv)));
}

// Único ponto de decisão de acesso: o e-mail precisa estar na lista autorizada.
function isEmailAuthorized(email) {
  return getAllowedEmails().indexOf((email || '').toLowerCase()) !== -1;
}

// ===== JWT (HMAC-SHA256 manual — zero supply chain risk) =====

function base64urlEncode(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET não configurado ou muito curto (mínimo 32 chars)');
  }
  return secret;
}

// ===== SESSION COOKIE =====
const SESSION_COOKIE_NAME = 'axenya_session';
const SESSION_TTL_SECONDS = 30 * 24 * 3600; // 30 dias

/**
 * Cria um JWT assinado com HMAC-SHA256.
 * @param {object} payload
 * @param {number} expiresInSeconds - padrão 30 dias
 */
function createToken(payload, expiresInSeconds = SESSION_TTL_SECONDS) {
  const secret = getSecret();
  const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const claims = { ...payload, iat: now, exp: now + expiresInSeconds };
  const body = base64urlEncode(JSON.stringify(claims));
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest();
  return `${header}.${body}.${base64urlEncode(sig)}`;
}

/**
 * Verifica e decodifica um JWT.
 * @param {string} token
 * @returns {object|null} payload ou null se inválido/expirado
 */
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const secret = getSecret();
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(`${parts[0]}.${parts[1]}`)
      .digest();
    const actualSig = base64urlDecode(parts[2]);

    if (expectedSig.length !== actualSig.length) return null;
    if (!crypto.timingSafeEqual(expectedSig, actualSig)) return null;

    const payload = JSON.parse(base64urlDecode(parts[1]).toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Extrai o cookie de sessão do header Cookie.
 * @param {object} req
 * @returns {string|null}
 */
function getSessionCookie(req) {
  const raw = req.headers && req.headers.cookie;
  if (!raw) return null;
  const parts = raw.split(';');
  for (let i = 0; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq < 0) continue;
    const name = parts[i].slice(0, eq).trim();
    if (name === SESSION_COOKIE_NAME) {
      return decodeURIComponent(parts[i].slice(eq + 1).trim());
    }
  }
  return null;
}

/**
 * Extrai e verifica o token. Tenta primeiro o cookie HttpOnly; cai para Authorization header
 * (compatibilidade com clientes antigos que ainda mandam Bearer).
 * @param {object} req
 * @returns {object|null}
 */
function verifyRequest(req) {
  const cookieToken = getSessionCookie(req);
  if (cookieToken) {
    const p = verifyToken(cookieToken);
    if (p) return p;
  }
  const auth = (req.headers && req.headers['authorization']) || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  return verifyToken(bearer);
}

/**
 * Monta o header Set-Cookie para emitir a sessão.
 * HttpOnly (sem acesso JS), Secure (HTTPS), SameSite=Lax (cross-site seguro),
 * Path=/ (todas as rotas), Max-Age = TTL.
 */
function buildSessionCookie(token, ttlSeconds = SESSION_TTL_SECONDS) {
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${ttlSeconds}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax'
  ].join('; ');
}

/** Retorna um Set-Cookie que expira imediatamente (logout). */
function clearSessionCookieHeader() {
  return [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'Secure',
    'SameSite=Lax'
  ].join('; ');
}

// ===== GOOGLE ID TOKEN VERIFICATION =====

/**
 * Verifica um Google ID token server-side.
 * Usa o endpoint tokeninfo do Google (sem dependência de biblioteca).
 *
 * @param {string} idToken - ID token do Google Identity Services
 * @returns {Promise<{success: boolean, user?: object, error?: string}>}
 */
async function verifyGoogleToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    return { success: false, error: 'ID token ausente' };
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return { success: false, error: 'GOOGLE_CLIENT_ID não configurado' };
  }

  try {
    // Verificar o ID token com Google
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
      { signal: AbortSignal.timeout(10000) }
    );

    if (!res.ok) {
      return { success: false, error: 'Token inválido ou expirado' };
    }

    const payload = await res.json();

    // Verificar audience (deve ser nosso client_id)
    if (payload.aud !== clientId) {
      console.error(`[GOOGLE AUTH] aud mismatch: ${payload.aud} !== ${clientId}`);
      return { success: false, error: 'Token não pertence a esta aplicação' };
    }

    // Acesso restrito: o e-mail precisa estar na lista de autorizados (arquivo + ALLOWED_EMAILS)
    const email = (payload.email || '').toLowerCase();
    if (!isEmailAuthorized(email)) {
      console.warn(`[GOOGLE AUTH] Acesso negado: ${email} não está na lista de autorizados`);
      return { success: false, error: 'Acesso não autorizado para este email' };
    }

    // Verificar que o email foi verificado pelo Google
    if (payload.email_verified !== 'true' && payload.email_verified !== true) {
      return { success: false, error: 'Email não verificado pelo Google' };
    }

    // Extrair dados do usuário
    const user = {
      name: payload.name || email.split('@')[0],
      email: email,
      picture: payload.picture || null,
      role: email.endsWith(`@${ALLOWED_DOMAIN}`) ? 'staff' : 'guest'
    };

    // Emitir JWT de sessão
    const sessionToken = createToken({
      name: user.name,
      email: user.email,
      role: user.role,
      picture: user.picture
    });

    console.log(`[GOOGLE AUTH] ${user.name} (${user.email}) autenticado via Google`);

    return { success: true, user, token: sessionToken };

  } catch (e) {
    console.error('[GOOGLE AUTH] Erro ao verificar token:', e.message);
    return { success: false, error: 'Erro ao verificar autenticação com Google' };
  }
}

module.exports = {
  verifyGoogleToken,
  isEmailAuthorized,
  getAllowedEmails,
  verifyToken,
  verifyRequest,
  createToken,
  buildSessionCookie,
  clearSessionCookieHeader,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS
};
