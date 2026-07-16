'use strict';
/**
 * Sanity check independente: HubSpot->BQ versus fotos da planilha.
 * A planilha NUNCA e fonte de ingestao. Ela e apenas referencia externa.
 *
 * Requer:
 *   GOOGLE_SERVICE_ACCOUNT_JSON
 *   FORECAST_SANITY_SPREADSHEET_ID (clone/read-only autorizado para a SA growth)
 */

const sheets = require('../lib/sheets');
const bq = require('../lib/bigquery');

const SID = process.env.FORECAST_SANITY_SPREADSHEET_ID;
const FIELDS = ['Pipeline', 'Etapa', 'Vidas', 'ARR Estimado (R$)', 'Quarter', 'Data Prevista Receita', 'Closed Lost'];
// Anomalia conhecida da planilha reconstruida: deal em pipeline fora do escopo
// Vendas/Bid. O BQ filtra pelo pipeline historico correto e nao deve reproduzi-lo.
const SHEET_OUT_OF_SCOPE = { '2026-05-12': new Set(['36080066857']) };
let fails = 0;

function assert(name, cond, detail) {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
  if (!cond) fails++;
}
function objects(rows) {
  if (!rows || rows.length < 2) return [];
  const h = rows[0].map(x => String(x).trim());
  return rows.slice(1).map(r => { const o = {}; h.forEach((k, i) => { o[k] = r[i] == null ? '' : String(r[i]); }); return o; });
}
function byId(rows) { const out = {}; objects(rows).forEach(r => { if (r['Deal ID']) out[r['Deal ID']] = r; }); return out; }
function sameValue(a, b) {
  const x = String(a == null ? '' : a).trim(), y = String(b == null ? '' : b).trim();
  if (x === y) return true;
  if (/^(true|false)$/i.test(x) && /^(true|false)$/i.test(y)) return x.toLowerCase() === y.toLowerCase();
  if (/^-?\d+(?:\.\d+)?$/.test(x) && /^-?\d+(?:\.\d+)?$/.test(y)) return Math.abs(Number(x) - Number(y)) < 1e-9;
  return false;
}

async function main() {
  if (!SID) throw new Error('FORECAST_SANITY_SPREADSHEET_ID nao configurado');
  if (!bq.isConfigured()) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON nao configurado');
  console.log('[sanity] lineage=HubSpot API -> ' + bq.dataset() + ' | sheet=' + SID + ' (somente check)');

  const tabs = await sheets.listSpreadsheetTabs(SID);
  const photoTabs = tabs.filter(t => /^\d{4}-\d{2}-\d{2}$/.test(t)).sort();
  const weekly = Object.fromEntries((await bq.listSnapshotDates(bq.TABLE_WEEKLY)).map(x => [x.tab, x.count]));
  const daily = Object.fromEntries((await bq.listSnapshotDates(bq.TABLE_DAILY)).map(x => [x.tab, x.count]));

  for (const day of photoTabs) {
    const sheetRows = await sheets.readSpreadsheetRange(SID, `'${day}'!A:AZ`);
    if (sheetRows.length < 2 || sheetRows[0][0] !== 'Deal ID') { console.log('SKIP | ' + day + ' formato legado/vazio'); continue; }
    const bqRows = await bq.readSnapshotRows(day, bq.TABLE_DAILY);
    const sm = byId(sheetRows), bm = byId(bqRows);
    const ignored = SHEET_OUT_OF_SCOPE[day] || new Set();
    ignored.forEach(id => { if (sm[id]) delete sm[id]; });
    const sids = Object.keys(sm), bids = Object.keys(bm);
    const missingBQ = sids.filter(id => !bm[id]);
    const extraBQ = bids.filter(id => !sm[id]);

    assert(day + ' presente no weekly_gold', weekly[day] != null, 'weekly=' + (weekly[day] || 0));
    assert(day + ' daily e weekly iguais', daily[day] === weekly[day], 'daily=' + (daily[day] || 0) + ' weekly=' + (weekly[day] || 0));
    assert(day + ' contagem BQ == Sheet', bids.length === sids.length, 'BQ=' + bids.length + ' Sheet=' + sids.length);
    assert(day + ' Deal IDs match', missingBQ.length === 0 && extraBQ.length === 0,
      'faltam_no_BQ=' + missingBQ.length + ' extras_no_BQ=' + extraBQ.length);
    if (ignored.size) console.log('PASS | ' + day + ' excecao documentada fora de Vendas/Bid | ignorados=' + ignored.size);

    const common = sids.filter(id => bm[id]);
    for (const field of FIELDS) {
      let diffs = 0;
      for (const id of common) if (!sameValue(sm[id][field], bm[id][field])) diffs++;
      assert(day + ' campo ' + field, diffs === 0, 'divergencias=' + diffs + '/' + common.length);
    }
  }

  // Sanity diario: agrega o BQ deal-level e compara com "Historico Diario".
  const histRows = await sheets.readSpreadsheetRange(SID, "'Historico Diario'!A:O");
  const histObjs = objects(histRows), lastByDate = {};
  histObjs.forEach(r => { if (r.Data) lastByDate[r.Data] = r; }); // duplicata: ultima linha vence
  const namedStages = ['Reunião Agendada', 'Diagnóstico', 'Cotação', 'Proposta Enviada', 'Consultoria', 'Negociação', 'Implantação', 'Ganho', 'Perdido'];
  for (const day of Object.keys(lastByDate).sort()) {
    if (daily[day] == null) continue;
    const deals = objects(await bq.readSnapshotRows(day, bq.TABLE_DAILY));
    const byStage = {}, byPipe = {};
    deals.forEach(d => {
      byStage[d.Etapa] = (byStage[d.Etapa] || 0) + 1;
      byPipe[d.Pipeline] = (byPipe[d.Pipeline] || 0) + 1;
    });
    const expected = lastByDate[day];
    const actual = {
      'Total Deals': deals.length,
      'Standby': (byStage.Standby || 0) + (byStage['Stand by'] || 0),
      'Pipeline Vendas': byPipe.Vendas || 0,
      'Pipeline Bid': byPipe.Bid || 0,
    };
    namedStages.forEach(s => { actual[s] = byStage[s] || 0; });
    const known = new Set(namedStages.concat(['Standby', 'Stand by']));
    actual['Outras Etapas'] = Object.keys(byStage).filter(s => !known.has(s)).reduce((n, s) => n + byStage[s], 0);
    for (const field of ['Total Deals'].concat(namedStages, ['Standby', 'Outras Etapas', 'Pipeline Vendas', 'Pipeline Bid'])) {
      assert('diario ' + day + ' ' + field, sameValue(expected[field], actual[field]), 'BQ=' + actual[field] + ' Sheet=' + expected[field]);
    }
  }

  // Coerencia interna: toda foto gold tem correspondente daily com mesma contagem.
  Object.keys(weekly).forEach(day => {
    assert('gold coberto pelo daily ' + day, daily[day] === weekly[day], 'daily=' + (daily[day] || 0) + ' weekly=' + weekly[day]);
  });

  console.log('\n[sanity] ' + (fails ? 'FAIL: ' + fails + ' check(s)' : 'MATCH: TODOS OS CHECKS PASSARAM'));
  process.exit(fails ? 1 : 0);
}

main().catch(e => { console.error('[sanity] ERRO:', e.message); process.exit(1); });
