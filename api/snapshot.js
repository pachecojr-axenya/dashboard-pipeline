'use strict';
/**
 * GET /api/snapshot
 *
 * Roda diariamente às 23:59 BRT via Vercel Cron (ou manualmente: usuário autenticado
 * ou ?secret=SNAPSHOT_SECRET).
 *
 * Fotografia = registro BRUTO de todos os deals (Vendas + Bid, TODAS as etapas,
 * inclusive Ganho e Perdido) como estão no HubSpot. NENHUM cálculo — os cálculos
 * são feitos no dashboard sobre a foto (regra do projeto, 2026-07-02).
 * Formato: 35 colunas de lib/snapshot-format.js (mesmo das abas "Jun 2026" e
 * "2026-06-05".."2026-06-26").
 *
 * O que cada execução faz:
 *   - Sempre: linha de batimento (só CONTAGENS por etapa/pipeline) na aba "Historico Diario".
 *   - Sexta-feira (BRT): grava a foto semanal na aba "YYYY-MM-DD".
 *   - Último dia do mês (BRT): grava a foto mensal na aba "Mmm AAAA".
 *   - Autocorreção: se a foto da última sexta ou do mês anterior não existir (cron
 *     falhou na noite certa), grava agora — a coluna "Capturada em" registra o atraso.
 *   - ?tab=Nome (só usuário autenticado): força uma foto com nome de aba específico.
 *
 * Abas nunca são sobrescritas: se a aba já tem conteúdo, a gravação é pulada.
 */

const { hubspotPost, fetchOwners, STAGE_MAP } = require('../lib/hubspot');
const { writeMonthlySnapshot, listTabs, readRange, appendRow } = require('../lib/sheets');
const { setCORSHeaders, getHubspotToken } = require('./_helpers');
const { verifyRequest } = require('../lib/auth');
const { PIPELINE_VENDAS, PIPELINE_BID, PROPERTIES, HEADERS, buildRow } = require('../lib/snapshot-format');
const bq = require('../lib/bigquery');

const MONTHS_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

const COUNT_HEADERS = [
  'Data', 'Total Deals',
  'Reunião Agendada', 'Diagnóstico', 'Cotação', 'Proposta Enviada', 'Consultoria',
  'Negociação', 'Standby', 'Implantação', 'Ganho', 'Perdido', 'Outras Etapas',
  'Pipeline Vendas', 'Pipeline Bid',
];

// ── Datas (o cron roda 02:59 UTC = 23:59 BRT do dia anterior) ────────────────

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

// Última sexta-feira ANTERIOR à data (exclusiva: se d é sexta, retorna a sexta passada)
function previousFriday(d) {
  const daysBack = ((d.getUTCDay() - 5) + 7) % 7 || 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysBack));
}

// Último dia do mês ANTERIOR
function previousMonthEnd(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
}

// ── Captura ──────────────────────────────────────────────────────────────────

async function fetchAllDeals(token) {
  let all = [], after = 0, hasMore = true;
  while (hasMore) {
    const resp = await hubspotPost(token, '/crm/v3/objects/deals/search', {
      filterGroups: [{
        filters: [{ propertyName: 'pipeline', operator: 'IN', values: [PIPELINE_VENDAS, PIPELINE_BID] }],
      }],
      properties: PROPERTIES,
      limit: 200,
      after,
    });
    all = all.concat(resp.results || []);
    hasMore = resp.paging?.next?.after != null;
    after = resp.paging?.next?.after || 0;
  }
  return all;
}

