'use strict';
/**
 * smoke-bdr-weekly-window-browser.js — prova, no browser, o defeito que o dono relatou
 * em 24/08/2026 na /novo-bdr:
 *
 *   "se eu coloco este ano para ver os dados, em weekly origination só mostra desde junho"
 *
 * Causa: `_getMonths(n)` já lia o filtro de período (`_filterState()`) e enumerava os
 * meses da janela, mas `_getWeeks(n)` NÃO — devolvia sempre as últimas n semanas a
 * partir de hoje. Com n=13 no R13, "Este ano" mostrava o Monthly abrindo em janeiro e
 * o Weekly começando na semana de ~1º de junho. Não era dado faltando: era o EIXO.
 *
 * Por que browser e não teste de dados: o payload sempre teve os deals de janeiro —
 * `_origDeals()` os entrega. O que os descartava era o `weeks` do render. Fixture
 * local, sem HubSpot e sem BigQuery.
 *
 *   node scripts/smoke-bdr-weekly-window-browser.js
 */

const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

if (typeof WebSocket === 'undefined') throw new Error('Este smoke requer Node com WebSocket global (Node 22+).');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2' };

// ── fixture ───────────────────────────────────────────────────────────────────────
// Um deal por mês do ano corrente, de janeiro até o mês atual, com o BDR do roster.
// O ponto do teste é temporal, não de agregação: 1 deal por mês basta para o eixo
// provar que a semana existe. Dia 15 para não encostar em virada de mês/semana.
const ANO = new Date().getFullYear();
const MES_ATUAL = new Date().getMonth() + 1;             // 1..12
const BDR = 'Priscilla Feliciello';

function montarDeals() {
  const deals = [];
  for (let m = 1; m <= MES_ATUAL; m += 1) {
    const dia = `${ANO}-${String(m).padStart(2, '0')}-15`;
    deals.push({
      id: String(200000 + m),
      dealname: `Deal mês ${m}`,
      pipeline: 'Vendas',
      stage: 'Reunião Agendada',
      sdr: BDR,
      origem: 'Outbound BDRs',
      colaboradores: 120,
      vidas: 300,
      data_reuniao_agendada: dia,
      createdate: dia,
      company_in_lista_abm: false,
    });
  }
  return deals;
}

const DEALS = montarDeals();
// Semana ISO (segunda) de 15/jan: é o primeiro rótulo que o eixo DEVE alcançar com
// "Este ano" ativo. Calculado aqui e não fixado à mão para o smoke não apodrecer.
function segundaDe(iso) {
  const d = new Date(`${iso}T00:00:00`);
  const off = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - off);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const SEMANA_JAN = segundaDe(`${ANO}-01-15`);

const ROTAS = { '/novo-bdr': 'bdr.html', '/': 'bdr.html' };

const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;

  if (p === '/api/forecast-table') {
    res.writeHead(200, { 'Content-Type': MIME['.json'] });
    return res.end(JSON.stringify({ success: true, deals: DEALS, total: DEALS.length }));
  }
  if (p === '/api/bdr-metas') {
    res.writeHead(200, { 'Content-Type': MIME['.json'] });
    return res.end(JSON.stringify({ success: true, metas: {}, monthly: {} }));
  }
  // Funil de Leads fora de escopo (tem smoke próprio); 503 é caminho que ele trata.
  if (p === '/api/bdr-lead-funnel') {
    res.writeHead(503, { 'Content-Type': MIME['.json'] });
    return res.end(JSON.stringify({ success: false, error: 'fora do escopo deste smoke' }));
  }
  if (p.indexOf('/api/') === 0) {
    res.writeHead(200, { 'Content-Type': MIME['.json'] });
    return res.end(JSON.stringify({ success: true, deals: [], rows: [], data: [], leads: [], items: [] }));
  }

  const arquivo = ROTAS[p] || p.replace(/^\//, '');
  const abs = path.join(ROOT, 'public', arquivo);
  if (!abs.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404); return res.end('nao encontrado');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream' });
  fs.createReadStream(abs).pipe(res);
});

