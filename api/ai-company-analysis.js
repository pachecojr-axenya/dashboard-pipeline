'use strict';
/**
 * POST /api/ai-company-analysis
 * Body: { companyData: object, activities: array }
 * Retorna análise estruturada de conta CS via Claude.
 * S6: Sanitização completa em lib/claude.js
 */

const { aiCompanyAnalysis } = require('../lib/claude');
const { setCORSHeaders, requireAuth, methodCheck } = require('./_helpers');

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['POST'])) return;

  const user = requireAuth(req, res);
  if (!user) return;

  const { companyData, activities } = req.body || {};

  if (!companyData || typeof companyData !== 'object') {
    return res.status(400).json({ success: false, error: 'companyData é obrigatório' });
  }

  try {
    const analysis = await aiCompanyAnalysis(companyData, activities || []);
    return res.status(200).json({ success: true, analysis });
  } catch (e) {
    console.error('[ai-company-analysis] Error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
}
