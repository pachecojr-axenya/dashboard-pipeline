'use strict';
/**
 * lib/growth-attribution.js — Semântica de atribuição de mídia paga.
 *
 * Fonte única das regras que dizem "este lead é do LinkedIn" ou "este lead é
 * pago". Fica separado do endpoint porque é a parte que dá briga: qualquer
 * mudança aqui muda CPL, e precisa de teste de contrato.
 *
 * DECISÕES MEDIDAS EM 2026-08-06 (ver docs/growth-performance.md):
 *
 * 1. `hs_analytics_source` do HubSpot é INÚTIL neste portal. 9.321 de 9.321
 *    contatos criados desde 01/05/2026 estão como OFFLINE/INTEGRATION, porque
 *    todo contato nasce por API (site, Apollo, prospector). O mesmo vale para
 *    `hs_lead_source` do objeto Lead (0-136): 5.760 de 5.842 em OFFLINE.
 *    => Atribuição de canal vem de `utm_source`, gravado pelas rotas do site.
 *
 * 2. `axenya_origem_canonica` NÃO serve para origem de canal: o backfill do RH
 *    Summit colou "stand" em contato de Apollo/outbound por dono. Só aparece
 *    como outbound_bdr / evento_rh_summit_*. Fica fora do cálculo.
 *
 * 3. `utm_medium` separa PAGO de ORGÂNICO dentro do mesmo canal. Isso é o que
 *    impede o CPL de mentir: em julho/2026 o LinkedIn teve 38 leads no canal,
 *    mas só 11 com medium pago. Dividir o spend por 38 daria CPL R$ 116,70
 *    quando o CPL pago real era R$ 403,16. **CPL usa só lead pago.**
 *
 * 4. O UTM do contato é LAST-TOUCH-COM-UTM: as rotas do site só escrevem o
 *    campo quando o valor chega preenchido, então um preenchimento posterior com
 *    UTM diferente sobrescreve. Coorte é pela DATA DE CRIAÇÃO do contato; a
 *    imprecisão residual é declarada na resposta (`coverage`), nunca escondida.
 */

// ── Canal ---------------------------------------------------------------

const CHANNEL_BY_SOURCE = {
  meta: 'Meta', facebook: 'Meta', fb: 'Meta', instagram: 'Meta', ig: 'Meta',
  'facebook.com': 'Meta', 'instagram.com': 'Meta',
  linkedin: 'LinkedIn', li: 'LinkedIn', 'linkedin.com': 'LinkedIn',
  google: 'Google', googleads: 'Google', gads: 'Google', adwords: 'Google',
};

/** Canais de mídia paga com spend conectado neste endpoint. */
const PAID_CHANNELS = ['Meta', 'LinkedIn'];

const SEM_UTM = 'Sem UTM';

function channelOf(props) {
  const raw = String(props.utm_source || '').trim().toLowerCase();
  if (!raw) return SEM_UTM;
  return CHANNEL_BY_SOURCE[raw] || `Outros`;
}

// ── Pago vs orgânico ----------------------------------------------------

const PAID_MEDIUMS = new Set([
  'paid_social', 'paidsocial', 'paid-social', 'cpc', 'ppc', 'paid', 'ads',
  'cpm', 'display', 'paid_search', 'paidsearch',
]);
const ORGANIC_MEDIUMS = new Set([
  'social', 'organic_social', 'organic', 'organico', 'referral', 'post',
]);

/** @returns {'pago'|'organico'|'outro'} */
function mediumTypeOf(props) {
  const raw = String(props.utm_medium || '').trim().toLowerCase();
  if (!raw) return 'outro';
  if (PAID_MEDIUMS.has(raw)) return 'pago';
  if (ORGANIC_MEDIUMS.has(raw)) return 'organico';
  return 'outro';
}

// ── Cargo -> senioridade | área -----------------------------------------
// `jobtitle` é texto livre e sujo ("Socio", "Sócio", "Socia", "Analista de rh").
// Sem normalização o breakdown por cargo vira lista de 60 variações de 1.

function _norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

const SENIORITY_RULES = [
  [/\b(ceo|cfo|coo|cto|chro|c-level|clevel|presidente|founder|fundador[a]?|owner|proprietari[oa])\b/, 'C-Level'],
  [/\b(soci[oa]s?|partner)\b/, 'Sócio'],
  [/\b(diretor[a]?|director|vp|vice-presidente|head)\b/, 'Diretor / Head'],
  [/\b(gerente|manager|gestor[a]?)\b/, 'Gerente'],
  [/\b(coordenador[a]?|supervisor[a]?|lider|leader|encarregad[oa])\b/, 'Coordenador / Supervisor'],
  [/\b(especialista|specialist|consultor[a]?|consultant)\b/, 'Especialista / Consultor'],
  [/\b(analista|analyst|assistente|auxiliar|assistant|tecnic[oa]|estagiari[oa]|aprendiz|jovem aprendiz)\b/, 'Analista / Assistente'],
];

