'use strict';
/**
 * gen-semantic-front.js | Gera public/semantic-ref.js a partir de semantic/referencia.json.
 *
 * É a ponte da camada semântica para o FRONT (ES5, sem fetch, sem bundler): o
 * arquivo gerado só define window.SEMANTIC_REF e é incluído via <script src>
 * ANTES dos scripts inline das páginas. Commitar o gerado (Vercel não builda).
 *
 * Uso: node scripts/gen-semantic-front.js
 * O check-semantic compara o arquivo em disco com o esperado (build()) e acusa drift.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Paridade (Fase 2): ordem HISTÓRICA das chaves da régua flat nos literais das
// páginas — spreads ({...DEFAULT, ...saved}) preservam ordem de inserção e há
// tabelas que iteram as chaves. Reordenar seria mudança visual; fica para depois.
const FLAT_ORDER = ['Reunião Agendada', 'Cotação', 'Proposta Enviada', 'Consultoria', 'Negociação', 'Implantação', 'Ganho', 'Standby', 'Diagnóstico'];

function ordered(valores, order) {
  const out = {};
  order.forEach(k => { if (valores[k] != null) out[k] = valores[k]; });
  Object.keys(valores).forEach(k => { if (out[k] == null) out[k] = valores[k]; });
  return out;
}

function build() {
  const referencia = JSON.parse(fs.readFileSync(path.join(ROOT, 'semantic', 'referencia.json'), 'utf8'));
  const payload = {
    versao: referencia._meta.versao,
    pipelines: referencia.pipelines,
    etapas: referencia.etapas.map(e => ({ id: e.id, pipeline: e.pipeline, nome: e.nome, ordem: e.ordem, ativa_default: e.ativa_default, final: e.final })),
    reguas: {
      forecast_flat: { tipo: 'forcada', valores: ordered(referencia.reguas_probabilidade.forecast_flat.valores, FLAT_ORDER) },
      painel_default: { tipo: 'forcada', valores: referencia.reguas_probabilidade.painel_default.valores }
    }
  };
  return "'use strict';\n" +
    '// GERADO por scripts/gen-semantic-front.js a partir de semantic/referencia.json — NÃO EDITAR.\n' +
    '// Regenerar: node scripts/gen-semantic-front.js (check-semantic acusa se desatualizar).\n' +
    'window.SEMANTIC_REF = ' + JSON.stringify(payload) + ';\n';
}

if (require.main === module) {
  const out = path.join(ROOT, 'public', 'semantic-ref.js');
  fs.writeFileSync(out, build(), 'utf8');
  console.log('gen-semantic-front: gerado ' + path.relative(ROOT, out));
}

module.exports = { build };
