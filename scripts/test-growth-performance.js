'use strict';
/**
 * test-growth-performance.js — Teste de contrato da semântica de atribuição de
 * mídia paga. Zero rede: exercita lib/growth-attribution.js com os valores REAIS
 * medidos no portal, para que uma mudança de regra que mexa em CPL quebre aqui
 * antes de ir para produção.
 *
 * Rodar: node scripts/test-growth-performance.js
 */

const assert = require('assert');
const a = require('../lib/growth-attribution');

let pass = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log(`  ok | ${name}`); }
  catch (e) { console.error(`  FALHOU | ${name}\n       ${e.message}`); process.exitCode = 1; }
}

console.log('\n== canal por utm_source ==');
t('meta, facebook e instagram caem em Meta', () => {
  ['meta', 'facebook', 'fb', 'instagram', 'ig', 'META'].forEach(s => {
    assert.strictEqual(a.channelOf({ utm_source: s }), 'Meta', s);
  });
});
t('linkedin cai em LinkedIn', () => {
  assert.strictEqual(a.channelOf({ utm_source: 'linkedin' }), 'LinkedIn');
  assert.strictEqual(a.channelOf({ utm_source: 'LinkedIn' }), 'LinkedIn');
});
t('sem utm_source devolve Sem UTM e nunca um canal pago', () => {
  assert.strictEqual(a.channelOf({}), a.SEM_UTM);
  assert.strictEqual(a.channelOf({ utm_source: '' }), a.SEM_UTM);
  assert.strictEqual(a.channelOf({ utm_source: '   ' }), a.SEM_UTM);
});
t('source desconhecido não vira canal pago', () => {
  ['hs_email', 'webinar', 'treble', 'RD Station'].forEach(s => {
    assert.strictEqual(a.channelOf({ utm_source: s }), 'Outros', s);
  });
});

console.log('\n== pago vs orgânico (base do CPL) ==');
t('paid_social e cpc são pagos', () => {
  ['paid_social', 'cpc', 'ppc', 'paid', 'paid_search'].forEach(m => {
    assert.strictEqual(a.mediumTypeOf({ utm_medium: m }), 'pago', m);
  });
});
t('social é orgânico | é o que separou 27 dos 38 leads do LinkedIn em julho/2026', () => {
  assert.strictEqual(a.mediumTypeOf({ utm_medium: 'social' }), 'organico');
  assert.strictEqual(a.mediumTypeOf({ utm_medium: 'organic_social' }), 'organico');
});
t('medium ausente não conta como pago', () => {
  assert.strictEqual(a.mediumTypeOf({}), 'outro');
  assert.strictEqual(a.mediumTypeOf({ utm_medium: 'landing_page' }), 'outro');
});

console.log('\n== iniciativa | join plataforma x HubSpot ==');
const PARES = [
  // [nome na plataforma, utm_campaign do HubSpot, iniciativa esperada]
  ['META | P0 | MoFu | Webinar 30/07 Reajuste | 2026-07', 'webinar_reajuste', 'Webinar Reajuste'],
  ['LI | P0 | MoFu | Webinar 2026-07 | Ad Set A | ABM C-level', 'webinar-reajuste-2026-07', 'Webinar Reajuste'],
  ['LI | P0 | MoFu | Webinar 2026-07 | Ad Set B | RH Aberto', 'reajuste-plano-saude-webinar', 'Webinar Reajuste'],
  ['META | P0 | MoFu | Pesquisa RH CONARH 26 | 2026-07', 'pesquisa_rh_conarh26_2026_07', 'Pesquisa RH | CONARH'],
  ['LI | P0 | MoFu | Pesquisa + CONARH', 'pesquisa-rh', 'Pesquisa RH | CONARH'],
  ['META | P0 | MoFu | Observatorio Axenya | 2026-07', 'observatorio_axenya_2026-07', 'Observatório Axenya'],
  ['LI | P0 | MoFu | Observatório 2026-07 | Ad Set A | HR/Finance aberto + Company Size 201+', 'observatorio-renovacao-ia-2026', 'Observatório Axenya'],
  ['META | P0 | MoFu | Workshop IA Renovacao | 2026-06', 'workshop_renovacao_com_ia', 'Workshop IA Renovação'],
  ['META | P0 | MoFu | Webinar DadosDecisao Revival | 2026-06', '2026-06_mofu_webinar-dados-decisao-revival', 'Webinar Dados à Decisão'],
  ['META | P0 | MoFu | Pesquisa RH Buddha Spa | 2026-06', 'pesquisa_rh_buddha_spa_2026_06', 'Pesquisa RH | Buddha Spa'],
];
t('as duas pontas caem na MESMA iniciativa | senão o CPL por campanha some', () => {
  PARES.forEach(([ad, utm, esperado]) => {
    assert.strictEqual(a.classifyInitiative(ad), esperado, `anúncio: ${ad}`);
    assert.strictEqual(a.classifyInitiative(utm), esperado, `utm: ${utm}`);
  });
});
t('utm_campaign vazio não inventa iniciativa', () => {
  assert.strictEqual(a.classifyInitiative(''), a.INITIATIVE_OUTRAS);
  assert.strictEqual(a.classifyInitiative(null), a.INITIATIVE_OUTRAS);
});
t('anúncio de webinar sem token da campanha precisa de override explícito', () => {
  // Regressão do bug real: "Webinar 2026-07" não carrega "reajuste" no nome, então
  // sem o override cairia em "Webinar | não especificado" e não pareria com o
  // utm webinar_reajuste — deixando a campanha sem CPL.
  Object.keys(a.INITIATIVE_OVERRIDES).forEach(nome => {
    assert.strictEqual(a.classifyInitiative(nome), a.INITIATIVE_OVERRIDES[nome], nome);
  });
});

