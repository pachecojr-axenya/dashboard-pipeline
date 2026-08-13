'use strict';
/**
 * test-bdr-lista-abm.js — trava o corte "Lista ABM" na PRIMEIRA METADE do /novo-bdr.
 *
 * A segunda metade (funil de leads) é provada contra o armazém por
 * `test-bdr-lead-funnel.js`. Aqui o grão é DEAL e a fiação é inline em `bdr.html`,
 * então o que se prova é comportamento de função + fiação, sem ir ao banco — este
 * arquivo roda no `npm run check` e no CI, que não têm credencial.
 *
 * Cada asserção existe por um modo de falha SILENCIOSO já visto neste projeto:
 *
 * 1. TRÊS BUCKETS. `null` (deal sem empresa) não é `false` (empresa fora da lista).
 *    Conflati-los transformaria ausência de conta em "conferi e não está na lista".
 *    Foi o defeito que o dono pediu para explicar na ficha.
 * 2. `byCanal` PRECISA ser `!== 'bdr'`, não `=== 'canal'`. Com a comparação antiga a
 *    aba "Por Lista ABM" cairia no ramo por-BDR e renderizaria IGUAL a "Por BDR" —
 *    filtro que não faz nada é pior que filtro nenhum, porque parece ter funcionado.
 * 3. O drill do ramo empilhado marcava `sel.fonte` FIXO. Com a dimensão nova ele
 *    marcaria a faceta ERRADA com um rótulo de Lista ABM, e o modal abriria vazio —
 *    mesma família do `dim_canal` fora do mapa de saída (leva 7).
 * 4. UMA régua de elegibilidade de meta. Ela estava escrita idêntica em dois lugares e
 *    a composição por lista seria a terceira cópia. Régua de meta duplicada é número
 *    de gente derivando em silêncio.
 * 5. A FICHA tem de dizer o que é "(sem empresa)" — pedido explícito do dono.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const bdr = fs.readFileSync(path.join(ROOT, 'public/bdr.html'), 'utf8');
const funnel = fs.readFileSync(path.join(ROOT, 'public/bdr-lead-funnel.js'), 'utf8');
const api = fs.readFileSync(path.join(ROOT, 'api/forecast-table.js'), 'utf8');

let falhas = 0;
function ok(cond, texto, extra) {
  if (!cond) falhas++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + texto + (extra != null ? '   | ' + extra : ''));
}

console.log('== o dado chega (api/forecast-table) ==');
ok(/COMPANY_PROPERTIES = \[[\s\S]{0,600}'lista'/.test(api),
  'a propriedade `lista` e pedida ao HubSpot');
ok(api.includes('company_in_lista_abm'), 'o deal carrega `company_in_lista_abm`');
ok(api.includes('company_lista'), 'o deal carrega o texto CRU `company_lista` (auditavel)');
// Sem empresa -> null, nao false. E o contrato do 3o bucket, do lado do servidor: a
// ausencia de conta tem de sair do endpoint como AUSENCIA, nao como negativa.
ok(/if \(!temConta\) return null;/.test(api),
  'deal SEM conta conferivel devolve null (nao false) em company_in_lista_abm');
ok(/temConta = true/.test(api) && (api.match(/temConta = true/g) || []).length === 2,
  'os DOIS caminhos (contexto completo e enxuto) declaram que ha conta conferivel',
  (api.match(/temConta = true/g) || []).length);
ok(api.includes('LISTA_ABM_TOKEN') && api.includes("split(';')"),
  'pertencimento por TOKEN EXATO, nao por substring');

// O DEFEITO QUE ESCAPOU (12/08/2026, achado pelo dono na tela): eu provei
// `company_in_lista_abm` chamando o endpoint com `includeContext=true`, e a PAGINA chama
// `/api/forecast-table?includeLost=true`. Sem um dos dois parametros o contexto de empresa
// nunca e buscado, `company_id` fica nulo em TODO deal e o corte inteiro devolve
// "(sem empresa)" -- 1.558 de 1.558, lido na tela como "nada veio da lista".
//
// A licao que virou assercao: PROVAR UM CAMPO COM UMA QUERY QUE A TELA NAO FAZ NAO PROVA
// O CAMPO NA TELA. O que se trava aqui e a QUERY DA PAGINA, nao a capacidade do endpoint.
console.log('\n== a pagina PEDE o dado (o defeito de 12/08) ==');
var mFetch = bdr.match(/fetch\('\/api\/forecast-table\?([^']*)'\)/);
ok(!!mFetch, 'a pagina chama /api/forecast-table');
if (mFetch) {
  var q = mFetch[1];
  ok(/includeLista=true|includeContext=true/.test(q),
    'a query da pagina pede includeLista (ou includeContext) -- sem isso TODO deal vira "(sem empresa)"', q);
}
ok(api.includes('includeLista'), 'o endpoint aceita includeLista');
ok(/const includeLista = includeContext \|\|/.test(api),
  'includeContext IMPLICA includeLista (la a empresa ja vem inteira)');
ok(api.includes('function mapWithLimit'),
  'os lotes tem teto de concorrencia (sequencial custava 17,4s; paralelo 7,4s)');
ok(/mapWithLimit\(lotes, 4/.test(api) && /mapWithLimit\(chunks, 4/.test(api),
  'associacao E batch read usam o teto (o gargalo era a associacao, nao as propriedades)');

console.log('\n== os tres buckets (_fLista) ==');
const mF = bdr.match(/function _fLista\(d\)\{[^}]*\}/);
ok(!!mF, 'a funcao _fLista existe em bdr.html');
if (mF) {
  // eslint-disable-next-line no-eval
  const _fLista = eval('(' + mF[0].replace('function _fLista', 'function') + ')');
  ok(_fLista({ company_in_lista_abm: true }) === 'Na lista ABM', 'true -> "Na lista ABM"');
  ok(_fLista({ company_in_lista_abm: false }) === 'Fora da lista', 'false -> "Fora da lista"');
  ok(_fLista({ company_in_lista_abm: null }) === '(sem empresa)', 'null -> "(sem empresa)"');
  ok(_fLista({}) === '(sem empresa)', 'campo AUSENTE -> "(sem empresa)" (nao "Fora da lista")');
  // A asserção que protege a conflação: os dois estados não podem colidir.
  ok(_fLista({ company_in_lista_abm: null }) !== _fLista({ company_in_lista_abm: false }),
    'SEM EMPRESA e FORA DA LISTA sao rotulos DIFERENTES (ausencia de conta nao e resposta)');
}

console.log('\n== fiacao da dimensao ==');
ok(/_dimFnDeal\(dim\)\{[\s\S]{0,200}dim==='lista'\?_fLista/.test(bdr),
  'o mapeador generico _dimFnDeal conhece `lista` (serve Weekly R13 e Monthly R14)');
ok(/_dimFacetKey\(dim\)\{[\s\S]{0,200}dim==='lista'\?'lista'/.test(bdr),
  'o mapeador de faceta conhece `lista`');
ok(/_DIM_TABS=[\s\S]{0,320}mode:'lista',label:'Por Lista ABM'/.test(bdr),
  'o gerador COMPARTILHADO de abas oferece "Por Lista ABM"');
ok(/bdr-origin-dim-tabs[\s\S]{0,320}mode:'lista'/.test(bdr),
  'a Originacao (R12) oferece a 3a dimensao');
ok(/_BDR_FACETS=\[[\s\S]{0,700}key:'lista',label:'Lista ABM',fn:_fLista/.test(bdr),
  'a faceta combinavel existe, entao o corte cruza com BDR x Origem x Desfecho x Porte x Mes');

console.log('\n== os modos de falha silenciosa ==');
ok(bdr.includes("var byCanal=_bdrOriginDim!=='bdr';"),
  'byCanal e "!== bdr" — com "=== canal" a aba nova renderizaria IGUAL a Por BDR');
ok(!bdr.includes("var byCanal=_bdrOriginDim==='canal';"),
  'a comparacao antiga nao sobrou em nenhum lugar');
ok(bdr.includes('dimFnOrig(d)') && !/canais\[c\][\s\S]{0,40}_fFonte\(d\)/.test(bdr),
  'o ramo empilhado usa a FUNCAO da dimensao, nao _fFonte fixo');
ok(bdr.includes('_bdrFacet.sel[_dimFacetKey(_bdrOriginDim)]'),
  'o drill marca a faceta da dimensao ATIVA');
ok(!bdr.includes('_bdrFacet.sel.fonte='),
  'a marcacao fixa em `fonte` nao sobrou (marcaria a faceta errada)');

console.log('\n== uma regua de elegibilidade de meta ==');
const reguaMeta = /if\(!_isTeamBdr\(d\)\)return false; if\(!_bdrCountsForGoal\(d\)\)return false;/g;
const nRegua = (bdr.match(reguaMeta) || []).length;
ok(nRegua === 1, 'a regua de elegibilidade aparece UMA vez (estava duplicada em 2 lugares)', nRegua);
ok(bdr.includes('function _teamEligibleDeals(months)'), '_teamEligibleDeals e a fonte unica');
ok(/_bdrAttainment\(label,months\)\{[\s\S]{0,300}_teamEligibleDeals\(months\)/.test(bdr),
  'o atingimento sai da regua unica');
ok(bdr.includes('function _listaSplit(deals)'), 'a composicao do realizado existe');
ok(/NAO existe meta por lista/.test(bdr),
  'esta escrito no codigo que NAO existe meta por lista (metas sao por BDR)');
ok(bdr.includes('byBdrLista[b][_fLista(d)]++'), 'o detalhe por BDR compoe por lista');
ok(bdr.includes('<th>Na lista ABM</th>'), 'a tabela do detalhe expoe a composicao');

console.log('\n== a ficha explica "(sem empresa)" (pedido do dono) ==');
[['bdr.html', bdr, '_HELP_LISTA_ABM'], ['bdr-lead-funnel.js', funnel, 'HELP_LISTA_ABM']]
  .forEach(([nome, txt, konst]) => {
    const m = txt.match(new RegExp('var ' + konst + "\\s*=[\\s\\S]{0,2400}?;\\r?\\n"));
    ok(!!m, `${nome}: a constante ${konst} existe`);
    if (!m) return;
    const ficha = m[0];
    ok(/\(sem empresa\)/.test(ficha), `${nome}: a ficha NOMEIA "(sem empresa)"`);
    ok(/N[AÃ]O TEM EMPRESA ASSOCIADA|nao ha conta|não há conta/i.test(ficha),
      `${nome}: a ficha DIZ que e deal/lead sem empresa associada`);
    ok(/n[aã]o [eé] o mesmo que|em vez de ser somado|ausência de dado não é resposta|ausencia de dado nao e resposta/i.test(ficha),
      `${nome}: a ficha diz que NAO e o mesmo que "Fora da lista"`);
    ok(/23\/jun\/2026/.test(ficha), `${nome}: a ficha declara a data da distribuicao`);
    ok(/2\.158/.test(ficha), `${nome}: a ficha declara as contas que nao existem no CRM`);
    ok(/co-ocorr[eê]ncia/i.test(ficha),
      `${nome}: a ficha separa pertencimento de ORIGEM (para ler como origem, cruzar com Outbound)`);
  });
const fichasComCorte = ['origin-bdr', 'metas-attainment', 'weekly-origin', 'leads-origin'];
ok((bdr.match(/\+_HELP_LISTA_ABM/g) || []).length === fichasComCorte.length,
  'as 4 fichas de card que oferecem o corte citam a explicacao',
  (bdr.match(/\+_HELP_LISTA_ABM/g) || []).length + '/' + fichasComCorte.length);
ok(/por BDR, canal, tier, vidas ou Lista ABM/.test(funnel),
  'a ficha da serie lista a quebra nova (oferecer corte que a ficha nega e icone morto de novo)');

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS PASSARAM');
process.exit(falhas ? 1 : 0);
