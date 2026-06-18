// Smoke test: roda os <script> inline de um HTML num DOM stub com dados reais
// e chama novoRender(), capturando qualquer exceção de runtime em builders.
// Uso: node _smoke-render.js <arquivo.html> [includeLost]
const fs = require('fs');
const http = require('http');
const vm = require('vm');

const file = process.argv[2];
const includeLost = process.argv[3] === 'includeLost';

function get(path) {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:3002' + path, res => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

// ---- Universal DOM/browser stub via Proxy ----
function makeStub(name) {
  const fn = function () { return makeStub(name + '()'); };
  return new Proxy(fn, {
    get(_t, prop) {
      if (prop === 'length') return 0;
      if (prop === 'matches') return false;
      if (prop === 'classList') return { add(){}, remove(){}, toggle(){}, contains(){ return false; } };
      if (prop === 'style') return new Proxy({}, { get(){ return ''; }, set(){ return true; } });
      if (prop === 'getBoundingClientRect') return () => ({ x:0,y:0,width:0,height:0,top:0,left:0,right:0,bottom:0 });
      if (prop === 'getContext') return () => makeStub('ctx');
      if (prop === 'textContent' || prop === 'innerHTML' || prop === 'value') return '';
      if (prop === Symbol.toPrimitive || prop === 'toString') return () => '';
      if (prop === 'dataset') return {};
      return makeStub(name + '.' + String(prop));
    },
    set() { return true; },
    apply() { return makeStub(name + '()'); }
  });
}

(async () => {
  const data = await get('/api/forecast-table' + (includeLost ? '?includeLost=true' : ''));
  const deals = data.deals || data;

  const path = require('path');
  const html = fs.readFileSync(file, 'utf8');
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m, scripts = [], externalSrcs = [];
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/.test(attrs)) {
      const sm = attrs.match(/src\s*=\s*["']([^"']+)["']/);
      if (sm) externalSrcs.push(sm[1]);
      continue;
    }
    if (/type\s*=\s*["']?(application\/json|text\/template)/i.test(attrs)) continue;
    scripts.push(m[2]);
  }
  // Load local public/*.js referenced by <script src="/..."> before inline scripts
  const publicDir = path.join(path.dirname(path.resolve(file)), '');
  const preScripts = [];
  for (const src of externalSrcs) {
    const localPath = src.replace(/\?.*$/, ''); // strip query string
    const localFile = path.join(publicDir, localPath);
    if (fs.existsSync(localFile)) preScripts.push({ code: fs.readFileSync(localFile, 'utf8'), name: localFile });
  }
  scripts = preScripts.map(function(s){ return s; }).concat(scripts.map(function(s){ return { code: s, name: file }; }));

  const doc = makeStub('document');
  const win = makeStub('window');
  const sandbox = {
    document: doc, window: win, console,
    localStorage: { getItem(){ return null; }, setItem(){}, removeItem(){} },
    navigator: { language: 'pt-BR' },
    location: { pathname: '/novo-board', href: '', search: '' },
    Chart: makeStub('Chart'),
    ChartDataLabels: {},
    fetch: function () { return Promise.resolve({ json(){ return Promise.resolve({ success:true, vendas:{}, bid:{} }); } }); },
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: function (cb) { return 0; },
    matchMedia: function () { return { matches: false, addListener(){}, addEventListener(){} }; },
    addEventListener(){}, removeEventListener(){}, dispatchEvent(){ return true; },
    getComputedStyle(){ return makeStub('cs'); },
    CustomEvent: function(){}, Event: function(){},
    MutationObserver: function(){ return { observe(){}, disconnect(){} }; },
    ResizeObserver: function(){ return { observe(){}, disconnect(){} }; },
    JSON, Math, Date, parseInt, parseFloat, isNaN, isFinite, Object, Array, String, Number, Boolean, RegExp, Intl, encodeURIComponent, decodeURIComponent,
  };
  sandbox.window = sandbox; // window.X === global X
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);

  let loadErr = null;
  scripts.forEach((s, i) => {
    const code = typeof s === 'string' ? s : s.code;
    const fname = typeof s === 'string' ? (file + '#script' + (i + 1)) : s.name;
    try { vm.runInContext(code, ctx, { filename: fname }); }
    catch (e) { loadErr = loadErr || (fname + ': ' + e.message); }
  });
  if (loadErr) { console.log('ERRO ao carregar script: ' + loadErr); process.exit(1); }

  // injeta dados e renderiza
  try {
    ctx._novoDeals = deals;
    if (typeof ctx.novoRender !== 'function') { console.log('novoRender não definido'); process.exit(1); }
    ctx.novoRender();
    console.log('OK | novoRender() rodou sem exceção em ' + file.split(/[\\/]/).pop() + ' (' + deals.length + ' deals)');
  } catch (e) {
    console.log('ERRO em novoRender(): ' + e.stack);
    process.exit(1);
  }
})().catch(e => { console.error('ERRO harness: ' + e.message); process.exit(1); });
