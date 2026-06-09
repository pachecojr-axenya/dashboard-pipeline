'use strict';
/**
 * POST /api/ai-cs-insights
 * Body: { portfolioSummary: object }
 * Retorna insights estratégicos de portfólio CS via Claude.
 * S6: Sanitização completa em lib/claude.js
 */

const { aiCSInsights } = require('../lib/claude');
const { setCORSHeaders, requireAuth, methodCheck } = require('./_helpers');

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['POST'])) return;

  const user = requireAuth(req, res);
  if (!user) return;

  const { portfolioSummary } = req.body || {};

  if (!portfolioSummary || typeof portfolioSummary !== 'object') {
    return res.status(400).json({ success: false, error: 'portfolioSummary é obrigatório' });
  }

  try {
    const insights = await aiCSInsights(portfolioSummary);
    return res.status(200).json({ success: true, insights });
  } catch (e) {
    console.error('[ai-cs-insights] Error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
}
