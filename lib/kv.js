'use strict';
/**
 * lib/kv.js — Minimal Upstash Redis / Vercel KV client via REST fetch.
 * Zero npm deps (rule: no external packages).
 *
 * Env vars (set automatically when Vercel KV / Upstash is provisioned):
 *   KV_REST_API_URL
 *   KV_REST_API_TOKEN
 *
 * Exports:
 *   isConfigured(): boolean
 *   getJSON(key): Promise<object | null>
 *   setJSON(key, value): Promise<void>
 *   delKey(key): Promise<void>
 *   userKey(user, ns): string — stable per-user key (defensive email normalization)
 */

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

function isConfigured() {
  return !!(KV_URL && KV_TOKEN);
}

async function _cmd(args) {
  if (!isConfigured()) throw new Error('KV not configured (KV_REST_API_URL / KV_REST_API_TOKEN missing)');
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(10_000)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`KV ${args[0]} HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const j = await res.json();
  if (j.error) throw new Error(`KV ${args[0]} error: ${j.error}`);
  return j.result;
}

async function getJSON(key) {
  const raw = await _cmd(['GET', key]);
  if (raw == null) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function setJSON(key, value) {
  await _cmd(['SET', key, JSON.stringify(value)]);
}

async function delKey(key) {
  await _cmd(['DEL', key]);
}

function userKey(user, ns) {
  const email = String((user && user.email) || 'anon').toLowerCase().trim();
  return `user:${email}:${ns}`;
}

module.exports = { isConfigured, getJSON, setJSON, delKey, userKey };
