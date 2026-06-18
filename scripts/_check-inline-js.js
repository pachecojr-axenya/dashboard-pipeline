// Extrai cada <script> inline (sem src) de um HTML e valida sintaxe via vm.
// Uso: node _check-inline-js.js <arquivo.html>
const fs = require('fs');
const vm = require('vm');

const file = process.argv[2];
const html = fs.readFileSync(file, 'utf8');

const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, idx = 0, errors = 0;
while ((m = re.exec(html)) !== null) {
  const attrs = m[1] || '';
  if (/\bsrc\s*=/.test(attrs)) continue;            // pula scripts externos
  if (/type\s*=\s*["']?(application\/json|text\/template)/i.test(attrs)) continue;
  const body = m[2];
  idx++;
  // linha aproximada do bloco no HTML
  const line = html.slice(0, m.index).split('\n').length;
  try {
    new vm.Script(body, { filename: `${file}#script${idx}@L${line}` });
  } catch (e) {
    errors++;
    console.log(`ERRO sintaxe | script #${idx} (HTML linha ~${line}) | ${e.message}`);
  }
}
console.log(`${file}: ${idx} blocos inline checados, ${errors} erro(s).`);
process.exit(errors ? 1 : 0);
