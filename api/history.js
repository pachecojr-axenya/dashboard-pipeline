'use strict';
/**
 * GET /api/history?action=tabs
 *   → lista as abas mensais disponíveis na planilha
 *
 * GET /api/history?action=fotos
 *   → lista as FOTOGRAFIAS brutas do pipe (abas semanais "YYYY-MM-DD" + mensais
 *     "Mmm AAAA" a partir de Jun 2026, quando o formato bruto de 35 colunas começou),
 *     ordenadas da mais recente para a mais antiga. Usado pelo modo Comparação do /forecast.
 *
 * GET /api/history?action=snapshot&tab=Mai+2026
 *   → retorna os deals daquele snapshot como array de objetos
 *
 * GET /api/history?action=local
 *   → lista os snapshots reconstruídos embutidos (dias sem cron)
 *
 * GET /api/history?action=local&tab=12+Jun+2026+(reconstruído)
 *   → retorna os deals do snapshot reconstruído (mesmo formato de ?action=snapshot)
 */

const { listMonthlyTabs, readSnapshot, listTabs } = require('../lib/sheets');
const { setCORSHeaders, requireAuth, getHubspotToken } = require('./_helpers');
const FC = require('../lib/forecast-compute');
const bq = require('../lib/bigquery');
const kv = require('../lib/kv');
const fs = require('fs'); const os = require('os'); const path = require('path');

// ── Comparação de fotos (action=compare) — helpers ──────────────────────────
const _MANUAL_KV_KEY = 'forecast:faturamento_manual';
const _MANUAL_TMP = path.join(os.tmpdir(), 'faturamento-manual.json');
// Faturamento manual (estado atual — não é snapshotado; caveat da Fase 1).
async function _readManual() {
  if (kv.isConfigured && kv.isConfigured()) { try { const v = await kv.getJSON(_MANUAL_KV_KEY); if (v && typeof v === 'object') return v; } catch (e) { /* fallback */ } }
  try { const j = JSON.parse(fs.readFileSync(_MANUAL_TMP, 'utf8')); if (j && typeof j === 'object') return j; } catch (e) { /* sem arquivo */ }
  return {};
}
const _MESES = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
// Fotos do SHEET (semanais + mensais desde jun/2026), da mais recente à mais antiga.
async function _listFotosSheet() {
  const all = await listTabs(); const fotos = [];
  all.forEach(t => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) { fotos.push({ tab: t, tipo: 'semanal', ord: t, refDate: t, source: 'sheet' }); return; }
    const m = t.match(/^([A-Za-zÀ-ÿ]{3}) (\d{4})$/);
    if (m) { const mo = _MESES[m[1].toLowerCase()]; if (mo == null) return; const ym = m[2] + '-' + String(mo + 1).padStart(2, '0'); const ord = ym + '-31'; if (ord >= '2026-06-01') fotos.push({ tab: t, tipo: 'mensal', ord, refDate: ym + '-15', source: 'sheet' }); }
  });
  fotos.sort((a, b) => b.ord.localeCompare(a.ord));
  return fotos;
}
// Fotos do BQ. Default = weekly_gold (lista "oficial", espelho da planilha).
// As datas do weekly sao as mesmas abas da planilha → a lista de fotos que as
// telas legadas (/forecast) mostram NAO muda ao ligar o BQ.
async function _listFotosBQ() {
  const dates = await bq.listSnapshotDates(bq.TABLE_WEEKLY);  // [{tab:'YYYY-MM-DD',tipo,count}]
  return dates.map(d => ({ tab: d.tab, tipo: d.tipo || 'semanal', ord: d.tab, refDate: d.tab, source: 'bq' }));
}
// Fonte de fotos: BQ (weekly) tem prioridade; fallback = Sheet.
// Se o BQ weekly tiver ao menos 2 fotos, usa BQ (comparação precisa de par).
async function _listFotos() {
  if (bq.isConfigured()) {
    try {
      const bqFotos = await _listFotosBQ();
      if (bqFotos.length >= 2) return bqFotos;
    } catch (e) { console.error('[history][bq fotos]', e.message); /* fallback */ }
  }
  return _listFotosSheet();
}
// Lê as linhas de uma foto no formato [[HEADERS],[...]], roteando pela fonte.
// BQ: lê do DAILY (cobre qualquer data — o backfill/cron grava as datas de foto
// também no daily), com fallback pro weekly e depois pro Sheet.
async function _readFotoRows(foto) {
  if (foto && foto.source === 'bq') {
    const daily = await bq.readSnapshotRows(foto.refDate, bq.TABLE_DAILY);
    if (daily.length > 1) return daily;
    const weekly = await bq.readSnapshotRows(foto.refDate, bq.TABLE_WEEKLY);
    if (weekly.length > 1) return weekly;
    return daily; // vazio → deixa o chamador tratar
  }
  return readSnapshot(foto.tab);
}
// Foto mais próxima em ou antes de `date` (fotos já vem ordenada desc).
function _resolveFoto(fotos, date) { return fotos.find(f => f.ord <= date) || null; }
function _rowsToObjs(rows) { const h = rows[0]; return rows.slice(1).map(r => { const o = {}; h.forEach((k, i) => { o[k] = r[i] == null ? '' : r[i]; }); return o; }); }

