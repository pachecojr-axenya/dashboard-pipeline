'use strict';
/**
 * check-semantic.js | Valida a camada semântica (semantic/*.json) | Fase 1 do 2.0.
 *
 * 1. Sintaxe: os 3 JSONs parseiam.
 * 2. Consistência interna: labels PT/EN, unidades válidas, origem válida,
 *    usa_dados/usa_referencia/depende_de apontam para coisas que existem,
 *    chaves das réguas de probabilidade são nomes/aliases de etapas reais.
 * 3. Drift contra o código: todo id de etapa/pipeline hardcoded nos arquivos
 *    vigiados precisa existir no referencia.json (senão o catálogo mente).
 *
 * Sai com código 1 em erro (roda no `npm run check`). Warnings não derrubam.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const errors = [];
const warns = [];

function load(name) {
  const p = path.join(ROOT, 'semantic', name);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    errors.push(`${name}: JSON inválido | ${e.message}`);
    return null;
  }
}

const referencia = load('referencia.json');
const dados = load('dados.json');
const regras = load('regras.json');

if (referencia && dados && regras) {
  // ── referencia.json ─────────────────────────────────────────────────────────
  const pipeKeys = Object.keys(referencia.pipelines || {});
  const pipeIds = pipeKeys.map(k => referencia.pipelines[k].id);
  const etapas = referencia.etapas || [];
  const stageIds = new Set();
  const stageNames = new Set();

  etapas.forEach(et => {
    if (!et.id || !et.nome || !et.pipeline || et.ordem == null) errors.push(`referencia: etapa incompleta (id/nome/pipeline/ordem) → ${JSON.stringify(et.id || et.nome)}`);
    if (stageIds.has(et.id)) errors.push(`referencia: id de etapa duplicado → ${et.id}`);
    stageIds.add(et.id);
    if (et.pipeline && !pipeKeys.includes(et.pipeline)) errors.push(`referencia: etapa ${et.id} aponta pipeline inexistente '${et.pipeline}'`);
    stageNames.add(et.nome);
    (et.aliases || []).forEach(a => stageNames.add(a));
  });

  // Chaves das réguas precisam ser nomes/aliases de etapas reais.
  const reguas = referencia.reguas_probabilidade || {};
  ['forecast_flat', 'painel_default'].forEach(rk => {
    const valores = (reguas[rk] || {}).valores || {};
    Object.keys(valores).forEach(nome => {
      if (!stageNames.has(nome)) errors.push(`referencia: régua ${rk} tem chave '${nome}' que não é nome/alias de etapa`);
      const v = valores[nome];
      if (typeof v !== 'number' || v < 0 || v > 1) errors.push(`referencia: régua ${rk}.${nome} fora de [0,1] → ${v}`);
    });
  });

  // ── dados.json ──────────────────────────────────────────────────────────────
  const unidades = new Set((dados._meta || {}).unidades_validas || []);
  const dadoKeys = new Set(Object.keys(dados.dados || {}));
  Object.entries(dados.dados || {}).forEach(([k, d]) => {
    if (!d.label || !d.label.pt || !d.label.en) errors.push(`dados.${k}: label PT/EN incompleto (bilíngue por design, ADR-005)`);
    if (!['fonte', 'manual'].includes(d.origem)) errors.push(`dados.${k}: origem inválida '${d.origem}' (fonte|manual)`);
    if (!d.unidade || !unidades.has(d.unidade)) errors.push(`dados.${k}: unidade ausente/inválida '${d.unidade}'`);
    if (d.origem === 'fonte' && !d.hubspot) errors.push(`dados.${k}: origem fonte sem propriedade hubspot`);
    if (d.origem === 'manual' && !d.persistencia) errors.push(`dados.${k}: dado manual sem persistencia declarada (ADR-004)`);
  });

  // ── regras.json ─────────────────────────────────────────────────────────────
  const tipos = new Set((regras._meta || {}).tipos_validos || []);
  const statuses = new Set((regras._meta || {}).status_validos || []);
  const regraKeys = new Set(Object.keys(regras.regras || {}));

  function refPathExists(p) {
    let cur = referencia;
    for (const part of p.split('.')) {
      if (cur == null || typeof cur !== 'object' || !(part in cur)) return false;
      cur = cur[part];
    }
    return true;
  }

  Object.entries(regras.regras || {}).forEach(([k, r]) => {
    if (!r.label || !r.label.pt || !r.label.en) errors.push(`regras.${k}: label PT/EN incompleto`);
    if (!tipos.has(r.tipo)) errors.push(`regras.${k}: tipo inválido '${r.tipo}'`);
    if (!statuses.has(r.status)) errors.push(`regras.${k}: status inválido '${r.status}'`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.vigente_desde || '')) errors.push(`regras.${k}: vigente_desde ausente/inválido (ADR-010)`);
    if (!r.formula && !r.filtro) errors.push(`regras.${k}: sem formula nem filtro`);
    if (!Array.isArray(r.fonte_codigo) || !r.fonte_codigo.length) errors.push(`regras.${k}: fonte_codigo vazio (extração precisa apontar o código real)`);
    (r.usa_dados || []).forEach(d => { if (!dadoKeys.has(d)) errors.push(`regras.${k}: usa_dados '${d}' não existe em dados.json`); });
    (r.usa_referencia || []).forEach(p => { if (!refPathExists(p)) errors.push(`regras.${k}: usa_referencia '${p}' não resolve em referencia.json`); });
    (r.depende_de || []).forEach(d => { if (!regraKeys.has(d)) errors.push(`regras.${k}: depende_de '${d}' não existe em regras.json`); });
  });

  // ── Drift contra o código ───────────────────────────────────────────────────
  // Ids de etapa do HubSpot têm 10 dígitos; qualquer um hardcoded nos arquivos
  // vigiados precisa existir no catálogo.
  const vigiados = ['api/forecast-table.js', 'api/funnel-stages.js', 'lib/snapshot-format.js', 'lib/hubspot.js'];
  const tk = referencia.tickets_cotacao || {};
  const ticketIds = (tk.etapas || []).map(e => e.id).concat(tk.pipeline ? [tk.pipeline.id] : []);
  const conhecidos = new Set([...stageIds, ...pipeIds, ...ticketIds]);
  vigiados.forEach(rel => {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { warns.push(`drift: arquivo vigiado ausente → ${rel}`); return; }
    const src = fs.readFileSync(p, 'utf8');
    const found = new Set((src.match(/\b\d{10}\b/g) || []));
    found.forEach(id => {
      if (!conhecidos.has(id)) errors.push(`drift: ${rel} usa id '${id}' que NÃO está em referencia.json`);
    });
  });

  // Régua flat: o literal 0.185790008 (Cotação 18,6%) identifica a régua nos
  // consumidores do 1.0; se sumir de lá, o catálogo desatualizou (ou vice-versa).
  ['public/forecast.html', 'public/forecast-stage.html'].forEach(rel => {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { warns.push(`drift: ${rel} ausente`); return; }
    if (!fs.readFileSync(p, 'utf8').includes('0.185790008')) {
      errors.push(`drift: ${rel} não contém mais a régua flat (0.185790008) documentada em referencia.reguas_probabilidade.forecast_flat`);
    }
  });

  // Visualização legível (ADR-003): avisa se está mais velha que os JSONs.
  const viewPath = path.join(ROOT, 'docs', 'dashboard-2.0', 'catalogo.md');
  if (fs.existsSync(viewPath)) {
    const viewM = fs.statSync(viewPath).mtimeMs;
    ['referencia.json', 'dados.json', 'regras.json'].forEach(n => {
      if (fs.statSync(path.join(ROOT, 'semantic', n)).mtimeMs > viewM) warns.push(`catalogo.md mais antigo que semantic/${n} — rode: node scripts/semantic-view.js`);
    });
  } else {
    warns.push('docs/dashboard-2.0/catalogo.md ausente — rode: node scripts/semantic-view.js');
  }
}

warns.forEach(w => console.log('  ⚠ ' + w));
if (errors.length) {
  errors.forEach(e => console.error('  ✗ ' + e));
  console.error(`check-semantic: ${errors.length} erro(s).`);
  process.exit(1);
}
console.log(`check-semantic: OK (${warns.length} aviso(s)).`);
