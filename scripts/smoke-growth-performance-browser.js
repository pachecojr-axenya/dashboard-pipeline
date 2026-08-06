'use strict';
/**
 * smoke-growth-performance-browser.js — Smoke FUNCIONAL de /growth/performance.
 *
 * HTTP 200 não é smoke: a página monta tudo em JS a partir de /api/growth-performance.
 * Este script abre o Chrome headless via CDP e exige que a página realmente
 * renderize os KPIs, que o drilldown abra com leads dentro, que o `i` abra a
 * memória de cálculo, que a troca de granularidade redesenhe a série e que o
 * console esteja limpo.
 *
 * Rodar:
 *   node scripts/smoke-growth-performance-browser.js --base-url=http://localhost:3007 --from=2026-07-01 --to=2026-07-31
 */

const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (typeof WebSocket === 'undefined') throw new Error('Este smoke requer Node com WebSocket global (Node 22+).');

function arg(name, fallback) {
  const found = process.argv.find((x) => x.indexOf(`--${name}=`) === 0);
  return found ? found.split('=').slice(1).join('=') : fallback;
}
const baseUrl = arg('base-url', 'http://localhost:3002').replace(/\/$/, '');
const from = arg('from', '2026-07-01');
const to = arg('to', '2026-07-31');

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9800 + (process.pid % 190);
const profile = path.join(os.tmpdir(), `axenya-growth-perf-smoke-${process.pid}`);
const chrome = spawn(chromePath, [
  '--headless', '--disable-gpu', '--disable-background-networking', '--disable-component-update',
  '--disable-default-apps', '--disable-extensions', '--disable-sync', '--no-first-run',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  `${baseUrl}/growth/performance`,
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  for (let i = 0; i < 40; i += 1) {
    try { return await (await fetch(`http://127.0.0.1:${port}/json`)).json(); }
    catch (_) { await sleep(500); }
  }
  throw new Error('Chrome CDP não iniciou.');
}

async function run() {
  const list = await targets();
  const target = list.find((x) => x.type === 'page' && x.url.indexOf('/growth/performance') >= 0);
  assert.ok(target, 'Página /growth/performance não abriu no Chrome headless.');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params && msg.params.type === 'error') {
      consoleErrors.push(JSON.stringify(msg.params.args || []));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push((msg.params.exceptionDetails && msg.params.exceptionDetails.text) || 'exception');
    }
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const send = (method, params) => new Promise((resolve) => {
    const id = ++seq; pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  const evaluate = (expr) => send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    .then((msg) => (msg.result && msg.result.result ? msg.result.result.value : undefined));
  await send('Runtime.enable');
  await send('Page.enable');

  // A página abre no mês corrente; forçamos a janela do smoke para ter dado.
  // A barra de filtro só existe depois do DOMContentLoaded -> load() -> renderFilters(),
  // e window.GrowthPerf existe ANTES disso. Sem retentar o clique, o smoke seguia
  // validando o mês corrente (que pode estar vazio) achando que era a janela pedida.
  let applied = false;
  for (let i = 0; i < 60; i += 1) {
    applied = await evaluate(`(function(){
      var f=document.getElementById('f-from'), t=document.getElementById('f-to'), a=document.getElementById('f-apply'), g=document.getElementById('f-gran');
      if(!f||!t||!a||!g) return false;
      f.value='${from}'; t.value='${to}'; g.value='dia';
      a.click();
      return true;
    })()`);
    if (applied) break;
    await sleep(500);
  }
  assert.strictEqual(applied, true, 'Barra de filtro de período nunca apareceu.');

  // Espera o render DA JANELA PEDIDA, não só "content visível": a carga inicial
  // usa o mês corrente e deixaria o smoke validando o período errado.
  let ready = false;
  for (let i = 0; i < 60; i += 1) {
    ready = await evaluate(`(function(){
      var c=document.getElementById('content');
      return !c.classList.contains('hidden') && c.getAttribute('data-range')==='${from}..${to}';
    })()`);
    if (ready) break;
    await sleep(1000);
  }
  assert.strictEqual(ready, true, `Conteúdo não renderizou para ${from} a ${to}.`);

  // 1) Estrutura mínima da página
  const shape = JSON.parse(await evaluate(`JSON.stringify({
    heroKpis: document.querySelectorAll('.kpis-hero .kpi').length,
    kpisTotal: document.querySelectorAll('.kpi').length,
    infoBtns: document.querySelectorAll('.calc-btn').length,
    cards: document.querySelectorAll('#content .card').length,
    chanCards: document.querySelectorAll('[data-canal]').length,
    serieSegs: document.querySelectorAll('.stack-svg rect.seg').length,
    iniRows: document.querySelectorAll('[data-ini]').length,
    corteRows: document.querySelectorAll('[data-corte]').length,
    leadLinks: document.querySelectorAll('#content a.deal-link').length,
    bigIdea: (document.querySelector('.big-idea-text')||{}).textContent||'',
    erroVisivel: /Não foi possível carregar/.test(document.getElementById('state').textContent) && !document.getElementById('state').classList.contains('hidden')
  })`));

  assert.strictEqual(shape.erroVisivel, false, 'Página mostrou estado de erro.');
  assert.strictEqual(shape.heroKpis, 4, `Esperava 4 KPIs hero, veio ${shape.heroKpis}.`);
  assert(shape.kpisTotal >= 10, `Poucos KPIs renderizados: ${shape.kpisTotal}.`);
  assert(shape.infoBtns >= 10, `Poucos botões i de memória de cálculo: ${shape.infoBtns}.`);
  assert(shape.cards >= 8, `Poucos cards: ${shape.cards}.`);
  assert(shape.chanCards >= 2, `Esperava ao menos Meta e LinkedIn como cards de canal, veio ${shape.chanCards}.`);
  assert(shape.serieSegs > 0, 'Série temporal sem barra de spend.');
  assert(shape.iniRows > 0, 'Tabela de iniciativas vazia.');
  assert(shape.corteRows > 0, 'Nenhum corte (cargo/porte/área) renderizado.');
  assert(shape.leadLinks > 0, 'Tabela de leads sem link para o HubSpot.');
  assert(/R\$/.test(shape.bigIdea), `Conclusão do topo sem valor monetário: ${shape.bigIdea}`);

  // 2) Separador canônico: travessão só como placeholder de "sem dado"
  const separadorRuim = await evaluate(`(function(){
    var txt = document.getElementById('content').textContent;
    var m = txt.match(/\\w\\s+[–]\\s+\\w/g);
    return m ? m.slice(0,3).join(' /// ') : '';
  })()`);
  assert.strictEqual(separadorRuim, '', `En-dash usado como separador: ${separadorRuim}`);

  // 3) Drilldown de KPI abre modal COM leads dentro
  await evaluate("document.querySelector('.kpis-hero .kpi[data-drill=\"pagos\"]').click()");
  await sleep(600);
  const modal = JSON.parse(await evaluate(`JSON.stringify({
    open: document.getElementById('modal-overlay').classList.contains('open'),
    kpis: document.querySelectorAll('#modal-body .modal-kpi').length,
    rows: document.querySelectorAll('#modal-body tbody tr').length,
    titulo: document.getElementById('modal-title').textContent
  })`));
  assert.strictEqual(modal.open, true, 'Drilldown do KPI não abriu modal.');
  assert.strictEqual(modal.kpis, 4, 'Modal sem os 4 KPIs de reconciliação.');
  assert(modal.rows > 0, 'Modal de leads pagos veio vazio.');
  await evaluate('GrowthPerf.closeModal()');

  // 4) `i` abre memória de cálculo com fórmula
  await evaluate("document.querySelector('.calc-btn[data-help=\"cplPago\"]').click()");
  await sleep(400);
  const drawer = JSON.parse(await evaluate(`JSON.stringify({
    open: document.getElementById('help-drawer').classList.contains('open'),
    titulo: document.getElementById('help-title').textContent,
    corpo: document.getElementById('help-body').textContent.length
  })`));
  assert.strictEqual(drawer.open, true, 'Drawer de memória de cálculo não abriu.');
  assert(/CPL/.test(drawer.titulo), `Título do drawer inesperado: ${drawer.titulo}`);
  assert(drawer.corpo > 120, 'Memória de cálculo sem conteúdo suficiente.');
  await evaluate('GrowthPerf.closeHelp()');

  // 5) Clique na barra da série abre o período
  // SVGElement não tem .click() (só HTMLElement tem) — dispara evento de mouse real.
  await evaluate("document.querySelector('.stack-svg rect.seg').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))");
  await sleep(600);
  const bucketModal = JSON.parse(await evaluate(`JSON.stringify({
    open: document.getElementById('modal-overlay').classList.contains('open'),
    titulo: document.getElementById('modal-title').textContent
  })`));
  assert.strictEqual(bucketModal.open, true, 'Clique na barra não abriu drilldown do período.');
  assert(/spend/.test(bucketModal.titulo), `Título do drill de período sem spend: ${bucketModal.titulo}`);
  await evaluate('GrowthPerf.closeModal()');

  // 6) Granularidade redesenha a série
  const segsDia = await evaluate("document.querySelectorAll('.stack-svg rect.seg').length");
  await evaluate("document.querySelector('.granbar [data-gran=\"mes\"]').click()");
  await sleep(800);
  const mes = JSON.parse(await evaluate(`JSON.stringify({
    segs: document.querySelectorAll('.stack-svg rect.seg').length,
    ativo: (document.querySelector('.granbar [data-gran="mes"]')||{}).className||'',
    granAtual: document.getElementById('content').getAttribute('data-gran-atual')
  })`));
  assert(mes.segs > 0, 'Série por mês ficou sem barra.');
  assert(/active/.test(mes.ativo), `Botão de granularidade mês não marcou ativo (class="${mes.ativo}").`);
  assert.strictEqual(mes.granAtual, 'mes', 'Estado de granularidade não virou mês.');
  assert(mes.segs <= segsDia, `Agregação por mês devia ter no máximo tantas barras quanto por dia (${mes.segs} > ${segsDia}).`);
  await evaluate("document.querySelector('.granbar [data-gran=\"dia\"]').click()");
  await sleep(600);

  // 7) Higiene de marcação presente (bloco existe mesmo quando está tudo OK)
  const higiene = await evaluate("document.querySelectorAll('.alert-row').length");
  assert(higiene > 0, 'Bloco de higiene de marcação não renderizou nenhuma linha.');

  assert.deepStrictEqual(consoleErrors, [], `erros JS no console: ${consoleErrors.join(' | ')}`);
  ws.close();
  console.log(`OK | smoke growth performance CDP | ${baseUrl} | ${from} a ${to} | kpis=${shape.kpisTotal} cards=${shape.cards} barras=${segsDia} iniciativas=${shape.iniRows} leads=${shape.leadLinks}`);
}

run().finally(() => {
  chrome.kill('SIGTERM');
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
}).catch((error) => {
  console.error(`FAIL | smoke growth performance CDP | ${error.message}`);
  process.exitCode = 1;
});
