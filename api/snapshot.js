'use strict';
/**
 * GET /api/snapshot
 *
 * Roda diariamente às 23:59 BRT via Vercel Cron (ou manualmente por usuário autenticado).
 *
 * Sempre:   grava linha de big numbers na aba "Historico" da planilha.
 * Fim de mês: também cria aba "Mmm AAAA" com fotografia completa de todos os deals.
 */

const { hubspotPost, fetchOwners, STAGE_MAP } = require('../lib/hubspot');
const { appendDailyRow, writeMonthlySnapshot } = require('../lib/sheets');
const { setCORSHeaders, getHubspotToken }       = require('./_helpers');
const { verifyRequest }                          = require('../lib/auth');

const PIPELINE_VENDAS = '782758156';
const PIPELINE_BID    = '894130090';
const PIPELINE_LABELS = { [PIPELINE_VENDAS]: 'Vendas', [PIPELINE_BID]: 'Bid' };

const ACTIVE_STAGE_IDS = [
  '1144746908', '1144746909', '1144746910', '1288611084', '1144844314', // Vendas
  '1363560722', '1349620555', '1349620556', '1353387279',               // Bid
  '1353387280', '1353457025', '1373066362',                              // Bid cont.
];

const PROPERTIES = [
  'dealname', 'dealstage', 'pipeline', 'hubspot_owner_id',
  'produto', 'quantidade_de_colaboradores', 'vidas',
  'primeira_fatura', 'arr_estimado', 'modelo_de_remuneracao',
  'possui_agenciamento', 'possui_vitalicio',
  'probabilidade_de_fechamento_', 'hs_deal_stage_probability',
  'qual_quarter_de_fechamento', 'data_prevista_para_receita',
  'hs_is_closed_lost', 'hs_object_id', 'createdate',
];

const STAGE_PROB = {
  'Cotação': 0.18579, 'Proposta Enviada': 0.285, 'Consultoria': 0.284954,
  'Negociação': 0.493, 'Implantação': 0.8, 'Ganho': 1.0,
  'Standby': 0.12, 'Stand by': 0.12,
};

const MONTHS_PT  = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const MONTHS_SHORT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

const SNAPSHOT_BASE_HEADERS = [
  'Deal', 'URL HubSpot', 'Pipeline', 'Etapa', 'Executivo',
  'Produto', 'Vidas', 'Colaboradores',
  '1ª Fatura (R$)', 'ARR Estimado (R$)',
  'Modelo', 'Agenciamento', 'Vitalício',
  'Probabilidade (%)', 'Quarter', 'Data Prevista', 'Dias no Pipe',
];

// ── Helpers de data ──────────────────────────────────────────────────────────

// O cron roda às 02:59 UTC = 23:59 BRT (UTC-3). Subtrai 3h para obter a data correta.
function getBRTDate() {
  return new Date(Date.now() - 3 * 60 * 60 * 1000);
}