// ── Histórico de proprietários de um deal (action=owner-history&id=X) ────────
// Lazy, por deal (chamado quando o modal do /forecast abre). Não entra no payload
// compartilhado de /api/forecast-table para não pesar em todos os painéis.
async function hubGet(token, url) {
  const res = await fetch('https://api.hubapi.com' + url, {
    headers: { 'Authorization': 'Bearer ' + token },
    signal: AbortSignal.timeout(20000),
  });
  if (res.status >= 400) throw new Error('HubSpot API error (HTTP ' + res.status + ')');
  return res.json();
}
function histDateStr(ts) {
  if (ts == null) return null;
  if (/^\d+$/.test(String(ts))) { const d = new Date(Number(ts)); return isNaN(d) ? null : d.toISOString().substring(0, 10); }
  return String(ts).substring(0, 10);
}
// Mapa id→nome de TODOS os owners (ativos + arquivados). O GET individual não retorna
// arquivados, então usamos a listagem em lote com archived=true (mesma correção do forecast-table).
async function fetchOwnersMap(token) {
  const map = {};
  for (const archived of ['false', 'true']) {
    let after, hasMore = true;
    while (hasMore) {
      const r = await hubGet(token, '/crm/v3/owners?limit=200&archived=' + archived + (after ? '&after=' + after : ''));
      (r.results || []).forEach(o => {
        const name = (((o.firstName || '') + ' ' + (o.lastName || '')).trim()) || o.email || ('ID ' + o.id);
        if (!map[o.id]) map[o.id] = name;
      });
      hasMore = r.paging && r.paging.next && r.paging.next.after != null;
      after = r.paging && r.paging.next ? r.paging.next.after : undefined;
    }
  }
  return map;
}

