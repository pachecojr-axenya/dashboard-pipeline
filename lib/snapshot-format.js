'use strict';
/**
 * snapshot-format.js — fonte única do formato de fotografia bruta do pipe.
 *
 * Uma "foto" é o registro dos deals COMO ESTÃO no HubSpot: propriedades cruas,
 * sem nenhum cálculo (regra do projeto, 2026-07-02). Labels de pipeline/etapa/
 * owner são resolução de nome, não cálculo. Usado por:
 *   - api/snapshot.js            (fotos ao vivo: semanal sexta + mensal + forçada)
 *   - scripts/reconstruct-weekly.js (fotos passadas via histórico de propriedades)
 * Formato validado: abas "Jun 2026" e "2026-06-05".."2026-06-26" da planilha.
 */

const PIPELINE_VENDAS = '782758156';
const PIPELINE_BID    = '894130090';
const PIPELINE_LABELS = { [PIPELINE_VENDAS]: 'Vendas', [PIPELINE_BID]: 'Bid' };

// Propriedades cruas capturadas na foto (espelha o conjunto do /api/forecast-table)
const PROPERTIES = [
  'dealname', 'dealstage', 'pipeline', 'hubspot_owner_id', 'sdr',
  'produto', 'quantidade_de_colaboradores', 'vidas',
  'valor_da_fatura_do_plano_de_saude_atual', 'primeira_fatura',
  'arr_estimado', 'premio_mensal', 'modelo_de_remuneracao',
  'possui_agenciamento', 'possui_vitalicio', 'e_poc',
  'probabilidade_de_fechamento_', 'hs_deal_stage_probability',
  'qual_quarter_de_fechamento', 'data_prevista_para_receita',
  'vigencia', 'vencimento_da_1o_fatura',
  'hs_is_closed_won', 'hs_is_closed_lost', 'hs_object_id',
  'createdate', 'closedate',
  'hs_v2_date_entered_1144746905', // entrada em Reunião Agendada (Vendas)
  'hs_v2_date_entered_1288611084', // entrada em Implantação (Vendas)
  'hs_v2_date_entered_1144844314', // entrada em Ganho (Vendas)
  'motivo_do_declinio_ou_perdido',
  'motivo_de_declinio_perdido___descricao',
  'a_reuniao_ocorreu_',
  'notes_last_updated',
];

const HEADERS = [
  'Deal ID', 'Deal', 'URL HubSpot', 'Pipeline', 'Etapa', 'Executivo', 'SDR',
  'Produto', 'Vidas', 'Colaboradores', 'Fatura Plano Atual (R$)', '1ª Fatura (R$)',
  'ARR Estimado (R$)', 'Prêmio Mensal (R$)', 'Modelo', 'Agenciamento', 'Vitalício', 'É POC?',
  'Probabilidade (campo)', 'Probabilidade HS', 'Quarter', 'Data Prevista Receita',
  'Vigência', 'Vencimento 1ª Fatura', 'Criado', 'Fechado',
  'Entrada Reunião Agendada', 'Entrada Implantação', 'Entrada Ganho',
  'Closed Won', 'Closed Lost', 'Motivo Declínio', 'Motivo Declínio (texto)',
  'Reunião Ocorreu', 'Última Atividade', 'Capturada em',
];

// Linha da foto AO VIVO: valores diretos das propriedades atuais do deal.
function buildRow(deal, ownerMap, stageMap, capturedAt) {
  const p = deal.properties || {};
  const v = x => (x == null ? '' : String(x));
  return [
    deal.id,
    v(p.dealname),
    'https://app.hubspot.com/contacts/44715285/deal/' + deal.id,
    PIPELINE_LABELS[p.pipeline] || v(p.pipeline),
    v(stageMap[p.dealstage] || p.dealstage),
    v(ownerMap[p.hubspot_owner_id] || p.hubspot_owner_id),
    v(ownerMap[p.sdr] || p.sdr),
    v(p.produto),
    v(p.vidas),
    v(p.quantidade_de_colaboradores),
    v(p.valor_da_fatura_do_plano_de_saude_atual),
    v(p.primeira_fatura),
    v(p.arr_estimado),
    v(p.premio_mensal),
    v(p.modelo_de_remuneracao),
    v(p.possui_agenciamento),
    v(p.possui_vitalicio),
    v(p.e_poc),
    v(p.probabilidade_de_fechamento_),
    v(p.hs_deal_stage_probability),
    v(p.qual_quarter_de_fechamento),
    v(p.data_prevista_para_receita),
    v(p.vigencia),
    v(p.vencimento_da_1o_fatura),
    v(p.createdate),
    v(p.closedate),
    v(p.hs_v2_date_entered_1144746905),
    v(p.hs_v2_date_entered_1288611084),
    v(p.hs_v2_date_entered_1144844314),
    v(p.hs_is_closed_won),
    v(p.hs_is_closed_lost),
    v(p.motivo_do_declinio_ou_perdido),
    v(p.motivo_de_declinio_perdido___descricao),
    v(p.a_reuniao_ocorreu_),
    v(p.notes_last_updated),
    capturedAt,
  ];
}

module.exports = { PIPELINE_VENDAS, PIPELINE_BID, PIPELINE_LABELS, PROPERTIES, HEADERS, buildRow };
