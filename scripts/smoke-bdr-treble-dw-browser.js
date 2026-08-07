'use strict';

const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (typeof WebSocket === 'undefined') {
  throw new Error('Este smoke requer Node com WebSocket global (Node 22+).');
}

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9500 + (process.pid % 300);
// Porta do servidor local é parametrizável: 3002 costuma ficar presa por
// instâncias antigas de `vercel dev`, e o smoke não deve depender disso.
const appPort = parseInt(process.env.SMOKE_PORT, 10) || 3002;
const appUrl = `http://localhost:${appPort}/novo-bdr/treble`;
const profile = path.join(os.tmpdir(), `axenya-treble-dw-smoke-${process.pid}`);
const chrome = spawn(chromePath, [
  '--headless',
  '--disable-gpu',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-extensions',
  '--disable-sync',
  '--no-first-run',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  appUrl
], { stdio: 'ignore' });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  let targets;
  for (let i = 0; i < 30; i += 1) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      break;
    } catch (_) {
      await sleep(500);
    }
  }

  const target = targets && targets.find(x => x.type === 'page' && x.url.includes('/novo-bdr/treble'));
  assert.ok(target, 'Página Treble não abriu no Chrome headless.');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  const evaluate = expression => new Promise(resolve => {
    const id = ++seq;
    pending.set(id, msg => resolve(msg.result && msg.result.result ? msg.result.result.value : undefined));
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });

  // O carregamento inicial usa o preset salvo (default "Hoje") e pode terminar
  // legitimamente vazio quando ninguém disparou hoje. Concluído = conteúdo
  // visível OU empty state renderizado; o que não pode é ficar no spinner.
  let settled = false;
  for (let i = 0; i < 45; i += 1) {
    settled = await evaluate('document.querySelector("#state").classList.contains("hidden") || !document.querySelector("#state").querySelector(".spinner")');
    if (settled) break;
    const stateText = await evaluate('document.querySelector("#state").textContent');
    if (/Erro ao carregar/.test(stateText || '')) throw new Error(stateText);
    await sleep(1000);
  }
  assert.ok(settled, 'Dashboard não concluiu o carregamento.');

  // Regressão do defeito reportado em 07/08/2026: com período corrente vazio a
  // tela trocava a fonte por /api/bdr-treble?days=30 e pintava 30 dias sob o
  // chip "Hoje". Agora tem de continuar no warehouse, com zero honesto.
  const firstLoad = JSON.parse(await evaluate(`JSON.stringify({
    dwMode: BdrTreble._test._state.dwMode,
    rows: BdrTreble._test._state.rows.length,
    rangeLabel: (BdrTreble._test._state.range || {}).label || '',
    activePeriodChip: (function(){
      var chip = document.querySelector('.period-chip.active');
      return chip ? chip.textContent.trim() : '';
    })(),
    stateText: document.querySelector('#state').textContent || ''
  })`));

  assert.strictEqual(firstLoad.dwMode, true, 'período vazio não pode derrubar a tela para o fallback REST');
  if (firstLoad.rows === 0) {
    assert.ok(
      firstLoad.stateText.indexOf(firstLoad.activePeriodChip) !== -1,
      `empty state deve nomear o período selecionado (${firstLoad.activePeriodChip}), não um "sem dados" genérico`
    );
    assert.ok(
      /zero é a resposta do período/i.test(firstLoad.stateText),
      'empty state deve afirmar que zero é a resposta do período'
    );
  }
  assert.ok(
    firstLoad.rangeLabel.indexOf('30 dias') === -1 || firstLoad.activePeriodChip === '30d',
    'o período exibido tem de bater com o chip selecionado'
  );

  await evaluate(`(function(){
    var from = document.querySelector('#f-from');
    var to = document.querySelector('#f-to');
    from.value = '2026-07-01';
    to.value = '2026-07-02';
    document.querySelector('#f-apply').click();
  })()`);

  for (let i = 0; i < 30; i += 1) {
    const text = await evaluate('document.body.textContent');
    if (/01\/07\/2026 a 02\/07\/2026/.test(text || '')) break;
    const stateText = await evaluate('document.querySelector("#state").textContent');
    if (/Erro ao carregar/.test(stateText || '')) throw new Error(stateText);
    await sleep(500);
  }

  async function clickTab(label) {
    const ok = await evaluate(`(function(){
      var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
      var tab = tabs.filter(function(x){ return x.textContent.trim() === '${label}'; })[0];
      if (!tab) return false;
      tab.click();
      return true;
    })()`);
    assert.strictEqual(ok, true, `Tab ${label} não encontrada`);
    await sleep(300);
  }

  await clickTab('Status');
  const statusOk = await evaluate('!!document.querySelector(".stack100")');
  const statusPctTotal = await evaluate(`Array.prototype.slice.call(document.querySelectorAll('table tbody tr')).reduce(function(sum,row){
    var cell = row.querySelectorAll('td')[2];
    return sum + (cell ? Number(cell.textContent.replace('%','').replace(',','.')) : 0);
  },0)`);
  await clickTab('Quem enviou');
  const agentsOk = await evaluate('document.body.textContent.includes("Quem tentou enviar")');
  await clickTab('Linha do tempo');
  const timelineOk = await evaluate('!!document.querySelector(".timeline-chart") && document.body.textContent.includes("Linha do tempo")');
  await clickTab('Arquitetura API');
  const apiOk = await evaluate('document.body.textContent.includes("Contrato de métricas") && document.body.textContent.includes("Qualidade da atribuição")');

  const jsError = await evaluate('window.__trebleSmokeError || null');
  assert.strictEqual(jsError, null);

  const result = JSON.parse(await evaluate(`JSON.stringify({
    customLabel: document.body.textContent.includes('01/07/2026 a 02/07/2026'),
    activeLine: document.body.textContent.includes('mostrando'),
    dwMode: BdrTreble._test._state.dwMode,
    freshnessSeal: /último disparo registrado/i.test(document.body.textContent),
    emptyPeriodKeptDw: ${firstLoad.dwMode},
    statusOk: ${statusOk},
    statusPctTotal: ${statusPctTotal},
    agentsOk: ${agentsOk},
    timelineOk: ${timelineOk},
    apiOk: ${apiOk},
    stateHidden: document.querySelector('#state').classList.contains('hidden'),
    contentVisible: !document.querySelector('#content').classList.contains('hidden')
  })`));

  assert.strictEqual(result.customLabel, true);
  assert.strictEqual(result.activeLine, true);
  assert.strictEqual(result.dwMode, true, 'range customizado com dados deve ser servido pelo warehouse');
  assert.strictEqual(result.freshnessSeal, true, 'selo de frescor do warehouse deve estar visível na tela');
  assert.strictEqual(result.statusOk, true);
  assert.ok(Math.abs(result.statusPctTotal - 100) < 0.01, 'percentuais visuais de status devem somar 100%');
  assert.strictEqual(result.agentsOk, true);
  assert.strictEqual(result.timelineOk, true);
  assert.strictEqual(result.apiOk, true);
  assert.strictEqual(result.stateHidden, true);
  assert.strictEqual(result.contentVisible, true);

  ws.close();
  console.log(`OK | smoke browser Treble DW V2 | ${JSON.stringify(result)}`);
}

run().finally(() => {
  chrome.kill('SIGTERM');
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
}).catch(error => {
  console.error(`FAIL | smoke browser Treble DW | ${error.message}`);
  process.exitCode = 1;
});
