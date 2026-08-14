'use strict';
/**
 * test-refresh-gate.js — as travas do botão Atualizar (regras 1 e 5 do handoff F5).
 *
 *   node scripts/test-refresh-gate.js
 *
 * Por que teste sintético e não um clique de verdade: as duas regras são sobre
 * TEMPO. O teto é "1 refresh a cada 5 min por escopo", e uma execução de escopo
 * `workload` leva ~5,5 min — esperar a janela fechar para ver o 429 é lento e,
 * pior, dá um resultado diferente a cada execução. Aqui as execuções são
 * fabricadas com a idade exata, então a fronteira é testável de verdade:
 * 4min59s tem de recusar, 5min01s tem de aceitar.
 *
 * A ida real ao Cloud Run é coberta pelo smoke em produção (o 202 com run_id que
 * aparece em bronze.raw_extract_run, e o 429 de concorrência no 2º clique).
 */

const assert = require('assert');
const jobs = require('../lib/hubspot-jobs');

const MIN = 60 * 1000;
let passou = 0;

function exec({ escopo = 'workload', idadeMin = 0, viva = false, run_id = 'r1' }) {
  return {
    nome: 'exec-' + run_id,
    run_id,
    escopo,
    em_andamento: viva,
    idade_ms: idadeMin * MIN,
    iniciado_em: new Date(Date.now() - idadeMin * MIN).toISOString(),
    status: viva ? 'RUNNING' : 'OK',
  };
}

function caso(nome, fn) {
  try {
    fn();
    passou++;
    console.log('  ok   ' + nome);
  } catch (e) {
    console.log('  FALHA ' + nome + '\n        ' + e.message);
    process.exitCode = 1;
  }
}

console.log('gate() — trava de concorrência (regra 1)');

caso('sem execução nenhuma libera', () => {
  assert.deepStrictEqual(jobs.gate([], 'tudo'), { ok: true });
});

caso('execução viva recusa por concorrência', () => {
  const v = jobs.gate([exec({ viva: true, idadeMin: 1 })], 'tudo');
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.motivo, 'concorrencia');
});

caso('execução viva de OUTRO escopo também recusa', () => {
  // De propósito: o job é um só. Duas execuções simultâneas duplicam o custo de
  // request da API do HubSpot sem trazer nada — o MERGE é idempotente, o
  // orçamento não é.
  const v = jobs.gate([exec({ escopo: 'leads', viva: true, idadeMin: 1 })], 'workload');
  assert.strictEqual(v.motivo, 'concorrencia');
});

caso('fechamento em andamento tambem recusa o botao', () => {
  // A trava olhava so o `reconcile`, entao o `close` era invisivel e o botao
  // podia disparar por cima de um fechamento. Os dois fazem CREATE OR REPLACE no
  // mesmo gold: duas execucoes simultaneas reescrevem as mesmas tabelas e quem
  // le no meio ve o estado de ninguem. Com refresh intraday, a colisao deixa de
  // ser hipotese.
  const fechamento = Object.assign(exec({ viva: true, idadeMin: 2 }), { job: 'hubspot-platform-close' });
  const v = jobs.gate([fechamento], 'workload');
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.motivo, 'concorrencia');
});

caso('execução viva há mais de 30 min é considerada morta e libera', () => {
  // Zumbi não pode travar o botão por uma hora inteira (task-timeout é 60 min).
  const v = jobs.gate([exec({ viva: true, idadeMin: 31 })], 'workload');
  assert.strictEqual(v.ok, true);
});

console.log('gate() — teto de uso (regra 5)');

caso('mesmo escopo há 1 min recusa por teto', () => {
  const v = jobs.gate([exec({ escopo: 'workload', idadeMin: 1 })], 'workload');
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.motivo, 'teto');
  assert.strictEqual(v.execucao.run_id, 'r1');
});

caso('mesmo escopo em 4min59s ainda recusa', () => {
  const v = jobs.gate([exec({ escopo: 'workload', idadeMin: 4 + 59 / 60 })], 'workload');
  assert.strictEqual(v.motivo, 'teto');
});

caso('mesmo escopo em 5min01s libera', () => {
  const v = jobs.gate([exec({ escopo: 'workload', idadeMin: 5 + 1 / 60 })], 'workload');
  assert.strictEqual(v.ok, true);
});

caso('escopo DIFERENTE não é barrado pelo teto', () => {
  // O teto é por escopo: quem olha a tela de leads não espera o cooldown de quem
  // acabou de atualizar o workload.
  const v = jobs.gate([exec({ escopo: 'workload', idadeMin: 1 })], 'leads');
  assert.strictEqual(v.ok, true);
});

caso('concorrência tem precedência sobre teto', () => {
  const v = jobs.gate([
    exec({ escopo: 'workload', idadeMin: 1, viva: true, run_id: 'viva' }),
    exec({ escopo: 'workload', idadeMin: 2, run_id: 'antiga' }),
  ], 'workload');
  assert.strictEqual(v.motivo, 'concorrencia');
  assert.strictEqual(v.execucao.run_id, 'viva');
});

console.log('escopos aceitos');

caso('só workload, leads e tudo', () => {
  assert.deepStrictEqual([...jobs.SCOPES].sort(), ['leads', 'tudo', 'workload']);
});

caso('constantes de tempo batem com o handoff', () => {
  assert.strictEqual(jobs.COOLDOWN_MS, 5 * 60 * 1000, 'teto é de 5 min');
  assert.strictEqual(jobs.STALE_MS, 30 * 60 * 1000, 'zumbi expira em 30 min');
});

console.log(`\n${passou} casos ok${process.exitCode ? ' — com falhas acima' : ''}`);
