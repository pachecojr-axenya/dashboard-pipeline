'use strict';
/**
 * semantic-view.js | Gera a visualização legível do catálogo (ADR-003).
 * Uso: node scripts/semantic-view.js  →  escreve docs/dashboard-2.0/catalogo.md
 * O .md gerado é SÓ LEITURA: editar sempre os semantic/*.json e regerar.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const j = n => JSON.parse(fs.readFileSync(path.join(ROOT, 'semantic', n), 'utf8'));
const referencia = j('referencia.json');
const dados = j('dados.json');
const regras = j('regras.json');

const esc = s => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const L = [];

L.push('# Catálogo | camada semântica (visualização gerada)');
L.push('');
L.push('> **GERADO por `scripts/semantic-view.js` — NÃO EDITAR AQUI.** A fonte são os');
L.push('> 3 arquivos em `semantic/`. Edite lá, rode `npm run check` e regere esta visão.');
L.push(`> Gerado a partir das versões: referencia v${referencia._meta.versao} | dados v${dados._meta.versao} | regras v${regras._meta.versao}.`);
L.push('');

// ── Referência ────────────────────────────────────────────────────────────────
L.push('## Referência (`semantic/referencia.json`)');
L.push('');
L.push(`Portal HubSpot: \`${referencia.hubspot.portal_id}\``);
L.push('');
L.push('### Etapas por pipeline');
L.push('');
Object.entries(referencia.pipelines).forEach(([key, pipe]) => {
  L.push(`**${pipe.label.pt}** (\`${pipe.id}\`)`);
  L.push('');
  L.push('| Ordem | Etapa | ID | Ativa (default) | Final | Notas |');
  L.push('|---|---|---|---|---|---|');
  referencia.etapas.filter(e => e.pipeline === key).sort((a, b) => a.ordem - b.ordem).forEach(e => {
    const nome = e.aliases ? `${e.nome} (aliases: ${e.aliases.join(', ')})` : e.nome;
    L.push(`| ${e.ordem} | ${esc(nome)} | \`${e.id}\` | ${e.ativa_default ? 'sim' : 'não'} | ${e.final ? 'sim' : 'não'} | ${esc(e.notas || '')} |`);
  });
  L.push('');
});

L.push('### Réguas de probabilidade');
L.push('');
Object.entries(referencia.reguas_probabilidade).forEach(([key, r]) => {
  if (typeof r === 'string') { L.push(`**${key}** (nota histórica) | ${esc(r)}`); L.push(''); return; }
  L.push(`**${key}** | ${esc(r.descricao.pt)} | tipo: ${r.tipo}`);
  L.push('');
  if (r.valores) {
    L.push('| Etapa | Probabilidade |');
    L.push('|---|---|');
    Object.entries(r.valores).forEach(([n, v]) => L.push(`| ${esc(n)} | ${(v * 100).toFixed(1).replace('.', ',')}% |`));
    L.push('');
  }
  if (r.regra) L.push(`Calculada pela regra \`${r.regra}\` (amostra mínima ${r.min_amostra}).`);
  if (r.usada_em) L.push(`Usada em: ${r.usada_em.map(esc).join(' · ')}`);
  if (r.divergencia_conhecida) L.push(`> 🔴 **Divergência conhecida:** ${esc(r.divergencia_conhecida)}`);
  L.push('');
});

L.push('### Valor por vida (VPV) | Porte');
L.push('');
L.push('| Faixa de vidas | R$/vida/mês |');
L.push('|---|---|');
referencia.valor_por_vida.faixas.forEach(f => L.push(`| ${f.vidas_max == null ? 'acima' : 'até ' + f.vidas_max} | ${f.valor} |`));
L.push('');
L.push(`Corte PME: ${referencia.porte.corte_pme_vidas} vidas. Fuso canônico: ${referencia.fuso.canonico}.`);
L.push('');

L.push('### Times | Executivos (AEs) e BDRs');
L.push('');
L.push('| AE | owner_id |');
L.push('|---|---|');
referencia.times.aes.forEach(p => L.push(`| ${esc(p.nome)} | \`${p.owner_id}\` |`));
L.push('');
L.push('| BDR | owner_id |');
L.push('|---|---|');
referencia.times.bdrs.forEach(p => L.push(`| ${esc(p.nome)} | \`${p.owner_id}\` |`));
L.push('');

// ── Dados ─────────────────────────────────────────────────────────────────────
L.push('## Dados (`semantic/dados.json`)');
L.push('');
L.push('| Dado | Label PT | Origem | Objeto | Propriedade HubSpot | Unidade | Dono | Notas |');
L.push('|---|---|---|---|---|---|---|---|');
Object.entries(dados.dados).forEach(([k, d]) => {
  const origem = d.origem === 'manual' ? '✏️ manual' : 'fonte';
  L.push(`| \`${k}\` | ${esc(d.label.pt)} | ${origem} | ${d.objeto} | ${d.hubspot ? '`' + esc(d.hubspot) + '`' : '—'} | ${d.unidade} | ${d.dono} | ${esc(d.notas || d.persistencia || '')} |`);
});
L.push('');

// ── Regras ────────────────────────────────────────────────────────────────────
L.push('## Regras (`semantic/regras.json`)');
L.push('');
Object.entries(regras.regras).forEach(([k, r]) => {
  L.push(`### \`${k}\` | ${esc(r.label.pt)}`);
  L.push('');
  if (r.ajuda && r.ajuda.pt) L.push(`> ${esc(r.ajuda.pt)}`), L.push('');
  L.push(`- **Tipo:** ${r.tipo} · **Grain:** ${esc(r.grain || '—')} · **Status:** ${r.status} · **Vigente desde:** ${r.vigente_desde} · **Dono:** ${r.owner}`);
  if (r.usa_dados) L.push(`- **Usa dados:** ${r.usa_dados.map(d => '`' + d + '`').join(', ')}`);
  if (r.usa_referencia) L.push(`- **Usa referência:** ${r.usa_referencia.map(d => '`' + d + '`').join(', ')}`);
  if (r.depende_de) L.push(`- **Depende de:** ${r.depende_de.map(d => '`' + d + '`').join(', ')}`);
  if (r.precedencia) L.push(`- **Precedência:** ${esc(r.precedencia)}`);
  if (r.filtro) L.push(`- **Filtro:** ${esc(r.filtro)}`);
  if (r.formula) L.push(`- **Fórmula:** ${esc(r.formula)}`);
  if (r.tabela) {
    L.push('');
    L.push('| ' + r.tabela.colunas.map(esc).join(' | ') + ' |');
    L.push('|' + r.tabela.colunas.map(() => '---').join('|') + '|');
    r.tabela.linhas.forEach(l => L.push('| ' + l.map(esc).join(' | ') + ' |'));
    L.push('');
  }
  if (r.faltantes) L.push(`- **Faltantes:** ${esc(r.faltantes)}`);
  if (r.ponto_no_tempo) L.push(`- **Ponto no tempo:** ${esc(r.ponto_no_tempo)}`);
  L.push(`- **Código (1.0):** ${r.fonte_codigo.map(esc).join(' · ')}`);
  if (r.notas) L.push(`- **Notas:** ${esc(r.notas)}`);
  L.push('');
});

const out = path.join(ROOT, 'docs', 'dashboard-2.0', 'catalogo.md');
fs.writeFileSync(out, L.join('\n') + '\n', 'utf8');
console.log('semantic-view: gerado ' + path.relative(ROOT, out));
