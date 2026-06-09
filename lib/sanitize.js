'use strict';
/**
 * sanitize.js — Módulo de sanitização anti-prompt-injection
 * Copiado do Electron original (src_electron_backup/sanitize.js) sem alterações.
 * Aplica em TODOS os dados externos (HubSpot, usuário) antes de injetar em prompts Claude.
 */

const INJECTION_PATTERNS = [
  /ignore\s+(previous|all|above|prior)\s+(instructions?|prompts?|context)/gi,
  /system\s*:/gi,
  /assistant\s*:/gi,
  /human\s*:/gi,
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /###\s*(instruction|system|prompt)/gi,
  /you\s+are\s+now\s+(a|an)\s+/gi,
  /forget\s+(everything|all|your)\s+(you|previous)/gi,
  /new\s+instructions?\s*:/gi,
  /override\s+(previous|all|system)/gi,
  /disregard\s+(previous|all|above)/gi,
  /act\s+as\s+(if\s+you\s+are|a|an)\s+/gi,
  /pretend\s+(you\s+are|to\s+be)\s+/gi,
  /jailbreak/gi,
  /DAN\s+mode/gi,
];

const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const MAX_FIELD_LENGTH = 500;

function sanitizeForPrompt(text, maxLength = MAX_FIELD_LENGTH) {
  if (text === null || text === undefined) return '';
  if (typeof text !== 'string') text = String(text);
  text = text.replace(CONTROL_CHARS_RE, '');
  for (const pattern of INJECTION_PATTERNS) {
    text = text.replace(pattern, '[REMOVIDO]');
  }
  text = text.replace(/`/g, "'").replace(/\\/g, '\\\\');
  if (text.length > maxLength) text = text.substring(0, maxLength) + '…';
  return text.trim();
}

function sanitizeObject(data) {
  if (!data || typeof data !== 'object') return {};
  const result = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      result[key] = sanitizeForPrompt(value);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
    } else if (value === null || value === undefined) {
      result[key] = value;
    } else {
      result[key] = sanitizeForPrompt(JSON.stringify(value), 200);
    }
  }
  return result;
}

function sanitizeActivities(activities) {
  if (!Array.isArray(activities)) return [];
  return activities.map(a => ({
    type: sanitizeForPrompt(a.type, 50),
    date: sanitizeForPrompt(a.date, 20),
    owner: sanitizeForPrompt(a.owner, 100),
    title: sanitizeForPrompt(a.title, 200),
    body: sanitizeForPrompt(a.body, 500)
  }));
}

module.exports = { sanitizeForPrompt, sanitizeObject, sanitizeActivities };
