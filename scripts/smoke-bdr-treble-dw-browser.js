'use strict';

const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (typeof WebSocket === 'undefined') throw new Error('Este smoke requer Node com WebSocket global (Node 22+).');

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9500 + (process.pid % 300);
const profile = path.join(os.tmpdir(), `axenya-treble-dw-smoke-${process.pid}`);
const chrome = spawn(chromePath, [
  '--headless', '--disable-gpu', '--disable-background-networking', '--disable-component-update',
  '--disable-default-apps', '--disable-extensions', '--disable-sync', '--no-first-run',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  'http://localhost:3002/novo-bdr/treble',
], { stdio: 'ignore' });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  let targets;
  for (let i = 0; i < 30; i += 1) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch (_) { await sleep(500); }
  }
  const target = targets && targets.find(x => x.type === 'page' && x.url.includes('/novo-bdr/treble'));
  assert.ok(target, 'Página Treble não abriu no Chrome headless.');

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
  for (let i = 0; i < 45; i += 1) {
    loaded = await evaluate('document.querySelector("#state").classList.contains("hidden")');
    if (loaded) break;
    const stateText = await evaluate('document.querySelector("#state").textContent');
    if (/Erro ao carregar/.test(stateText || '')) throw new Error(stateText);
    await sleep(1000);
  }
  assert.ok(loaded, 'Dashboard não concluiu o carregamento.');

  const result = JSON.parse(await evaluate(`JSON.stringify({
    source: document.querySelector('#filters').textContent.includes('ClickHouse Treble'),
    attempts: [...document.querySelectorAll('.kpi .label')].some(x => x.textContent === 'Tentativas'),
    readUnavailable: document.body.textContent.includes('Indisponível'),
    tabs: [...document.querySelectorAll('.tab')].map(x => x.textContent.trim()),
    stateHidden: document.querySelector('#state').classList.contains('hidden'),
    contentVisible: !document.querySelector('#content').classList.contains('hidden')
  })`));
  assert.strictEqual(result.source, true);
  assert.strictEqual(result.attempts, true);
  assert.strictEqual(result.readUnavailable, true);
  assert.strictEqual(result.stateHidden, true);
  assert.strictEqual(result.contentVisible, true);
  assert.ok(result.tabs.includes('Detalhe dos envios'));
  ws.close();
  console.log(`OK | smoke browser Treble DW | ${JSON.stringify(result)}`);
}

run().finally(() => {
  chrome.kill('SIGTERM');
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
}).catch(error => {
  console.error(`FAIL | smoke browser Treble DW | ${error.message}`);
  process.exitCode = 1;
});
