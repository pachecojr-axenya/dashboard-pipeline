'use strict';
/**
 * lib/seo-analytics.js — Semântica do painel de SEO. Puro, zero rede, zero deps.
 *
 * Aqui vivem as decisões que mudam número na tela; ficam separadas do cliente
 * (lib/gsc.js) e do endpoint (api/seo-performance.js) para que scripts/test-seo-
 * performance.js possa fixá-las sem chamar a API do Google.
 *
 * As três decisões que mais mexem no resultado:
 *
 *  1. **Janela em múltiplo de 7.** Fim de semana desta propriedade rende ~1/4 de
 *     um dia útil (medido em 89 dias: dom 36 e sáb 32 cliques/dia contra 124-127
 *     de seg a qua). Comparar 30 contra 31 dias, ou uma semana com 2 sábados
 *     contra uma com 1, produz "queda" que é só calendário. Então WoW = 7×1,
 *     MoM = 7×4 (28 dias) e QoQ = 7×13 (91 dias) — sempre com a mesma quantidade
 *     de cada dia da semana nas duas pontas.
 *
 *  2. **Posição e CTR não se somam.** Posição agregada é média ponderada por
 *     IMPRESSÃO; CTR agregado é clicks/impressions recalculado. Média simples de
 *     posição errou por 0,10 e de CTR por mais da metade no conjunto medido.
 *
 *  3. **Posição menor é melhor.** `deltaPos` é `atual - anterior`, então valor
 *     NEGATIVO é ganho. A UI nunca deve pintar sinal negativo de vermelho aqui.
 */

// ── util -----------------------------------------------------------------

