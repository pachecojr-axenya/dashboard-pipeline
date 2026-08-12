'use strict';
/**
 * smoke-bdr-lead-funnel-browser.js — prova os PIXELS da seção "Funil de Leads".
 *
 * As levas 1–4 declararam "render não verificado" e a leva 5 mostrou por que isso
 * importa: com 14 colunas o cabeçalho CLIPAVA ("Toque pré-lead" virava "Toque pré") e
 * o payload estava perfeito. Coluna cortada é coluna que não existe, e nenhum teste de
 * dados pega isso.
 *
 * SEM CREDENCIAL DE BQ, de propósito: o servidor deste smoke serve FIXTURES capturadas
 * do endpoint real (scripts/_lead-funnel-fixture.js). O que está sob teste aqui é o
 * desenho, não a consulta — e amarrar o smoke de pixel ao BigQuery faria a falha de
 * rede virar "falha de layout".
 *
 *   node scripts/_lead-funnel-fixture.js /tmp/fx     # captura (precisa de gcloud ADC)
 *   node scripts/smoke-bdr-lead-funnel-browser.js --fixtures=/tmp/fx
 */

const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

if (typeof WebSocket === 'undefined') throw new Error('Este smoke requer Node com WebSocket global (Node 22+).');

const ROOT = path.join(__dirname, '..');
const arg = (nome, padrao) => {
  const a = process.argv.find((x) => x.indexOf('--' + nome + '=') === 0);
  return a ? a.split('=').slice(1).join('=') : padrao;
};
const FX = arg('fixtures', path.join(os.tmpdir(), 'lead-funnel-fixtures'));
if (!fs.existsSync(path.join(FX, 'base.json'))) {
  throw new Error('fixtures ausentes em ' + FX + ' — rode antes: node scripts/_lead-funnel-fixture.js ' + FX);
}
const META = JSON.parse(fs.readFileSync(path.join(FX, '_meta.json'), 'utf8'));
const fixture = (n) => fs.readFileSync(path.join(FX, n + '.json'));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2' };

// Rotas bonitas do painel, iguais às do local-server.js.
const ROTAS = { '/novo-bdr': 'bdr.html', '/novo': 'dashboard.html', '/': 'bdr.html' };

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;

  if (p === '/api/bdr-lead-funnel') {
    // Qual fixture responde: a mesma decisão que o endpoint tomaria.
    let nome = 'base';
    if (u.searchParams.get('dim') === 'bdr') nome = 'recorte-bdr';
    else if (u.searchParams.get('dim') === 'canal_macro') nome = 'recorte-canal';
    else if (u.searchParams.get('gran') === 'mes') nome = 'gran-mes';
    res.writeHead(200, { 'Content-Type': MIME['.json'] });
    return res.end(fixture(nome));
  }
  // Os outros painéis da página não estão sob teste: respondem vazio e válido, para a
  // tela montar sem erro de console que não seja nosso.
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