function countsRow(deals, today) {
  const byStage = {};
  const byPipe = { [PIPELINE_VENDAS]: 0, [PIPELINE_BID]: 0 };
  for (const d of deals) {
    const label = STAGE_MAP[d.properties.dealstage] || d.properties.dealstage || '—';
    byStage[label] = (byStage[label] || 0) + 1;
    if (d.properties.pipeline in byPipe) byPipe[d.properties.pipeline]++;
  }
  const named = ['Reunião Agendada', 'Diagnóstico', 'Cotação', 'Proposta Enviada', 'Consultoria',
    'Negociação', 'Standby', 'Stand by', 'Implantação', 'Ganho', 'Perdido'];
  const outras = Object.keys(byStage).filter(s => !named.includes(s))
    .reduce((s, k) => s + byStage[k], 0);
  return [
    today, deals.length,
    byStage['Reunião Agendada'] || 0,
    byStage['Diagnóstico'] || 0,
    byStage['Cotação'] || 0,
    byStage['Proposta Enviada'] || 0,
    byStage['Consultoria'] || 0,
    byStage['Negociação'] || 0,
    (byStage['Standby'] || 0) + (byStage['Stand by'] || 0),
    byStage['Implantação'] || 0,
    byStage['Ganho'] || 0,
    byStage['Perdido'] || 0,
    outras,
    byPipe[PIPELINE_VENDAS],
    byPipe[PIPELINE_BID],
  ];
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
    const brtDate    = getBRTDate();
    const today      = dateStr(brtDate);
    const capturedAt = new Date().toISOString();
    const forceTab   = isUser && (req.query?.tab || new URL(`http://x${req.url}`).searchParams.get('tab'));

    // ── Foto bruta de todos os deals ─────────────────────────────────────────
    const deals    = await fetchAllDeals(hsToken);
    const ownerMap = await fetchOwners(hsToken);
    const rows     = deals.map(d => buildRow(d, ownerMap, STAGE_MAP, capturedAt));

    const actions = {};

    // ── Legado Sheets ────────────────────────────────────────────────────────
    // A planilha é somente sanity/compatibilidade. Falha de permissão nela não
    // pode bloquear a fonte canônica diária no BigQuery (incidente 17–20/07).
    try {
      const tabs = await listTabs();
      const tabHasContent = async name => {
        if (!tabs.includes(name)) return false;
        const v = await readRange(`'${name}'!A2:A2`);
        return v.length > 0;
      };
      const writeTab = async name => {
        if (await tabHasContent(name)) return 'já existia';
        for (let i = 0; i < rows.length; i += 400) {
          await writeMonthlySnapshot(name, HEADERS, rows.slice(i, i + 400));
        }
        return 'gravada (' + rows.length + ' deals)';
      };

      await appendRow('Historico Diario', COUNT_HEADERS, countsRow(deals, today));
      actions.batimento = today;

      if (brtDate.getUTCDay() === 5) {
        actions['semanal ' + today] = await writeTab(today);
      } else {
        const lastFri = dateStr(previousFriday(brtDate));
        if (!(await tabHasContent(lastFri))) {
          actions['semanal ' + lastFri + ' (atrasada)'] = await writeTab(lastFri);
        }
      }

      if (isLastDayOfMonth(brtDate)) {
        actions['mensal ' + monthTabName(brtDate)] = await writeTab(monthTabName(brtDate));
      } else {
        const prevMonth = monthTabName(previousMonthEnd(brtDate));
        if (!(await tabHasContent(prevMonth))) {
          actions['mensal ' + prevMonth + ' (atrasada)'] = await writeTab(prevMonth);
        }
      }

      if (forceTab) {
        actions['forçada ' + forceTab] = await writeTab(forceTab);
      }
    } catch (e) {
      console.error('[snapshot][sheets]', e.message);
      actions.sheets = 'ERRO (não bloqueante): ' + e.message;
    }

    // ── BQ: daily (todo dia) + weekly_gold (sexta/mês = espelho da planilha) ──
    // Fonte canônica e fail-closed: erro no BQ falha o cron para permitir retry.
    // - daily: foto deal-level TODO dia → destrava "datas livres" no /forecast-delta.
    // - weekly_gold: datamart leve; materializa a foto do dia SÓ na sexta e no
    //   último dia do mês, exatamente como a planilha grava suas abas. Derivado
    //   do daily (paridade garantida).
    if (bq.isConfigured()) {
      try {
        await bq.ensureTables();
        const ehSexta = brtDate.getUTCDay() === 5;
        const ehFimMes = isLastDayOfMonth(brtDate);
        const snapType = ehSexta ? 'semanal' : (ehFimMes ? 'mensal' : 'diario');

        // 1) daily — todo dia (idempotente por data)
        const dailyCount = await bq.snapshotCount(today, bq.TABLE_DAILY);
        if (dailyCount === rows.length) {
          actions.bq_daily = 'já existia (' + today + ')';
        } else if (dailyCount === 0) {
          const r = await bq.insertSnapshotRows(today, snapType, rows, capturedAt, bq.TABLE_DAILY, HEADERS);
          actions.bq_daily = 'gravada ' + today + ' (' + r.inserted + ' deals, ' + snapType + ')';
        } else {
          throw new Error('BQ daily parcial em ' + today + ': existente=' + dailyCount + ' esperado=' + rows.length);
        }

        // 2) weekly_gold — só na sexta / último dia do mês (espelha a planilha)
        if (ehSexta || ehFimMes) {
          const weeklyCount = await bq.snapshotCount(today, bq.TABLE_WEEKLY);
          if (weeklyCount === rows.length) {
            actions.bq_weekly = 'já existia (' + today + ')';
          } else if (weeklyCount === 0) {
            // Mesma resposta bruta da HubSpot API alimenta daily e weekly; evita
            // depender da visibilidade imediata do streaming buffer do daily.
            const rw = await bq.insertSnapshotRows(today, snapType, rows, capturedAt, bq.TABLE_WEEKLY, HEADERS);
            actions.bq_weekly = 'materializada ' + today + ' (' + rw.inserted + ' deals, ' + snapType + ')';
          } else {
            throw new Error('BQ weekly parcial em ' + today + ': existente=' + weeklyCount + ' esperado=' + rows.length);
          }
        }
      } catch (e) {
        console.error('[snapshot][bq]', e.message);
        // BQ é a fonte canônica. Qualquer falha precisa falhar o cron para ficar
        // observável e permitir retry, em vez de responder 200 enganoso.
        throw e;
      }
    } else {
      throw new Error('BigQuery não configurado: GOOGLE_SERVICE_ACCOUNT_JSON ausente');
    }

    return res.status(200).json({ success: true, date: today, deals: deals.length, actions });

  } catch (e) {
    console.error('[snapshot]', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};
