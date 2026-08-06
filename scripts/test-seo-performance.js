'use strict';
/**
 * test-seo-performance.js — Teste de contrato da semântica de SEO. Zero rede.
 *
 * Exercita lib/seo-analytics.js com os valores REAIS medidos na propriedade
 * sc-domain:axenya.com em 2026-08-06, para que uma mudança de regra que mexa em
 * posição, CTR, janela de comparação ou categoria quebre aqui antes de subir.
 *
 * Rodar: node scripts/test-seo-performance.js
 */

const assert = require('assert');
const a = require('../lib/seo-analytics');

let pass = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log(`  ok | ${name}`); }
  catch (e) { console.error(`  FALHOU | ${name}\n       ${e.message}`); process.exitCode = 1; }
}

/** Histograma de dia da semana de uma janela [from,to] inclusiva. */
function histDow(w) {
  const h = [0, 0, 0, 0, 0, 0, 0];
  for (let d = w.from; d <= w.to; d = a.shiftDays(d, 1)) h[a.dowOf(d)] += 1;
  return h;
}

console.log('\n== janelas de comparação | múltiplo de 7 ==');
t('WoW, MoM e QoQ têm janelas do mesmo tamanho e em múltiplo de 7', () => {
  ['wow', 'mom', 'qoq'].forEach(base => {
    const w = a.windowsFor(base, '2026-08-04');
    assert.strictEqual(w.atual.dias, w.anterior.dias, base);
    assert.strictEqual(w.atual.dias % 7, 0, `${base} dias=${w.atual.dias} não é múltiplo de 7`);
  });
});
t('as duas pontas têm a MESMA composição de dias da semana', () => {
  // É o motivo de existir a regra: nesta propriedade domingo rende 36 e sábado 32
  // cliques/dia contra 124-127 de seg a qua. Janela com 2 sábados contra janela
  // com 1 produz "queda" que é só calendário.
  ['wow', 'mom', 'qoq', 'yoy'].forEach(base => {
    const w = a.windowsFor(base, '2026-08-04');
    assert.deepStrictEqual(histDow(w.atual), histDow(w.anterior), base);
  });
});
t('uma janela de 30 dias NÃO tem composição igual à anterior | prova do risco', () => {
  const atual = { from: a.shiftDays('2026-08-04', -29), to: '2026-08-04' };
  const anterior = { from: a.shiftDays('2026-08-04', -59), to: a.shiftDays('2026-08-04', -30) };
  assert.notDeepStrictEqual(histDow(atual), histDow(anterior));
});
t('datas exatas das janelas ancoradas em 2026-08-04', () => {
  assert.deepStrictEqual(a.windowsFor('dod', '2026-08-04').atual, { from: '2026-08-04', to: '2026-08-04', dias: 1 });
  assert.deepStrictEqual(a.windowsFor('dod', '2026-08-04').anterior, { from: '2026-08-03', to: '2026-08-03', dias: 1 });
  assert.deepStrictEqual(a.windowsFor('wow', '2026-08-04').atual, { from: '2026-07-29', to: '2026-08-04', dias: 7 });
  assert.deepStrictEqual(a.windowsFor('wow', '2026-08-04').anterior, { from: '2026-07-22', to: '2026-07-28', dias: 7 });
  assert.deepStrictEqual(a.windowsFor('mom', '2026-08-04').atual, { from: '2026-07-08', to: '2026-08-04', dias: 28 });
  assert.deepStrictEqual(a.windowsFor('qoq', '2026-08-04').atual, { from: '2026-05-06', to: '2026-08-04', dias: 91 });
});
t('YoY usa 364 dias (52 semanas) e preserva o dia da semana', () => {
  const w = a.windowsFor('yoy', '2026-08-04');
  assert.strictEqual(a.diffDays(w.anterior.to, w.atual.to), 364);
  assert.strictEqual(a.dowOf(w.anterior.to), a.dowOf(w.atual.to));
});
t('base desconhecida cai em WoW, nunca quebra', () => {
  assert.strictEqual(a.windowsFor('inventada', '2026-08-04').base, 'wow');
});

