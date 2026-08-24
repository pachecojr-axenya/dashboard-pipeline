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

  // 4. Compromissos confirmados | cada linha na tabela, os agregados nas métricas
  cc.items.forEach(item => {
    check(`compromisso "${item.name}" na tabela`, has('committedTable', item.name) && has('committedTable', brl(item.amount)), brl(item.amount));
    check(`compromisso "${item.name}" com status`, has('committedTable', item.status));
  });
  check('tabela fecha no total comprometido', has('committedTable', brl(cc.total)), brl(cc.total));
  ['total', 'paid', 'pending'].forEach(k =>
    check(`métrica de compromisso ${k}`, has('committedMetrics', brl(cc[k])), brl(cc[k])));
  check('total = pago + pendente', Math.round(cc.total * 100) === Math.round((cc.paid + cc.pending) * 100), `${cc.paid} + ${cc.pending}`);

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

  // 6b. Invariantes da base de COMPETÊNCIA (o que segura a leitura "mês X = gasto do mês X")
  const c2 = v => Math.round(Number(v) * 100);
  const REALIZADO = new Set(['caixa', 'competência', 'ajuste de transição']);
  const somaItens = pred => lines.items.filter(pred).reduce((s, i) => s + i.amount, 0);

  // invariante central: os cinco tetos de ago-dez somam o saldo em 31/07
  const somaTetos = recon.plannedMonthlyCeilings.reduce((s, c) => s + c.ceiling, 0);
  check('soma dos tetos ago-dez = saldo em 31/jul',
    c2(somaTetos) === c2(recon.balanceAtJuly31), `${brl(somaTetos)} vs ${brl(recon.balanceAtJuly31)}`);

  // a série mensal fecha no realizado jan-jul
  const somaMensal = recon.actuals.monthly.reduce((s, m) => s + m.amount, 0);
  check('actuals.monthly soma throughJuly',
    c2(somaMensal) === c2(recon.actuals.throughJuly), `${brl(somaMensal)} vs ${brl(recon.actuals.throughJuly)}`);

  // saldos derivam do orçamento, não são digitados
  check('saldo em 31/jul = anual - realizado jan-jul',
    c2(recon.balanceAtJuly31) === c2(recon.annualBudget - recon.actuals.throughJuly));
  check('saldo em 24/08 = anual - realizado jan-ago',
    c2(recon.balanceAtAug24) === c2(recon.annualBudget - recon.actuals.throughAug24));
  check('realizado jan-ago = jan-jul + agosto realizado',
    c2(recon.actuals.throughAug24) === c2(recon.actuals.throughJuly + recon.augustToDate.realized));

  // envelope fecha
  const se2 = recon.strategicEnvelope;
  check('envelope livre = envelope - pendentes',
    c2(se2.availableAfterCommitments) === c2(se2.freeAfterRecurring - se2.committedFromEnvelope));
  check('distribuição do envelope soma o disponível',
    c2(se2.distribution.reduce((s, d) => s + d.amount, 0)) === c2(se2.availableAfterCommitments));

  // os JSON não podem divergir entre si
  ['2026-06', '2026-07'].forEach(m => {
    const doJson = somaItens(i => i.month === m && REALIZADO.has(i.basis));
    const naSerie = (recon.actuals.monthly.find(x => x.month === m) || {}).amount;
    check(`lançamentos de ${m} somam a série mensal`, c2(doJson) === c2(naSerie), `${brl(doJson)} vs ${brl(naSerie)}`);
  });
  const agoReal = somaItens(i => i.month === '2026-08' && REALIZADO.has(i.basis));
  check('lançamentos de agosto somam augustToDate.realized',
    c2(agoReal) === c2(recon.augustToDate.realized), `${brl(agoReal)} vs ${brl(recon.augustToDate.realized)}`);
  const agoPend = somaItens(i => i.month === '2026-08' && i.basis === 'compromisso');
  check('pendentes de agosto = total comprometido',
    c2(agoPend) === c2(cc.total), `${brl(agoPend)} vs ${brl(cc.total)}`);

  // mídia paga de jul/ago vem da API, não do cartão (nunca voltar ao valor de limiar)
  const midiaJul = somaItens(i => i.month === '2026-07' && i.meceCategory === 'Mídia Paga');
  check('mídia paga de julho = entrega medida na API (R$ 9.656,38)',
    c2(midiaJul) === c2(9656.38), brl(midiaJul));
  check('nenhuma linha de mídia paga em jul/ago veio de cartão',
    !lines.items.some(i => i.month >= '2026-07' && i.meceCategory === 'Mídia Paga' && i.origin !== 'API do canal'),
    lines.items.filter(i => i.month >= '2026-07' && i.meceCategory === 'Mídia Paga' && i.origin !== 'API do canal').map(i => i.origin).join(','));

  // 6c. Decisões de 24/08: Treble fora do escopo, CONARH pago, agência a 6.500
  const fora = lines.items.filter(i => i.basis === 'fora do escopo');
  check('Treble.ai existe como linha fora do escopo', fora.length === 1 && /Treble/.test(fora[0].expenseName),
    fora.map(i => i.expenseName).join(','));
  check('linha fora do escopo não entra no realizado do mês',
    c2(somaItens(i => i.month === '2026-07' && REALIZADO.has(i.basis))) ===
    c2(somaItens(i => i.month === '2026-07') - fora.reduce((s, i) => s + i.amount, 0)));

  const conarh2 = lines.items.filter(i => /CONARH/.test(i.expenseName) && /2\/2/.test(i.expenseName));
  check('CONARH parcela 2/2 está no realizado de agosto',
    conarh2.length === 1 && conarh2[0].month === '2026-08' && REALIZADO.has(conarh2[0].basis),
    conarh2.map(i => `${i.month}/${i.basis}`).join(','));
  check('CONARH parcela 2/2 saiu dos compromissos',
    !cc.items.some(i => /2\/2/.test(i.share || '') || /parcela 2/i.test(i.name)));

  const AGENCIA = 6500;
  const agRec = fr.baseItems.find(b => b.name === 'Agência de PR');
  check(`Agência de PR = ${brl(AGENCIA)} na recorrência`, agRec && agRec.monthlyAmount === AGENCIA,
    agRec ? String(agRec.monthlyAmount) : 'ausente');
  const agItens = lines.items.filter(i => i.expenseName === 'Agência de PR');
  check('nenhum lançamento de agência ficou em R$ 6.950,00',
    agItens.every(i => i.amount === AGENCIA), agItens.map(i => `${i.month}=${i.amount}`).join(' '));

  // os dois JSON precisam concordar mês a mês também no futuro projetado
  fr.monthly.filter(m => m.month >= '2026-09').forEach(m => {
    const doJson = somaItens(i => i.month === m.month);
    check(`projeção de ${m.month} bate entre os dois JSON`, c2(doJson) === c2(m.amount),
      `${brl(doJson)} vs ${brl(m.amount)}`);
  });

  // toda linha realizada precisa declarar a base, e jun+ precisa ser competência
  const semBase = lines.items.filter(i => !i.basis);
  check('toda linha declara a base', semBase.length === 0, `${semBase.length} sem basis`);
  const caixaTardia = lines.items.filter(i => i.month >= '2026-06' && i.basis === 'caixa');
  check('nenhum mês de jun em diante ficou em caixa', caixaTardia.length === 0, `${caixaTardia.length} linhas`);
  recon.actuals.monthly.forEach(m =>
    check(`${m.month} declara base`, Boolean(m.basis), String(m.basis)));

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