function dateStr(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isLastDayOfMonth(d) {
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
  return next.getUTCDate() === 1;
}

function monthTabName(d) {
  return `${MONTHS_PT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ── Helpers de normalização ──────────────────────────────────────────────────

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

// Gera array de 24 meses a partir do mês do snapshot (0-indexed)
function generateMonths(year, mo) {
  return Array.from({ length: 24 }, (_, i) => {
    const total = mo + i;
    return { y: year + Math.floor(total / 12), mo: total % 12 };
  });
}

function monthLabel(m) {
  return `${MONTHS_SHORT[m.mo]}/${String(m.y).slice(2)}`;
}

function buildSnapshotHeaders(months) {
  return [
    ...SNAPSHOT_BASE_HEADERS,
    ...months.map(m => `${monthLabel(m)} Real (R$)`),
    ...months.map(m => `${monthLabel(m)} Prob (R$)`),
  ];
}

// Data prevista para receita → { y, mo } 0-indexed
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

// Receita bruta mensal — mesma lógica do frontend (n = número do mês, 1-based)
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

// ── Handler ──────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  const cronSecret     = process.env.CRON_SECRET;
  const snapshotSecret = process.env.SNAPSHOT_SECRET;
  const authHeader     = req.headers['authorization'] || '';
  const querySecret    = (req.query && req.query.secret) || new URL(`http://x${req.url}`).searchParams.get('secret') || '';
  const isCron         = cronSecret     && authHeader  === `Bearer ${cronSecret}`;
  const isZapier       = snapshotSecret && (authHeader === `Bearer ${snapshotSecret}` || querySecret === snapshotSecret);
  const isUser         = !!verifyRequest(req);
  if (!isCron && !isZapier && !isUser) return res.status(401).json({ success: false, error: 'Não autorizado' });

  let hsToken;
  try { hsToken = getHubspotToken(); }
  catch (e) { return res.status(503).json({ success: false, error: e.message }); }

  try {
    const brtDate  = getBRTDate();
    const today    = dateStr(brtDate);
    // ?tab=Mai+2026 força snapshot mensal com nome específico (só usuário autenticado, não cron)
    const forceTab = isUser && (req.query?.tab || new URL(`http://x${req.url}`).searchParams.get('tab'));
    const lastDay  = forceTab ? true : isLastDayOfMonth(brtDate);

    // ── Busca todos os deals ativos ──────────────────────────────────────────
    let all = [], after = 0, hasMore = true;
    while (hasMore) {
      const resp = await hubspotPost(hsToken, '/crm/v3/objects/deals/search', {
        filterGroups: [{
          filters: [
            { propertyName: 'pipeline',  operator: 'IN', values: [PIPELINE_VENDAS, PIPELINE_BID] },
            { propertyName: 'dealstage', operator: 'IN', values: ACTIVE_STAGE_IDS },
          ],
        }],
        properties: PROPERTIES,
        limit: 200,
        after,
      });
      all     = all.concat(resp.results || []);
      hasMore = resp.paging?.next?.after != null;
      after   = resp.paging?.next?.after || 0;
    }

    const deals    = all.filter(r => r.properties.hs_is_closed_lost !== 'true');
    const ownerMap = await fetchOwners(hsToken);

    // ── Big numbers (diário) ─────────────────────────────────────────────────
    let arrTotal = 0, arrPonderado = 0;
    const stageCounts    = {};
    const pipelineCounts = { [PIPELINE_VENDAS]: 0, [PIPELINE_BID]: 0 };

    for (const d of deals) {
      const p         = d.properties;
      const stageName = STAGE_MAP[p.dealstage] || p.dealstage || '—';
      const arr       = calcARR(p);
      const prob      = normalizeProb(p.probabilidade_de_fechamento_)
        ?? normalizeProb(p.hs_deal_stage_probability)
        ?? STAGE_PROB[stageName] ?? 0;

      arrTotal     += arr;
      arrPonderado += arr * prob;
      stageCounts[stageName]    = (stageCounts[stageName] || 0) + 1;
      if (p.pipeline in pipelineCounts) pipelineCounts[p.pipeline]++;
    }

    const dailyRow = [
      today, deals.length,
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

    await appendDailyRow(dailyRow);

    // ── Fotografia mensal (só no último dia do mês) ──────────────────────────
    let monthTab = null;
    if (lastDay) {
      monthTab = forceTab || monthTabName(brtDate);

      // 24 meses a partir do mês do snapshot
      const months          = generateMonths(brtDate.getUTCFullYear(), brtDate.getUTCMonth());
      const snapshotHeaders = buildSnapshotHeaders(months);

      const dealRows = deals.map(d => {
        const p    = d.properties;
        const prob = normalizeProb(p.probabilidade_de_fechamento_)
          ?? normalizeProb(p.hs_deal_stage_probability);
        const arr  = calcARR(p);
        const dias = p.createdate
          ? Math.floor((Date.now() - new Date(p.createdate).getTime()) / 86400000)
          : '';
        const ag  = normalizeBool(p.possui_agenciamento);
        const vit = normalizeBool(p.possui_vitalicio);
        const revStart = parseRevDate(p.data_prevista_para_receita);

        const baseRow = [
          (p.dealname || '').replace(/\s*-\s*Novo\(a\)\s*Deal\s*$/gi, '').trim(),
          `https://app.hubspot.com/contacts/44715285/deal/${d.id}`,
          PIPELINE_LABELS[p.pipeline] || p.pipeline || '-',
          STAGE_MAP[p.dealstage] || p.dealstage || '-',
          ownerMap[p.hubspot_owner_id] || '-',
          p.produto || '',
          p.vidas                        ? parseInt(p.vidas)                       : '',
          p.quantidade_de_colaboradores  ? parseInt(p.quantidade_de_colaboradores) : '',
          p.primeira_fatura              ? parseFloat(p.primeira_fatura)           : '',
          arr || '',
          p.modelo_de_remuneracao || '',
          ag  === true ? 'Sim' : (ag  === false ? 'Não' : ''),
          vit === true ? 'Sim' : (vit === false ? 'Não' : ''),
          prob != null ? parseFloat((prob * 100).toFixed(1)) : '',
          fmtQuarter(p.qual_quarter_de_fechamento),
          fmtDate(p.data_prevista_para_receita),
          dias,
        ];

        // Receita real por mês (24 colunas)
        const realCols = months.map(m => {
          if (!revStart) return '';
          const diff = (m.y - revStart.y) * 12 + (m.mo - revStart.mo);
          if (diff < 0 || diff > 23) return '';
          const rec = calcReceita(diff + 1, p);
          return rec != null ? Math.round(rec) : '';
        });

        // Receita probabilizada por mês (24 colunas)
        const probCols = months.map((m, i) => {
          const rec = realCols[i];
          return (rec !== '' && prob != null) ? Math.round(rec * prob) : '';
        });

        return [...baseRow, ...realCols, ...probCols];
      });

      await writeMonthlySnapshot(monthTab, snapshotHeaders, dealRows);
    }

    return res.status(200).json({
      success:          true,
      date:             today,
      deals:            deals.length,
      arr_total:        Math.round(arrTotal),
      arr_ponderado:    Math.round(arrPonderado),
      monthly_snapshot: monthTab,
    });

  } catch (e) {
    console.error('[snapshot]', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};