console.log('\n== agregação | posição e CTR não se somam ==');
t('posição agregada é ponderada por impressão, não média simples', () => {
  const rows = [
    { clicks: 10, impressions: 1000, ctr: 0.01, position: 1 },
    { clicks: 0, impressions: 1, ctr: 0, position: 100 },
  ];
  const ag = a.aggregate(rows);
  const simples = (1 + 100) / 2;
  assert.ok(Math.abs(ag.position - (1 * 1000 + 100 * 1) / 1001) < 1e-9, `position ${ag.position}`);
  assert.ok(ag.position < 1.2, 'ponderada tem que ficar perto de 1');
  assert.ok(Math.abs(ag.position - simples) > 40, 'média simples erraria por dezenas de posições');
});
t('CTR agregado é clicks/impressions, não média dos CTRs', () => {
  const rows = [
    { clicks: 1, impressions: 1000, ctr: 0.001, position: 5 },
    { clicks: 50, impressions: 100, ctr: 0.5, position: 2 },
  ];
  const ag = a.aggregate(rows);
  const mediaDosCtr = (0.001 + 0.5) / 2;
  assert.ok(Math.abs(ag.ctr - 51 / 1100) < 1e-12, `ctr ${ag.ctr}`);
  assert.ok(mediaDosCtr / ag.ctr > 5, 'média de CTRs erraria mais de 5x neste conjunto');
});
t('conjunto vazio não vira NaN nem divisão por zero', () => {
  const ag = a.aggregate([]);
  assert.strictEqual(ag.clicks, 0);
  assert.strictEqual(ag.ctr, 0);
  assert.strictEqual(ag.position, 0);
});

console.log('\n== delta | posição menor é melhor ==');
t('posicaoMelhorou é true quando a posição DIMINUI', () => {
  const d = a.deltaOf({ clicks: 10, impressions: 100, ctr: 0.1, position: 3 }, { clicks: 8, impressions: 90, ctr: 0.088, position: 7 });
  assert.strictEqual(d.position, -4);
  assert.strictEqual(d.posicaoMelhorou, true);
});
t('posicaoMelhorou é false quando a posição AUMENTA', () => {
  const d = a.deltaOf({ clicks: 10, impressions: 100, ctr: 0.1, position: 9 }, { clicks: 8, impressions: 90, ctr: 0.088, position: 4 });
  assert.strictEqual(d.position, 5);
  assert.strictEqual(d.posicaoMelhorou, false);
});
t('posição ausente em uma das pontas devolve null, não uma conclusão falsa', () => {
  const d = a.deltaOf({ clicks: 1, impressions: 10, ctr: 0.1, position: 4 }, { clicks: 0, impressions: 0, ctr: 0, position: 0 });
  assert.strictEqual(d.posicaoMelhorou, null);
});
t('variação sobre base zero é null (novo), nunca +100% nem Infinity', () => {
  assert.strictEqual(a.pct(50, 0), null);
  assert.strictEqual(a.pct(0, 0), 0);
  assert.ok(isFinite(a.pct(50, 10)));
});

console.log('\n== status de movimentação ==');
t('novo e perdido são status próprios, não ±100%', () => {
  assert.strictEqual(a.statusOf({ clicks: 5, impressions: 40 }, null), a.STATUS.NOVO);
  assert.strictEqual(a.statusOf({ clicks: 0, impressions: 0 }, { clicks: 3, impressions: 30 }), a.STATUS.PERDIDO);
});
t('com clique empatado, o status olha impressão e exige 20% de variação', () => {
  assert.strictEqual(a.statusOf({ clicks: 2, impressions: 100 }, { clicks: 2, impressions: 105 }), a.STATUS.ESTAVEL);
  assert.strictEqual(a.statusOf({ clicks: 2, impressions: 150 }, { clicks: 2, impressions: 100 }), a.STATUS.SUBIU);
  assert.strictEqual(a.statusOf({ clicks: 2, impressions: 70 }, { clicks: 2, impressions: 100 }), a.STATUS.CAIU);
});
t('clique manda quando muda', () => {
  assert.strictEqual(a.statusOf({ clicks: 9, impressions: 10 }, { clicks: 2, impressions: 900 }), a.STATUS.SUBIU);
});

