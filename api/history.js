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
const { setCORSHeaders, requireAuth }    = require('./_helpers');

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

    return res.status(400).json({ success: false, error: 'action inválido. Use ?action=tabs ou ?action=snapshot&tab=...' });

  } catch (e) {
    console.error('[history]', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};
