#!/usr/bin/env node
'use strict';

/**
 * reconstruct-snapshot.js — Reconstrói a fotografia do pipe num dia passado.
 *
 * O cron /api/snapshot não rodou em 12/06, então não há linha agregada nem foto
 * deal-a-deal salva desse dia. Este script reconstrói esse estado a partir do
 * HISTÓRICO DE PROPRIEDADES do HubSpot (cada mudança de etapa/ARR/etc. fica
 * registrada com timestamp). Para cada deal, "rebobina" cada propriedade para o
 * valor vigente no instante de corte e aplica EXATAMENTE a mesma lógica do
 * api/snapshot.js (mesmas etapas ativas, mesmas fórmulas de ARR/receita), para
 * que o resultado seja comparável com as fotos que o painel já gera.
 *
 * Uso:  node scripts/reconstruct-snapshot.js [YYYY-MM-DD]   (padrão: 2026-06-12)
 *
 * Saídas (em ./_snapshots/):
 *   - snapshot-<data>-deals.csv      foto deal-a-deal (mesmas colunas do painel)
 *   - snapshot-<data>-agregado.csv   linha de big numbers (mesma aba "Historico")
 *   - snapshot-<data>.json           dump completo (deals + agregado)
 */

const fs   = require('fs');
const path = require('path');
const { hubspotPost, fetchOwners, STAGE_MAP } = require('../lib/hubspot');

// ── Carrega .env.local (mesma rotina do local-server) ────────────────────────
(function loadEnv() {
  const envFile = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
})();

const TOKEN = process.env.HUBSPOT_TOKEN;
if (!TOKEN) { console.error('ERRO: HUBSPOT_TOKEN não encontrado no ambiente / .env.local'); process.exit(1); }

// ── Constantes (idênticas a api/snapshot.js) ─────────────────────────────────
const PIPELINE_VENDAS = '782758156';
const PIPELINE_BID    = '894130090';
const PIPELINE_LABELS = { [PIPELINE_VENDAS]: 'Vendas', [PIPELINE_BID]: 'Bid' };

const ACTIVE_STAGE_IDS = [
  '1144746908', '1144746909', '1144746910', '1288611084', '1144844314', // Vendas
  '1363560722', '1349620555', '1349620556', '1353387279',               // Bid
  '1353387280', '1353457025', '1373066362',                              // Bid cont.
];

// Propriedades que variam no tempo → precisamos do histórico de cada uma.
const HIST_PROPS = [
  'dealname', 'dealstage', 'pipeline', 'hubspot_owner_id',
  'produto', 'quantidade_de_colaboradores', 'vidas',
  'primeira_fatura', 'arr_estimado', 'modelo_de_remuneracao',
  'possui_agenciamento', 'possui_vitalicio',
  'probabilidade_de_fechamento_', 'hs_deal_stage_probability',
  'qual_quarter_de_fechamento', 'data_prevista_para_receita',
  'hs_is_closed_lost',
];
// Estáticas (não rebobinadas).
const STATIC_PROPS = ['hs_object_id', 'createdate'];

// Grupo de atrito (perdidos da semana): precisamos do estado ATUAL destes campos.
const CURRENT_EXTRA_PROPS = ['motivo_do_declinio_ou_perdido', 'closedate'];
// "Vivo no corte" = etapa ativa OU Diagnóstico (Vendas). Estar aqui garante que o
// deal NÃO estava perdido em 12/06 — então um closed-lost atual é perda da semana.
const DIAGNOSTICO_ID = '1144746906';
const ALIVE_12JUN = new Set([...ACTIVE_STAGE_IDS, DIAGNOSTICO_ID]);

const STAGE_PROB = {
  'Cotação': 0.18579, 'Proposta Enviada': 0.285, 'Consultoria': 0.284954,
  'Negociação': 0.493, 'Implantação': 0.8, 'Ganho': 1.0,
  'Standby': 0.12, 'Stand by': 0.12,
};

const MONTHS_SHORT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