console.log('\n== movimentações | união das duas janelas ==');
t('buildMovements une chaves das duas pontas e ordena por movimento absoluto', () => {
  const atual = [
    { key: 'vcmh', clicks: 39, impressions: 1516, ctr: 0.026, position: 6.0 },
    { key: 'nova', clicks: 4, impressions: 90, ctr: 0.044, position: 8.0 },
  ];
  const anterior = [
    { key: 'vcmh', clicks: 12, impressions: 900, ctr: 0.013, position: 7.2 },
    { key: 'sumiu', clicks: 30, impressions: 400, ctr: 0.075, position: 3.0 },
  ];
  const m = a.buildMovements(atual, anterior);
  assert.strictEqual(m.length, 3, 'união tem que ter 3 chaves');
  assert.strictEqual(m[0].chave, 'sumiu', 'maior |Δcliques| primeiro (-30)');
  assert.strictEqual(m[0].status, a.STATUS.PERDIDO);
  const nova = m.filter(x => x.chave === 'nova')[0];
  assert.strictEqual(nova.status, a.STATUS.NOVO);
  const vcmh = m.filter(x => x.chave === 'vcmh')[0];
  assert.strictEqual(vcmh.delta.clicks, 27);
  assert.strictEqual(vcmh.delta.posicaoMelhorou, true);
});
t('rollup por categoria agrega com posição ponderada e soma os itens', () => {
  const movs = a.buildMovements(
    [{ key: 'modelo de pgr', clicks: 17, impressions: 1335, ctr: 0.012, position: 8.6 },
     { key: 'pgr modelo', clicks: 6, impressions: 449, ctr: 0.013, position: 6.1 }],
    [{ key: 'modelo de pgr', clicks: 10, impressions: 1000, ctr: 0.01, position: 9.0 }],
    { enrich: k => ({ categoria: a.categoryOf(k) }) }
  );
  const roll = a.rollupMovements(movs, m => m.categoria);
  assert.strictEqual(roll.length, 1);
  assert.strictEqual(roll[0].chave, 'NR-01 | PGR | Riscos psicossociais');
  assert.strictEqual(roll[0].itens, 2);
  assert.strictEqual(roll[0].atual.clicks, 23);
  const esperado = (8.6 * 1335 + 6.1 * 449) / (1335 + 449);
  assert.ok(Math.abs(roll[0].atual.position - esperado) < 1e-9);
});

console.log('\n== categorias | consultas reais da propriedade ==');
const PARES = [
  ['axenya', 'Marca'],
  ['axenia', 'Marca'],
  ['anexya', 'Marca'],
  ['axeny', 'Marca'],
  ['axenya empresa', 'Marca'],
  ['modelo de pgr com riscos psicossociais', 'NR-01 | PGR | Riscos psicossociais'],
  ['modelo de inventário de riscos psicossociais', 'NR-01 | PGR | Riscos psicossociais'],
  ['nr1 para professores', 'NR-01 | PGR | Riscos psicossociais'],
  ['nr1 saude mental 2026', 'NR-01 | PGR | Riscos psicossociais'],
  ['cid z73.0', 'Saúde mental | Absenteísmo'],
  ['taxa de absenteísmo', 'Saúde mental | Absenteísmo'],
  ['presenteísmo e absenteísmo', 'Saúde mental | Absenteísmo'],
  ['custo invisível', 'Saúde mental | Absenteísmo'],
  ['afastamento pelo inss', 'Afastamento | INSS | CID'],
  ['como funciona o afastamento pelo inss por atestado', 'Afastamento | INSS | CID'],
  ['fap por cnae', 'FAP | CNAE | eSocial'],
  ['tabela fap', 'FAP | CNAE | eSocial'],
  ['consulta fap empresa', 'FAP | CNAE | eSocial'],
  ['vcmh 2026', 'Reajuste | VCMH | ANS'],
  ['reajuste plano de saúde empresarial 2026', 'Reajuste | VCMH | ANS'],
  ['aumento plano de saude 2026', 'Reajuste | VCMH | ANS'],
  ['sinistralidade', 'Reajuste | VCMH | ANS'],
  ['dependentes plano de saude empresarial', 'Plano de saúde empresarial'],
  ['falso coletivo plano de saude stj', 'Plano de saúde empresarial'],
  ['malha fina plano de saúde empresarial', 'Plano de saúde empresarial'],
  ['plano pme o que é', 'Plano de saúde empresarial'],
  ['ginastica laboral é obrigatória', 'SST | Ergonomia | NR-17'],
  ['facescan', 'Produto | Tecnologia'],
  ['promoprev', 'Produto | Tecnologia'],
];
t('as 29 consultas reais caem na categoria esperada', () => {
  PARES.forEach(([q, esperado]) => {
    assert.strictEqual(a.categoryOf(q), esperado, `"${q}"`);
  });
});
t('regra específica ganha da genérica | reajuste não cai em Plano de saúde', () => {
  assert.strictEqual(a.categoryOf('reajuste plano de saúde 2026'), 'Reajuste | VCMH | ANS');
  assert.notStrictEqual(a.categoryOf('reajuste plano de saúde 2026'), 'Plano de saúde empresarial');
});
t('consulta vazia ou desconhecida não inventa categoria', () => {
  assert.strictEqual(a.categoryOf(''), a.CATEGORY_OUTRAS);
  assert.strictEqual(a.categoryOf(null), a.CATEGORY_OUTRAS);
  assert.strictEqual(a.categoryOf('z73.0'), 'Saúde mental | Absenteísmo');
  assert.strictEqual(a.categoryOf('average cost of health insurance'), 'Plano de saúde empresarial');
});

