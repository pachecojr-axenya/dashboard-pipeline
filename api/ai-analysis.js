'use strict';
/**
 * POST /api/ai-analysis
 * Body: { prompt: string } — para geminiGenerate (prompt livre)
 * ou Body: { companyData: object, activities: array } — para aiCompanyAnalysis
 *
 * S6: Sanitização anti-prompt-injection aplicada em lib/claude.js
 */

const { claudeRequest } = require('../lib/claude');
const { sanitizeForPrompt } = require('../lib/sanitize');
const { setCORSHeaders, requireAuth, methodCheck } = require('./_helpers');

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['POST'])) return;

  const user = requireAuth(req, res);
  if (!user) return;

  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ success: false, error: 'Campo prompt é obrigatório' });
  }

  // S6: Sanitizar prompt antes de enviar ao Claude
  const sanitizedPrompt = sanitizeForPrompt(prompt, 4000);

  try {
    const text = await claudeRequest(sanitizedPrompt);
    return res.status(200).json({ success: true, text });
  } catch (e) {
    console.error('[ai-analysis] Error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
}
