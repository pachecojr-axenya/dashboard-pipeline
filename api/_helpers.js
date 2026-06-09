'use strict';
/**
 * _helpers.js — Utilitários compartilhados pelas API routes
 *
 * - setCORSHeaders: CORS restrito (sem wildcard)
 * - requireAuth: verifica JWT e retorna 401 se inválido
 * - getHubspotToken: retorna token do env (nunca hardcoded)
 * - methodCheck: retorna 405 se método errado
 */

const { verifyRequest } = require('../lib/auth');

// Domínio de produção — ajustar após deploy no Vercel
// Normaliza: remove trailing slash para evitar mismatch com Origin header do browser.
const ALLOWED_ORIGIN = (process.env.ALLOWED_ORIGIN || 'https://pipeline.axenya.com').replace(/\/+$/, '');

/**
 * Aplica headers de segurança e CORS restrito.
 * Não usa wildcard (*).
 */
function setCORSHeaders(req, res) {
  const origin = (req.headers['origin'] || '').replace(/\/+$/, '');
  // Permitir apenas o domínio configurado (ou localhost em dev)
  const isAllowed = origin === ALLOWED_ORIGIN || /^http:\/\/localhost(:\d+)?$/.test(origin);
  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

/**
 * Verifica autenticação. Retorna o payload do JWT ou envia 401.
 * LOCAL_DEV_BYPASS=true no .env.local pula a verificação em desenvolvimento.
 * @returns {object|null} payload se autenticado, null se respondeu com 401
 */
function requireAuth(req, res) {
  if (process.env.LOCAL_DEV_BYPASS === 'true') {
    return { name: 'Dev Local', email: 'dev@axenya.com', role: 'staff' };
  }
  const payload = verifyRequest(req);
  if (!payload) {
    res.status(401).json({ error: 'Não autorizado. Faça login novamente.' });
    return null;
  }
  return payload;
}

/**
 * Retorna o token HubSpot do env.
 * NUNCA hardcoda — falha explicitamente se não configurado.
 */
function getHubspotToken() {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) throw new Error('HUBSPOT_TOKEN não configurado. Verifique as variáveis de ambiente do Vercel.');
  return token;
}

/**
 * Verifica o método HTTP. Retorna false e envia 405 se errado.
 */
function methodCheck(req, res, allowed) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return false;
  }
  if (!allowed.includes(req.method)) {
    res.setHeader('Allow', allowed.join(', '));
    res.status(405).json({ error: `Método ${req.method} não permitido` });
    return false;
  }
  return true;
}

module.exports = { setCORSHeaders, requireAuth, getHubspotToken, methodCheck };
