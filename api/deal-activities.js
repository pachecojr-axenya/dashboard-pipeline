'use strict';
/**
 * POST /api/deal-activities
 * Body: { hsId: "123456", extras?: true, fonte?: "bq" | "api" }
 * Retorna atividades (notes, emails, calls, meetings) de um deal.
 *
 * MIGRADO para a fonte única (F5, 07/08/2026): lê `silver.fact_engagement`.
 * Mesmo motivo do company-activities — o toque nativo cobre todos os donos.
 * Ver aquele arquivo para o contrato de `fonte` e `extras`.
 *
 * PARIDADE, e por que ela NÃO é igualdade de conjunto: a versão da API busca as
 * associações de cada tipo com `?limit=50` e só depois ordena e corta em 20. Para
 * objeto com muito toque de um tipo, esses 50 não são os mais recentes — então as
 * "últimas 20 atividades" do modal antigo NUNCA foram as últimas 20. Medido em
 * 07/08/2026: a empresa 18490469550 tem 33.207 e-mails (mais 21 ligações, 18 notas,
 * 12 reuniões); a API devolvia notas e ligações de abril a agosto e nenhum dos
 * e-mails do próprio dia. Outras duas empresas conferidas: 4.635 e 2.034 e-mails.
 * O armazém pega o top 20 global por data de verdade.
 *
 * `?fonte=api` reproduz o comportamento antigo, inclusive a truncagem.
 */

const { fetchDealActivities } = require('../lib/hubspot');
const whq = require('../lib/hubspot-wh-queries');
const wh = require('../lib/hubspot-warehouse');
const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['POST'])) return;

  const user = requireAuth(req, res);
  if (!user) return;

  const { hsId, extras, fonte } = req.body || {};
  if (!hsId || typeof hsId !== 'string' || !/^\d+$/.test(hsId)) {
    return res.status(400).json({ success: false, error: 'ID de deal inválido' });
  }

  if (fonte !== 'api' && wh.isConfigured()) {
    try {
      const activities = await whq.activities('deal', hsId, { extras: extras === true });
      return res.status(200).json({
        success: true, activities, fonte: 'bq',
        // O COMO viaja com o número: quem lê o feed tem de saber que ele agora é o
        // top 20 de verdade, e que a versão antiga truncava em 50 por tipo.
        premissas: {
          fonte: 'silver.fact_engagement (toque nativo, cobre TODOS os donos)',
          janela: 'top 20 por data de ocorrência, sem teto por tipo',
          tipos: 'notes, emails, calls, meetings — communications (WhatsApp/LinkedIn) e tasks só com extras=true',
          corpo: 'props.hs_{note,email,call,meeting,task}_body, HTML removido e cortado em 300 chars',
          diferenca_vs_api: 'a versao antiga buscava 50 associacoes POR TIPO antes de ordenar, entao seu top 20 nao era o top 20',
        },
      });
    } catch (e) {
      console.error('[deal-activities] armazém falhou, caindo para a API:', e.message);
    }
  }

  let token;
  try {
    token = getHubspotToken();
  } catch (e) {
    return res.status(503).json({ success: false, error: e.message });
  }

  try {
    const activities = await fetchDealActivities(token, hsId);
    return res.status(200).json({ success: true, activities, fonte: 'api' });
  } catch (e) {
    console.error('[deal-activities] Error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
}
