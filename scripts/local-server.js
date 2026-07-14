#!/usr/bin/env node
'use strict';

/**
 * local-server.js — Servidor de desenvolvimento local (zero dependências).
 *
 * Emula o runtime de funções serverless da Vercel sem precisar do Vercel CLI
 * nem de login. Serve `public/` aplicando os rewrites de `vercel.json` e
 * roteia `/api/*` para os handlers em `api/`, fornecendo os helpers que a
 * Vercel injeta (req.query, req.body, req.cookies, res.status/json/send/redirect).
 *
 * Uso:  node scripts/local-server.js [porta]   (padrão: 3002)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const API_DIR = path.join(ROOT, 'api');
const PORT = parseInt(process.argv[2], 10) || 3002;

// ---------------------------------------------------------------------------
// 1) Carrega .env.local e garante as vars essenciais de dev
// ---------------------------------------------------------------------------
const envFile = path.join(ROOT, '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
  console.log(`[local] .env.local carregado`);
} else {
  console.log(`[local] .env.local não encontrado — rodando só com bypass (UI sem dados HubSpot)`);
}
if (!process.env.LOCAL_DEV_BYPASS) process.env.LOCAL_DEV_BYPASS = 'true';
if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'dev-local-secret-nao-usar-em-producao-axenya-2026';
if (!process.env.ALLOWED_ORIGIN) process.env.ALLOWED_ORIGIN = `http://localhost:${PORT}`;

// ---------------------------------------------------------------------------
// 2) Rewrites (espelham vercel.json) e content-types
// ---------------------------------------------------------------------------
const REWRITES = {
  '/': '/login.html',
  '/dashboard': '/dashboard.html',
  '/novo': '/dashboard.html',
  '/novo-ae': '/ae.html',
  '/novo-bdr': '/bdr.html',
  '/novo-bdr/no-show': '/bdr-no-show.html',
  '/novo-bdr/workload': '/bdr-workload.html',
  '/dashboard/bdr/workload': '/bdr-workload.html',
  '/novo-bdr/list-attack': '/bdr-list-attack.html',
  '/novo-bdr/treble': '/bdr-treble.html',
  '/dashboard/bdr/no-show': '/bdr-no-show.html',
  '/dashboard/bdr/list-attack': '/bdr-list-attack.html',
  '/dashboard/bdr/treble': '/bdr-treble.html',
  '/novo-bdr-no-show': '/bdr-no-show.html',
  '/novo-bdr-list-attack': '/bdr-list-attack.html',
  '/novo-bdr-treble': '/bdr-treble.html',
  '/novo-board': '/board.html',
  '/novo-48h': '/48h.html',
  '/novo-cs': '/cs.html',
  '/novo-cotacao': '/cotacao.html',
  '/forecast': '/forecast.html',
  '/forecast-delta': '/forecast-delta.html',
  '/forecast-overall': '/forecast-stage.html',
  '/forecast-mql': '/forecast-stage.html',
  '/forecast-diagnostico': '/forecast-stage.html',
  '/forecast-cotacao': '/forecast-stage.html',
  '/forecast-consultoria': '/forecast-stage.html',
  '/forecast-negociacao': '/forecast-stage.html',
  '/forecast-ganho': '/forecast-stage.html',
  '/forecast-bid': '/forecast-stage.html',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// ---------------------------------------------------------------------------
// 3) Helpers que a Vercel injeta em req/res
// ---------------------------------------------------------------------------
function decorateRes(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = (data) => {
    if (Buffer.isBuffer(data) || typeof data === 'string') { res.end(data); return res; }
    return res.json(data);
  };
  res.redirect = (a, b) => {
    const status = typeof a === 'number' ? a : 302;
    const url = typeof a === 'number' ? b : a;
    res.statusCode = status;
    res.setHeader('Location', url);
    res.end();
    return res;
  };
  return res;
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);
      const ct = (req.headers['content-type'] || '').toLowerCase();
      if (ct.includes('application/json')) {
        try { return resolve(JSON.parse(raw)); } catch { return resolve(raw); }
      }
      if (ct.includes('application/x-www-form-urlencoded')) {
        return resolve(Object.fromEntries(new URLSearchParams(raw)));
      }
      resolve(raw);
    });
    req.on('error', () => resolve(undefined));
  });
}

// Resolve um path /api/... para o arquivo handler correspondente
function resolveApiFile(pathname) {
  const rel = pathname.replace(/^\/api\//, '').replace(/\/+$/, '');
  const candidates = [
    path.join(API_DIR, rel + '.js'),
    path.join(API_DIR, rel, 'index.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 4) Servidor
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  decorateRes(res);
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = decodeURIComponent(parsed.pathname);

  // --- API routes ---
  if (pathname.startsWith('/api/')) {
    const file = resolveApiFile(pathname);
    if (!file) {
      res.status(404).json({ error: `API route não encontrada: ${pathname}` });
      return;
    }
    req.query = Object.fromEntries(parsed.searchParams);
    req.cookies = parseCookies(req);
    try {
      req.body = await readBody(req);
      const handler = require(file);
      const fn = typeof handler === 'function' ? handler : handler.default;
      if (typeof fn !== 'function') throw new Error('handler não exporta uma função');
      console.log(`[api] ${req.method} ${pathname}`);
      await fn(req, res);
    } catch (e) {
      console.error(`[api] ERRO ${pathname}:`, e.stack || e.message);
      if (!res.headersSent) res.status(500).json({ error: e.message });
    }
    return;
  }

  // --- Static / rewrites ---
  if (REWRITES[pathname]) pathname = REWRITES[pathname];
  // segurança: impede path traversal
  const safe = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!safe.startsWith(PUBLIC_DIR)) {
    res.status(403).end('Forbidden');
    return;
  }
  let filePath = safe;
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  res.status(404).end(`404 — ${pathname} não encontrado`);
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║   Dashboard Ivan Visual — Dev Server (local)      ║');
  console.log('  ╚══════════════════════════════════════════════════╝');
  console.log('');
  console.log(`   Login/Home   →  http://localhost:${PORT}/`);
  console.log(`   Dashboard    →  http://localhost:${PORT}/dashboard`);
  console.log(`   NOVO (visual)→  http://localhost:${PORT}/novo`);
  console.log(`   Forecast     →  http://localhost:${PORT}/forecast`);
  console.log(`   No Show BDR  →  http://localhost:${PORT}/novo-bdr/no-show`);
  console.log(`   Ataque Lista →  http://localhost:${PORT}/novo-bdr/list-attack`);
  console.log(`   BDR Treble   →  http://localhost:${PORT}/novo-bdr/treble`);
  console.log('');
  console.log(`   Auth bypass  →  ATIVO (LOCAL_DEV_BYPASS=true)`);
  console.log(`   HubSpot data →  ${process.env.HUBSPOT_TOKEN ? 'token presente ✔' : 'sem token (UI carrega, dados não)'}`);
  console.log('');
});
