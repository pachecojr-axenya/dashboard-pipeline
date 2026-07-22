'use strict';

const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (typeof WebSocket === 'undefined') throw new Error('Este smoke requer Node com WebSocket global (Node 22+).');

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9300 + (process.pid % 500);
const profile = path.join(os.tmpdir(), `axenya-no-show-smoke-${process.pid}`);
const chrome = spawn(chromePath, [
  '--headless', '--disable-gpu', '--disable-background-networking', '--disable-component-update',
  '--disable-default-apps', '--disable-extensions', '--disable-sync', '--no-first-run',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  'http://localhost:3002/novo-bdr/no-show',
], { stdio: 'ignore' });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function pages() {
  for (let i = 0; i < 30; i += 1) {
    try { return await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch (_) { await sleep(500); }
  }
  throw new Error('Chrome CDP não iniciou.');
}

async function run() {
  const targets = await pages();
  const target = targets.find(x => x.type === 'page' && x.url.includes('/novo-bdr/no-show'));
  assert.ok(target, 'Página no-show não abriu no Chrome headless.');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const evaluate = expression => new Promise(resolve => {
    const id = ++seq;
    pending.set(id, msg => resolve(msg.result && msg.result.result ? msg.result.result.value : undefined));
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });

  let loaded = false;
  for (let i = 0; i < 60; i += 1) {
    loaded = await evaluate('document.querySelector("#state").classList.contains("hidden")');
    if (loaded) break;
    const failed = await evaluate('document.querySelector("#state").textContent.includes("Erro ao carregar")');
    if (failed) throw new Error('Página local retornou erro ao carregar dados.');
    await sleep(1000);
  }
  assert.ok(loaded, 'Página não concluiu o carregamento em 60s.');
  await evaluate('document.querySelector("[data-rate-filter=bdr]").click()');
  await sleep(300);
  const raw = await evaluate(`JSON.stringify({
    active: document.querySelector('[data-rate-filter].active').textContent,
    legend: document.querySelectorAll('#rate-legend .rate-legend-item').length,
    historicalBdr: [...document.querySelectorAll('#rate-legend .rate-legend-item')].some(x=>x.textContent.includes('Gabriel Milan Ramos (Histórico | inativo)')),
    axis: [...document.querySelectorAll('#rate-chart svg>text')].slice(0,2).map(x=>x.textContent),
    executives: [...document.querySelectorAll('#rate-legend .rate-legend-item')].some(x=>/André Pontes|Guilherme Gabiatti|Rafael Leite|Fausto|Juliana Dalberto|Ágatta/.test(x.textContent)),
    outsideRank: [...document.querySelectorAll('[data-rank-mode=outside]')].reduce((s,x)=>s+Number(x.querySelector('.pill').textContent.replace(/\\D/g,'')),0),
    recoveryOutside: [...document.querySelectorAll('.table-wrap tbody tr .pill.bad')].filter(x=>x.textContent.includes('Fora SLA')).length,
    has130: document.querySelector('#rate-chart').textContent.includes('130%'),
    reconciliation: document.querySelector('.data-scope-warning').textContent
  })`);
  const result = JSON.parse(raw);
  assert.strictEqual(result.active, 'Por BDR');
  assert.strictEqual(result.legend, 14, 'legenda deve conter 13 BDRs atuais + Gabriel histórico');
  assert.strictEqual(result.historicalBdr, true, 'Gabriel deve aparecer rotulado como histórico/inativo');
  assert.deepStrictEqual(result.axis, ['100%', '0%']);
  assert.strictEqual(result.executives, false, 'AE não pode aparecer na visão por BDR');
  assert.strictEqual(result.has130, false, 'eixo não pode ultrapassar 100%');
  assert.ok(result.outsideRank <= result.recoveryOutside, 'ranking BDR fora SLA não pode exceder a fila operacional global');
  assert.ok(result.reconciliation.includes('A taxa global usa todas as reuniões'), 'disclaimer deve explicar o universo global');

  await evaluate('document.querySelector("[data-rate-filter=ae]").click()');
  await sleep(300);
  const aeRaw = await evaluate(`JSON.stringify({
    active: document.querySelector('[data-rate-filter].active').textContent,
    legend: document.querySelectorAll('#rate-legend .rate-legend-item').length,
    executives: [...document.querySelectorAll('#rate-legend .rate-legend-item')].some(x=>/André Pontes|Guilherme Gabiatti|Rafael Leite|Fausto|Juliana Dalberto|Ágatta/.test(x.textContent))
  })`);
  const aeResult = JSON.parse(aeRaw);
  assert.strictEqual(aeResult.active, 'Por AE');
  assert.ok(aeResult.legend > 0, 'visão por AE deve renderizar séries');
  assert.strictEqual(aeResult.executives, true, 'visão por AE deve exibir executivos');
  ws.close();
  console.log(`OK | smoke browser no-show | BDR=${JSON.stringify(result)} | AE=${JSON.stringify(aeResult)}`);
}

run().finally(() => {
  chrome.kill('SIGTERM');
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
}).catch(error => {
  console.error(`FAIL | smoke browser no-show | ${error.message}`);
  process.exitCode = 1;
});
