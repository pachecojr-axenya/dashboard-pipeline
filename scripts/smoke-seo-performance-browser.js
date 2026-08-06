'use strict';
/**
 * smoke-seo-performance-browser.js — Smoke FUNCIONAL de /growth/seo.
 *
 * HTTP 200 não é smoke: a página monta tudo em JS a partir de /api/seo-performance.
 * Este script abre o Chrome headless via CDP e exige que a página realmente
 * renderize KPIs e linha do tempo, que a ordenação por clique no cabeçalho mude a
 * ordem, que a busca filtre, que a troca de visão e de granularidade redesenhe,
 * que os drilldowns abram com linhas dentro e que o console esteja limpo.
 *
 * Cobre também o modo AGREGADO (colunas absolutas + participação, sem Δ), a visão
 * NOVOS (sem coluna "antes", ordenada por impressão, referência declarada), a
 * janela LIVRE de/até com o aviso de intervalo não múltiplo de 7, e a regressão do
 * rótulo de página (fragmento e host precisam distinguir as linhas).
 *
 * Rodar:
 *   node scripts/smoke-seo-performance-browser.js --base-url=http://localhost:3007 --base=wow
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
const baseCmp = arg('base', 'wow');

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9600 + (process.pid % 190);
const profile = path.join(os.tmpdir(), `axenya-seo-perf-smoke-${process.pid}`);
const chrome = spawn(chromePath, [
  '--headless', '--disable-gpu', '--disable-background-networking', '--disable-component-update',
  '--disable-default-apps', '--disable-extensions', '--disable-sync', '--no-first-run',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  `${baseUrl}/growth/seo`,
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
  const target = list.find((x) => x.type === 'page' && x.url.indexOf('/growth/seo') >= 0);
  assert.ok(target, 'Página /growth/seo não abriu no Chrome headless.');

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

  // Espera o render DA BASE PEDIDA, não só "content visível". A carga inicial é
  // WoW; pedir outra base e checar apenas visibilidade validaria a base errada.
  let ready = false;
  for (let i = 0; i < 90; i += 1) {
    const clicked = await evaluate(`(function(){
      var b=document.querySelector('#filters [data-base="${baseCmp}"]');
      if(!b) return false;
      if(document.getElementById('content').getAttribute('data-base-atual')==='${baseCmp}') return true;
      if(!b.classList.contains('active')) b.click();
      return true;
    })()`);
    if (clicked) {
      ready = await evaluate(`(function(){
        var c=document.getElementById('content');
        return !c.classList.contains('hidden') && c.getAttribute('data-base-atual')==='${baseCmp}';
      })()`);
    }
    if (ready) break;
    await sleep(1000);
  }
  assert.strictEqual(ready, true, `Conteúdo não renderizou para a base ${baseCmp}.`);

  // 1) Estrutura mínima
  const shape = JSON.parse(await evaluate(`JSON.stringify({
    heroKpis: document.querySelectorAll('.kpis-hero .kpi').length,
    cmpCards: document.querySelectorAll('[data-cmp]').length,
    cmpAtivo: document.querySelectorAll('.cmp-card.active').length,
    infoBtns: document.querySelectorAll('.calc-btn').length,
    cards: document.querySelectorAll('#content .card').length,
    barras: document.querySelectorAll('.seo-svg rect.bar').length,
    posLinha: document.querySelectorAll('.seo-svg polyline.pos-ln').length,
    tabs: document.querySelectorAll('[data-view]').length,
    ths: document.querySelectorAll('th.sortable').length,
    linhas: document.querySelectorAll('#content tbody tr[data-row]').length,
    covItems: document.querySelectorAll('.cov-item').length,
    janela: document.getElementById('content').getAttribute('data-janela')||'',
    bigIdea: (document.querySelector('.big-idea-text')||{}).textContent||'',
    erroVisivel: /Não foi possível carregar/.test(document.getElementById('state').textContent) && !document.getElementById('state').classList.contains('hidden')
  })`));

  assert.strictEqual(shape.erroVisivel, false, 'Página mostrou estado de erro.');
  assert.strictEqual(shape.heroKpis, 4, `Esperava 4 KPIs hero, veio ${shape.heroKpis}.`);
  assert.strictEqual(shape.cmpCards, 5, `Esperava DoD, WoW, MoM, QoQ e YoY no strip, veio ${shape.cmpCards}.`);
  assert.strictEqual(shape.cmpAtivo, 1, `Exatamente uma base devia estar ativa, veio ${shape.cmpAtivo}.`);
  assert(shape.infoBtns >= 8, `Poucos botões i de memória de cálculo: ${shape.infoBtns}.`);
  assert(shape.cards >= 4, `Poucos cards: ${shape.cards}.`);
  assert(shape.barras > 0, 'Linha do tempo sem barras.');
  assert.strictEqual(shape.posLinha, 1, 'Linha de posição média não desenhou.');
  assert.strictEqual(shape.tabs, 10, `Esperava 10 visões, veio ${shape.tabs}.`);
  assert(shape.ths >= 9, `Cabeçalho sem colunas ordenáveis suficientes: ${shape.ths}.`);
  assert(shape.linhas > 0, 'Tabela de movimentação veio vazia.');
  assert(shape.covItems >= 6, `Bloco de cobertura incompleto: ${shape.covItems}.`);
  assert(/^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(shape.janela), `Janela não declarada: ${shape.janela}`);
  assert(/cliques/.test(shape.bigIdea), `Conclusão do topo sem cliques: ${shape.bigIdea}`);

  // 2) Separador canônico: en-dash nunca como separador
  const separadorRuim = await evaluate(`(function(){
    var txt = document.getElementById('content').textContent;
    var m = txt.match(/\\w\\s+[–]\\s+\\w/g);
    return m ? m.slice(0,3).join(' /// ') : '';
  })()`);
  assert.strictEqual(separadorRuim, '', `En-dash usado como separador: ${separadorRuim}`);

  // 3) Ordenação por clique no cabeçalho muda a ordem de verdade
  const ordemAntes = await evaluate("JSON.stringify(Array.prototype.slice.call(document.querySelectorAll('#content tbody tr[data-row]')).slice(0,8).map(function(r){return r.getAttribute('data-row');}))");
  await evaluate("document.querySelector('th.sortable[data-sort=\"i\"]').click()");
  await sleep(500);
  const depois = JSON.parse(await evaluate(`JSON.stringify({
    ordem: Array.prototype.slice.call(document.querySelectorAll('#content tbody tr[data-row]')).slice(0,8).map(function(r){return r.getAttribute('data-row');}),
    marcado: (document.querySelector('th.sortable[data-sort="i"]')||{}).className||'',
    impressoes: Array.prototype.slice.call(document.querySelectorAll('#content tbody tr[data-row]')).slice(0,6).map(function(r){
      var td=r.querySelectorAll('td'); return td.length ? td[5].textContent.replace(/\\D/g,'') : '';
    })
  })`));
  assert(/on/.test(depois.marcado), 'Coluna clicada não ficou marcada como ordenação ativa.');
  assert.notStrictEqual(JSON.stringify(depois.ordem), ordemAntes, 'Clique no cabeçalho não mudou a ordem das linhas.');
  const nums = depois.impressoes.map(Number).filter((n) => !isNaN(n));
  for (let i = 1; i < nums.length; i += 1) {
    assert(nums[i] <= nums[i - 1], `Ordenação decrescente por impressões quebrada: ${nums.join(' > ')}`);
  }

  // 4) Busca filtra as linhas
  const totalAntes = await evaluate("document.querySelectorAll('#content tbody tr[data-row]').length");
  await evaluate(`(function(){
    var el=document.getElementById('v-busca');
    el.value='pgr';
    el.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await sleep(500);
  const busca = JSON.parse(await evaluate(`JSON.stringify({
    n: document.querySelectorAll('#content tbody tr[data-row]').length,
    todosCasam: Array.prototype.slice.call(document.querySelectorAll('#content tbody tr[data-row]')).every(function(r){
      return /pgr/i.test(r.textContent);
    }),
    valorMantido: (document.getElementById('v-busca')||{}).value
  })`));
  assert(busca.n > 0, 'Busca por "pgr" não devolveu nenhuma linha (a propriedade tem dezenas).');
  assert(busca.n < totalAntes, `Busca não filtrou nada: ${busca.n} de ${totalAntes}.`);
  assert.strictEqual(busca.todosCasam, true, 'Busca deixou passar linha que não casa com o termo.');
  assert.strictEqual(busca.valorMantido, 'pgr', 'Campo de busca perdeu o texto no redesenho.');
  await evaluate("document.getElementById('v-clear').click()");
  await sleep(400);

  // 5) Troca de visão redesenha com outras colunas
  await evaluate("document.querySelector('[data-view=\"categorias\"]').click()");
  await sleep(500);
  const cat = JSON.parse(await evaluate(`JSON.stringify({
    view: document.getElementById('content').getAttribute('data-view-atual'),
    linhas: document.querySelectorAll('#content tbody tr[data-row]').length,
    primeiraCol: (document.querySelector('th.sortable')||{}).textContent||'',
    temMarca: /Marca/.test(document.querySelector('#content tbody').textContent)
  })`));
  assert.strictEqual(cat.view, 'categorias', 'Estado de visão não virou categorias.');
  assert(cat.linhas >= 3, `Visão de categorias com poucas linhas: ${cat.linhas}.`);
  assert(/Grupo/.test(cat.primeiraCol), `Colunas não trocaram na visão de grupo: "${cat.primeiraCol}".`);
  assert.strictEqual(cat.temMarca, true, 'Categoria Marca não apareceu na visão de categorias.');

  // 6) Drill de linha de grupo abre as consultas que compõem o grupo
  await evaluate("document.querySelector('#content tbody tr[data-row]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))");
  await sleep(600);
  const drillGrupo = JSON.parse(await evaluate(`JSON.stringify({
    open: document.getElementById('modal-overlay').classList.contains('open'),
    kpis: document.querySelectorAll('#modal-body .modal-kpi').length,
    rows: document.querySelectorAll('#modal-body tbody tr').length
  })`));
  assert.strictEqual(drillGrupo.open, true, 'Clique na linha de categoria não abriu drilldown.');
  assert.strictEqual(drillGrupo.kpis, 4, 'Drill de grupo sem os 4 KPIs de reconciliação.');
  assert(drillGrupo.rows > 0, 'Drill de grupo não listou as consultas de dentro.');
  await evaluate('SeoPerf.closeModal()');
  await evaluate("document.querySelector('[data-view=\"consultas\"]').click()");
  await sleep(400);

  // 7) Drill de KPI
  await evaluate("document.querySelector('.kpis-hero .kpi[data-drill=\"clicks\"]').click()");
  await sleep(600);
  const kpiModal = JSON.parse(await evaluate(`JSON.stringify({
    open: document.getElementById('modal-overlay').classList.contains('open'),
    kpis: document.querySelectorAll('#modal-body .modal-kpi').length,
    titulo: document.getElementById('modal-title').textContent
  })`));
  assert.strictEqual(kpiModal.open, true, 'Drilldown do KPI não abriu modal.');
  assert.strictEqual(kpiModal.kpis, 4, 'Modal do KPI sem os 4 blocos de reconciliação.');
  assert(/Cliques/.test(kpiModal.titulo), `Título do drill de KPI inesperado: ${kpiModal.titulo}`);
  await evaluate('SeoPerf.closeModal()');

  // 8) `i` abre memória de cálculo explicando a regra de posição
  await evaluate("document.querySelector('.calc-btn[data-help=\"posicao\"]').click()");
  await sleep(400);
  const drawer = JSON.parse(await evaluate(`JSON.stringify({
    open: document.getElementById('help-drawer').classList.contains('open'),
    titulo: document.getElementById('help-title').textContent,
    corpo: document.getElementById('help-body').textContent
  })`));
  assert.strictEqual(drawer.open, true, 'Drawer de memória de cálculo não abriu.');
  assert(/Posição/.test(drawer.titulo), `Título do drawer inesperado: ${drawer.titulo}`);
  assert(/menor é melhor/i.test(drawer.corpo), 'Memória de cálculo não explica que posição menor é melhor.');
  await evaluate('SeoPerf.closeHelp()');

  // 9) Clique na barra abre o período. SVGElement não tem .click().
  await evaluate("document.querySelector('.seo-svg rect.bar').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))");
  await sleep(600);
  const bucket = JSON.parse(await evaluate(`JSON.stringify({
    open: document.getElementById('modal-overlay').classList.contains('open'),
    titulo: document.getElementById('modal-title').textContent,
    rows: document.querySelectorAll('#modal-body tbody tr').length
  })`));
  assert.strictEqual(bucket.open, true, 'Clique na barra não abriu drilldown do período.');
  assert(/Período/.test(bucket.titulo), `Título do drill de período inesperado: ${bucket.titulo}`);
  assert(bucket.rows > 0, 'Drill de período não listou os dias de dentro.');
  await evaluate('SeoPerf.closeModal()');

  // 10) Granularidade redesenha a linha do tempo e agrega
  const barrasSemana = await evaluate("document.querySelectorAll('.seo-svg rect.bar').length");
  await evaluate("document.querySelector('.granbar [data-gran=\"mes\"]').click()");
  await sleep(700);
  const mes = JSON.parse(await evaluate(`JSON.stringify({
    barras: document.querySelectorAll('.seo-svg rect.bar').length,
    ativo: (document.querySelector('.granbar [data-gran="mes"]')||{}).className||'',
    granAtual: document.getElementById('content').getAttribute('data-gran-atual'),
    parciais: document.querySelectorAll('.seo-svg rect.bar.parcial').length,
    ultimaEhParcial: (function(){
      var bs=document.querySelectorAll('.seo-svg rect.bar');
      return bs.length ? bs[bs.length-1].classList.contains('parcial') : false;
    })(),
    parciaisSemVariacao: Array.prototype.slice.call(document.querySelectorAll('.seo-svg rect.bar.parcial')).every(function(b){
      return /sem varia/.test(b.getAttribute('data-hover-text')||'');
    })
  })`));
  assert(mes.barras > 0, 'Linha do tempo por mês ficou sem barra.');
  assert(/active/.test(mes.ativo), `Botão de granularidade mês não marcou ativo (class="${mes.ativo}").`);
  assert.strictEqual(mes.granAtual, 'mes', 'Estado de granularidade não virou mês.');
  assert(mes.barras < barrasSemana, `Mês devia agregar mais que semana (${mes.barras} vs ${barrasSemana}).`);
  // Dois buckets parciais são o esperado: o mês corrente e o primeiro mês da
  // série, que começa no meio do mês (455 dias para trás não cai em dia 1).
  assert(mes.parciais >= 1 && mes.parciais <= 2, `Buckets parciais fora do esperado: ${mes.parciais}.`);
  assert.strictEqual(mes.ultimaEhParcial, true, 'O mês corrente deveria estar marcado como parcial.');
  assert.strictEqual(mes.parciaisSemVariacao, true, 'Bucket parcial está exibindo variação | comparar 4 dias com 31 é calendário, não performance.');

  // Bucket parcial não pode exibir variação: comparar 4 dias com 31 é calendário.
  await evaluate(`(function(){
    var bs=document.querySelectorAll('.seo-svg rect.bar.parcial');
    bs[bs.length-1].dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
  })()`);
  await sleep(500);
  const parcial = await evaluate("document.getElementById('modal-body').textContent");
  assert(/PARCIAL/.test(parcial), 'Drill do bucket parcial não avisa que ele é parcial.');
  assert(/sem variação/.test(parcial), 'Drill do bucket parcial deveria dizer que não há variação a exibir.');
  await evaluate('SeoPerf.closeModal()');
  await evaluate("document.querySelector('.granbar [data-gran=\"dia\"]').click()");
  await sleep(600);
  const dia = JSON.parse(await evaluate(`JSON.stringify({
    fds: document.querySelectorAll('.seo-svg rect.bar.fds').length,
    mm: document.querySelectorAll('.seo-svg polyline.mm-ln').length
  })`));
  assert(dia.fds > 0, 'Granularidade de dia não destaca fim de semana.');
  assert.strictEqual(dia.mm, 1, 'Granularidade de dia sem a média móvel de 7 dias.');

  // 11) Higiene calculada
  const higiene = await evaluate("document.querySelectorAll('.alert-row').length");
  assert(higiene > 0, 'Bloco de higiene não renderizou nenhuma linha.');

  // 12) Modo Agregado troca as colunas por absoluto + participação
  await evaluate("document.querySelector('[data-modo=\"agregado\"]').click()");
  await sleep(600);
  const agg = JSON.parse(await evaluate(`JSON.stringify({
    modo: document.getElementById('content').getAttribute('data-modo-atual'),
    cabecalhos: Array.prototype.slice.call(document.querySelectorAll('th.sortable')).map(function(t){return t.textContent.replace(/[↕↑↓]/g,'').trim();}),
    linhas: document.querySelectorAll('#content tbody tr[data-row]').length,
    primeiraShare: (function(){
      var tr=document.querySelector('#content tbody tr[data-row]');
      if(!tr) return null;
      var td=tr.querySelectorAll('td');
      return td.length>3 ? td[3].textContent.trim() : null;
    })()
  })`));
  assert.strictEqual(agg.modo, 'agregado', 'Estado de modo não virou agregado.');
  assert(agg.cabecalhos.indexOf('% dos cliques') >= 0, `Modo agregado sem coluna de participação: ${agg.cabecalhos.join(' / ')}`);
  assert(agg.cabecalhos.every((h) => h.indexOf('Δ') < 0), `Modo agregado ainda mostra coluna de variação: ${agg.cabecalhos.join(' / ')}`);
  assert(agg.linhas > 0, 'Modo agregado ficou sem linhas.');
  assert(/%$/.test(agg.primeiraShare || ''), `Coluna de participação não formatou como porcentagem: "${agg.primeiraShare}"`);
  // Participação da maior linha não pode passar de 100%: prova que o denominador
  // é o total da dimensão e não a soma das linhas carregadas.
  const shareNum = parseFloat(String(agg.primeiraShare).replace('%', '').replace(',', '.'));
  assert(shareNum > 0 && shareNum <= 100, `Participação fora de faixa: ${agg.primeiraShare}`);
  await evaluate("document.querySelector('[data-modo=\"movimento\"]').click()");
  await sleep(400);

  // 13) Visão Novos: sem colunas "antes", ordenada por impressão
  await evaluate("document.querySelector('[data-view=\"novos\"]').click()");
  await sleep(600);
  const novos = JSON.parse(await evaluate(`JSON.stringify({
    view: document.getElementById('content').getAttribute('data-view-atual'),
    cabecalhos: Array.prototype.slice.call(document.querySelectorAll('th.sortable')).map(function(t){return t.textContent.replace(/[↕↑↓]/g,'').trim();}),
    linhas: document.querySelectorAll('#content tbody tr[data-row]').length,
    impressoes: Array.prototype.slice.call(document.querySelectorAll('#content tbody tr[data-row]')).slice(0,8).map(function(r){
      var td=r.querySelectorAll('td'); return td.length>2 ? td[2].textContent.replace(/\\D/g,'') : '';
    }),
    nota: (document.querySelector('.trunc-note')||{}).textContent||'',
    refDeclarada: document.getElementById('content').getAttribute('data-janela-ref')||''
  })`));
  assert.strictEqual(novos.view, 'novos', 'Estado de visão não virou novos.');
  assert(novos.cabecalhos.indexOf('Consulta nova') >= 0, `Visão de novos sem coluna própria: ${novos.cabecalhos.join(' / ')}`);
  assert(novos.cabecalhos.indexOf('Antes') < 0, 'Visão de novos não deveria ter coluna "Antes" | é zero por definição.');
  assert(novos.linhas > 0, 'Visão de novos veio vazia.');
  const impN = novos.impressoes.map(Number).filter((n) => !isNaN(n));
  for (let i = 1; i < impN.length; i += 1) {
    assert(impN[i] <= impN[i - 1], `Novos não vieram ordenados por impressão: ${impN.join(' > ')}`);
  }
  assert(/sem NENHUMA impressão na janela de referência/.test(novos.nota),
    `Visão de novos não declara a janela de referência: "${novos.nota}"`);
  assert(/^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(novos.refDeclarada), `Janela de referência não exposta: ${novos.refDeclarada}`);

  // 14) Páginas: rótulo tem que distinguir fragmento e host
  // Regressão real: sem o `#fragmento` no rótulo, 27 URLs distintas viravam a
  // mesma linha na tabela; sem o host, 6 hosts serviam a linha "/".
  await evaluate("document.querySelector('[data-view=\"paginas\"]').click()");
  await sleep(600);
  const rotulos = JSON.parse(await evaluate(`JSON.stringify(
    Array.prototype.slice.call(document.querySelectorAll('#content tbody tr[data-row] td:first-child')).map(function(t){return t.textContent.trim();})
  )`));
  const repetidos = rotulos.filter((r, i) => rotulos.indexOf(r) !== i);
  assert.strictEqual(repetidos.length, 0, `Rótulos de página duplicados na tabela: ${repetidos.slice(0, 3).join(' | ')}`);

  // 15) Janela livre de/até: recarrega e declara a janela pedida
  const de = arg('from', '2026-07-01');
  const ate = arg('to', '2026-07-31');
  await evaluate(`(function(){
    document.getElementById('f-from').value='${de}';
    document.getElementById('f-to').value='${ate}';
    document.getElementById('f-apply').click();
  })()`);
  let custom = false;
  for (let i = 0; i < 60; i += 1) {
    custom = await evaluate(`(function(){
      var c=document.getElementById('content');
      return !c.classList.contains('hidden') && c.getAttribute('data-base-atual')==='custom'
        && c.getAttribute('data-janela')==='${de}..${ate}';
    })()`);
    if (custom) break;
    await sleep(1000);
  }
  assert.strictEqual(custom, true, `Janela livre ${de} a ${ate} não renderizou.`);
  const livre = JSON.parse(await evaluate(`JSON.stringify({
    cmpCards: document.querySelectorAll('[data-cmp]').length,
    cmpCustomAtivo: !!document.querySelector('.cmp-card.active[data-cmp="custom"]'),
    ref: document.getElementById('content').getAttribute('data-janela-ref'),
    chipAtivo: (document.querySelector('#filters .period-chip.active')||{}).textContent||'',
    higiene: document.getElementById('content').textContent
  })`));
  assert.strictEqual(livre.cmpCards, 6, `Strip devia ganhar o cartão Personalizado, veio ${livre.cmpCards}.`);
  assert.strictEqual(livre.cmpCustomAtivo, true, 'Cartão Personalizado não ficou ativo.');
  assert.strictEqual(livre.chipAtivo, 'Personalizado', `Chip ativo inesperado: ${livre.chipAtivo}`);
  assert(/^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(livre.ref), `Referência da janela livre não declarada: ${livre.ref}`);
  // 31 dias não é múltiplo de 7: a página tem que avisar, não fingir.
  assert(/não é múltiplo de 7/.test(livre.higiene),
    'Janela livre de 31 dias não disparou o aviso de composição de dia da semana.');

  assert.deepStrictEqual(consoleErrors, [], `erros JS no console: ${consoleErrors.join(' | ')}`);
  ws.close();
  console.log(`OK | smoke seo performance CDP | ${baseUrl} | base=${baseCmp} janela=${shape.janela} | kpis=${shape.heroKpis} cards=${shape.cards} barras=${shape.barras} linhas=${shape.linhas} visoes=${shape.tabs} novos=${novos.linhas} higiene=${higiene} | livre=${de}..${ate}`);
}

run().finally(() => {
  chrome.kill('SIGTERM');
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
}).catch((error) => {
  console.error(`FAIL | smoke seo performance CDP | ${error.message}`);
  process.exitCode = 1;
});
