// Smoke do painel MKT Budget: executa os <script> inline do mkt-budget.html
// num DOM mínimo real (nós de verdade guardando innerHTML/textContent),
// com fetch apontando para os JSON de public/data, e confere se os números
// que aparecem na tela batem com os JSON de origem.
//
// Uso: node scripts/smoke-mkt-budget.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'public', 'mkt-budget.html');
const DATA = path.join(ROOT, 'public', 'data');

const html = fs.readFileSync(HTML, 'utf8');
const recon = JSON.parse(fs.readFileSync(path.join(DATA, 'marketing-budget-2026-reconciliation.json'), 'utf8'));
const lines = JSON.parse(fs.readFileSync(path.join(DATA, 'marketing-budget-2026-line-items.json'), 'utf8'));

const fails = [];
const passes = [];
function check(name, cond, detail) {
  (cond ? passes : fails).push(detail ? `${name} | ${detail}` : name);
}

// ── IDs que a página precisa preencher ──────────────────────────────────────
const IDS = [
  'heroMetrics', 'bridgeTable', 'scenarioBars', 'timeline', 'committedIntro',
  'committedMetrics', 'committedTable', 'recurringIntro', 'recurringTable',
  'envelopeBars', 'strategyPresets', 'strategyToggles', 'strategyLevers',
  'strategyMatrix', 'strategyTotal', 'meceBars', 'assumptions', 'sourceTable',
  'lineItemsTable', 'lineSummary', 'pageInfo', 'prevPage', 'nextPage',
  'exportCsv', 'lineMonth', 'lineCategory', 'lineOrigin', 'lineItemsIntro',
  'openQuestions', 'nav-drawer', 'nav-backdrop', 'topbar', 'dataPath',
];

function makeNode(id) {
  return {
    id, innerHTML: '', textContent: '', disabled: false, value: '', checked: false,
    dataset: {}, style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, append() {}, remove() {}, click() {},
    querySelectorAll() { return []; },
  };
}

const nodes = Object.fromEntries(IDS.map(id => [id, makeNode(id)]));

const doc = {
  documentElement: {
    getAttribute() { return 'dark'; },
    setAttribute() {},
  },
  body: { classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} },
  getElementById(id) { return nodes[id] || null; },
  querySelector() { return { prepend() {}, append() {} }; },
  querySelectorAll() { return []; },
  createElement() { return makeNode('created'); },
  addEventListener() {},
};

const pending = [];
function fakeFetch(url) {
  const file = url.startsWith('/data/') ? path.join(ROOT, 'public', url) : null;
  const p = file
    ? Promise.resolve({ json: () => Promise.resolve(JSON.parse(fs.readFileSync(file, 'utf8'))) })
    : Promise.reject(new Error('fetch não mapeado: ' + url));
  pending.push(p);
  return p;
}

const sandbox = {
  document: doc,
  window: { addEventListener() {}, matchMedia: () => ({ matches: false }), scrollY: 0 },
  localStorage: { getItem() { return null; }, setItem() {} },
  fetch: fakeFetch,
  Intl, URL: { createObjectURL() { return 'blob:x'; }, revokeObjectURL() {} },
  Blob: function () {}, console,
  setTimeout, clearTimeout,
};
sandbox.globalThis = sandbox;

const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
check(`extraiu ${scripts.length} blocos de script inline`, scripts.length >= 2, `${scripts.length}`);

const ctx = vm.createContext(sandbox);
try {
  scripts.forEach((code, i) => vm.runInContext(code, ctx, { filename: `mkt-budget.inline[${i}].js` }));
} catch (err) {
  console.error('FALHA ao executar script inline:', err);
  process.exit(1);
}

