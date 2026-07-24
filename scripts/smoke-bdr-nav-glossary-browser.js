'use strict';

const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (typeof WebSocket === 'undefined') throw new Error('Este smoke requer Node com WebSocket global.');
const baseArg = process.argv.find((value) => value.indexOf('--base-url=') === 0);
const baseUrl = (baseArg ? baseArg.split('=').slice(1).join('=') : 'http://localhost:3002').replace(/\/$/, '');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9700 + (process.pid % 200);
const profile = path.join(os.tmpdir(), `axenya-bdr-nav-glossary-${process.pid}`);
const chrome = spawn(chromePath, [
  '--headless', '--disable-gpu', '--disable-background-networking', '--disable-component-update',
  '--disable-default-apps', '--disable-extensions', '--disable-sync', '--no-first-run',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  `${baseUrl}/novo-bdr/workload`,
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function targets() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { return await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch (_) { await sleep(300); }
  }
  throw new Error('Chrome CDP não iniciou.');
}

async function run() {
  const pages = await targets();
  const target = pages.find((item) => item.type === 'page' && item.url.indexOf('/novo-bdr/workload') >= 0);
  assert(target, 'Página Workload não abriu.');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let sequence = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const send = (method, params) => new Promise((resolve) => { const id = ++sequence; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params: params || {} })); });
  const evaluate = (expression) => send('Runtime.evaluate', { expression, returnByValue: true }).then((message) => message.result.result.value);
  await send('Runtime.enable');
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await evaluate('!!window.WorkloadBDRInfo && document.querySelectorAll(".nav-menu .nav-item").length > 5')) break;
    await sleep(300);
  }
  const colors = JSON.parse(await evaluate(`JSON.stringify(Object.fromEntries(Array.from(document.querySelectorAll('.nav-menu .nav-item[data-href]')).map(x=>[x.getAttribute('data-href'),x.querySelector('.health-dot')&&x.querySelector('.health-dot').className])))`));
  assert(/\by\b/.test(colors['/novo-bdr/workload']), 'Workload não ficou amarelo no menu interno.');
  assert(/\br\b/.test(colors['/novo-bdr/list-attack']), 'Ataque à Lista não ficou vermelho no menu interno.');
  assert(/\bg\b/.test(colors['/novo-bdr/treble']), 'Treble não ficou verde no menu interno.');

  await evaluate("WorkloadBDRInfo.open('Contatos elegíveis')");
  const help = await evaluate("document.querySelector('#v2-info-body').textContent");
  assert(help.includes('virou Lead no HubSpot'), 'Glossário não explica contato elegível em linguagem simples.');
  assert(help.includes('Não significa todos os contatos do HubSpot'), 'Glossário não delimita o universo elegível.');
  assert(help.includes('Como é calculado e de onde vêm os dados'), 'Drawer não mostra cálculo e origem.');
  ws.close();
  console.log(`OK | menu BDR consistente + glossário leigo | ${baseUrl}`);
}

run().finally(() => {
  chrome.kill('SIGTERM');
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
}).catch((error) => {
  console.error(`FAIL | menu/glossário BDR | ${error.message}`);
  process.exitCode = 1;
});