console.log('\n== cargo -> senioridade | área ==');
t('variações sujas de cargo colapsam no mesmo bucket', () => {
  ['Socio', 'Sócio', 'socia', 'SÓCIA'].forEach(c => {
    assert.strictEqual(a.classifyJobTitle(c).senioridade, 'Sócio', c);
  });
  ['Analista de RH', 'Analista de rh', 'analista de recursos humanos'].forEach(c => {
    const r = a.classifyJobTitle(c);
    assert.strictEqual(r.senioridade, 'Analista / Assistente', c);
    assert.strictEqual(r.area, 'RH / People', c);
  });
});
t('áreas específicas ganham da genérica de RH', () => {
  assert.strictEqual(a.classifyJobTitle('Coordenador de DP').area, 'DP / Folha');
  assert.strictEqual(a.classifyJobTitle('Analista de Beneficios').area, 'Benefícios / Remuneração');
  assert.strictEqual(a.classifyJobTitle('Técnico de Segurança do Trabalho').area, 'SST / Saúde Ocupacional');
  assert.strictEqual(a.classifyJobTitle('Diretora Financeira').area, 'Financeiro');
});
t('cargo vazio devolve persona preenchida | evita undefined na UI', () => {
  const r = a.classifyJobTitle('');
  assert.strictEqual(r.persona, '(sem cargo)');
  assert.strictEqual(r.cargo, '(sem cargo)');
});

console.log('\n== porte ==');
t('campo porte do portal ganha do proxy', () => {
  assert.strictEqual(a.porteOf({ porte: 'Corporate', numberofemployees: 12 }), 'Corporate');
});
t('sem porte cai para faixa de funcionários, marcada como proxy', () => {
  assert.strictEqual(a.porteOf({ numberofemployees: 250 }), '100-499 (proxy)');
  assert.strictEqual(a.porteOf({ vidas: 4000 }), '1000+ (proxy)');
});
t('company ausente e porte ausente são estados distintos', () => {
  assert.strictEqual(a.porteOf(null), '(sem empresa)');
  assert.strictEqual(a.porteOf({}), '(sem porte)');
});

console.log('\n== invariantes de cálculo (aritmética do painel) ==');
t('CPL pago de julho/2026 confere com o medido nas APIs', () => {
  // Medido em 2026-08-06: Meta R$ 5.221,60 / 55 pagos | LinkedIn R$ 4.434,78 / 11 pagos.
  const meta = 5221.60 / 55, li = 4434.78 / 11;
  assert.ok(Math.abs(meta - 94.94) < 0.01, `CPL Meta ${meta}`);
  assert.ok(Math.abs(li - 403.16) < 0.01, `CPL LinkedIn ${li}`);
  // O erro que a regra evita: dividir pelo total do canal (38) em vez dos pagos (11).
  const errado = 4434.78 / 38;
  assert.ok(errado < li / 3, 'CPL por lead do canal subestima em mais de 3x');
});

console.log(`\n${pass} asserção(ões) de contrato passaram.`);
if (process.exitCode) console.error('\nHÁ FALHAS — não deployar.');
