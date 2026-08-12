'use strict';
/**
 * GET  /api/faturamento-manual — retorna o mapa global de faturamento manual.
 * POST /api/faturamento-manual — salva/atualiza UM deal:
 *     body: { dealId: string, manual?: boolean|null, months?: { "YYYY-MM": number },
 *             monthsMeta?: { "YYYY-MM": { source: "hubspot", ticketIds?: string[] } } }
 *   - manual: true  → força o deal para a lista manual (mesmo sem vencimento)
 *   - manual: false → força o deal a permanecer no forecast (ignora o gate de vencimento)
 *   - manual: null  → remove o override explícito (volta a decidir pelo gate de vencimento)
 *   - months: substitui o mapa de valores mês a mês do deal (faturamento real)
 *   - monthsMeta: substitui o mapa de ORIGEM de cada mês (2026-08-12, integração
 *     apólice↔HubSpot). Mês com source:"hubspot" veio do ticket de faturamento real
 *     (Sérgio/operações) — o editor do painel Ganho trava a edição desses meses e a
 *     tabela principal + tooltip linkam direto para o(s) ticket(s) em `ticketIds`
 *     (pode ser mais de um quando o deal tem mais de uma apólice associada).
 *     Ausente == "manual" (digitado à mão), comportamento anterior a esta mudança.
 *
 * Estrutura persistida (chave global única):
 *   { "<dealId>": { manual: bool|undefined, months: { "2026-04": 71687.2, ... },
 *                    monthsMeta: { "2026-04": { source: "hubspot", ticketIds: ["44396595885"] } } }, ... }
 *
 * Persistência: Vercel KV (chave `forecast:faturamento_manual`) quando configurado;
 * fallback /tmp/faturamento-manual.json (per-instância) — mesmo padrão de /api/meta-receita.
 */

const { setCORSHeaders, requireAuth, methodCheck } = require('./_helpers');
const kv = require('../lib/kv');
const fs = require('fs');
const os = require('os');
const path = require('path');

const KV_KEY   = 'forecast:faturamento_manual';
const TMP_FILE = path.join(os.tmpdir(), 'faturamento-manual.json');

async function readAll() {
  if (kv.isConfigured()) {
    try {
      const v = await kv.getJSON(KV_KEY);
      if (v && typeof v === 'object') return v;
    } catch (e) { /* cai p/ fallback */ }
  }
  try {
    const j = JSON.parse(fs.readFileSync(TMP_FILE, 'utf8'));
    if (j && typeof j === 'object') return j;
  } catch (e) { /* sem arquivo */ }
  return {};
}

async function writeAll(obj) {
  if (kv.isConfigured()) {
    try { await kv.setJSON(KV_KEY, obj); return; } catch (e) { /* cai p/ /tmp */ }
  }
  fs.writeFileSync(TMP_FILE, JSON.stringify(obj), 'utf8');
}

// Sanitiza o mapa de meses: chaves "YYYY-MM", valores numéricos finitos >= 0.
function cleanMonths(months) {
  const out = {};
  if (months && typeof months === 'object') {
    for (const k of Object.keys(months)) {
      if (!/^\d{4}-\d{2}$/.test(k)) continue;
      const n = Number(months[k]);
      if (isFinite(n) && n >= 0) out[k] = n;
    }
  }
  return out;
}

// Sanitiza o mapa de origem por mês: chaves "YYYY-MM", só guarda source:"hubspot"
// (qualquer outro valor, ou ausência da chave, é "manual" por definição — não
// precisa ocupar espaço no store) + ticketIds (ids dos tickets de faturamento que
// originaram o valor — pode ser mais de um quando o deal tem mais de uma apólice).
function cleanMonthsMeta(monthsMeta) {
  const out = {};
  if (monthsMeta && typeof monthsMeta === 'object') {
    for (const k of Object.keys(monthsMeta)) {
      if (!/^\d{4}-\d{2}$/.test(k)) continue;
      const v = monthsMeta[k];
      if (!v || v.source !== 'hubspot') continue;
      const entry = { source: 'hubspot' };
      if (Array.isArray(v.ticketIds)) {
        const ids = v.ticketIds.map(String).filter(Boolean);
        if (ids.length) entry.ticketIds = ids;
      }
      out[k] = entry;
    }
  }
  return out;
}

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET', 'POST'])) return;

  const user = requireAuth(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    return res.status(200).json({ success: true, data: await readAll() });
  }

  // POST — atualiza um deal
  const body = req.body || {};
  const dealId = body.dealId != null ? String(body.dealId) : '';
  if (!dealId) {
    return res.status(400).json({ success: false, error: 'dealId é obrigatório' });
  }

  try {
    const all = await readAll();
    const entry = (all[dealId] && typeof all[dealId] === 'object') ? all[dealId] : {};

    // Dado manual de primeira classe (ADR-004 | Fase 4): toda escrita registra
    // quem/quando + o estado anterior (log mínimo de 1 nível). Consumidores leem
    // entry.manual/entry.months por acesso direto — `meta` é sibling inofensivo.
    const anterior = {
      manual: ('manual' in entry) ? entry.manual : null,
      months: entry.months ? { ...entry.months } : null,
    };

    if ('manual' in body) {
      if (body.manual === null) delete entry.manual;       // volta ao gate automático
      else entry.manual = !!body.manual;                   // força inclusão/exclusão
    }
    if ('months' in body) {
      entry.months = cleanMonths(body.months);
    }
    if ('monthsMeta' in body) {
      const cleanedMeta = cleanMonthsMeta(body.monthsMeta);
      if (Object.keys(cleanedMeta).length) entry.monthsMeta = cleanedMeta;
      else delete entry.monthsMeta;
    }

    entry.meta = {
      em: new Date().toISOString(),
      por: (user && (user.email || user.name)) || 'desconhecido',
      anterior,
    };

    // Se o deal ficou sem nenhuma informação útil, remove a entrada (mantém o store enxuto).
    const hasMonths = entry.months && Object.keys(entry.months).length > 0;
    if (!('manual' in entry) && !hasMonths) delete all[dealId];
    else all[dealId] = entry;

    await writeAll(all);
    return res.status(200).json({ success: true, data: all });
  } catch (e) {
    console.error('[faturamento-manual] write error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};