console.log('\n== marca vs não-marca ==');
t('erros de digitação reais da marca são reconhecidos', () => {
  ['axenya', 'Axenya', 'axenia', 'anexya', 'axeny', 'axenya empresa', 'AXENYA'].forEach(q => {
    assert.strictEqual(a.isBrand(q), true, q);
  });
});
t('palavra parecida não vira marca', () => {
  ['anexo', 'plano de saude', 'axe', 'anexar documento', 'pgr'].forEach(q => {
    assert.strictEqual(a.isBrand(q), false, q);
  });
});

console.log('\n== seções | URLs reais ==');
t('URL real cai na seção certa', () => {
  const p = 'https://www.axenya.com';
  assert.strictEqual(a.sectionOf(p + '/recursos/blog/pgr-riscos-psicossociais-modelo-empresa'), 'Blog');
  assert.strictEqual(a.sectionOf(p + '/'), 'Home');
  assert.strictEqual(a.sectionOf(p), 'Home');
  assert.strictEqual(a.sectionOf(p + '/recursos/ferramentas/calculadora'), 'Ferramentas');
  assert.strictEqual(a.sectionOf(p + '/recursos/webinares/x'), 'Webinares');
  assert.strictEqual(a.sectionOf(p + '/recursos/post/y'), 'Recursos | outros');
  assert.strictEqual(a.sectionOf(p + '/solucoes'), 'Soluções');
  assert.strictEqual(a.sectionOf(p + '/observatorio'), 'Observatório');
  assert.strictEqual(a.sectionOf(p + '/sobre-nos'), 'Institucional');
  assert.strictEqual(a.sectionOf(p + '/p/lp-webinar'), 'Landing | /p');
  assert.strictEqual(a.sectionOf(p + '/llms.txt'), 'Outras páginas');
});
t('Blog vem antes de Recursos | ordem das regras importa', () => {
  assert.notStrictEqual(a.sectionOf('https://www.axenya.com/recursos/blog/x'), 'Recursos | outros');
});
t('pageLabel tira host e barra final', () => {
  assert.strictEqual(a.pageLabel('https://www.axenya.com/recursos/blog/x/'), '/recursos/blog/x');
  assert.strictEqual(a.pageLabel('https://www.axenya.com/'), '/');
});

