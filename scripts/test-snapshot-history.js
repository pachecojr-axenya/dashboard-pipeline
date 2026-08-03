'use strict';
/**
 * TESTE ZERO-DEPS de lib/snapshot-history.js (valueAt) + classificação do drill.
 *
 * Bug relatado ao vivo na reunião de forecast (2026-07-31): um deal que foi para
 * Perdido apareceu classificado como "movimentação" (avanço de etapa) no drill do
 * waterfall. Causa raiz: valueAt() — usada pelo backfill histórico HubSpot→BQ
 * (scripts/backfill-hubspot-bq.js, via lib/snapshot-history.js) para reconstruir
 * "qual era o valor de uma propriedade num corte de data" — ordenava o histórico
 * de propriedade com um comparador que devolve -1 também quando os timestamps são
 * IGUAIS (`a.timestamp < b.timestamp ? 1 : -1`). Isso viola o contrato de ordem
 * total do Array.prototype.sort: quando o HubSpot registra DUAS mudanças de
 * dealstage no MESMO instante (workflow em cadeia, ex.: Negociação → Perdido
 * processados no mesmo request), o sort podia reordenar errado um array que o
 * HubSpot já entrega correto (mais-recente-primeiro) e valueAt() devolvia a etapa
 * INTERMEDIÁRIA em vez do estado FINAL (Perdido). Como a "etapa em B" errada
 * (ex.: "Negociação" em vez de "Perdido") alimenta rawBStageById em
 * api/history.js, o drill classificava o deal como "avancou" (destino ranqueia
 * acima da etapa de origem) em vez de "saiu" (Caiu/Perdido) — exatamente o bug
 * relatado.
 *
 * Uso: node scripts/test-snapshot-history.js   (exit 0 = ok, 1 = falha)
 */
const H = require('../lib/snapshot-history');
const FC = require('../lib/forecast-compute');

let fails = 0;
function check(name, cond, detail) { console.log((cond ? 'PASS' : 'FALHA') + '  ' + name + (detail ? ' | ' + detail : '')); if (!cond) fails++; }

console.log('== valueAt | empate de timestamp (workflow em cadeia) ==');

const T0 = '2026-06-01T10:00:00.000Z';
const T1 = '2026-06-10T09:00:00.000Z';
const T2 = '2026-07-15T14:30:00.000Z'; // instante do workflow: 2 gravações, MESMO timestamp
const cutoff = '2026-07-31T02:59:59.999Z';

// Ordem realista da API do HubSpot (documentada: mais recente primeiro) — o
// valor FINAL (Perdido) aparece ANTES do intermediário no array de histórico.
const versoesRealistas = [
  { value: 'perdido_id', timestamp: T2 },
  { value: 'negociacao_intermediaria', timestamp: T2 },
  { value: 'negociacao_id', timestamp: T1 },
  { value: 'cotacao_id', timestamp: T0 },
];
check(
  'valueAt devolve o estado FINAL (Perdido), não a etapa intermediária do mesmo instante',
  H.valueAt(versoesRealistas, cutoff) === 'perdido_id',
  'obtido=' + H.valueAt(versoesRealistas, cutoff)
);

// Histórico maior (muitas transições ao longo do tempo) + empate no fim — cenário
// mais realista de um deal com trajetória longa. O comparador antigo, não sendo
// uma ordem total válida, podia embaralhar arrays maiores mesmo fora do par
// empatado (falha de invariante do sort, não só das duas pontas).
const historicoLongo = [];
for (let i = 0; i < 30; i++) historicoLongo.push({ value: 'stage_' + i, timestamp: new Date(Date.parse(T0) + i * 86400000).toISOString() });
historicoLongo.push({ value: 'perdido_id', timestamp: T2 });          // estado final: mais recente primeiro (contrato HubSpot)
historicoLongo.push({ value: 'negociacao_intermediaria', timestamp: T2 });
check(
  'valueAt com histórico longo + empate no fim ainda resolve para o estado final',
  H.valueAt(historicoLongo, '2026-12-31T00:00:00.000Z') === 'perdido_id',
  'obtido=' + H.valueAt(historicoLongo, '2026-12-31T00:00:00.000Z')
);

// Sem empate (caso comum): garante que o fix não regrediu o caminho feliz.
const versoesSemEmpate = [
  { value: 'perdido_id', timestamp: T2 },
  { value: 'negociacao_id', timestamp: T1 },
  { value: 'cotacao_id', timestamp: T0 },
];
check('valueAt sem empate continua correto (regressão)', H.valueAt(versoesSemEmpate, cutoff) === 'perdido_id');
check('valueAt respeita o corte (não olha o futuro)', H.valueAt(versoesSemEmpate, T1) === 'negociacao_id', 'obtido=' + H.valueAt(versoesSemEmpate, T1));
check('valueAt vazio/nulo devolve null', H.valueAt([], cutoff) === null && H.valueAt(null, cutoff) === null);

console.log('\n== Efeito downstream | classificação do drill (api/history.js usa _classifySaiu) ==');

// Reproduz o sintoma relatado na reunião: Beta estava em Negociação na foto A e,
// por causa do bug acima, a etapa "bruta em B" chegava como a etapa intermediária
// (Negociação/Proposta, rank mais alto) em vez de "Perdido". O drill classificava
// isso como 'avancou' (implica avanço de etapa) quando deveria ser 'saiu' (Caiu).
const dealsA = [
  { hs_id: '1', dealname: 'Beta', stage: 'Negociação', pipeline: 'Vendas', vidas: 800, arr_estimado: 360000, quarter: 'Q1 2027', createdate: '2025-11-01', modelo_remuneracao: 'Fee por vida', primeira_fatura: 30000, data_prevista_para_receita: '2027-01-01', probabilidade: 0.3 },
];
const dealsB = [
  { hs_id: '1', dealname: 'Beta', stage: 'Perdido', pipeline: 'Vendas', vidas: 800, arr_estimado: 360000, quarter: 'Q1 2027', createdate: '2025-11-01', modelo_remuneracao: 'Fee por vida', primeira_fatura: 30000, data_prevista_para_receita: '2027-01-01', probabilidade: 0.3 },
];
const rawBStageById = {}; dealsB.forEach(d => { rawBStageById[d.hs_id] = d.stage; });
const cA = FC.dealContributions(dealsA, '2026-06-01', {}, null, null);
const cB = FC.dealContributions(dealsB, '2026-07-31', {}, null, null);
const drill = FC.drillGeneric(cA, cB, 'neg', 'prob12', rawBStageById);
const beta = drill.deals.find(d => d.id === '1');
check('Beta SAIU classificado como "saiu" (Caiu/Perdido), não "avancou"', beta && beta.tipo === 'saiu', beta && ('tipo=' + beta.tipo));
check('Beta traz destino Perdido no drill', beta && beta.stageB === 'Perdido', beta && ('stageB=' + beta.stageB));

console.log('\n' + (fails === 0 ? 'OK — todos os checks passaram' : 'FALHOU — ' + fails + ' check(s)'));
process.exit(fails === 0 ? 0 : 1);
