'use strict';
/**
 * GET /api/history?action=tabs
 *   → lista as abas mensais disponíveis na planilha
 *
 * GET /api/history?action=fotos
 *   → lista as FOTOGRAFIAS brutas do pipe (abas semanais "YYYY-MM-DD" + mensais
 *     "Mmm AAAA" a partir de Jun 2026, quando o formato bruto de 35 colunas começou),
 *     ordenadas da mais recente para a mais antiga. Usado pelo modo Comparação do /forecast.
 *
 * GET /api/history?action=snapshot&tab=Mai+2026
 *   → retorna os deals daquele snapshot como array de objetos
 *
 * GET /api/history?action=local
 *   → lista os snapshots reconstruídos embutidos (dias sem cron)
 *
 * GET /api/history?action=local&tab=12+Jun+2026+(reconstruído)
 *   → retorna os deals do snapshot reconstruído (mesmo formato de ?action=snapshot)
 */

const { listMonthlyTabs, readSnapshot, listTabs } = require('../lib/sheets');
const { setCORSHeaders, requireAuth, getHubspotToken } = require('./_helpers');

// ── Histórico de proprietários de um deal (action=owner-history&id=X) ────────
// Lazy, por deal (chamado quando o modal do /forecast abre). Não entra no payload
// compartilhado de /api/forecast-table para não pesar em todos os painéis.
async function hubGet(token, url) {
  const res = await fetch('https://api.hubapi.com' + url, {
    headers: { 'Authorization': 'Bearer ' + token },
    signal: AbortSignal.timeout(20000),
  });
  if (res.status >= 400) throw new Error('HubSpot API error (HTTP ' + res.status + ')');
  return res.json();
}
function histDateStr(ts) {
  if (ts == null) return null;
  if (/^\d+$/.test(String(ts))) { const d = new Date(Number(ts)); return isNaN(d) ? null : d.toISOString().substring(0, 10); }
  return String(ts).substring(0, 10);
}
// Mapa id→nome de TODOS os owners (ativos + arquivados). O GET individual não retorna
// arquivados, então usamos a listagem em lote com archived=true (mesma correção do forecast-table).
async function fetchOwnersMap(token) {
  const map = {};
  for (const archived of ['false', 'true']) {
    let after, hasMore = true;
    while (hasMore) {
      const r = await hubGet(token, '/crm/v3/owners?limit=200&archived=' + archived + (after ? '&after=' + after : ''));
      (r.results || []).forEach(o => {
        const name = (((o.firstName || '') + ' ' + (o.lastName || '')).trim()) || o.email || ('ID ' + o.id);
        if (!map[o.id]) map[o.id] = name;
      });
      hasMore = r.paging && r.paging.next && r.paging.next.after != null;
      after = r.paging && r.paging.next ? r.paging.next.after : undefined;
    }
  }
  return map;
}

// Snapshots reconstruídos do pipe (dias em que o cron diário não rodou).
// Dados embutidos via require() para o bundler da Vercel os incluir; servidos
// pela rota autenticada abaixo (action=local), nunca como arquivo estático.
// Para adicionar um novo: gere com scripts/reconstruct-snapshot.js e registre aqui.
const LOCAL_SNAPSHOTS = {
  '12 Jun 2026 (reconstruído)': require('../lib/snapshots/2026-06-12.json'),
};

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Método não permitido' });
  // requireAuth (mesmo gate dos demais endpoints): respeita LOCAL_DEV_BYPASS no dev;
  // em produção exige a sessão JWT, como antes.
  if (!requireAuth(req, res)) return;

  const params = new URL(`http://x${req.url}`).searchParams;
  const action = params.get('action');
  const tab    = params.get('tab');

  try {
    if (action === 'tabs') {
      const tabs = await listMonthlyTabs();
      return res.status(200).json({ success: true, tabs });
    }

    if (action === 'fotos') {
      const MESES = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
      const all = await listTabs();
      const fotos = [];
      all.forEach(t => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
          fotos.push({ tab: t, tipo: 'semanal', ord: t });
          return;
        }
        const m = t.match(/^([A-Za-zÀ-ÿ]{3}) (\d{4})$/);
        if (m) {
          const mo = MESES[m[1].toLowerCase()];
          if (mo == null) return;
          const ord = m[2] + '-' + String(mo + 1).padStart(2, '0') + '-31';
          // abas mensais anteriores a Jun 2026 estão no formato legado (colunas calculadas) — fora
          if (ord >= '2026-06-01') fotos.push({ tab: t, tipo: 'mensal', ord });
        }
      });
      fotos.sort((a, b) => b.ord.localeCompare(a.ord));
      return res.status(200).json({ success: true, fotos });
    }

    if (action === 'local') {
      if (!tab) {
        return res.status(200).json({ success: true, tabs: Object.keys(LOCAL_SNAPSHOTS) });
      }
      const snap = LOCAL_SNAPSHOTS[tab];
      if (!snap) return res.status(404).json({ success: false, error: 'Snapshot reconstruído não encontrado' });
      return res.status(200).json({ success: true, tab, deals: snap.deals, attrition: snap.attrition || [] });
    }

    if (action === 'snapshot' && tab) {
      const rows = await readSnapshot(tab);
      if (rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Aba não encontrada ou vazia' });
      }
      const headers = rows[0];
      const deals   = rows.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
        return obj;
      });
      return res.status(200).json({ success: true, tab, deals });
    }

    if (action === 'owner-history') {
      const id = params.get('id');
      if (!id) return res.status(400).json({ success: false, error: 'informe ?id=<dealId>' });
      let token;
      try { token = getHubspotToken(); } catch (e) { return res.status(503).json({ success: false, error: e.message }); }
      const [deal, owners] = await Promise.all([
        hubGet(token, '/crm/v3/objects/deals/' + encodeURIComponent(id) + '?propertiesWithHistory=hubspot_owner_id'),
        fetchOwnersMap(token),
      ]);
      const raw = (deal.propertiesWithHistory && deal.propertiesWithHistory.hubspot_owner_id) || [];
      const timeline = raw.map(h => ({   // HubSpot devolve mais recente primeiro
        ownerId: h.value || null,
        owner: h.value ? (owners[h.value] || ('ID ' + h.value)) : '—',
        date: histDateStr(h.timestamp),
        source: h.sourceType || null,
      }));
      // Colapsa trocas consecutivas para o mesmo dono → períodos distintos de posse.
      // current = dono atual (topo); previous = proprietários antigos, do mais recente ao mais antigo.
      const dedup = timeline.filter((e, i) => i === 0 || e.ownerId !== timeline[i - 1].ownerId);
      return res.status(200).json({ success: true, id, current: dedup[0] || null, history: timeline, previous: dedup.slice(1) });
    }

    return res.status(400).json({ success: false, error: 'action inválido. Use ?action=tabs ou ?action=snapshot&tab=...' });

  } catch (e) {
    console.error('[history]', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};
