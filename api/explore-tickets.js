'use strict';
/**
 * POST /api/explore-tickets
 * Explora pipelines e propriedades de tickets (debug/admin).
 *
 * NÃO MIGRADO — decisão de 07/08/2026, aplicando a ressalva do próprio handoff F5
 * ("se o endpoint precisar dos outros pipelines, mantém na API"). Este precisa:
 *
 *   · `GET /crm/v3/pipelines/tickets` enumera os 19 pipelines de ticket do portal.
 *     O armazém tem 17 em `bronze.raw_pipeline_stage` — e o escopo modelado é só
 *     o de Cotação (847948895, 187 tickets de 109.200). Um explorador que mostra
 *     17 de 19 e diz "pipelines de ticket" é pior que um que bate na API.
 *   · `GET /crm/v3/properties/tickets` devolve as DEFINIÇÕES de propriedade do
 *     portal. Definição de propriedade não é modelada em nenhuma camada — o
 *     armazém guarda valores, não o dicionário.
 *
 * Só a terceira parte (10 tickets recentes de Cotação) caberia no armazém, e
 * migrar um terço de um endpoint de debug não paga o custo de duas fontes.
 * Revisitar quando o escopo de tickets for ampliado para os 19 pipelines.
 *
 * FIXME herdado (B02): este endpoint é inalcançável em produção — ver o 403 de
 * role abaixo. Nenhum usuário recebe 'admin' no OAuth do Google.
 */

const { hubspotGet, hubspotPost } = require('../lib/hubspot');
const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['POST'])) return;

  const user = requireAuth(req, res);
  if (!user) return;

  // FIXME(B02): Google OAuth atribui role 'staff' ou 'guest'. Nenhum usuário recebe 'admin'.
  // Este endpoint é inacessível em produção. Definir lógica de admin (ex: whitelist de emails)
  // ou remover a restrição.
  if (user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Acesso restrito a administradores' });
  }

  let token;
  try {
    token = getHubspotToken();
  } catch (e) {
    return res.status(503).json({ success: false, error: e.message });
  }

  try {
    const [pipelines, props, recent] = await Promise.all([
      hubspotGet(token, '/crm/v3/pipelines/tickets'),
      hubspotGet(token, '/crm/v3/properties/tickets'),
      hubspotPost(token, '/crm/v3/objects/tickets/search', {
        filterGroups: [{ filters: [{ propertyName: 'hs_pipeline', operator: 'EQ', value: '847948895' }] }],
        properties: ['subject', 'hs_pipeline', 'hs_pipeline_stage', 'createdate', 'hs_object_id'],
        sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
        limit: 10
      })
    ]);

    return res.status(200).json({
      success: true,
      pipelines: pipelines.results,
      properties: (props.results || []).map(p => ({ name: p.name, label: p.label, type: p.type })),
      recentTickets: (recent.results || []).map(r => r.properties)
    });
  } catch (e) {
    console.error('[explore-tickets] Error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
}