const AREA_RULES = [
  [/\b(dp|departamento pessoal|folha|payroll|admissao|admissional)\b/, 'DP / Folha'],
  [/\b(beneficio|beneficios|remuneracao|c&b|comp|total rewards)\b/, 'Benefícios / Remuneração'],
  [/\b(sst|seguranca do trabalho|saude ocupacional|ocupacional|engenheiro de seguranca|tecnico de seguranca|ergonomia)\b/, 'SST / Saúde Ocupacional'],
  [/\b(medic[oa]|enfermeir[oa]|psicolog[oa]|nutricionist[ae]|fisioterapeut[ae]|saude)\b/, 'Saúde / Médico'],
  [/\b(rh|recursos humanos|people|gente e gestao|gente|human resources|hr|talent|recrutamento|dho|desenvolvimento humano)\b/, 'RH / People'],
  [/\b(financeir[oa]|controladoria|controller|contabil|contabilidade|tesouraria|fp&a|cfo)\b/, 'Financeiro'],
  [/\b(compras|suprimentos|procurement|sourcing)\b/, 'Compras / Suprimentos'],
  [/\b(juridic[oa]|legal|compliance|advogad[oa])\b/, 'Jurídico / Compliance'],
  [/\b(comercial|vendas|sales|account|comercio)\b/, 'Comercial / Vendas'],
  [/\b(ti|tecnologia|it|desenvolvedor|developer|engenheir[oa] de software|dados|data)\b/, 'TI / Dados'],
  [/\b(marketing|growth|comunicacao|midia)\b/, 'Marketing'],
  [/\b(operacoes|operacional|logistica|producao|industrial|manutencao)\b/, 'Operações'],
  [/\b(ceo|cfo|coo|presidente|socio|socia|founder|fundador|diretor geral|owner|proprietari)\b/, 'Diretoria / C-Level'],
];

function classifyJobTitle(jobtitle) {
  const t = _norm(jobtitle);
  if (!t) {
    return {
      cargo: '(sem cargo)', senioridade: '(sem cargo)',
      area: '(sem cargo)', persona: '(sem cargo)',
    };
  }
  let senioridade = 'Outros';
  for (const [re, label] of SENIORITY_RULES) { if (re.test(t)) { senioridade = label; break; } }
  let area = 'Outros';
  for (const [re, label] of AREA_RULES) { if (re.test(t)) { area = label; break; } }
  return {
    cargo: String(jobtitle || '').trim(),
    senioridade,
    area,
    persona: `${senioridade} | ${area}`,
  };
}

// ── Porte ---------------------------------------------------------------
// `porte` (enum: PME I, PME II, Middle, Corporate) é o campo do portal; quando
// vazio, cai para faixa de nº de funcionários / vidas.

function porteOf(company) {
  if (!company) return '(sem empresa)';
  const p = String(company.porte || '').trim();
  if (p) return p;
  const n = Number(company.numberofemployees || company.vidas || company.quantidade_de_vidas || 0);
  if (!n) return '(sem porte)';
  if (n < 30) return 'Até 29 (proxy)';
  if (n < 100) return '30-99 (proxy)';
  if (n < 500) return '100-499 (proxy)';
  if (n < 1000) return '500-999 (proxy)';
  return '1000+ (proxy)';
}

// ── Iniciativa (join campanha de anúncio <-> utm_campaign) --------------
// A plataforma nomeia "META | P0 | MoFu | Pesquisa RH CONARH 26 | 2026-07" e o
// site marca "pesquisa_rh_conarh26_2026_07". Não existe chave comum.
//
// Pareamento por sobreposição de tokens foi TESTADO E DESCARTADO em 2026-08-06:
// gerava (a) spend duplicado quando 2 utm_campaigns caíam no mesmo anúncio, e
// (b) match falso — `pesquisa_rh_conarh26_2026_07` colou em
// "LI | ... | Webinar 2026-07 | Ad Set B" só porque compartilhavam os tokens de
// data e "rh" (score 0,5).
//
// O que substituiu: as DUAS pontas passam pelo MESMO classificador de
// INICIATIVA (webinar tal, pesquisa tal, observatório). O join é por
// (canal, iniciativa) — legível, estável e editável. Anúncio cujo nome não
// carrega o token da iniciativa entra em OVERRIDES pelo nome exato.
//
// Correção durável (pendente, do lado da operação de mídia): batizar a campanha
// de anúncio com o MESMO slug usado em utm_campaign. Aí o join deixa de precisar
// de regra.

const INITIATIVE_OVERRIDES = {
  'LI | P0 | MoFu | Webinar 2026-07 | Ad Set A | ABM C-level': 'Webinar Reajuste',
  'LI | P0 | MoFu | Webinar 2026-07 | Ad Set B | RH Aberto': 'Webinar Reajuste',
};

const INITIATIVE_RULES = [
  [/buddha/, 'Pesquisa RH | Buddha Spa'],
  [/observat/, 'Observatório Axenya'],
  [/pesquisa|conarh/, 'Pesquisa RH | CONARH'],
  [/workshop/, 'Workshop IA Renovação'],
  [/reajuste|30.?07/, 'Webinar Reajuste'],
  [/dados.?decis|dadosdecisao|dos.?dados/, 'Webinar Dados à Decisão'],
  [/conta.?rh/, 'Conta do RH'],
  [/nr.?0?1/, 'NR-01'],
  [/calculadora|simulador|multa/, 'Calculadora | Simulador'],
  [/cotacao|cotação/, 'Cotação'],
  [/webinar/, 'Webinar | não especificado'],
  [/newsletter/, 'Newsletter'],
];

const INITIATIVE_OUTRAS = 'Outras | sem classificação';

/**
 * Classifica um nome de campanha de anúncio OU um utm_campaign na mesma
 * iniciativa. É o que permite o join entre plataforma e HubSpot.
 */
function classifyInitiative(name) {
  const raw = String(name || '').trim();
  if (!raw) return INITIATIVE_OUTRAS;
  if (INITIATIVE_OVERRIDES[raw]) return INITIATIVE_OVERRIDES[raw];
  const t = _norm(raw);
  for (const [re, label] of INITIATIVE_RULES) { if (re.test(t)) return label; }
  return INITIATIVE_OUTRAS;
}

module.exports = {
  PAID_CHANNELS, SEM_UTM, INITIATIVE_OUTRAS, INITIATIVE_OVERRIDES,
  channelOf, mediumTypeOf, classifyJobTitle, porteOf,
  classifyInitiative,
};
