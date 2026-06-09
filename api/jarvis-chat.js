'use strict';
/**
 * POST /api/jarvis-chat
 * Body: { messages: [{role, content}...], systemPrompt: string, model?: string }
 * Returns: { success: true, text: string }
 *
 * Endpoint dedicado ao Jarvis (chart-building assistant).
 * Usa claudeChat() com suporte a multi-turn + system prompt.
 */

const { claudeChat } = require('../lib/claude');
const { setCORSHeaders, requireAuth, methodCheck } = require('./_helpers');

// Per-instance in-memory rate limit (best-effort in serverless — resets on cold start).
// Keeps the Jarvis assistant from being spammed by one user.
const RATE = { windowMs: 60_000, maxPerWindow: 15, buckets: new Map() };

function rateLimitOk(key) {
  const now = Date.now();
  const entry = RATE.buckets.get(key) || { start: now, count: 0 };
  if (now - entry.start > RATE.windowMs) { entry.start = now; entry.count = 0; }
  entry.count += 1;
  RATE.buckets.set(key, entry);
  return entry.count <= RATE.maxPerWindow;
}

const MAX_MESSAGES = 50;
const MAX_CONTENT_CHARS = 12_000;
const MAX_TOTAL_CHARS = 120_000;

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['POST'])) return;

  const user = requireAuth(req, res);
  if (!user) return;

  if (!rateLimitOk(user.email || 'anon')) {
    return res.status(429).json({ success: false, error: 'Muitas requisições ao Jarvis. Aguarde um minuto.' });
  }

  const { messages, systemPrompt, model } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ success: false, error: 'Campo messages (array) é obrigatório e não pode ser vazio' });
  }

  let totalChars = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m || typeof m.content !== 'string' || !m.content.trim()) {
      return res.status(400).json({ success: false, error: `messages[${i}].content deve ser uma string não-vazia` });
    }
    if (!['user', 'assistant'].includes(m.role)) {
      return res.status(400).json({ success: false, error: `messages[${i}].role deve ser "user" ou "assistant"` });
    }
    if (m.content.length > MAX_CONTENT_CHARS) {
      return res.status(400).json({ success: false, error: `messages[${i}].content excede ${MAX_CONTENT_CHARS} caracteres` });
    }
    totalChars += m.content.length;
  }
  if (totalChars > MAX_TOTAL_CHARS) {
    return res.status(400).json({ success: false, error: `Histórico excede ${MAX_TOTAL_CHARS} caracteres no total` });
  }

  const trimmedMessages = messages.length > MAX_MESSAGES
    ? messages.slice(messages.length - MAX_MESSAGES)
    : messages;

  try {
    const text = await claudeChat(trimmedMessages, systemPrompt || '', model || undefined);
    return res.status(200).json({ success: true, text });
  } catch (e) {
    console.error('[jarvis-chat] Error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};