(async () => {
  await Promise.all(pending).catch(err => { console.error('fetch falhou:', err); process.exit(1); });
  await new Promise(r => setTimeout(r, 40));

  const brl = v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
    .replace(/ /g, ' ');
  const norm = s => String(s).replace(/ /g, ' ');
  const has = (id, value) => norm(nodes[id].innerHTML + '|' + nodes[id].textContent).includes(norm(value));

  const fr = recon.futureRecurring;
  const se = recon.strategicEnvelope;
  const cc = recon.committedCommitments;

  // 1. Todo alvo de render foi preenchido
  ['heroMetrics', 'bridgeTable', 'scenarioBars', 'timeline', 'committedMetrics',
    'committedTable', 'recurringTable', 'envelopeBars', 'strategyLevers', 'meceBars',
    'assumptions', 'sourceTable', 'openQuestions', 'lineItemsTable',
  ].forEach(id => check(`#${id} preenchido`, nodes[id].innerHTML.length > 0, `${nodes[id].innerHTML.length} chars`));
  ['recurringIntro', 'committedIntro', 'lineItemsIntro', 'strategyTotal', 'lineSummary']
    .forEach(id => check(`#${id} com texto`, nodes[id].textContent.length > 0, `${nodes[id].textContent.length} chars`));

  // 2. Números da reconciliação chegam na tela
  check('hero mostra envelope ainda livre', has('heroMetrics', brl(se.availableAfterCommitments)), brl(se.availableAfterCommitments));
  check('hero mostra total comprometido', has('heroMetrics', brl(cc.total)), brl(cc.total));
  check('ponte mostra recorrência ago-dez', has('bridgeTable', brl(fr.total)), brl(fr.total));
  check('ponte mostra envelope estratégico', has('bridgeTable', brl(se.freeAfterRecurring)), brl(se.freeAfterRecurring));
  check('ponte mostra envelope ainda livre', has('bridgeTable', brl(se.availableAfterCommitments)), brl(se.availableAfterCommitments));
  check('cenário com projetos confirmados', has('scenarioBars', brl(recon.scenarios.committedIncludingConfirmedProjects)), brl(recon.scenarios.committedIncludingConfirmedProjects));

  // 3. Recorrências revisadas
  [['Apollo', 504.9], ['Apify', 147.9], ['Clay', 943.5]].forEach(([name, amount]) => {
    const item = fr.baseItems.find(b => b.name === name);
    check(`recorrência ${name} = ${brl(amount)} no JSON`, item && item.monthlyAmount === amount, item ? String(item.monthlyAmount) : 'ausente');
    check(`tabela mostra ${name}`, has('recurringTable', name) && has('recurringTable', brl(amount)));
  });
  const usd = Object.fromEntries((fr.usdItems || []).map(u => [u.name, u.usdAmount]));
  check('tabela anota conversão em USD', has('recurringTable', `${usd.Clay} USD`), `${usd.Clay} USD`);

  // 4. Compromissos confirmados
  check('compromisso pago aparece', has('committedTable', brl(cc.paid)), brl(cc.paid));
  check('compromisso pendente aparece', has('committedTable', brl(cc.pending)), brl(cc.pending));
  check('compromisso nomeia Brindes Lux', has('committedTable', 'Brindes Lux'));
  check('métricas de compromisso somam o total', has('committedMetrics', brl(cc.total)), brl(cc.total));

  // 5. Timeline: 12 meses, agosto com faixa de comprometido
  const monthRows = (nodes.timeline.innerHTML.match(/class="month"/g) || []).length;
  check('timeline com 12 meses', monthRows === 12, String(monthRows));
  const ago = recon.plannedMonthlyCeilings.find(c => c.month === '2026-08');
  check('timeline tem faixa de compromisso', nodes.timeline.innerHTML.includes('class="committed"'));
  check('timeline mostra teto de agosto', has('timeline', brl(ago.ceiling)), brl(ago.ceiling));

  // 6. Lançamentos linha a linha
  check('resumo cita o total de lançamentos', nodes.lineItemsIntro.textContent.includes(String(lines.summary.itemCount)), String(lines.summary.itemCount));
  check('resumo da tabela soma o total', has('lineSummary', brl(lines.summary.totalAmount)), brl(lines.summary.totalAmount));
  const origins = new Set(lines.items.map(i => i.origin));
  check('origem Compromisso existe nos lançamentos', origins.has('Compromisso'));

  // 7. Regra primária nº 1: separador é sempre a barra vertical
  const rendered = IDS.map(id => nodes[id].innerHTML + ' ' + nodes[id].textContent).join('\n');
  const dashSep = [...rendered.matchAll(/\S+\s[—–·]\s\S+/g)].map(m => m[0]);
  check('sem travessão/en-dash/middot como separador', dashSep.length === 0, dashSep.slice(0, 4).join(' ;; '));

  // 8. Nenhum erro de JS capturado pelo handler da página
  check('sem erro de JS registrado', !sandbox.window.__mktBudgetSmokeError, String(sandbox.window.__mktBudgetSmokeError));

  passes.forEach(p => console.log('PASS ', p));
  fails.forEach(f => console.log('FAIL ', f));
  console.log(`\n${passes.length} PASS | ${fails.length} FAIL`);
  if (fails.length) process.exit(1);
  console.log('OK — smoke do MKT Budget passou');
})();
