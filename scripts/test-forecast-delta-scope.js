'use strict';
/**
 * test-forecast-delta-scope.js — cobre o escopo do /forecast-delta: multiselect
 * livre por etapa (2026-08-13), sentinela 'tudo' legado (D09) e o default (sem
 * scope algum). UNIT, zero-deps, zero-rede. Valida applyDeltaScope /
 * deltaScopeStages / deltaRowInScope de lib/forecast-compute.js.
 */
const FC = require('../lib/forecast-compute');

let fail = 0;
function check(name, cond, extra) {
  console.log((cond ? '  ok  ' : ' FAIL ') + name + (cond ? '' : '  << ' + (extra || '')));
  if (!cond) fail++;
}

const deals = [
  { hs_id: '1', dealname: 'Reuniao', stage: 'Reunião Agendada', pipeline: 'Vendas' },
  { hs_id: '2', dealname: 'Diag',    stage: 'Diagnóstico',      pipeline: 'Vendas' },
  { hs_id: '3', dealname: 'Cot',     stage: 'Cotação',          pipeline: 'Vendas' },
  { hs_id: '4', dealname: 'Cons',    stage: 'Consultoria',      pipeline: 'Vendas' },
  { hs_id: '5', dealname: 'Neg',     stage: 'Negociação',       pipeline: 'Vendas' },
  { hs_id: '6', dealname: 'Ganho',   stage: 'Ganho',            pipeline: 'Vendas' },
  { hs_id: '7', dealname: 'Impl',    stage: 'Implantação',      pipeline: 'Vendas' },
  { hs_id: '8', dealname: 'Sb',      stage: 'Standby',          pipeline: 'Vendas' },
  { hs_id: '9', dealname: 'SbEsp',   stage: 'Stand by',         pipeline: 'Vendas' },
  { hs_id: '10', dealname: 'BidNeg', stage: 'Negociação',       pipeline: 'Bid'    },
  { hs_id: '11', dealname: 'BidProp',stage: 'Proposta Enviada', pipeline: 'Bid'    },
];
const names = arr => arr.map(d => d.dealname).sort();

console.log('== applyDeltaScope ==');
const ativos = FC.applyDeltaScope(deals, 'Cotação|Consultoria|Negociação');
check('lista Cot/Cons/Neg = Cot/Cons/Neg (SEM Diagnóstico)', JSON.stringify(names(ativos)) === JSON.stringify(['Cons', 'Cot', 'Neg']), names(ativos).join(','));
check('remove Bid', !ativos.some(d => d.pipeline === 'Bid'));
check('remove Standby (as duas grafias)', !ativos.some(d => /Sb/.test(d.dealname)));
check('remove Diagnóstico/Reunião/Ganho/Implantação (fora da lista)', !ativos.some(d => ['Diag', 'Reuniao', 'Ganho', 'Impl'].includes(d.dealname)));

// Caso Ágatta (2026-08-14): "Diagnóstico pra frente" SEM Reunião Agendada — o
// motivo de o escopo ter virado multiselect. Nenhuma das 2 opções do antigo
// toggle binário (Ativos=3 etapas | Todo o Pipe=+Reunião Agendada) cobria isso.
const diagPraFrente = FC.applyDeltaScope(deals, 'Diagnóstico|Cotação|Consultoria|Negociação');
check('Diagnóstico pra frente = Diag+Cot+Cons+Neg (SEM Reunião Agendada)', JSON.stringify(names(diagPraFrente)) === JSON.stringify(['Cons', 'Cot', 'Diag', 'Neg']), names(diagPraFrente).join(','));

const tudoEtapas = FC.applyDeltaScope(deals, 'Reunião Agendada|Diagnóstico|Cotação|Consultoria|Negociação');
check('todas as 5 etapas abertas selecionadas = Reunião+4 (SEM Ganho/Implantação)', JSON.stringify(names(tudoEtapas)) === JSON.stringify(['Cons', 'Cot', 'Diag', 'Neg', 'Reuniao']), names(tudoEtapas).join(','));

