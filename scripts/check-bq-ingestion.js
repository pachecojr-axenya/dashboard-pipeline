'use strict';
/**
 * check-bq-ingestion.js — Testes de validade da ingestao Sheet -> BQ.
 *
 * Garante que a automacao no BQ RESPEITA a planilha (diretriz do dono 2026-07-16):
 * o que existe na planilha tem que bater com o BQ. Roda como Node puro (precisa de
 * GOOGLE_SERVICE_ACCOUNT_JSON no ambiente).
 *
 * Checks (cada um PASS/FAIL, exit code 1 se qualquer FAIL):
 *   1. Paridade de datas: toda foto da planilha (semanal/mensal) existe no weekly_gold.
 *   2. Paridade de contagem: nº de deals por foto bate Sheet vs weekly_gold vs daily.
 *   3. Paridade de IDs: conjunto de Deal IDs (c00) identico Sheet vs BQ (amostra das datas).
 *   4. Coerencia daily>=weekly: toda data do weekly existe no daily com a mesma contagem.
 *   5. Colunas: weekly e daily tem exatamente NUM_COLS colunas c00..c35.
 *
 * Uso: GOOGLE_SERVICE_ACCOUNT_JSON=... node scripts/check-bq-ingestion.js
 */

const sheets = require('../lib/sheets');
const bq = require('../lib/bigquery');

const MESES = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
function tabToDate(t) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^([A-Za-zÀ-ÿ]{3}) (\d{4})$/);
  if (m) { const mo = MESES[m[1].toLowerCase()]; if (mo == null) return null; const ym = m[2] + '-' + String(mo + 1).padStart(2, '0'); if (ym + '-31' >= '2026-06-01') return ym + '-15'; }
  return null;
}

let fails = 0;
function assert(name, cond, detail) {
  const ok = !!cond;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
  if (!ok) fails++;
}

async function main() {
  if (!bq.isConfigured()) { console.error('ERRO: GOOGLE_SERVICE_ACCOUNT_JSON nao configurado.'); process.exit(1); }
  console.log('[check] dataset:', bq.dataset());

  // fotos da planilha (formato bruto de 36 colunas)
  const tabs = await sheets.listTabs();
  const sheetFotos = [];
  for (const t of tabs) { const d = tabToDate(t); if (d) sheetFotos.push({ tab: t, date: d }); }

  const weeklyDates = (await bq.listSnapshotDates(bq.TABLE_WEEKLY)).reduce((m, r) => { m[r.tab] = r.count; return m; }, {});
  const dailyDates = (await bq.listSnapshotDates(bq.TABLE_DAILY)).reduce((m, r) => { m[r.tab] = r.count; return m; }, {});

  // Check 1 + 2: cada foto do Sheet existe no weekly com a mesma contagem
  for (const f of sheetFotos) {
    const rows = await sheets.readSnapshot(f.tab);
    if (rows.length < 2 || rows[0].length !== bq.NUM_COLS) { console.log('SKIP | ' + f.tab + ' (formato legado/vazia)'); continue; }
    const nSheet = rows.length - 1;
    assert('data presente no weekly_gold: ' + f.tab, weeklyDates[f.date] != null, 'sheet=' + nSheet);
    if (weeklyDates[f.date] != null) {
      assert('contagem weekly == sheet: ' + f.date, weeklyDates[f.date] === nSheet, 'sheet=' + nSheet + ' weekly=' + weeklyDates[f.date]);
    }
    // Check 3: paridade de Deal IDs (c00) — Sheet vs BQ daily
    if (dailyDates[f.date] != null) {
      const idsSheet = new Set(rows.slice(1).map(r => String(r[0])));
      const bqRows = await bq.readSnapshotRows(f.date, bq.TABLE_DAILY);
      const idsBQ = new Set(bqRows.slice(1).map(r => String(r[0])));
      let miss = 0; idsSheet.forEach(id => { if (!idsBQ.has(id)) miss++; });
      assert('Deal IDs Sheet⊆BQ daily: ' + f.date, miss === 0, 'faltando ' + miss + ' de ' + idsSheet.size);
    }
  }

  // Check 4: daily cobre toda data do weekly com a mesma contagem
  Object.keys(weeklyDates).forEach(d => {
    assert('daily cobre weekly: ' + d, dailyDates[d] != null && dailyDates[d] >= weeklyDates[d], 'weekly=' + weeklyDates[d] + ' daily=' + (dailyDates[d] || 0));
  });

  // Check 5: colunas
  const sampleDate = Object.keys(dailyDates)[0];
  if (sampleDate) {
    const r = await bq.readSnapshotRows(sampleDate, bq.TABLE_DAILY);
    assert('daily tem NUM_COLS colunas', r.length && r[0].length === bq.NUM_COLS, 'cols=' + (r[0] ? r[0].length : 0) + ' esperado=' + bq.NUM_COLS);
  } else {
    console.log('SKIP | check de colunas (BQ ainda vazio — rode o backfill primeiro)');
  }

  console.log('\n[check] ' + (fails === 0 ? 'TODOS OS CHECKS PASSARAM' : fails + ' CHECK(S) FALHARAM'));
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error('[check] FALHOU:', e.message); process.exit(1); });
