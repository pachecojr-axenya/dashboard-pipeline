'use strict';
/**
 * test-forecast-delta-scope.js — cobre o escopo Ativos/Tudo do /forecast-delta
 * (2026-07-20). UNIT, zero-deps, zero-rede. Valida applyDeltaScope /
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
const ativos = FC.applyDeltaScope(deals, 'ativos');
check('ativos = Cot/Cons/Neg (SEM Diagnóstico)', JSON.stringify(names(ativos)) === JSON.stringify(['Cons', 'Cot', 'Neg']), names(ativos).join(','));
check('ativos remove Bid', !ativos.some(d => d.pipeline === 'Bid'));
check('ativos remove Standby (as duas grafias)', !ativos.some(d => /Sb/.test(d.dealname)));
check('ativos remove Diagnóstico/Reunião/Ganho/Implantação', !ativos.some(d => ['Diag', 'Reuniao', 'Ganho', 'Impl'].includes(d.dealname)));

const tudo = FC.applyDeltaScope(deals, 'tudo');
check('tudo = Reunião+4+Ganho+Impl (7 Vendas)', JSON.stringify(names(tudo)) === JSON.stringify(['Cons', 'Cot', 'Diag', 'Ganho', 'Impl', 'Neg', 'Reuniao']), names(tudo).join(','));
check('tudo remove Bid', !tudo.some(d => d.pipeline === 'Bid'));
check('tudo remove Standby', !tudo.some(d => /Sb/.test(d.dealname)));

check('default (sem scope) = ativos', FC.applyDeltaScope(deals).length === 3);

console.log('== deltaScopeStages ==');
check('ativos: 3 etapas (sem Diagnóstico)', JSON.stringify(FC.deltaScopeStages('ativos')) === JSON.stringify(['Cotação', 'Consultoria', 'Negociação']));
check('tudo: 7 etapas, sem Bid/Standby/Proposta', JSON.stringify(FC.deltaScopeStages('tudo')) === JSON.stringify(['Reunião Agendada', 'Diagnóstico', 'Cotação', 'Consultoria', 'Negociação', 'Ganho', 'Implantação']));

console.log('== deltaRowInScope ==');
const rowDiag = { isBid: false, stages: ['Diagnóstico'] };
const rowGanho = { isBid: false, stages: ['Ganho', 'Implantação'] };
const rowMql = { isBid: false, stages: ['Reunião Agendada'] };
const rowBid = { isBid: true, stages: ['Proposta Enviada'] };
check('ativos descarta Diagnóstico', FC.deltaRowInScope(rowDiag, 'ativos') === false);
check('ativos descarta Ganho/Implantação', FC.deltaRowInScope(rowGanho, 'ativos') === false);
check('ativos descarta Reunião', FC.deltaRowInScope(rowMql, 'ativos') === false);
check('qualquer escopo descarta Bid', FC.deltaRowInScope(rowBid, 'ativos') === false && FC.deltaRowInScope(rowBid, 'tudo') === false);
check('tudo mantém Ganho e Reunião', FC.deltaRowInScope(rowGanho, 'tudo') === true && FC.deltaRowInScope(rowMql, 'tudo') === true);

console.log(fail ? ('\n' + fail + ' FALHA(S)') : '\nTODOS OK');
process.exit(fail ? 1 : 0);
