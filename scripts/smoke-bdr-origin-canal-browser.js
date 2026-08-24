'use strict';
/**
 * smoke-bdr-origin-canal-browser.js — prova, no browser, os dois defeitos que o dono
 * relatou em 24/08/2026 no card "Originação por BDR" da /novo-bdr.
 *
 * 1) "coloco deals por canal e não mostra por canal"
 *    `_dimFnDeal('canal')` não conhecia o modo 'canal' (o Weekly/Monthly chama o MESMO
 *    corte de 'origem') e caía no DEFAULT, que agrupa por BDR. A tela empilhava o nome
 *    do BDR dentro da barra do próprio BDR e chamava aquilo de canal.
 *
 * 2) "passo o mouse na barra da Priscila e vai mudando o nome da pessoa"
 *    O gráfico é `indexAxis:'y'` e o tooltip era `mode:'index'` SEM `axis:'y'`. O modo
 *    'index' do Chart.js resolve pelo eixo X por padrão — numa barra horizontal isso
 *    procura o ponto pelo VALOR, não pela linha. Andar para a direita dentro da barra
 *    da Priscilla trocava a linha e o tooltip mostrava outro BDR.
 *
 * Por que browser e não teste de dados: os dois defeitos SÓ existem no render. O
 * payload estava certo nos dois casos. Fixture local, sem HubSpot e sem BigQuery — o
 * que está sob teste é o desenho, não a consulta.
 *
 *   node scripts/smoke-bdr-origin-canal-browser.js
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
// Nomes reais do drawer (window.BDR_LIST em settings-modal.js). "Gabriele de Almeida
// Silva" entra pela grafia do HubSpot DE PROPÓSITO: é ela que o BDR_HS_ALIAS resolve
// para "Gabriele Almeida", e era o nome que aparecia no tooltip da Priscilla.
// Totais distintos (24 / 22 / 20) para o ranking ser determinístico — empate deixaria
// a ordem das linhas ao critério do sort e o teste ficaria intermitente.
const MIX = [
  { sdr: 'Priscilla Feliciello',        canais: { 'Eventos Axenya': 17, 'Outbound BDRs': 7 } },
  { sdr: 'Gabriele de Almeida Silva',   canais: { 'Eventos Axenya': 16, 'Outbound BDRs': 4, 'Site': 2 } },
  { sdr: 'Marcelli Netto',              canais: { 'Eventos Axenya': 14, 'Outbound BDRs': 6 } },
];
const CANAIS_ESPERADOS = ['Eventos Axenya', 'Outbound BDRs', 'Site'];
const ORDEM_ESPERADA = ['Priscilla Feliciello', 'Gabriele Almeida', 'Marcelli Netto'];

// Data de originação dentro do mês corrente: sem filtro de período a tela usa o mês
// atual nos KPIs, e uma data fixa no passado faria o smoke apodrecer sozinho.
function diaDoMesCorrente() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-10`;
}

function montarDeals() {
  const dia = diaDoMesCorrente();
  const deals = [];
  let i = 0;
  MIX.forEach((b) => {
    Object.keys(b.canais).forEach((canal) => {
      for (let k = 0; k < b.canais[canal]; k += 1) {
        i += 1;
        deals.push({
          id: String(100000 + i),
          dealname: `Deal ${i}`,
          pipeline: 'Vendas',
          stage: 'Reunião Agendada',
          sdr: b.sdr,
          origem: canal,
          // >= 30 colaboradores: mantém todos elegíveis para a meta, senão a cor da
          // barra no modo Por BDR vira ruído que não é o que está sob teste.
          colaboradores: 120,
          vidas: 300,
          data_reuniao_agendada: dia,
          createdate: dia,
          company_in_lista_abm: false,
        });
      }
    });
  });
  return deals;
}

const DEALS = montarDeals();

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
  // O Funil de Leads NÃO está sob teste aqui e tem smoke próprio com fixtures reais
  // (smoke-bdr-lead-funnel-browser.js). Um payload vazio genérico o faz estourar em
  // `por_etapa`, e essa exceção mascararia um erro NOSSO no console. 503 é um caminho
  // que ele trata: a seção pinta o estado de erro e sai da frente.
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
const profile = path.join(os.tmpdir(), `axenya-origin-canal-smoke-${process.pid}`);
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

  // ── o gráfico montou ─────────────────────────────────────────────────────────
  let pronto = false;
  for (let i = 0; i < 40; i += 1) {
    pronto = await js("!!(window._novoCharts && _novoCharts['chart-bdr-origin-bdr'])");
    if (pronto) break;
    await sleep(500);
  }
  ok(pronto, 'o gráfico Originação por BDR montou');
  if (!pronto) return finalizar(ws, erros);

  console.log('\n== modo Por BDR (padrão) ==');
  ok(await js("_novoCharts['chart-bdr-origin-bdr'].data.datasets.length === 1"),
    'Por BDR desenha UM dataset (barra sólida)',
    await js("_novoCharts['chart-bdr-origin-bdr'].data.datasets.length"));

  const labelsBdr = await js("JSON.stringify(_novoCharts['chart-bdr-origin-bdr'].data.labels)");
  ok(JSON.parse(labelsBdr).join('|') === ORDEM_ESPERADA.join('|'),
    'as linhas saem na ordem do volume', labelsBdr);

  // ── o defeito 1: Por Canal ────────────────────────────────────────────────────
  console.log('\n== modo Por Canal ==');
  await js("bdrSwitchOriginDim('canal')");
  await sleep(900);

  const legendas = JSON.parse(await js(
    "JSON.stringify(_novoCharts['chart-bdr-origin-bdr'].data.datasets.map(function(d){return d.label;}))"));

  const ordenados = legendas.slice().sort();
  ok(ordenados.join('|') === CANAIS_ESPERADOS.slice().sort().join('|'),
    'os datasets são os CANAIS, não os BDRs', JSON.stringify(legendas));

  const vazouBdr = legendas.some((l) => ORDEM_ESPERADA.indexOf(l) >= 0
    || l === 'Gabriele de Almeida Silva');
  ok(!vazouBdr, 'nenhum nome de BDR aparece como se fosse canal');

  // Cada linha tem MAIS DE UM segmento: era isto que não acontecia antes — com o
  // agrupamento caindo no default, a linha do BDR tinha um segmento só, o dele.
  const segmentosPriscilla = await js(
    "_novoCharts['chart-bdr-origin-bdr'].data.datasets.filter(function(d){return (d.data[0]||0)>0;}).length");
  ok(segmentosPriscilla === 2, 'a barra da Priscilla se divide nos 2 canais dela', segmentosPriscilla);

  const totalPriscilla = await js(
    "_novoCharts['chart-bdr-origin-bdr'].data.datasets.reduce(function(a,d){return a+(d.data[0]||0);},0)");
  ok(totalPriscilla === 24, 'o empilhado da Priscilla soma o total dela (24)', totalPriscilla);

  // ── o defeito 2: tooltip anda para a direita e troca de BDR ───────────────────
  console.log('\n== tooltip na barra horizontal ==');
  const geo = JSON.parse(await js(`(function(){
    var c=_novoCharts['chart-bdr-origin-bdr'];
    var y=c.scales.y, a=c.chartArea, r=c.canvas.getBoundingClientRect();
    return JSON.stringify({left:r.left,top:r.top,areaLeft:a.left,areaRight:a.right,
      linhas:[0,1,2].map(function(i){return y.getPixelForValue(i);})});
  })()`));

  // Três pontos ao longo da MESMA linha (a da Priscilla): começo, meio e ponta da
  // barra. Antes do fix os três devolviam BDRs diferentes.
  const xs = [
    geo.areaLeft + (geo.areaRight - geo.areaLeft) * 0.15,
    geo.areaLeft + (geo.areaRight - geo.areaLeft) * 0.50,
    geo.areaRight - 10,
  ];
  const vistos = [];
  for (let i = 0; i < xs.length; i += 1) {
    await cmd('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: Math.round(geo.left + xs[i]), y: Math.round(geo.top + geo.linhas[0]),
      button: 'none', buttons: 0,
    });
    await sleep(350);
    vistos.push(await js(`(function(){
      var t=_novoCharts['chart-bdr-origin-bdr'].tooltip;
      return (t && t.title && t.title.length) ? String(t.title[0]) : '';
    })()`));
  }
  console.log('         títulos lidos: ' + JSON.stringify(vistos));

  const todosPriscilla = vistos.every((t) => t.indexOf('Priscilla Feliciello') === 0);
  ok(todosPriscilla, 'o tooltip diz Priscilla nos 3 pontos da barra da Priscilla');

  const unico = new Set(vistos.filter(Boolean)).size;
  ok(unico === 1, 'o nome NÃO muda ao arrastar o mouse para a direita', `${unico} nome(s) distinto(s)`);

  // E a linha de baixo continua sendo a de baixo — o fix não pode ter grudado tudo
  // na primeira linha.
  await cmd('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: Math.round(geo.left + xs[2]), y: Math.round(geo.top + geo.linhas[1]),
    button: 'none', buttons: 0,
  });
  await sleep(350);
  const linha2 = await js(`(function(){
    var t=_novoCharts['chart-bdr-origin-bdr'].tooltip;
    return (t && t.title && t.title.length) ? String(t.title[0]) : '';
  })()`);
  ok(linha2.indexOf('Gabriele Almeida') === 0, 'a 2ª linha ainda responde por ela mesma', linha2);

  return finalizar(ws, erros);
}

function finalizar(ws, erros) {
  console.log('\n== console ==');
  ok(erros.length === 0, 'sem erro de JS no console', erros.slice(0, 3).join(' || ') || 'nenhum');
  try { ws.close(); } catch (_) { /* já fechado */ }
}

run()
  .then(() => {
    console.log(falhas === 0 ? '\nOK — smoke da Originação por Canal passou' : `\nFALHOU — ${falhas} verificação(ões)`);
  })
  .catch((e) => { falhas += 1; console.error('\nERRO:', e.message); })
  .finally(() => {
    try { if (chrome) chrome.kill(); } catch (_) { /* já morto */ }
    try { server.close(); } catch (_) { /* já fechado */ }
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) { /* nada a limpar */ }
    process.exit(falhas === 0 ? 0 : 1);
  });
