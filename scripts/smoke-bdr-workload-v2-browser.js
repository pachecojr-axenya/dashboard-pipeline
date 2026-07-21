'use strict';

const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (typeof WebSocket === 'undefined') throw new Error('Este smoke requer Node com WebSocket global (Node 22+).');

const baseArg = process.argv.find((x) => x.indexOf('--base-url=') === 0);
const baseUrl = (baseArg ? baseArg.split('=').slice(1).join('=') : 'http://localhost:3002').replace(/\/$/, '');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9400 + (process.pid % 400);
const profile = path.join(os.tmpdir(), `axenya-workload-v2-smoke-${process.pid}`);
const chrome = spawn(chromePath, [
  '--headless', '--disable-gpu', '--disable-background-networking', '--disable-component-update',
  '--disable-default-apps', '--disable-extensions', '--disable-sync', '--no-first-run',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  `${baseUrl}/novo-bdr/workload`,
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function pages() {
  for (let i = 0; i < 30; i += 1) {
    try { return await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch (_) { await sleep(500); }
  }
  throw new Error('Chrome CDP não iniciou.');
}
async function run() {
  const targets = await pages();
  const target = targets.find((x) => x.type === 'page' && x.url.indexOf('/novo-bdr/workload') >= 0);
  assert.ok(target, 'Página workload não abriu no Chrome headless.');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params && msg.params.type === 'error') consoleErrors.push(JSON.stringify(msg.params.args || []));
    if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params.exceptionDetails && msg.params.exceptionDetails.text || 'exception');
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const send = (method, params) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params: params || {} })); });
  const evaluate = (expression) => send('Runtime.evaluate', { expression, returnByValue: true }).then((msg) => msg.result && msg.result.result ? msg.result.result.value : undefined);
  await send('Runtime.enable');
  await send('Page.enable');

  for (let i = 0; i < 60; i += 1) {
    const ready = await evaluate('window.BDR_WORKLOAD_V2_ASSET_LOADED===true && !!window.WorkloadBDRV2 && !document.querySelector("#content").classList.contains("hidden")');
    if (ready) break;
    await sleep(1000);
  }
  const tabs = ['pulse', 'channels', 'management', 'penetration', 'evolution'];
  for (const tab of tabs) {
    await evaluate(`WorkloadBDRV2.tab('${tab}')`);
    await sleep(1800);
    const ok = await evaluate(`JSON.stringify({tab:'${tab}', selected:document.querySelector('#tab-${tab}').getAttribute('aria-selected'), panel:document.querySelector('#v2-panel').textContent.length, error:/Erro/.test(document.querySelector('#v2-panel').textContent), buttons:document.querySelectorAll('#v2-panel button').length})`);
    const parsed = JSON.parse(ok);
    assert.strictEqual(parsed.selected, 'true', `aba ${tab} não selecionou`);
    assert(parsed.panel > 20, `aba ${tab} sem conteúdo`);
    assert.strictEqual(parsed.error, false, `aba ${tab} com erro visível`);
    assert(parsed.buttons > 0, `aba ${tab} sem interações`);
  }
  await evaluate("WorkloadBDRV2.openInfo('channels')");
  await sleep(300);
  assert.strictEqual(await evaluate("document.querySelector('#v2-info-drawer').classList.contains('open')"), true, 'drawer de memória não abriu');
  await evaluate("WorkloadBDRV2.closeInfo()");
  await evaluate("WorkloadBDRV2.openDrill('penetration','bucket:2–3')");
  await sleep(1500);
  assert.strictEqual(await evaluate("document.querySelector('#modal-overlay').classList.contains('open')"), true, 'modal/drill não abriu');
  const modalText = await evaluate("document.querySelector('#modal-body').textContent");
  assert(/total|Consulta válida|Reconciliação/i.test(modalText), 'drill sem reconciliação/resultado');
  assert.deepStrictEqual(consoleErrors, [], `erros JS no console: ${consoleErrors.join(' | ')}`);
  ws.close();
  console.log(`OK | smoke browser workload v2 CDP | ${baseUrl} | abas=${tabs.length}`);
}

run().finally(() => {
  chrome.kill('SIGTERM');
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
}).catch((error) => {
  console.error(`FAIL | smoke browser workload v2 CDP | ${error.message}`);
  process.exitCode = 1;
});
