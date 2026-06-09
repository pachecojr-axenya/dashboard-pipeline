'use strict';
/**
 * POST /api/watcher-deals
 * Returns deals for a specific owner + stage with fill status of watcher properties.
 * Body: { owner: "Fernando Siqueira", stage: "Reunião agendada" }
 */

const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');

// TODO(C09): Pipeline ID, stage mapping, hubspotPost e fetchOwnerMap são duplicados de lib/hubspot.js.
// Refatorar para importar de lib/hubspot.js e eliminar duplicação.
const HUBSPOT_PIPELINE = '782758156';
const STAGE_NAME_TO_ID = {
  'Reunião agendada': '1144746905',
  'Reunião Agendada': '1144746905',
  'Diagnóstico': '1144746906',
  'Cotação': '1144746908',
  'Consultoria': '1144746909',
  'Negociação': '1144746910',
  'Stand by': '1317543716',
  'Implantação': '1288611084'
};

// NEEDS_ADJUSTMENT(D06): Mapeamento manual de display names → HubSpot internal names.
// Se uma propriedade mudar no HubSpot, precisa editar aqui.
// Considerar: buscar via HubSpot Properties API ou mover para config file.
const PROP_MAP = {
  'Reunião ocorreu': 'a_reuniao_ocorreu_',
  'ICP': 'icp',
  'Tem plano de saúde': 'tem_plano_de_saude_',
  'Valor fatura estimada': 'valor_fatura_estimada',
  'Valor Fatura Atual': 'valor_fatura_atual',
  'Provedores atuais': 'provedores_atuais',
  'Qtd de vidas': 'vidas',
  'Qtd de colaboradores': 'qtd_de_colaboradores',
  'Relatório Manus': 'relatorio_manus',
  'Aniversário apólice': 'aniversario_apolice_1',
  'Solução oferecida': 'solucao_oferecida',
  'Tipo de negociação': 'tipo_de_negociacao',
  'Cashback': 'cashback',
  'Garantia de eficiência': 'garantia_de_eficiencia',
  'Modelo contratação': 'modelo_de_contratacao',
  'Modelo remuneração': 'modelo_de_remuneracao',
  'Modelo pagamento': 'modelo_de_pagamento',
  'Possui Vitalício': 'possui_vitalicio_',
  'Proposta': 'proposta',
  'Apresentação proposta': 'apresentacao_proposta',
  'Plano oferecido': 'plano_oferecido',
  'Possui vitalício?': 'possui_vitalicio_',
  'Possui agenciamento?': 'possui_agenciamento_',
  '% cashback': 'cashback',
  '% garantia eficiência': 'garantia_de_eficiencia',
  '% taxa de sucesso': 'taxa_de_sucesso'
};

// All unique HubSpot property names we need
const ALL_HS_PROPS = [
  'dealname', 'dealstage', 'hubspot_owner_id', 'hs_object_id',
  ...new Set(Object.values(PROP_MAP))
];

async function hubspotPost(token, endpoint, body) {
  const res = await fetch(`https://api.hubapi.com${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000)
  });
  if (res.status === 429) throw new Error('HubSpot rate limit');
  if (res.status >= 400) throw new Error(`HubSpot API error (HTTP ${res.status})`);
  return res.json();
}

async function fetchOwnerMap(token) {
  const res = await fetch('https://api.hubapi.com/crm/v3/owners?limit=500', {
    headers: { 'Authorization': `Bearer ${token}` },
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) return {};
  const data = await res.json();
  const map = {};
  for (const o of (data.results || [])) {
    const name = [o.firstName, o.lastName].filter(Boolean).join(' ').trim();
    if (name) map[o.id] = name;
  }
  return map;
}

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['POST', 'OPTIONS'])) return;
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = requireAuth(req, res);
  if (!user) return;

  let token;
  try { token = getHubspotToken(); } catch (e) {
    return res.status(503).json({ success: false, error: e.message });
  }

  const { owner, stage } = req.body || {};
  if (!owner || !stage) {
    return res.status(400).json({ success: false, error: 'owner and stage required' });
  }

  // Case-insensitive stage lookup
  let stageId = STAGE_NAME_TO_ID[stage];
  if (!stageId) {
    const stageLower = stage.toLowerCase();
    for (const key in STAGE_NAME_TO_ID) {
      if (key.toLowerCase() === stageLower) { stageId = STAGE_NAME_TO_ID[key]; break; }
    }
  }
  if (!stageId) {
    return res.status(400).json({ success: false, error: 'Unknown stage: ' + stage });
  }

  try {
    // Fetch owner map to resolve owner name → ID
    // Match is fuzzy: each word in the search name must appear in the HubSpot name
    const ownerMap = await fetchOwnerMap(token);
    const searchParts = owner.toLowerCase().split(/\s+/).filter(Boolean);
    const ownerIds = Object.entries(ownerMap)
      .filter(function(entry) {
        var hsName = entry[1].toLowerCase();
        // Exact match first
        if (hsName === owner.toLowerCase()) return true;
        // Fuzzy: every word from watcher name must appear in HubSpot name
        return searchParts.every(function(part) { return hsName.indexOf(part) >= 0; });
      })
      .map(function(entry) { return entry[0]; });

    if (ownerIds.length === 0) {
      return res.json({ success: true, deals: [], message: 'Owner not found: ' + owner + '. Available: ' + Object.values(ownerMap).join(', ') });
    }

    // Search deals for this owner + stage
    const filters = [
      { propertyName: 'pipeline', operator: 'EQ', value: HUBSPOT_PIPELINE },
      { propertyName: 'dealstage', operator: 'EQ', value: stageId },
      { propertyName: 'hubspot_owner_id', operator: 'IN', values: ownerIds }
    ];

    let allDeals = [];
    let after = 0;
    let hasMore = true;

    while (hasMore) {
      const body = {
        filterGroups: [{ filters }],
        properties: ALL_HS_PROPS,
        limit: 100,
        after
      };
      const response = await hubspotPost(token, '/crm/v3/objects/deals/search', body);
      allDeals = allDeals.concat(response.results || []);
      hasMore = response.paging && response.paging.next && response.paging.next.after != null;
      after = hasMore ? response.paging.next.after : 0;
    }

    // Build response with fill status per property
    const deals = allDeals.map(function(r) {
      const p = r.properties;
      const fields = {};
      for (const displayName in PROP_MAP) {
        const hsName = PROP_MAP[displayName];
        const val = p[hsName];
        // NEEDS_ADJUSTMENT(C10): Considera '0' e 'false' como não preenchido.
        // Para campos numéricos, 0 pode ser válido (ex: 0% cashback).
        // Para booleanos, 'false' pode ser a resposta real.
        // Ideal: diferenciar por tipo de campo.
        fields[displayName] = {
          value: val || null,
          filled: val != null && val !== '' && val !== '0' && val !== 'false'
        };
      }
      return {
        hs_id: p.hs_object_id,
        name: (p.dealname || 'Unknown').replace(/ - Novo\(a\) Deal$/i, '').replace(/ - New Deal$/i, '').trim(),
        fields: fields
      };
    });

    return res.json({ success: true, deals: deals, owner: owner, stage: stage });
  } catch (e) {
    console.error('[watcher-deals] Error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};