const PORT = 3800 + (process.pid % 90);
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const cdpPort = 9100 + (process.pid % 300);
const profile = path.join(os.tmpdir(), `axenya-weekly-window-smoke-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let chrome;
let falhas = 0;
function ok(cond, texto, extra) {
  if (!cond) falhas += 1;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + texto + (extra != null ? '   | ' + extra : ''));
}

async function alvos() {
  for (let i = 0; i < 40; i += 1) {
    try { return await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json(); } catch (_) { await sleep(500); }
  }
  throw new Error('Chrome CDP não iniciou.');
}

const WEEKLY = "_novoCharts['chart-bdr-weekly-origin']";
const MONTHLY = "_novoCharts['chart-bdr-leads-origin']";
const somaWeekly = `(function(){var c=${WEEKLY};return c.data.datasets.reduce(function(a,d){`
  + 'return a+d.data.reduce(function(x,y){return x+(y||0);},0);},0);})()';

async function run() {
  await new Promise((r) => server.listen(PORT, r));
  chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-component-update',
    '--disable-default-apps', '--disable-extensions', '--disable-sync', '--no-first-run',
    '--window-size=1440,2400',
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`,
    `http://localhost:${PORT}/novo-bdr`,
  ], { stdio: 'ignore' });

  const targets = await alvos();
  const target = targets.find((x) => x.type === 'page' && x.url.indexOf('/novo-bdr') >= 0);
  assert.ok(target, 'Página /novo-bdr não abriu no Chrome headless.');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pendentes = new Map();
  const erros = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params && msg.params.type === 'error') {
      erros.push(JSON.stringify(msg.params.args || []).slice(0, 300));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const ed = (msg.params || {}).exceptionDetails || {};
      const det = (ed.exception && (ed.exception.description || ed.exception.value)) || ed.text || '';
      erros.push('EXCEPTION ' + String(det).slice(0, 400));
    }
    if (msg.id && pendentes.has(msg.id)) { pendentes.get(msg.id)(msg); pendentes.delete(msg.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const cmd = (method, params) => new Promise((resolve) => {
    const id = ++seq; pendentes.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  await cmd('Runtime.enable');
  await cmd('Page.enable');

  const js = async (expr) => {
    const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    return r.result && r.result.result && r.result.result.value;
  };

  let pronto = false;
  for (let i = 0; i < 40; i += 1) {
    pronto = await js(`!!(window._novoCharts && ${WEEKLY})`);
    if (pronto) break;
    await sleep(500);
  }
  ok(pronto, 'o gráfico Weekly Origination montou');
  if (!pronto) return finalizar(ws, erros);

  // ── sem filtro: comportamento histórico preservado ───────────────────────────
  console.log('\n== sem filtro de período ==');
  const nSem = await js(`${WEEKLY}.data.labels.length`);
  ok(nSem === 13, 'sem filtro o eixo continua com 13 semanas', nSem);

  // ── "Este ano": o defeito ────────────────────────────────────────────────────
  console.log('\n== filtro "Este ano" ==');
  await js("AxF.preset('curyear')");
  await sleep(1500);

  const labels = JSON.parse(await js(`JSON.stringify(${WEEKLY}.data.labels)`));
  console.log(`         ${labels.length} rótulos | primeiro=${labels[0]} último=${labels[labels.length - 1]}`);

  ok(labels.length > 13, 'o eixo passa de 13 semanas — a janela do filtro manda', labels.length);

  // O rótulo é dd/mm. A semana de 15/jan tem de estar no eixo: era ela que o
  // gráfico deixava de fora, e é o "só mostra desde junho" do relato.
  const rotuloJan = `${SEMANA_JAN.slice(8, 10)}/${SEMANA_JAN.slice(5, 7)}`;
  ok(labels.indexOf(rotuloJan) >= 0, `a semana de janeiro (${rotuloJan}) está no eixo`,
    JSON.stringify(labels.slice(0, 4)));
  ok(labels[0] === rotuloJan || labels.indexOf(rotuloJan) <= 2,
    'janeiro está no COMEÇO do eixo, não no meio', `índice ${labels.indexOf(rotuloJan)}`);

  // Nenhuma semana futura: "Este ano" termina em 31/12 e semana que não aconteceu
  // não é dado — seriam ~18 barras vazias na ponta.
  const futuro = await js(`(function(){
    var hoje=new Date(); var off=(hoje.getDay()+6)%7; hoje.setDate(hoje.getDate()-off);
    var k=hoje.getFullYear()+'-'+String(hoje.getMonth()+1).padStart(2,'0')+'-'+String(hoje.getDate()).padStart(2,'0');
    return _getWeeks(13).filter(function(w){return w>k;}).length;
  })()`);
  ok(futuro === 0, 'o eixo para na semana corrente | nenhuma semana futura', futuro);

  // O total desenhado tem de ser TODOS os deals da janela (um por mês até hoje).
  const soma = await js(somaWeekly);
  ok(soma === DEALS.length, `o Weekly soma os ${DEALS.length} deals do ano`, soma);

  // E o Weekly passa a cobrir a MESMA janela do Monthly — era a incoerência visível.
  const mesesMonthly = JSON.parse(await js(`JSON.stringify(${MONTHLY}.data.labels)`));
  const somaMonthly = await js(`(function(){var c=${MONTHLY};return c.data.datasets.reduce(function(a,d){`
    + 'return a+d.data.reduce(function(x,y){return x+(y||0);},0);},0);})()');
  ok(soma === somaMonthly, 'Weekly e Monthly fecham o mesmo total na janela',
    `weekly=${soma} monthly=${somaMonthly} (${mesesMonthly.length} meses)`);

  // ── janelas curtas não regridem ──────────────────────────────────────────────
  console.log('\n== filtro "Mês atual" ==');
  await js("AxF.preset('curmonth')");
  await sleep(1200);
  const nMes = await js(`${WEEKLY}.data.labels.length`);
  ok(nMes >= 4 && nMes <= 6, 'mês corrente rende 4–6 semanas', nMes);
  const somaMes = await js(somaWeekly);
  ok(somaMes === 1, 'e só o deal do mês corrente aparece', somaMes);

  // ── rodapé de corte: sem corte, sem rodapé ───────────────────────────────────
  const nota = await js("!!document.getElementById('bdr-weekly-note')");
  ok(nota === false, 'sem truncagem o rodapé de corte não aparece', String(nota));

  // ── janela longa: o eixo tem teto, e o teto é DITO ───────────────────────────
  // Range de jan/2023 até o mês corrente pela mesma porta que o dono usa (o seletor
  // de mês da barra), não por atalho interno.
  console.log('\n== range longo (jan/2023 → mês corrente) ==');
  await js(`(function(){
    AxF.openMonth('from'); AxF.mpNav(${2023 - ANO}); AxF.mpPick(0);
    AxF.openMonth('to');   AxF.mpPick(${MES_ATUAL - 1});
    AxF.apply();
  })()`);
  await sleep(1800);

  const nLongo = await js(`${WEEKLY}.data.labels.length`);
  ok(nLongo === 78, 'o eixo trava no teto de 78 semanas', nLongo);
  const notaTxt = await js("(document.getElementById('bdr-weekly-note')||{}).textContent||''");
  ok(/semana\(s\) anterior\(es\)/.test(notaTxt), 'o rodapé diz quantas semanas ficaram fora',
    String(notaTxt).slice(0, 120));

  return finalizar(ws, erros);
}

function finalizar(ws, erros) {
  console.log('\n== console ==');
  ok(erros.length === 0, 'sem erro de JS no console', erros.slice(0, 3).join(' || ') || 'nenhum');
  try { ws.close(); } catch (_) { /* já fechado */ }
}

run()
  .then(() => {
    console.log(falhas === 0 ? '\nOK — smoke da janela do Weekly Origination passou' : `\nFALHOU — ${falhas} verificação(ões)`);
  })
  .catch((e) => { falhas += 1; console.error('\nERRO:', e.message); })
  .finally(() => {
    try { if (chrome) chrome.kill(); } catch (_) { /* já morto */ }
    try { server.close(); } catch (_) { /* já fechado */ }
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) { /* nada a limpar */ }
    process.exit(falhas === 0 ? 0 : 1);
  });