// Snapshots reconstruídos do pipe (dias em que o cron diário não rodou).
// Dados embutidos via require() para o bundler da Vercel os incluir; servidos
// pela rota autenticada abaixo (action=local), nunca como arquivo estático.
// Para adicionar um novo: gere com scripts/reconstruct-snapshot.js e registre aqui.
const LOCAL_SNAPSHOTS = {
  '12 Jun 2026 (reconstruído)': require('../lib/snapshots/2026-06-12.json'),
};

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Método não permitido' });
  // requireAuth (mesmo gate dos demais endpoints): respeita LOCAL_DEV_BYPASS no dev;
  // em produção exige a sessão JWT, como antes.
  if (!requireAuth(req, res)) return;

  const params = new URL(`http://x${req.url}`).searchParams;
  const action = params.get('action');
  const tab    = params.get('tab');

  try {
    if (action === 'tabs') {
      const tabs = await listMonthlyTabs();
      return res.status(200).json({ success: true, tabs });
    }

    if (action === 'fotos') {
      // Fonte única _listFotos: BQ (datas livres, diário) com fallback pro Sheet.
      // Mantém o contrato { tab, tipo, ord } que o frontend já consome; source
      // é aditivo (o dropdown/inputs do /forecast-delta não quebram).
      const fotos = await _listFotos();
      const source = fotos.length && fotos[0].source === 'bq' ? 'bq' : 'sheet';
      return res.status(200).json({ success: true, source, fotos });
    }

    if (action === 'local') {
      if (!tab) {
        return res.status(200).json({ success: true, tabs: Object.keys(LOCAL_SNAPSHOTS) });
      }
      const snap = LOCAL_SNAPSHOTS[tab];
      if (!snap) return res.status(404).json({ success: false, error: 'Snapshot reconstruído não encontrado' });
      return res.status(200).json({ success: true, tab, deals: snap.deals, attrition: snap.attrition || [] });
    }

    if (action === 'compare') {
      const a = params.get('a'); const b = params.get('b');
      if (!a || !b) return res.status(400).json({ success: false, error: 'informe ?a=YYYY-MM-DD e ?b=YYYY-MM-DD' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return res.status(400).json({ success: false, error: 'datas devem estar no formato YYYY-MM-DD' });
      if (!(b > a)) return res.status(400).json({ success: false, error: 'Data B deve ser posterior a Data A' });

      const fotos = await _listFotos();
      if (!fotos.length) return res.status(422).json({ success: false, error: 'Nenhuma foto disponível' });
      const oldest = fotos[fotos.length - 1];
      const fA = _resolveFoto(fotos, a); const fB = _resolveFoto(fotos, b);
      if (!fA || !fB) return res.status(422).json({ success: false, error: 'Sem foto em ou antes de uma das datas (foto mais antiga: ' + oldest.tab + ')' });
      if (fA.tab === fB.tab) return res.status(422).json({ success: false, error: 'As duas datas resolvem para a mesma foto (' + fA.tab + ') | escolha datas mais distantes' });

      const [rowsA, rowsB, manual] = await Promise.all([_readFotoRows(fA), _readFotoRows(fB), _readManual()]);
      if (!rowsA.length || !rowsB.length) return res.status(404).json({ success: false, error: 'Foto vazia' });

      const snapA = FC.computeSnapshot(FC.mapFotoDeals(_rowsToObjs(rowsA)), fA.refDate, manual);
      const snapB = FC.computeSnapshot(FC.mapFotoDeals(_rowsToObjs(rowsB)), fB.refDate, manual);
      const byA = {}; snapA.stages.forEach(s => { byA[s.key] = s; });
      const waterfall = snapB.stages.map(s => {
        const pa = byA[s.key] || {};
        return {
          key: s.key, label: s.label,
          a: { prob12: pa.prob12 || 0, real12: pa.real12 || 0, probTotal: pa.probTotal || 0, realTotal: pa.realTotal || 0 },
          b: { prob12: s.prob12, real12: s.real12, probTotal: s.probTotal, realTotal: s.realTotal },
          delta: { prob12: s.prob12 - (pa.prob12 || 0), real12: s.real12 - (pa.real12 || 0), probTotal: s.probTotal - (pa.probTotal || 0), realTotal: s.realTotal - (pa.realTotal || 0) },
        };
      });
      const sumDelta = waterfall.reduce((x, w) => x + w.delta.prob12, 0);
      const invariantOk = Math.abs(sumDelta - (snapB.totals.prob12 - snapA.totals.prob12)) < 0.01;

      return res.status(200).json({
        success: true,
        measure: 'prob12',   // headline: Receita Probabilizada, TCV(12M) rolante
        a: { requested: a, resolvedTab: fA.tab, tipo: fA.tipo, refDate: fA.refDate, kpis: snapA.kpis, totals: snapA.totals },
        b: { requested: b, resolvedTab: fB.tab, tipo: fB.tipo, refDate: fB.refDate, kpis: snapB.kpis, totals: snapB.totals },
        funnel: { stages: snapB.funnelStages, a: snapA.stageCounts, b: snapB.stageCounts },
        waterfall,
        totals: { a: snapA.totals, b: snapB.totals, deltaProb12: snapB.totals.prob12 - snapA.totals.prob12 },
        invariant: { sumStageDeltaProb12: sumDelta, totalDeltaProb12: snapB.totals.prob12 - snapA.totals.prob12, ok: invariantOk },
        dealDiff: FC.dealDiff(snapA.scopedDeals, snapB.scopedDeals).counts,
        caveats: [
          'Probabilidades por etapa e faturamento manual usam o estado ATUAL (não snapshotado) | Fase 1',
          'Ganho/Implantação depende do faturamento manual (gate: vencimento ≤ data da foto) | em datas anteriores ao início do faturamento a etapa aparece subestimada — não é erro, é fidelidade ponto-no-tempo',
        ],
      });
    }

    if (action === 'compare-drill') {
      const a = params.get('a'); const b = params.get('b'); const row = params.get('row');
      const measure = params.get('measure') || 'prob12';
      if (!a || !b || !row) return res.status(400).json({ success: false, error: 'informe ?a=&b=&row=' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return res.status(400).json({ success: false, error: 'datas devem estar no formato YYYY-MM-DD' });
      if (!(b > a)) return res.status(400).json({ success: false, error: 'Data B deve ser posterior a Data A' });
      const fotos = await _listFotos();
      const fA = _resolveFoto(fotos, a); const fB = _resolveFoto(fotos, b);
      if (!fA || !fB) return res.status(422).json({ success: false, error: 'Sem foto em ou antes de uma das datas' });
      if (fA.tab === fB.tab) return res.status(422).json({ success: false, error: 'As duas datas resolvem para a mesma foto' });
      const [rowsA, rowsB, manual] = await Promise.all([_readFotoRows(fA), _readFotoRows(fB), _readManual()]);
      const mappedB = FC.mapFotoDeals(_rowsToObjs(rowsB));
      // etapa bruta de cada deal em B (inclui Perdido/Ganho/fora de escopo) → destino de quem saiu
      const rawBStageById = {}; mappedB.forEach(d => { rawBStageById[FC.dealId(d)] = d.stage; });
      const cA = FC.dealContributions(FC.mapFotoDeals(_rowsToObjs(rowsA)), fA.refDate, manual);
      const cB = FC.dealContributions(mappedB, fB.refDate, manual);
      const drill = FC.drillRow(cA, cB, row, measure, rawBStageById);
      return res.status(200).json({ success: true, a: fA.tab, b: fB.tab, row: drill.rowKey, measure: drill.measure, sumDelta: drill.sumDelta, deals: drill.deals });
    }

    if (action === 'snapshot' && tab) {
      // FIX 2026-07-16 (alerta do Pacheco): a tela de "comparação com foto" do
      // /forecast lê os deals de uma foto via action=snapshot&tab=<data>. Ao ligar
      // o BQ, a lista de fotos passa a vir do BQ (datas 'YYYY-MM-DD'); se este
      // handler só olhasse o Sheet, não acharia a aba e a tela quebraria. Então:
      // BQ daily (cobre qualquer data) → BQ weekly → Sheet (fallback).
      let rows = [];
      if (bq.isConfigured() && /^\d{4}-\d{2}-\d{2}$/.test(tab)) {
        try {
          rows = await bq.readSnapshotRows(tab, bq.TABLE_DAILY);
          if (rows.length <= 1) rows = await bq.readSnapshotRows(tab, bq.TABLE_WEEKLY);
        } catch (e) { console.error('[history][snapshot bq]', e.message); rows = []; }
      }
      if (rows.length <= 1) {
        try { rows = await readSnapshot(tab); } catch (e) { rows = []; }
      }
      if (rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Foto não encontrada (BQ nem planilha): ' + tab });
      }
      const headers = rows[0];
      const deals   = rows.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
        return obj;
      });
      return res.status(200).json({ success: true, tab, deals });
    }

    if (action === 'owner-history') {
      const id = params.get('id');
      if (!id) return res.status(400).json({ success: false, error: 'informe ?id=<dealId>' });
      let token;
      try { token = getHubspotToken(); } catch (e) { return res.status(503).json({ success: false, error: e.message }); }
      const [deal, owners] = await Promise.all([
        hubGet(token, '/crm/v3/objects/deals/' + encodeURIComponent(id) + '?propertiesWithHistory=hubspot_owner_id'),
        fetchOwnersMap(token),
      ]);
      const raw = (deal.propertiesWithHistory && deal.propertiesWithHistory.hubspot_owner_id) || [];
      const timeline = raw.map(h => ({   // HubSpot devolve mais recente primeiro
        ownerId: h.value || null,
        owner: h.value ? (owners[h.value] || ('ID ' + h.value)) : '—',
        date: histDateStr(h.timestamp),
        source: h.sourceType || null,
      }));
      // Colapsa trocas consecutivas para o mesmo dono → períodos distintos de posse.
      // current = dono atual (topo); previous = proprietários antigos, do mais recente ao mais antigo.
      const dedup = timeline.filter((e, i) => i === 0 || e.ownerId !== timeline[i - 1].ownerId);
      return res.status(200).json({ success: true, id, current: dedup[0] || null, history: timeline, previous: dedup.slice(1) });
    }

    return res.status(400).json({ success: false, error: 'action inválido. Use ?action=tabs ou ?action=snapshot&tab=...' });

  } catch (e) {
    console.error('[history]', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};