const SNAPSHOT_BASE_HEADERS = [
  'Deal', 'URL HubSpot', 'Pipeline', 'Etapa', 'Executivo',
  'Produto', 'Vidas', 'Colaboradores',
  '1ª Fatura (R$)', 'ARR Estimado (R$)',
  'Modelo', 'Agenciamento', 'Vitalício',
  'Probabilidade (%)', 'Quarter', 'Data Prevista', 'Dias no Pipe',
];

const HISTORICO_HEADERS = [
  'Data', 'Total Deals',
  'ARR Total (R$)', 'ARR Ponderado (R$)', 'MRR Ponderado (R$)',
  'Cotação', 'Proposta Enviada', 'Consultoria', 'Negociação', 'Implantação', 'Ganho', 'Standby',
  'Pipeline Vendas', 'Pipeline Bid',
];

// ── Helpers (idênticos a api/snapshot.js) ────────────────────────────────────
function normalizeProb(val) {
  const n = parseFloat(val);
  if (isNaN(n) || n < 0) return null;
  return n > 1 ? n / 100 : n;
}
function normalizeBool(val) {
  const v = (val || '').toString().trim().toLowerCase();
  if (v === 'true' || v === 'sim') return true;
  if (v === 'false' || v === 'não' || v === 'nao') return false;
  return null;
}
function fmtDate(d) {
  if (!d) return '';
  const parts = String(d).substring(0, 10).split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : d;
}
function fmtQuarter(q) {
  if (!q) return '';
  if (q === 'true')  return 'Q1';
  if (q === 'false') return 'Q2';
  const s = q.toString().trim().toLowerCase();
  if (s === 'sem informação' || s === 'sem informacao') return '';
  return q;
}
function generateMonths(year, mo) {
  return Array.from({ length: 24 }, (_, i) => {
    const total = mo + i;
    return { y: year + Math.floor(total / 12), mo: total % 12 };
  });
}
function monthLabel(m) { return `${MONTHS_SHORT[m.mo]}/${String(m.y).slice(2)}`; }
function buildSnapshotHeaders(months) {
  return [
    ...SNAPSHOT_BASE_HEADERS,
    ...months.map(m => `${monthLabel(m)} Real (R$)`),
    ...months.map(m => `${monthLabel(m)} Prob (R$)`),
  ];
}
function parseRevDate(str) {
  if (!str) return null;
  const match = str.match(/^(\d{4})-(\d{2})/);
  if (!match) return null;
  return { y: parseInt(match[1]), mo: parseInt(match[2]) - 1 };
}
function calcARR(p) {
  const a = parseFloat(p.arr_estimado);
  if (!isNaN(a) && a > 0) return a;
  const pf = parseFloat(p.primeira_fatura);
  return (!isNaN(pf) && pf > 0) ? pf * 12 : 0;
}
function calcReceita(n, p) {
  const pf    = parseFloat(p.primeira_fatura);
  const vidas = parseInt(p.vidas) || 0;
  const mod   = p.modelo_de_remuneracao;
  const agenc = normalizeBool(p.possui_agenciamento);
  if (!pf || isNaN(pf) || !mod) return null;
  if (mod === 'Fee por vida') return pf;
  if (mod === 'Corretagem') {
    if (agenc === true) {
      return vidas < 200
        ? (n <= 3 ? pf : pf * 0.02)
        : (n === 1 ? pf * 0.95 : pf * 0.05);
    }
    return vidas < 200 ? pf * 0.02 : pf * 0.05;
  }
  return null;
}

// ── Rebobinagem: valor de uma propriedade no instante de corte ───────────────
// history = [{ value, timestamp }]; retorna o valor vigente em cutoffMs.
function valueAsOf(history, cutoffMs) {
  if (!history || !history.length) return undefined;
  const sorted = history.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  let val;
  for (const h of sorted) {
    if (new Date(h.timestamp).getTime() <= cutoffMs) val = h.value;
    else break;
  }
  return val;
}

