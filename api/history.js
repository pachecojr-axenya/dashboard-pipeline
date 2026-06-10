'use strict';
/**
 * GET /api/history?action=tabs
 *   → lista as abas mensais disponíveis na planilha
 *
 * GET /api/history?action=snapshot&tab=Mai+2026
 *   → retorna os deals daquele snapshot como array de objetos
 */

const { listMonthlyTabs, readSnapshot } = require('../lib/sheets');
const { setCORSHeaders }                 = require('./_helpers');
const { verifyRequest }                  = require('../lib/auth');

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Método não permitido' });
  if (!verifyRequest(req)) return res.status(401).json({ success: false, error: 'Não autorizado' });

  const params = new URL(`http://x${req.url}`).searchParams;
  const action = params.get('action');
  const tab    = params.get('tab');

  try {
    if (action === 'tabs') {
      const tabs = await listMonthlyTabs();
      return res.status(200).json({ success: true, tabs });
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