function norm(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function shiftDays(iso, days) {
  const d = new Date(String(iso) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDays(a, b) {
  return Math.round((Date.parse(String(b) + 'T12:00:00Z') - Date.parse(String(a) + 'T12:00:00Z')) / 86400000);
}

/** 0=domingo .. 6=sábado. Data do GSC é sempre YYYY-MM-DD sem fuso. */
function dowOf(iso) {
  return new Date(String(iso) + 'T12:00:00Z').getUTCDay();
}

function isWeekend(iso) {
  const d = dowOf(iso);
  return d === 0 || d === 6;
}

// ── marca ----------------------------------------------------------------

// Erros de digitação reais que aparecem no relatório: axenia, anexya, axeny.
const BRAND_RE = /\b(axen[yi]a?|axeny|anex[yi]a|anexya|axena)\b/;

function isBrand(q) {
  return BRAND_RE.test(norm(q));
}

// ── categorias de consulta -----------------------------------------------

// Ordem importa: a primeira regra que casa vence. Regra específica antes da
// genérica, senão "reajuste plano de saúde" cai em "Plano de saúde" e a visão
// de reajuste (que é a que o time comercial usa) fica vazia.
const CATEGORY_RULES = [
  ['Marca', BRAND_RE],
  ['NR-01 | PGR | Riscos psicossociais', /\bpgr\b|psicossoc|\bnr.?0?1\b|\bnr1\b|inventario de risco|matriz de risco|plano de acao.*risco|risco.*plano de acao|gro\b/],
  ['Saúde mental | Absenteísmo', /saude mental|burnout|depress|ansiedade|esgotament|absente|presente?ism|\bz.?73|custo invisivel|custo oculto|bem.?estar/],
  ['Afastamento | INSS | CID', /afastament|\binss\b|\bcid\b|cid.?10|auxilio.?doenca|\bb31\b|atestado|pericia|reabilitacao/],
  ['FAP | CNAE | eSocial', /\bfap\b|\bcnae\b|\brat\b|esocial|s.?2210|s.?2220|nexo tecnico|\bntep\b/],
  ['Reajuste | VCMH | ANS', /\bvcmh\b|reajust|aument\w* (do |de |no )?plano|\bans\b|sinistralidade|inflacao medica|indice de reajuste/],
  ['Plano de saúde empresarial', /plano de saude|plano saude|health insurance|dependente|coparticipa|falso coletivo|\bpme\b|deducao|desconto.*salario|imposto de renda|malha fina|vigencia|carencia|portabilidade|coletivo empresarial|operadora|rede credenciada|tabela de preco/],
  ['SST | Ergonomia | NR-17', /\bnr.?17\b|ergonom|ginastica laboral|\bsst\b|seguranca do trabalho|\bcipa\b|\bppra\b|\baso\b|insalubridade|\bpcmso\b/],
  ['Produto | Tecnologia', /facescan|promoprev|plataforma|software|telemedicina|wearable|gestao de saude|aplicativo|\bapp\b|\bia\b|inteligencia artificial/],
  ['Benefícios | RH', /beneficio|\brh\b|recursos humanos|folha de pagamento|\bdp\b|admissao|demissao|turnover|clima organizacional|onboarding|people/],
];

const CATEGORY_OUTRAS = 'Outros';

function categoryOf(q) {
  const n = norm(q);
  if (!n) return CATEGORY_OUTRAS;
  for (let i = 0; i < CATEGORY_RULES.length; i += 1) {
    if (CATEGORY_RULES[i][1].test(n)) return CATEGORY_RULES[i][0];
  }
  return CATEGORY_OUTRAS;
}

// ── seções do site --------------------------------------------------------

const SECTION_RULES = [
  ['Blog', /^\/recursos\/blog(\/|$)/],
  ['Ferramentas', /^\/recursos\/ferramentas(\/|$)/],
  ['Webinares', /^\/recursos\/webinares(\/|$)/],
  ['Recursos | outros', /^\/recursos(\/|$)/],
  ['Soluções', /^\/solucoes(\/|$)/],
  ['Observatório', /^\/observatorio(\/|$)/],
  ['Central de Conhecimento', /^\/central-de-conhecimento(\/|$)/],
  ['Institucional', /^\/(sobre-nos|about|quem-servimos|termos|privacidade)(\/|$)/],
  ['Contato', /^\/(contato|contato-recebido|obrigado-por-baixar)(\/|$)/],
  ['Landing | /p', /^\/p(\/|$)/],
];

function pathOf(url) {
  const s = String(url == null ? '' : url);
  const m = s.match(/^https?:\/\/[^/]+(\/[^?#]*)?/);
  if (m) return m[1] || '/';
  return s.split('?')[0].split('#')[0] || '/';
}

/**
 * Host canônico é só `https://www.`. A propriedade é `sc-domain:`, então ela
 * cobre TODO subdomínio e também http — na janela de julho apareceram 6 hosts
 * distintos servindo `/`, incluindo `http://axenya.com/` com 13 cliques (a versão
 * http continua indexada) e `drops`, `scan` e `portal`.
 */
function hostOf(url) {
  const m = String(url == null ? '' : url).match(/^(https?):\/\/([^/]+)/);
  if (!m) return { scheme: null, host: null, canonico: true };
  return { scheme: m[1], host: m[2], canonico: m[1] === 'https' && /^www\./.test(m[2]) };
}

function sectionOf(url) {
  const h = hostOf(url);
  // Subdomínio não é seção do site principal: sem isso, `drops.axenya.com/` e
  // `scan.axenya.com/` entravam na seção Home e inflavam o número dela.
  if (h.host && !h.canonico && !/^(www\.)?[^.]+\.[^.]+$/.test(h.host)) return 'Subdomínios';
  const p = pathOf(url).replace(/\/+$/, '') || '/';
  if (p === '/') return 'Home';
  for (let i = 0; i < SECTION_RULES.length; i += 1) {
    if (SECTION_RULES[i][1].test(p)) return SECTION_RULES[i][0];
  }
  return 'Outras páginas';
}

/**
 * Rótulo de página para tabela: tira o host canônico e a barra final, mas
 * PRESERVA tudo que dá identidade à URL — fragmento, query string e host não
 * canônico.
 *
 * As três coisas foram medidas como colisão real de rótulo em janelas de 2026:
 *  - fragmento: o Google indexa "links para seções" como URLs próprias
 *    (`...#cronograma-120-dias`) e 27 rótulos colidiam, mostrando 5 linhas
 *    visualmente idênticas com números diferentes;
 *  - host: a propriedade é `sc-domain:`, então 6 hosts diferentes serviam `/`;
 *  - query: `?utm_campaign=post` e `?__hstc=...` do HubSpot estão INDEXADOS e
 *    aparecem como URL separada da versão limpa (que é um problema de conteúdo
 *    duplicado, e por isso tem que ficar visível em vez de ser fundido).
 *
 * `sectionOf` continua ignorando fragmento e query, porque a seção do site é a
 * mesma. A tabela trunca visualmente e mostra a URL inteira no hover.
 */
function pageLabel(url) {
  const s = String(url == null ? '' : url);
  const p = pathOf(s).replace(/\/+$/, '') || '/';
  const m = s.match(/[?#].*$/);
  const sufixo = m ? m[0] : '';
  const h = hostOf(s);
  const prefixo = (h.host && !h.canonico) ? `${h.scheme}://${h.host}` : '';
  return prefixo + p + sufixo;
}

// ── agregação ------------------------------------------------------------

/**
 * Soma um conjunto de linhas do GSC respeitando a natureza de cada métrica.
 * Posição = média ponderada por impressão. CTR = clicks/impressions.
 */
function aggregate(rows) {
  let clicks = 0, impressions = 0, posWeighted = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const c = Number(r.clicks) || 0;
    const im = Number(r.impressions) || 0;
    clicks += c;
    impressions += im;
    posWeighted += (Number(r.position) || 0) * im;
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? posWeighted / impressions : 0,
    linhas: rows.length,
  };
}

/** Agrupa linhas por chave derivada e agrega cada bucket. */
function groupBy(rows, keyFn) {
  const buckets = new Map();
  for (let i = 0; i < rows.length; i += 1) {
    const k = keyFn(rows[i]);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(rows[i]);
  }
  const out = [];
  buckets.forEach((list, k) => {
    const a = aggregate(list);
    out.push({ key: k, ...a });
  });
  return out;
}

// ── janelas de comparação ------------------------------------------------

const BASES = {
  dod: { label: 'DoD | dia', dias: 1, desc: 'último dia fechado contra o dia anterior' },
  wow: { label: 'WoW | semana', dias: 7, desc: '7 dias contra os 7 anteriores' },
  mom: { label: 'MoM | mês', dias: 28, desc: '28 dias contra os 28 anteriores (4 semanas exatas)' },
  qoq: { label: 'QoQ | trimestre', dias: 91, desc: '91 dias contra os 91 anteriores (13 semanas exatas)' },
  yoy: { label: 'YoY | ano', dias: 28, desc: '28 dias contra os mesmos 28 dias 52 semanas atrás' },
};

/**
 * Define as duas janelas de uma base de comparação, ancoradas no último dia
 * FECHADO. Todas as janelas terminam em `endISO` e têm o mesmo comprimento.
 */
function windowsFor(base, endISO) {
  const b = BASES[base] ? base : 'wow';
  const dias = BASES[b].dias;
  const atual = { from: shiftDays(endISO, -(dias - 1)), to: endISO, dias };

  let anterior;
  if (b === 'yoy') {
    // 364 dias = 52 semanas: preserva o dia da semana nas duas pontas.
    anterior = { from: shiftDays(atual.from, -364), to: shiftDays(atual.to, -364), dias };
  } else {
    anterior = { from: shiftDays(atual.from, -dias), to: shiftDays(atual.from, -1), dias };
  }

  // Para DoD (1 dia contra 1 dia) o ruído de dia da semana domina; o mesmo dia
  // da semana anterior é a referência honesta e vai junto na resposta.
  const mesmoDiaSemanaAnterior = { from: shiftDays(atual.from, -7), to: shiftDays(atual.to, -7), dias };

  return {
    base: b,
    label: BASES[b].label,
    desc: BASES[b].desc,
    atual,
    anterior,
    mesmoDiaSemanaAnterior,
    diasPorJanela: dias,
  };
}

function basesDisponiveis() {
  return Object.keys(BASES).map(k => ({ base: k, ...BASES[k] }));
}

/**
 * Janela de datas LIVRE, para o dono escolher `de` e `até` na mão.
 *
 * A janela de referência default é a imediatamente anterior, do MESMO tamanho —
 * é o único default que não inventa premissa. `multiploDe7` sai no retorno porque
 * um intervalo livre quase nunca é múltiplo de 7 e aí a comparação carrega viés de
 * dia da semana (fim de semana rende ~1/4 do dia útil nesta propriedade): a tela
 * avisa em vez de fingir que a variação é limpa.
 */
function customWindows(from, to, cmpFrom, cmpTo) {
  const a = from <= to ? from : to;
  const b = from <= to ? to : from;
  const dias = diffDays(a, b) + 1;
  const atual = { from: a, to: b, dias };

  let anterior;
  if (cmpFrom && cmpTo) {
    const c = cmpFrom <= cmpTo ? cmpFrom : cmpTo;
    const d = cmpFrom <= cmpTo ? cmpTo : cmpFrom;
    anterior = { from: c, to: d, dias: diffDays(c, d) + 1 };
  } else {
    anterior = { from: shiftDays(a, -dias), to: shiftDays(a, -1), dias };
  }

  return {
    base: 'custom',
    label: 'Personalizado',
    desc: `${atual.dias} dias escolhidos à mão contra ${anterior.dias} dias`,
    atual,
    anterior,
    mesmoDiaSemanaAnterior: { from: shiftDays(a, -7), to: shiftDays(b, -7), dias },
    diasPorJanela: dias,
    multiploDe7: dias % 7 === 0 && anterior.dias % 7 === 0,
    mesmoTamanho: atual.dias === anterior.dias,
    referenciaManual: !!(cmpFrom && cmpTo),
  };
}

// ── deltas ---------------------------------------------------------------

function pct(atual, anterior) {
  if (anterior === 0) return atual === 0 ? 0 : null; // null = "novo", não 100%
  return (atual - anterior) / anterior;
}

/**
 * Delta de um par de agregados. `deltaPosition` negativo = subiu no ranking.
 */
function deltaOf(atual, anterior) {
  return {
    clicks: (atual.clicks || 0) - (anterior.clicks || 0),
    clicksPct: pct(atual.clicks || 0, anterior.clicks || 0),
    impressions: (atual.impressions || 0) - (anterior.impressions || 0),
    impressionsPct: pct(atual.impressions || 0, anterior.impressions || 0),
    ctr: (atual.ctr || 0) - (anterior.ctr || 0),
    position: (atual.position || 0) - (anterior.position || 0),
    posicaoMelhorou: (atual.position || 0) > 0 && (anterior.position || 0) > 0
      ? (atual.position < anterior.position)
      : null,
  };
}

const STATUS = {
  NOVO: 'novo',
  PERDIDO: 'perdido',
  SUBIU: 'subiu',
  CAIU: 'caiu',
  ESTAVEL: 'estavel',
};

/**
 * Classifica o movimento de uma entidade entre as duas janelas.
 * Zero impressão em uma das pontas é status próprio: "novo" e "perdido" são o
 * que o dono quer ver primeiro, e tratá-los como +100%/-100% os esconderia no
 * meio da lista.
 */
function statusOf(atual, anterior) {
  const ia = atual ? atual.impressions || 0 : 0;
  const ib = anterior ? anterior.impressions || 0 : 0;
  if (ib === 0 && ia > 0) return STATUS.NOVO;
  if (ia === 0 && ib > 0) return STATUS.PERDIDO;
  const ca = atual ? atual.clicks || 0 : 0;
  const cb = anterior ? anterior.clicks || 0 : 0;
  if (ca === cb) {
    // Sem mudança de clique, o movimento relevante é de impressão.
    const p = pct(ia, ib);
    if (p != null && Math.abs(p) >= 0.2) return p > 0 ? STATUS.SUBIU : STATUS.CAIU;
    return STATUS.ESTAVEL;
  }
  return ca > cb ? STATUS.SUBIU : STATUS.CAIU;
}

/**
 * Junta as entidades das duas janelas numa lista de movimentações.
 *
 * @param {Array} rowsAtual   linhas do GSC da janela atual (byDimension)
 * @param {Array} rowsAnterior linhas da janela anterior
 * @param {object} [opts]
 * @param {(key:string)=>object} [opts.enrich] campos extra por chave (categoria, seção…)
 */
function buildMovements(rowsAtual, rowsAnterior, opts) {
  const o = opts || {};
  const mapA = new Map();
  const mapB = new Map();
  for (let i = 0; i < rowsAtual.length; i += 1) mapA.set(rowsAtual[i].key, rowsAtual[i]);
  for (let i = 0; i < rowsAnterior.length; i += 1) mapB.set(rowsAnterior[i].key, rowsAnterior[i]);

  const chaves = new Set();
  mapA.forEach((_v, k) => chaves.add(k));
  mapB.forEach((_v, k) => chaves.add(k));

  const zero = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  const out = [];
  chaves.forEach(k => {
    const a = mapA.get(k) || zero;
    const b = mapB.get(k) || zero;
    const row = {
      chave: k,
      atual: { clicks: a.clicks || 0, impressions: a.impressions || 0, ctr: a.ctr || 0, position: a.position || 0 },
      anterior: { clicks: b.clicks || 0, impressions: b.impressions || 0, ctr: b.ctr || 0, position: b.position || 0 },
      delta: deltaOf(a, b),
      status: statusOf(mapA.get(k), mapB.get(k)),
    };
    if (o.enrich) Object.assign(row, o.enrich(k));
    out.push(row);
  });

  // Ordem default = maior movimento absoluto de clique, desempate por impressão.
  out.sort((x, y) => {
    const d = Math.abs(y.delta.clicks) - Math.abs(x.delta.clicks);
    if (d !== 0) return d;
    return Math.abs(y.delta.impressions) - Math.abs(x.delta.impressions);
  });
  return out;
}

/** Agrega movimentações por categoria/seção sem re-chamar a API. */
function rollupMovements(movs, keyOf) {
  const buckets = new Map();
  for (let i = 0; i < movs.length; i += 1) {
    const k = keyOf(movs[i]);
    if (!buckets.has(k)) buckets.set(k, { atual: [], anterior: [], itens: 0 });
    const b = buckets.get(k);
    b.atual.push(movs[i].atual);
    b.anterior.push(movs[i].anterior);
    b.itens += 1;
  }
  const out = [];
  buckets.forEach((b, k) => {
    const a = aggregate(b.atual);
    const p = aggregate(b.anterior);
    out.push({
      chave: k,
      itens: b.itens,
      atual: { clicks: a.clicks, impressions: a.impressions, ctr: a.ctr, position: a.position },
      anterior: { clicks: p.clicks, impressions: p.impressions, ctr: p.ctr, position: p.position },
      delta: deltaOf(a, p),
      status: statusOf(a.impressions ? a : null, p.impressions ? p : null),
    });
  });
  out.sort((x, y) => y.atual.clicks - x.atual.clicks || Math.abs(y.delta.clicks) - Math.abs(x.delta.clicks));
  return out;
}

// ── linha do tempo -------------------------------------------------------

/**
 * Série diária enriquecida: dia da semana, flag de fim de semana, média móvel de
 * 7 dias, delta contra o dia anterior e contra o mesmo dia da semana anterior.
 *
 * A média móvel de 7 dias existe porque a série crua desta propriedade oscila 4×
 * entre sábado e segunda — sem ela a "linha do tempo" é um serrote e nenhuma
 * tendência é legível.
 */
function enrichDaily(dias) {
  const byDate = new Map();
  for (let i = 0; i < dias.length; i += 1) byDate.set(dias[i].date, dias[i]);

  return dias.map((d, i) => {
    let soma = 0, n = 0;
    for (let k = Math.max(0, i - 6); k <= i; k += 1) { soma += dias[k].clicks; n += 1; }
    const prev = i > 0 ? dias[i - 1] : null;
    const d7 = byDate.get(shiftDays(d.date, -7)) || null;
    return {
      date: d.date,
      clicks: d.clicks,
      impressions: d.impressions,
      ctr: d.ctr,
      position: d.position,
      dow: dowOf(d.date),
      fimDeSemana: isWeekend(d.date),
      mm7: n > 0 ? soma / n : 0,
      dodClicks: prev ? d.clicks - prev.clicks : null,
      dodPct: prev ? pct(d.clicks, prev.clicks) : null,
      d7Clicks: d7 ? d.clicks - d7.clicks : null,
      d7Pct: d7 ? pct(d.clicks, d7.clicks) : null,
    };
  });
}

/**
 * Reagrupa a série diária.
 *  - `semana`: blocos de 7 dias ancorados no ÚLTIMO dia da série (do fim para o
 *    começo), então todo bucket tem 7 dias e é comparável. Semana ISO deixaria a
 *    última semana parcial e ela leria como colapso.
 *  - `mes`/`trimestre`: calendário, com flag `parcial` quando o bucket não está
 *    completo dentro da série.
 */
function rollupDaily(dias, gran) {
  if (!dias.length) return [];
  if (gran === 'dia') {
    return dias.map(d => ({
      key: d.date, label: d.date, from: d.date, to: d.date, dias: 1, parcial: false,
      clicks: d.clicks, impressions: d.impressions, ctr: d.ctr, position: d.position,
    }));
  }

  if (gran === 'semana') {
    const out = [];
    for (let end = dias.length - 1; end >= 0; end -= 7) {
      const start = Math.max(0, end - 6);
      const slice = dias.slice(start, end + 1);
      const a = aggregate(slice);
      out.push({
        key: slice[0].date,
        label: `${slice[0].date} a ${slice[slice.length - 1].date}`,
        from: slice[0].date, to: slice[slice.length - 1].date,
        dias: slice.length, parcial: slice.length < 7,
        clicks: a.clicks, impressions: a.impressions, ctr: a.ctr, position: a.position,
      });
    }
    return out.reverse();
  }

  const keyOf = gran === 'trimestre'
    ? (iso => `${iso.slice(0, 4)}-T${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`)
    : (iso => iso.slice(0, 7));

  const buckets = new Map();
  for (let i = 0; i < dias.length; i += 1) {
    const k = keyOf(dias[i].date);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(dias[i]);
  }
  const out = [];
  buckets.forEach((slice, k) => {
    const a = aggregate(slice);
    const esperado = gran === 'trimestre' ? _diasNoTrimestre(k) : _diasNoMes(k);
    out.push({
      key: k, label: k,
      from: slice[0].date, to: slice[slice.length - 1].date,
      dias: slice.length, parcial: slice.length < esperado,
      clicks: a.clicks, impressions: a.impressions, ctr: a.ctr, position: a.position,
    });
  });
  out.sort((x, y) => (x.key < y.key ? -1 : 1));
  return out;
}

function _diasNoMes(ym) {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function _diasNoTrimestre(key) {
  const y = Number(key.slice(0, 4)), t = Number(key.slice(6));
  let total = 0;
  for (let m = (t - 1) * 3 + 1; m <= t * 3; m += 1) total += new Date(Date.UTC(y, m, 0)).getUTCDate();
  return total;
}

/** Delta período-contra-período dentro de uma série já reagrupada. */
function serieComDelta(buckets) {
  return buckets.map((b, i) => {
    const prev = i > 0 ? buckets[i - 1] : null;
    return {
      ...b,
      deltaClicks: prev ? b.clicks - prev.clicks : null,
      deltaPct: prev ? pct(b.clicks, prev.clicks) : null,
      deltaPosition: prev ? b.position - prev.position : null,
    };
  });
}

// ── cobertura ------------------------------------------------------------

/**
 * Quanto do site a dimensão consegue explicar. Sem isso a tabela de consultas
 * mente por omissão: no período medido ela cobria 27,5% dos cliques.
 */
function coverageOf(totalSite, agregadoDimensao) {
  const c = totalSite.clicks || 0;
  const i = totalSite.impressions || 0;
  return {
    clicksSite: c,
    clicksDimensao: agregadoDimensao.clicks || 0,
    pctClicks: c > 0 ? (agregadoDimensao.clicks || 0) / c : null,
    impressionsSite: i,
    impressionsDimensao: agregadoDimensao.impressions || 0,
    pctImpressions: i > 0 ? (agregadoDimensao.impressions || 0) / i : null,
  };
}

module.exports = {
  norm, shiftDays, diffDays, dowOf, isWeekend,
  isBrand, BRAND_RE,
  categoryOf, CATEGORY_RULES, CATEGORY_OUTRAS,
  sectionOf, pathOf, pageLabel, hostOf, SECTION_RULES,
  aggregate, groupBy,
  BASES, windowsFor, basesDisponiveis, customWindows,
  pct, deltaOf, statusOf, STATUS,
  buildMovements, rollupMovements,
  enrichDaily, rollupDaily, serieComDelta,
  coverageOf,
};
