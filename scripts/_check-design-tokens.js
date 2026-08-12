// Gate do design system (docs/design-system.md). Valida, por arquivo HTML
// governado, que os módulos compartilhados obrigatórios estão incluídos e que
// não há regressão de padrões já migrados (classe antiga, :root local revivido).
// Achados de cor legada em CSS puro são reportados como aviso (dívida
// catalogada em design-system.md §2), não travam o build — ver seção
// "O que este gate NÃO faz" no próprio design-system.md.
//
// Uso: node _check-design-tokens.js <arquivo.html> [arquivo2.html ...]
const fs = require('fs');
const path = require('path');

// Módulos compartilhados que cada painel governado deve incluir hoje —
// verificado contra o conteúdo real de cada arquivo, não aspiracional.
// Atualize esta lista quando um painel adotar/abandonar um módulo (e registre
// a mudança em design-system.md).
const REQUIRED_SCRIPTS = {
  'dashboard.html':      ['premium.css', 'premium.js', 'help-drawer.js', 'ax-ui.js', 'nav.js'],
  'board.html':          ['premium.css', 'premium.js', 'help-drawer.js', 'ax-ui.js', 'settings-modal.js', 'nav.js'],
  'ae.html':             ['premium.css', 'premium.js', 'help-drawer.js', 'ax-ui.js', 'settings-modal.js', 'nav.js'],
  'cs.html':             ['premium.css', 'premium.js', 'ax-ui.js', 'settings-modal.js', 'nav.js'],
  'cotacao.html':        ['premium.css', 'premium.js', 'ax-ui.js', 'settings-modal.js', 'nav.js'],
  '48h.html':            ['premium.css', 'premium.js', 'ax-ui.js', 'settings-modal.js', 'nav.js'],
  'forecast-delta.html': ['premium.css', 'premium.js', 'ax-ui.js', 'nav.js'],
};

// Arquivos onde a limpeza do :root morto (Tier 1, item 2 de design-system.md)
// já foi confirmada — reintroduzir um bloco :root local aqui é regressão real,
// não dívida antiga, então trava o build. Fora desta lista (dashboard/board/ae
// hoje) o :root morto é dívida JÁ catalogada — reportado como aviso.
const ROOT_CLEAN = new Set(['cs.html', 'cotacao.html', '48h.html', 'forecast-delta.html']);

// Classes do sistema antigo (pré-premium.css) que nenhum painel governado deve
// reintroduzir — token exato, não substring (não confundir com .novo-card/.kpi-card).
const BANNED_CLASS_TOKENS = new Set(['card', 'kpi']);

// Cores da paleta pré-premium.css, hardcoded em CSS puro (fora de <script>) —
// não passam pelo remap em runtime do premium.js (que só intercepta datasets
// do Chart.js). Ver design-system.md §1.0 e §2. Reportadas como aviso: é dívida
// extensa e já mapeada, corrigir em massa aqui seria escopo de implementação,
// não de gate.
const LEGACY_CSS_COLORS = [
  '#0d1117', '#171f2e', '#1e2a3c', '#293a50', '#3ab8b7', '#3fb950', '#f85149',
  '#1f2328', '#e6edf3', '#e69650', 'rgba(58,184,183', 'rgba(63, 184, 183',
  'rgba(63,185,80', 'rgba(248,81,73',
];

function extractStyleBlocks(html) {
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let m, out = '';
  while ((m = re.exec(html)) !== null) out += m[1] + '\n';
  return out;
}

function checkFile(file) {
  const base = path.basename(file);
  const html = fs.readFileSync(file, 'utf8');
  const styleText = extractStyleBlocks(html);
  const errors = [];
  const warnings = [];

  const required = REQUIRED_SCRIPTS[base];
  if (required) {
    required.forEach(function (mod) {
      const pattern = new RegExp('["\'/]' + mod.replace('.', '\\.') + '(\\?[^"\']*)?["\']');
      if (!pattern.test(html)) {
        errors.push('módulo obrigatório ausente: ' + mod + ' (design-system.md, painel governado)');
      }
    });
  }

  const rootRe = /:root\s*\{/g;
  if (rootRe.test(styleText)) {
    const msg = 'bloco :root local declarado (deveria vir só de premium.css)';
    if (ROOT_CLEAN.has(base)) errors.push(msg + ' — regressão em arquivo já limpo');
    else warnings.push(msg + ' — dívida conhecida (Tier 1.2 pendente neste arquivo), ver design-system.md');
  }

  const classAttrRe = /class\s*=\s*"([^"]*)"|class\s*=\s*'([^']*)'/g;
  let cm;
  while ((cm = classAttrRe.exec(html)) !== null) {
    const tokens = (cm[1] || cm[2] || '').split(/\s+/).filter(Boolean);
    tokens.forEach(function (t) {
      if (BANNED_CLASS_TOKENS.has(t)) {
        errors.push('classe legada "' + t + '" usada em class="' + (cm[1] || cm[2]) + '" — use .novo-card/.kpi-card');
      }
    });
  }

  let legacyHits = 0;
  LEGACY_CSS_COLORS.forEach(function (c) {
    const count = styleText.split(c).length - 1;
    legacyHits += count;
  });
  if (legacyHits > 0) {
    warnings.push(legacyHits + ' ocorrência(s) de cor legada em CSS puro (fora de <script>) — dívida catalogada em design-system.md §2, não bloqueia');
  }

  return { file, errors, warnings };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Uso: node _check-design-tokens.js <arquivo.html> [...]');
  process.exit(1);
}

let totalErrors = 0;
files.forEach(function (f) {
  const r = checkFile(f);
  r.warnings.forEach(function (w) { console.log('AVISO | ' + r.file + ' | ' + w); });
  r.errors.forEach(function (e) { console.log('ERRO  | ' + r.file + ' | ' + e); });
  totalErrors += r.errors.length;
  if (!r.errors.length && !r.warnings.length) console.log('OK    | ' + r.file);
});

console.log('_check-design-tokens: ' + files.length + ' arquivo(s), ' + totalErrors + ' erro(s).');
process.exit(totalErrors ? 1 : 0);
