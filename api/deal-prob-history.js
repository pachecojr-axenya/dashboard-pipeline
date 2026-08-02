'use strict';
/**
 * GET /api/deal-prob-history?id=<dealId>
 *   → histórico de mudanças da probabilidade informada pelo AE
 *     (propriedade HubSpot `probabilidade_de_fechamento_`) de um deal,
 *     via propertiesWithHistory. Lazy, por deal (chamado no mouse-over da
 *     célula "Prob AE" do CRO Dashboard) — não entra no payload
 *     compartilhado de /api/forecast-table.
 *
 * Uso: puramente informativo/storytelling (decisão nº 6, reunião de
 * forecast de 31-jul-2026) — "contar a história da conta" (o que aconteceu
 * quando a probabilidade subiu/desceu). NUNCA alimenta cálculo de receita;
 * a fonte de cálculo continua sendo o valor atual de `probabilidade_de_fechamento_`
 * já exposto por /api/forecast-table.
 *
 * Isolado em arquivo próprio (não em api/history.js) para não colidir com
 * outra sessão mexendo nesse arquivo em paralelo.
 */

const { setCORSHeaders, requireAuth, getHubspotToken } = require('./_helpers');

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

// Mesma normalização do forecast-table.js (probabilidade_de_fechamento_ vem
// ora em 0-1, ora em 0-100 no HubSpot): >1 divide por 100.
function normalizeProb(val) {
  const n = parseFloat(val);
  if (isNaN(n) || n < 0) return null;
  return n > 1 ? n / 100 : n;
}

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Método não permitido' });
  if (!requireAuth(req, res)) return;

  const params = new URL(`http://x${req.url}`).searchParams;
  const id = params.get('id');
  if (!id) return res.status(400).json({ success: false, error: 'informe ?id=<dealId>' });

  try {
    let token;
    try { token = getHubspotToken(); } catch (e) { return res.status(503).json({ success: false, error: e.message }); }
    const deal = await hubGet(token, '/crm/v3/objects/deals/' + encodeURIComponent(id) + '?propertiesWithHistory=probabilidade_de_fechamento_');
    const raw = (deal.propertiesWithHistory && deal.propertiesWithHistory.probabilidade_de_fechamento_) || [];
    // HubSpot devolve mais recente primeiro.
    const timeline = raw.map(h => ({
      value: normalizeProb(h.value),
      date: histDateStr(h.timestamp),
      source: h.sourceType || null,
    }));
    // Colapsa entradas consecutivas com o mesmo valor normalizado (ruído de
    // re-save sem mudança real de probabilidade).
    const dedup = timeline.filter((e, i) => i === 0 || e.value !== timeline[i - 1].value);
    return res.status(200).json({ success: true, id, current: dedup[0] || null, history: dedup });
  } catch (e) {
    console.error('[deal-prob-history]', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};
