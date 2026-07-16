'use strict';
/**
 * migrate-fotos-to-bq.js — Migra as fotos historicas do Google Sheet para o BQ.
 *
 * Uma vez so: pega cada aba de foto ja existente na planilha (semanais
 * "YYYY-MM-DD" + mensais "Mmm AAAA" desde jun/2026) e grava como linhas na
 * tabela BQ forecast_snapshots, preservando as 36 colunas 1:1. A data do
 * snapshot segue a MESMA regra do _listFotos do api/history.js (mensal ->
 * dia 15 do mes) para nao mudar a semantica de resolucao de foto.
 *
 * Idempotente: pula datas que ja existem no BQ (dedup por insertId tambem cobre
 * reexecucao). Nao escreve no Sheet, so le.
 *
 * Uso:
 *   GOOGLE_SERVICE_ACCOUNT_JSON=... node scripts/migrate-fotos-to-bq.js [--dry-run]
 *   VERCEL_ENV=production forca dataset _prd (default local = _dev).
 */

const sheets = require('../lib/sheets');
const bq = require('../lib/bigquery');

const MESES = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };

// Espelha _listFotos() do api/history.js: tab -> { tab, tipo, snapshotDate }.
function fotosFromTabs(tabs) {
  const fotos = [];
  tabs.forEach((t) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) { fotos.push({ tab: t, tipo: 'semanal', snapshotDate: t }); return; }
    const m = t.match(/^([A-Za-zÀ-ÿ]{3}) (\d{4})$/);
    if (m) {
      const mo = MESES[m[1].toLowerCase()];
      if (mo == null) return;
      const ym = m[2] + '-' + String(mo + 1).padStart(2, '0');
      const ord = ym + '-31';
      if (ord >= '2026-06-01') fotos.push({ tab: t, tipo: 'mensal', snapshotDate: ym + '-15' });
    }
  });
  fotos.sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  return fotos;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (!bq.isConfigured()) { console.error('ERRO: GOOGLE_SERVICE_ACCOUNT_JSON nao configurado.'); process.exit(1); }

  console.log('[migrate] dataset destino:', bq.dataset(), '| dry-run:', dryRun);
  await bq.ensureTables();

  const tabs = await sheets.listTabs();
  const fotos = fotosFromTabs(tabs);
  console.log('[migrate] fotos encontradas no Sheet:', fotos.map((f) => f.tab + '=>' + f.snapshotDate).join(', '));

  const jaDaily = dryRun ? [] : (await bq.listSnapshotDates(bq.TABLE_DAILY)).map((r) => r.tab);
  const jaWeekly = dryRun ? [] : (await bq.listSnapshotDates(bq.TABLE_WEEKLY)).map((r) => r.tab);
  let migradas = 0, puladas = 0;

  for (const f of fotos) {
    const emDaily = jaDaily.indexOf(f.snapshotDate) !== -1;
    const emWeekly = jaWeekly.indexOf(f.snapshotDate) !== -1;
    if (emDaily && emWeekly) { console.log('[skip] ' + f.tab + ' (' + f.snapshotDate + ' ja em daily+weekly)'); puladas++; continue; }
    const rows = await sheets.readSnapshot(f.tab);          // [[HEADERS],[...deal rows...]]
    if (!rows.length || rows.length < 2) { console.log('[skip] ' + f.tab + ' (vazia)'); puladas++; continue; }
    const header = rows[0];
    if (header.length !== bq.NUM_COLS) {
      console.log('[skip] ' + f.tab + ' (colunas=' + header.length + ' != ' + bq.NUM_COLS + ' | formato legado, fora do escopo)');
      puladas++; continue;
    }
    const dealRows = rows.slice(1);
    console.log('[migrate] ' + f.tab + ' -> ' + f.snapshotDate + ' (' + dealRows.length + ' deals)' + (dryRun ? ' [DRY]' : ''));
    if (!dryRun) {
      if (!emDaily) { const r = await bq.insertSnapshotRows(f.snapshotDate, f.tipo, dealRows, null, bq.TABLE_DAILY); console.log('        daily +' + r.inserted); }
      if (!emWeekly) { const r = await bq.insertSnapshotRows(f.snapshotDate, f.tipo, dealRows, null, bq.TABLE_WEEKLY); console.log('        weekly +' + r.inserted); }
    }
    migradas++;
  }

  console.log('[migrate] concluido | migradas=' + migradas + ' puladas=' + puladas);
}

main().catch((e) => { console.error('[migrate] FALHOU:', e.message); process.exit(1); });