console.log('\n== linha do tempo ==');
function serieFake(n, endISO) {
  const out = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const date = a.shiftDays(endISO, -i);
    // Reproduz a sazonalidade medida: fim de semana ~1/4 do dia útil.
    const c = a.isWeekend(date) ? 34 : 125;
    out.push({ date, clicks: c, impressions: c * 100, ctr: 0.01, position: 6.4 });
  }
  return out;
}
t('rollup semanal ancora no ÚLTIMO dia e todo bucket tem 7 dias', () => {
  const s = serieFake(455, '2026-08-04');
  const semanas = a.rollupDaily(s, 'semana');
  assert.strictEqual(semanas.length, 65, `${semanas.length} semanas`);
  semanas.forEach(w => assert.strictEqual(w.dias, 7, `${w.key} com ${w.dias} dias`));
  assert.strictEqual(semanas[semanas.length - 1].to, '2026-08-04');
  assert.strictEqual(semanas[semanas.length - 1].from, '2026-07-29');
  assert.ok(semanas.every(w => !w.parcial));
});
t('semana ancorada neutraliza o fim de semana | todos os buckets têm o mesmo total', () => {
  const semanas = a.rollupDaily(serieFake(455, '2026-08-04'), 'semana');
  const totais = {};
  semanas.forEach(w => { totais[w.clicks] = true; });
  assert.strictEqual(Object.keys(totais).length, 1, 'semana ISO deixaria a última parcial e mudaria o total');
});
t('mês e trimestre incompletos são marcados como parcial', () => {
  const s = serieFake(40, '2026-08-04');
  const meses = a.rollupDaily(s, 'mes');
  const ultimo = meses[meses.length - 1];
  assert.strictEqual(ultimo.key, '2026-08');
  assert.strictEqual(ultimo.dias, 4);
  assert.strictEqual(ultimo.parcial, true);
  const tri = a.rollupDaily(s, 'trimestre');
  assert.strictEqual(tri[tri.length - 1].key, '2026-T3');
  assert.strictEqual(tri[tri.length - 1].parcial, true);
});
t('mês fechado NÃO é parcial', () => {
  const s = serieFake(200, '2026-07-31');
  const meses = a.rollupDaily(s, 'mes');
  const julho = meses.filter(m => m.key === '2026-07')[0];
  assert.strictEqual(julho.dias, 31);
  assert.strictEqual(julho.parcial, false);
});
t('enrichDaily traz média móvel de 7 dias e delta contra o mesmo dia da semana', () => {
  const s = a.enrichDaily(serieFake(30, '2026-08-04'));
  const ultimo = s[s.length - 1];
  assert.strictEqual(ultimo.date, '2026-08-04');
  assert.strictEqual(ultimo.d7Clicks, 0, 'mesma terça da semana anterior tem o mesmo volume na série sintética');
  const sabado = s.filter(x => x.dow === 6)[0];
  assert.strictEqual(sabado.fimDeSemana, true);
  // A média móvel amortece a oscilação de 4x que a série crua tem.
  assert.ok(ultimo.mm7 < 125 && ultimo.mm7 > 34, `mm7 ${ultimo.mm7}`);
});

console.log('\n== cobertura | medida real de 2026-05-08 a 2026-08-04 ==');
t('cobertura de consultas reproduz os 27,5% de cliques medidos', () => {
  // Medido: site 8.108 cliques e 676.778 impressões; dimensão query devolveu
  // 2.232 cliques e 138.304 impressões (Google anonimiza cauda longa).
  const cov = a.coverageOf({ clicks: 8108, impressions: 676778 }, { clicks: 2232, impressions: 138304 });
  assert.ok(Math.abs(cov.pctClicks - 0.2753) < 0.001, `pctClicks ${cov.pctClicks}`);
  assert.ok(Math.abs(cov.pctImpressions - 0.2044) < 0.001, `pctImpressions ${cov.pctImpressions}`);
  assert.ok(cov.pctClicks < 0.4, 'abaixo de 40% dispara o aviso de higiene');
});
t('cobertura de páginas mostra impressão INFLADA acima de 100%', () => {
  // Medido: dimensão page devolveu 8.149 cliques (100,5%) e 876.714 impressões
  // (129,5%) — duas URLs na mesma SERP contam impressão cada uma.
  const cov = a.coverageOf({ clicks: 8108, impressions: 676778 }, { clicks: 8149, impressions: 876714 });
  assert.ok(cov.pctClicks > 1 && cov.pctClicks < 1.02, `pctClicks ${cov.pctClicks}`);
  assert.ok(cov.pctImpressions > 1.1, `pctImpressions ${cov.pctImpressions}`);
});

console.log('\n== sazonalidade medida (justifica a regra do múltiplo de 7) ==');
t('fim de semana rende ~1/4 do dia útil nesta propriedade', () => {
  // Médias medidas em 89 dias: dom 36, sáb 32, seg 124, ter 125, qua 127.
  const fds = (36 + 32) / 2, util = (124 + 125 + 127) / 3;
  assert.ok(util / fds > 3, `dia útil ${util} contra fim de semana ${fds}`);
  assert.strictEqual(a.isWeekend('2026-08-01'), true);  // sábado
  assert.strictEqual(a.isWeekend('2026-08-02'), true);  // domingo
  assert.strictEqual(a.isWeekend('2026-08-03'), false); // segunda
});

console.log(`\n${pass} asserção(ões) de contrato passaram.`);
if (process.exitCode) console.error('\nHÁ FALHAS — não deployar.');