check('seleção vazia (string vazia) = 0 deals', FC.applyDeltaScope(deals, '').length === 0);
check('nome de etapa desconhecido é ignorado (defensivo)', JSON.stringify(names(FC.applyDeltaScope(deals, 'Cotação|Etapa Inexistente'))) === JSON.stringify(['Cot']));

const tudo = FC.applyDeltaScope(deals, 'tudo');
check('tudo (sentinela legado, D09) = Reunião+4+Ganho+Impl (7 Vendas)', JSON.stringify(names(tudo)) === JSON.stringify(['Cons', 'Cot', 'Diag', 'Ganho', 'Impl', 'Neg', 'Reuniao']), names(tudo).join(','));
check('tudo remove Bid', !tudo.some(d => d.pipeline === 'Bid'));
check('tudo remove Standby', !tudo.some(d => /Sb/.test(d.dealname)));

check('default (param ausente, sem consumidor legado) = Cot/Cons/Neg', names(FC.applyDeltaScope(deals)).length === 3 && JSON.stringify(names(FC.applyDeltaScope(deals))) === JSON.stringify(['Cons', 'Cot', 'Neg']));

console.log('== deltaScopeStages ==');
check('lista Cot/Cons/Neg: 3 etapas (sem Diagnóstico)', JSON.stringify(FC.deltaScopeStages('Cotação|Consultoria|Negociação')) === JSON.stringify(['Cotação', 'Consultoria', 'Negociação']));
check('Diagnóstico pra frente: 4 etapas, ordem canônica do funil (sem Reunião)', JSON.stringify(FC.deltaScopeStages('Diagnóstico|Cotação|Consultoria|Negociação')) === JSON.stringify(['Diagnóstico', 'Cotação', 'Consultoria', 'Negociação']));
check('seleção vazia: array vazio (não cai no default)', JSON.stringify(FC.deltaScopeStages('')) === JSON.stringify([]));
check('default (param ausente): equivalente ao antigo "Ativos"', JSON.stringify(FC.deltaScopeStages()) === JSON.stringify(['Cotação', 'Consultoria', 'Negociação']));
check('tudo: 7 etapas, sem Bid/Standby/Proposta', JSON.stringify(FC.deltaScopeStages('tudo')) === JSON.stringify(['Reunião Agendada', 'Diagnóstico', 'Cotação', 'Consultoria', 'Negociação', 'Ganho', 'Implantação']));

console.log('== deltaRowInScope ==');
const rowDiag = { isBid: false, stages: ['Diagnóstico'] };
const rowGanho = { isBid: false, stages: ['Ganho', 'Implantação'] };
const rowMql = { isBid: false, stages: ['Reunião Agendada'] };
const rowBid = { isBid: true, stages: ['Proposta Enviada'] };
const ATIVOS = 'Cotação|Consultoria|Negociação';
const DIAG_PRA_FRENTE = 'Diagnóstico|Cotação|Consultoria|Negociação';
check('lista Cot/Cons/Neg descarta Diagnóstico', FC.deltaRowInScope(rowDiag, ATIVOS) === false);
check('Diagnóstico pra frente MANTÉM Diagnóstico', FC.deltaRowInScope(rowDiag, DIAG_PRA_FRENTE) === true);
check('Diagnóstico pra frente descarta Reunião Agendada', FC.deltaRowInScope(rowMql, DIAG_PRA_FRENTE) === false);
check('nenhuma seleção descarta Ganho/Implantação (nunca selecionável)', FC.deltaRowInScope(rowGanho, ATIVOS) === false && FC.deltaRowInScope(rowGanho, DIAG_PRA_FRENTE) === false);
check('qualquer escopo descarta Bid', FC.deltaRowInScope(rowBid, ATIVOS) === false && FC.deltaRowInScope(rowBid, 'tudo') === false);
check('tudo (legado) mantém Ganho e Reunião', FC.deltaRowInScope(rowGanho, 'tudo') === true && FC.deltaRowInScope(rowMql, 'tudo') === true);

console.log(fail ? ('\n' + fail + ' FALHA(S)') : '\nTODOS OK');
process.exit(fail ? 1 : 0);