// ── CSV ──────────────────────────────────────────────────────────────────────
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCSV(headers, rows) {
  return [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const dateArg = process.argv[2] || '2026-06-12';
  const m = dateArg.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) { console.error('Data inválida. Use YYYY-MM-DD.'); process.exit(1); }
  const Y = +m[1], Mo = +m[2] - 1, D = +m[3];
  // Corte = fim do dia em BRT (23:59:59 -03:00) = mesmo instante que o cron capturaria.
  const cutoffMs = Date.UTC(Y, Mo, D, 23, 59, 59) + 3 * 3600 * 1000;
  console.log(`\n⏳ Reconstruindo fotografia do pipe em ${dateArg} (corte: ${new Date(cutoffMs).toISOString()})\n`);

  // 1) Candidatos: deals dos dois pipelines criados ATÉ o corte.
  //    Rebobinamos a etapa depois; deals fechados/perdidos antes do corte caem fora pelo filtro de etapa ativa.
  let candidates = [], after = 0, hasMore = true;
  while (hasMore) {
    const resp = await hubspotPost(TOKEN, '/crm/v3/objects/deals/search', {
      filterGroups: [{
        filters: [
          { propertyName: 'pipeline',   operator: 'IN',  values: [PIPELINE_VENDAS, PIPELINE_BID] },
          { propertyName: 'createdate', operator: 'LTE', value: String(cutoffMs) },
        ],
      }],
      properties: ['hs_object_id', 'createdate'],
      limit: 200,
      after,
    });
    candidates = candidates.concat(resp.results || []);
    hasMore = resp.paging?.next?.after != null;
    after   = resp.paging?.next?.after || 0;
  }
  console.log(`   ${candidates.length} deals candidatos (criados até o corte).`);

  const ids = candidates.map(c => c.id);

  // 2) Histórico de propriedades (batch/read cap = 50 inputs por chamada).
  const histById = {};
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const resp = await hubspotPost(TOKEN, '/crm/v3/objects/deals/batch/read', {
      properties:            [...HIST_PROPS, ...STATIC_PROPS, ...CURRENT_EXTRA_PROPS],
      propertiesWithHistory: HIST_PROPS,
      inputs: batch.map(id => ({ id: String(id) })),
    });
    (resp.results || []).forEach(r => { histById[r.id] = r; });
    process.stdout.write(`\r   histórico: ${Math.min(i + 50, ids.length)}/${ids.length}`);
  }
  process.stdout.write('\n');

  const ownerMap = await fetchOwners(TOKEN);

  // 3) Rebobina cada deal para o estado no corte.
  const rewound   = [];
  const attrition = [];
  for (const id of ids) {
    const r = histById[id];
    if (!r) continue;
    const hist = r.propertiesWithHistory || {};
    const cur  = r.properties || {};
    const p = {};
    for (const prop of HIST_PROPS)   p[prop] = valueAsOf(hist[prop], cutoffMs);
    for (const prop of STATIC_PROPS) p[prop] = cur[prop];

    const stage12 = p.dealstage;

    // Foto: "ativo no corte" — mesma definição do snapshot.js.
    if (ACTIVE_STAGE_IDS.includes(stage12) && p.hs_is_closed_lost !== 'true') {
      rewound.push({ id, p });
    }

    // Atrito da semana: vivo em 12/06 (ativa ou Diagnóstico) e HOJE perdido.
    // stage12 ∈ ALIVE garante que não estava perdido no corte → perda posterior.
    if (ALIVE_12JUN.has(stage12) && cur.hs_is_closed_lost === 'true') {
      attrition.push({ id, p, cur });
    }
  }
  console.log(`   ${rewound.length} deals ativos no pipe em ${dateArg}.`);
  console.log(`   ${attrition.length} deals perdidos desde ${dateArg} (estavam vivos no corte).\n`);

  // 4) Agregado (big numbers) — idêntico ao dailyRow do snapshot.js.
  let arrTotal = 0, arrPonderado = 0;
  const stageCounts = {};
  const pipelineCounts = { [PIPELINE_VENDAS]: 0, [PIPELINE_BID]: 0 };
  for (const { p } of rewound) {
    const stageName = STAGE_MAP[p.dealstage] || p.dealstage || '—';
    const arr  = calcARR(p);
    const prob = normalizeProb(p.probabilidade_de_fechamento_)
      ?? normalizeProb(p.hs_deal_stage_probability)
      ?? STAGE_PROB[stageName] ?? 0;
    arrTotal     += arr;
    arrPonderado += arr * prob;
    stageCounts[stageName] = (stageCounts[stageName] || 0) + 1;
    if (p.pipeline in pipelineCounts) pipelineCounts[p.pipeline]++;
  }
  const aggRow = [
    dateArg, rewound.length,
    Math.round(arrTotal), Math.round(arrPonderado), Math.round(arrPonderado / 12),
    stageCounts['Cotação']          || 0,
    stageCounts['Proposta Enviada'] || 0,
    stageCounts['Consultoria']      || 0,
    stageCounts['Negociação']       || 0,
    stageCounts['Implantação']      || 0,
    stageCounts['Ganho']            || 0,
    (stageCounts['Standby'] || 0) + (stageCounts['Stand by'] || 0),
    pipelineCounts[PIPELINE_VENDAS],
    pipelineCounts[PIPELINE_BID],
  ];

  // 5) Foto deal-a-deal — idêntico ao writeMonthlySnapshot do snapshot.js.
  const months  = generateMonths(Y, Mo);
  const headers = buildSnapshotHeaders(months);
  const dealRows = rewound.map(({ id, p }) => {
    const prob = normalizeProb(p.probabilidade_de_fechamento_) ?? normalizeProb(p.hs_deal_stage_probability);
    const arr  = calcARR(p);
    const dias = p.createdate ? Math.floor((cutoffMs - new Date(p.createdate).getTime()) / 86400000) : '';
    const ag   = normalizeBool(p.possui_agenciamento);
    const vit  = normalizeBool(p.possui_vitalicio);
    const revStart = parseRevDate(p.data_prevista_para_receita);

    const baseRow = [
      (p.dealname || '').replace(/\s*-\s*Novo\(a\)\s*Deal\s*$/gi, '').trim(),
      `https://app.hubspot.com/contacts/44715285/deal/${id}`,
      PIPELINE_LABELS[p.pipeline] || p.pipeline || '-',
      STAGE_MAP[p.dealstage] || p.dealstage || '-',
      ownerMap[p.hubspot_owner_id] || '-',
      p.produto || '',
      p.vidas                       ? parseInt(p.vidas)                       : '',
      p.quantidade_de_colaboradores ? parseInt(p.quantidade_de_colaboradores) : '',
      p.primeira_fatura             ? parseFloat(p.primeira_fatura)           : '',
      arr || '',
      p.modelo_de_remuneracao || '',
      ag  === true ? 'Sim' : (ag  === false ? 'Não' : ''),
      vit === true ? 'Sim' : (vit === false ? 'Não' : ''),
      prob != null ? parseFloat((prob * 100).toFixed(1)) : '',
      fmtQuarter(p.qual_quarter_de_fechamento),
      fmtDate(p.data_prevista_para_receita),
      dias,
    ];
    const realCols = months.map(mm => {
      if (!revStart) return '';
      const diff = (mm.y - revStart.y) * 12 + (mm.mo - revStart.mo);
      if (diff < 0 || diff > 23) return '';
      const rec = calcReceita(diff + 1, p);
      return rec != null ? Math.round(rec) : '';
    });
    const probCols = months.map((mm, idx) => {
      const rec = realCols[idx];
      return (rec !== '' && prob != null) ? Math.round(rec * prob) : '';
    });
    return [...baseRow, ...realCols, ...probCols];
  });

  // 6) Grava saídas.
  const outDir = path.join(__dirname, '..', '_snapshots');
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, `snapshot-${dateArg}`);
  fs.writeFileSync(`${base}-deals.csv`,    toCSV(headers, dealRows), 'utf8');
  fs.writeFileSync(`${base}-agregado.csv`, toCSV(HISTORICO_HEADERS, [aggRow]), 'utf8');
  const dealObjs = dealRows.map(row => Object.fromEntries(headers.map((h, i) => [h, row[i]])));

  // Grupo de atrito: deals que estavam vivos em 12/06 e hoje estão perdidos.
  const cleanName = s => (s || '').replace(/\s*-\s*Novo\(a\)\s*Deal\s*$/gi, '').trim();
  const attritionRows = attrition.map(({ id, p, cur }) => ({
    'Deal':            cleanName(p.dealname),
    'URL HubSpot':     `https://app.hubspot.com/contacts/44715285/deal/${id}`,
    'Pipeline':        PIPELINE_LABELS[p.pipeline] || p.pipeline || '-',
    'Etapa em 12 Jun': STAGE_MAP[p.dealstage]   || p.dealstage   || '-',
    'Etapa hoje':      STAGE_MAP[cur.dealstage] || cur.dealstage || '-',
    'Executivo':       ownerMap[p.hubspot_owner_id] || '-',
    'ARR 12 Jun (R$)': calcARR(p) || '',
    'Data Perdido':    fmtDate(cur.closedate),
    'Motivo':          cur.motivo_do_declinio_ou_perdido || '',
  }));

  fs.writeFileSync(`${base}.json`, JSON.stringify({
    date: dateArg, cutoffISO: new Date(cutoffMs).toISOString(),
    aggregate: Object.fromEntries(HISTORICO_HEADERS.map((h, i) => [h, aggRow[i]])),
    deals: dealObjs,
    attrition: attritionRows,
  }, null, 2), 'utf8');

  // Dado embutido servido pela rota autenticada /api/history?action=local.
  // Após gerar, registre o rótulo no mapa LOCAL_SNAPSHOTS em api/history.js.
  const dataDir = path.join(__dirname, '..', 'lib', 'snapshots');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, `${dateArg}.json`),
    JSON.stringify({ tab: `${dateArg} (reconstruído)`, date: dateArg, deals: dealObjs, attrition: attritionRows }), 'utf8');

  // 7) Resumo no console.
  const brl = n => 'R$ ' + Number(n).toLocaleString('pt-BR');
  console.log('═'.repeat(58));
  console.log(`  FOTOGRAFIA DO PIPE — ${dateArg}`);
  console.log('═'.repeat(58));
  console.log(`  Total de deals ativos : ${rewound.length}`);
  console.log(`  ARR Total             : ${brl(Math.round(arrTotal))}`);
  console.log(`  ARR Ponderado         : ${brl(Math.round(arrPonderado))}`);
  console.log(`  MRR Ponderado         : ${brl(Math.round(arrPonderado / 12))}`);
  console.log('  ── Deals por etapa ──');
  for (const s of ['Cotação','Proposta Enviada','Consultoria','Negociação','Implantação','Ganho']) {
    if (stageCounts[s]) console.log(`     ${s.padEnd(18)}: ${stageCounts[s]}`);
  }
  const sb = (stageCounts['Standby'] || 0) + (stageCounts['Stand by'] || 0);
  if (sb) console.log(`     ${'Standby'.padEnd(18)}: ${sb}`);
  console.log(`  ── Por pipeline ──`);
  console.log(`     Vendas: ${pipelineCounts[PIPELINE_VENDAS]}   Bid: ${pipelineCounts[PIPELINE_BID]}`);
  if (attritionRows.length) {
    const lostArr  = attrition.reduce((s, a) => s + calcARR(a.p), 0);
    const fromDiag = attrition.filter(a => a.p.dealstage === DIAGNOSTICO_ID).length;
    console.log('  ── Atrito desde o corte (perdidos da semana) ──');
    console.log(`     Perdidos: ${attritionRows.length}  (de Diagnóstico: ${fromDiag}, de etapa ativa: ${attritionRows.length - fromDiag})`);
    console.log(`     ARR perdido (estado 12/06): ${brl(Math.round(lostArr))}`);
  }
  console.log('═'.repeat(58));
  console.log(`\n✅ Arquivos gravados em ${outDir}\\`);
  console.log(`   • snapshot-${dateArg}-deals.csv      (${dealRows.length} deals, ${headers.length} colunas)`);
  console.log(`   • snapshot-${dateArg}-agregado.csv`);
  console.log(`   • snapshot-${dateArg}.json\n`);
}

main().catch(e => { console.error('\nERRO:', e.message); process.exit(1); });