const PORT = 3900 + (process.pid % 90);
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const cdpPort = 9500 + (process.pid % 400);
const profile = path.join(os.tmpdir(), `axenya-lead-funnel-smoke-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let chrome;
let falhas = 0;
function ok(cond, texto, extra) {
  if (!cond) falhas++;
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
      erros.push('EXCEPTION ' + JSON.stringify(((msg.params || {}).exceptionDetails || {}).text || '').slice(0, 300));
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
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    return r.result && r.result.result && r.result.result.value;
  };

  // ── a seção existe e carregou ────────────────────────────────────────────────
  let pronto = false;
  for (let i = 0; i < 40; i += 1) {
    pronto = await js("!!(window.AxLeadFunnel && AxLeadFunnel.isLoaded && AxLeadFunnel.isLoaded())");
    if (pronto) break;
    await sleep(500);
  }
  ok(pronto, 'a seção do funil de leads carregou o payload');
  await sleep(1500);

  console.log('\n== render ==');
  ok(await js("!!document.getElementById('lf-serie')"), 'canvas da linha do tempo existe');
  ok(await js("!!document.getElementById('lf-snapshot-giro')"), 'painel de giro do snapshot existe');
  ok(await js("document.getElementById('lf-snapshot-giro').innerText.length > 40"), 'o painel de giro tem conteúdo (o vazio ao lado do snapshot era o defeito)');
  // Coluna cortada é coluna que não existe — o defeito de pixel da leva 5.
  // A mensagem de falha carrega a TABELA de origem: "GABRIELE ALMEIDA está clipado" sem
  // dizer em qual tabela manda alguém procurar em cinco cartões.
  const clip = await js(`(function(){var m=[];document.querySelectorAll('#lf-host th').forEach(function(t){
    if(t.scrollWidth>t.clientWidth+1){
      var w=t.closest('[id^=lf-]'); m.push((w?w.id:'?')+': '+t.innerText.trim().slice(0,26));
    }});return m.slice(0,6).join(' | ');})()`);
  ok(!clip, 'nenhum cabeçalho de tabela está CLIPADO', clip || 'nenhum');
  const rolaH = await js("document.documentElement.scrollWidth > document.documentElement.clientWidth + 2");
  ok(!rolaH, 'a página não rola horizontalmente (as tabelas rolam dentro do card)');

  // ── controles novos ──────────────────────────────────────────────────────────
  console.log('\n== controles da linha do tempo ==');
  ok(await js("!!document.getElementById('lf-gran-tabs')"), 'seletor de granularidade presente');
  ok(await js("!!document.getElementById('lf-quebra-tabs')"), 'seletor de quebra presente');
  ok(await js("document.getElementById('lf-serie-escala').innerText.indexOf('eixo %')===0"),
    'o rodapé declara o intervalo do eixo de %', await js("document.getElementById('lf-serie-escala').innerText"));

  // Eixo auto-escalado: o topo NÃO pode ser 100 quando as taxas são baixas.
  const eixo = await js(`(function(){var c=Chart.getChart('lf-serie');return c?JSON.stringify({min:c.scales.y1.min,max:c.scales.y1.max}):null;})()`);
  ok(!!eixo, 'o gráfico da série existe no registro do Chart.js', eixo);
  const E = JSON.parse(eixo || '{}');
  ok(!(E.min === 0 && E.max === 100), 'o eixo de % NÃO está travado em 0–100 (era o pedido)', eixo);

  // Esconder uma série pela legenda reescala o eixo.
  const antes = E.max;
  // Esconde a série de MAIOR pico: é a única escolha que obriga o topo do eixo a cair.
  // Esconder uma linha qualquer poderia não mudar nada e o teste passaria por sorte.
  await js(`(function(){
    var c=Chart.getChart('lf-serie');
    var alvo=-1, melhor=-1;
    c.data.datasets.forEach(function(d,i){
      if(d.yAxisID!=='y1')return;
      var mx=Math.max.apply(null,(d.data||[]).filter(function(v){return v!=null;}));
      if(mx>melhor){melhor=mx;alvo=i;}
    });
    var l=c.options.plugins.legend;
    l.onClick.call(c,null,{datasetIndex:alvo,text:c.data.datasets[alvo].label},{chart:c});
    return alvo;
  })()`);
  await sleep(400);
  const depois = JSON.parse(await js(`(function(){var c=Chart.getChart('lf-serie');return JSON.stringify({min:c.scales.y1.min,max:c.scales.y1.max});})()`));
  ok(depois.max !== antes || depois.min !== E.min, 'esconder uma linha na legenda REESCALA o eixo', antes + ' → ' + depois.max);

  // Quebra por BDR desenha uma linha por pessoa.
  await js("AxLeadFunnel.switchQuebra('bdr')");
  await sleep(800);
  const nLinhas = await js(`(function(){var c=Chart.getChart('lf-serie');return c.data.datasets.length;})()`);
  ok(nLinhas >= 2 && nLinhas <= 6, 'quebrar por BDR desenha uma linha por pessoa (capado em 6)', nLinhas + ' séries');
  const rot = await js(`(function(){var c=Chart.getChart('lf-serie');return c.data.datasets.map(function(d){return d.label;}).join(' | ');})()`);
  ok(rot.indexOf(META.bdr) >= 0, 'a quebra usa o NOME canônico do BDR (o mesmo da tabela)', rot.slice(0, 120));
  await js("AxLeadFunnel.switchQuebra('nenhuma')");
  await sleep(500);

  // ── tabela por dimensão: três visões ────────────────────────────────────────
  console.log('\n== tabela por dimensão ==');
  for (const v of ['contato', 'funil', 'penetracao']) {
    await js("AxLeadFunnel.switchReguaView('" + v + "')");
    await sleep(400);
    const cols = await js("document.querySelectorAll('#lf-regua thead th').length");
    ok(cols > 4, 'visão ' + v + ' desenha a tabela', cols + ' colunas');
  }
  const temPen = await js("(function(){var t=document.getElementById('lf-regua').innerText.toUpperCase();return t.indexOf('LEADS POR')>=0 && t.indexOf('EMPRESA')>=0;})()");
  ok(temPen, 'a visão de penetração nomeia empresas e leads por empresa');
  await js("AxLeadFunnel.switchReguaView('contato')");
  await sleep(400);
  const temTres = await js("(function(){var t=document.getElementById('lf-regua').innerText.toUpperCase();return ['TENTOU','FALOU COM','CONVERSOU'].every(function(x){return t.indexOf(x)>=0;});})()");
  ok(temTres, 'a visão de contato mostra as TRÊS réguas (tentou, falou com, conversou)');

  // ── etapas enumeradas ───────────────────────────────────────────────────────
  console.log('\n== etapas enumeradas ==');
  const txtWf = await js("document.getElementById('lf-waterfall').innerText");
  ok(/1 · Novo/.test(txtWf) && /2 · Tentativa/.test(txtWf), 'as etapas aparecem numeradas na tabela', (txtWf.match(/\d · [A-Za-zÀ-ú ]+/g) || []).slice(0, 3).join(' | '));

  // ── ficha do ícone "i" ──────────────────────────────────────────────────────
  console.log('\n== ficha dos cards (o ícone que não abria) ==');
  const registradas = await js("(function(){var k=['conv','serie','macro','regua','snapshot','pordia'];return k.filter(function(x){return (window.BDR_HELP_CHARTS||[]).some(function(f){return f.key===x;});}).join(',');})()");
  ok(registradas.split(',').length >= 6, 'as fichas dos cards do funil estão registradas', registradas);
  const temOnclick = await js(`(function(){var b=document.querySelector('#lf-host .novo-info-btn');return !!(b&&b.getAttribute('onclick'));})()`);
  ok(temOnclick, 'o ícone "i" tem ação de clique (antes era inerte)');
  await js("bdrHelpChart('serie')");
  await sleep(600);
  const drawerAberto = await js("!!document.querySelector('#novo-help-drawer.open')");
  ok(drawerAberto, 'clicar no ícone ABRE a telinha com a memória de cálculo');
  const conteudoDrawer = await js("(document.getElementById('novo-help-drawer')||{}).innerText || ''");
  ok(conteudoDrawer.indexOf('Linha do tempo') >= 0, 'a telinha mostra a ficha do card certo');
  await js("novoCloseHelp()");

  // ── matriz de desqualificação: as duas leituras ─────────────────────────────
  console.log('\n== desqualificação: quem × evidência ==');
  await js("AxLeadFunnel.switchDisqView('evidencia')");
  await sleep(600);
  const mtx = await js("document.getElementById('lf-disqmatrix').innerText.toUpperCase()");
  ok(mtx.indexOf('NENHUM ESFORÇO') >= 0 || mtx.indexOf('DISCOU') >= 0 || mtx.indexOf('MENSAGEM ENTREGUE') >= 0,
    'a matriz por EVIDÊNCIA mostra os submotivos derivados do CRM',
    (mtx.match(/(DISCOU[^\n\t]{0,26}|NENHUM ESFOR[^\n\t]{0,14}|MENSAGEM ENTREGUE[^\n\t]{0,16})/g) || []).slice(0, 3).join(' | '));
  // A abreviação de nome NÃO pode alcançar o rótulo de categoria: "Discou a." foi
  // exatamente o defeito da primeira rodada deste smoke.
  ok(!/DISCOU [A-Z]\.($|\s|\t)/.test(mtx), 'o submotivo NÃO é abreviado como se fosse nome de pessoa');
  ok(mtx.indexOf('8,3%') >= 0 || mtx.indexOf('EVIDÊNCIA, NÃO POR TEXTO') >= 0,
    'a tela DECLARA por que o submotivo não vem de texto livre');
  await js("AxLeadFunnel.switchDisqView('autor')");
  await sleep(500);

  // ── filtro global ───────────────────────────────────────────────────────────
  console.log('\n== o filtro vale para a seção inteira ==');
  const criadosAntes = await js("AxLeadFunnel && document.getElementById('lf-selo').innerText");
  await js("AxLeadFunnel.setFiltroDim('bdr')");
  await sleep(300);
  await js("AxLeadFunnel.setFiltroVal(" + JSON.stringify(META.bdr) + ")");
  for (let i = 0; i < 30; i += 1) {
    const t = await js("document.getElementById('lf-selo').innerText");
    if (t && t !== criadosAntes) break;
    await sleep(400);
  }
  const seloDepois = await js("document.getElementById('lf-selo').innerText");
  ok(seloDepois !== criadosAntes, 'aplicar o filtro RECARREGA a seção', seloDepois.slice(0, 80));
  const textoFiltro = await js("document.getElementById('lf-conv').innerText");
  ok(textoFiltro.indexOf('seção inteira') >= 0 || textoFiltro.indexOf(META.bdr) >= 0,
    'a tela declara o recorte ativo');
  const macroTem = await js("(document.querySelector('.lf-macro-nota')||{}).innerText||''");
  ok(macroTem.indexOf('Conferência') >= 0, 'o waterfall macro continua conferindo com o filtro aplicado',
    macroTem.slice(0, 90));

  console.log('\n== console ==');
  const errosReais = erros.filter((e) => !/favicon|Failed to load resource/i.test(e));
  ok(errosReais.length === 0, 'nenhum erro de console', errosReais.slice(0, 3).join(' || ') || 'nenhum');

  console.log('\n' + (falhas ? falhas + ' FALHA(S)' : 'SMOKE DE RENDER: TODOS OS CASOS PASSARAM'));
  return falhas;
}

run().then((f) => {
  try { chrome.kill(); } catch (_) {}
  server.close();
  process.exit(f ? 1 : 0);
}).catch((e) => {
  console.error('ERRO:', e.message);
  try { chrome.kill(); } catch (_) {}
  server.close();
  process.exit(1);
});
