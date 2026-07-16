'use strict';
/**
 * Backfill historico HubSpot API -> BigQuery Forecast.
 * NUNCA usa Google Sheets como fonte. Sheets e apenas sanity check externo.
 *
 * Uso:
 *   node scripts/backfill-hubspot-bq.js --from 2026-05-12 --to 2026-07-16 \
 *     --gold-dates 2026-05-12,2026-06-05
 *   VERCEL_ENV=production ...  # somente com aprovacao explicita
 */

const fs = require('fs');
const path = require('path');
const bq = require('../lib/bigquery');
const H = require('../lib/snapshot-history');

function loadLocalEnv() {
  const p = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (!m || process.env[m[1]]) return;
    process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  });
}

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }
function isFriday(day) { return new Date(day + 'T00:00:00Z').getUTCDay() === 5; }
function isMonthEnd(day) { const d = new Date(day + 'T00:00:00Z'); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).getUTCDate() === 1; }

(async () => {
  loadLocalEnv();
  const from = arg('--from'), to = arg('--to');
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) {
    throw new Error('Uso: --from YYYY-MM-DD --to YYYY-MM-DD');
  }
  if (!process.env.HUBSPOT_TOKEN) throw new Error('HUBSPOT_TOKEN nao configurado');
  if (!bq.isConfigured()) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON nao configurado');
  if (/_prd$/.test(bq.dataset()) && !process.argv.includes('--allow-prod')) {
    throw new Error('Backfill em PRD exige --allow-prod explicito');
  }
  const goldExtra = new Set(String(arg('--gold-dates') || '').split(',').filter(Boolean));

  await bq.ensureTables();
  console.log('[backfill] origem=HubSpot API | dataset=' + bq.dataset() + ' | ' + from + '..' + to);
  let lastPct = -1;
  const loaded = await H.loadHistory(process.env.HUBSPOT_TOKEN, (done, total) => {
    const pct = Math.floor(done / total * 10) * 10;
    if (pct !== lastPct) { process.stdout.write('[HubSpot history] ' + pct + '%\n'); lastPct = pct; }
  });
  console.log('[backfill] deals atuais encontrados=' + loaded.ids.length);

  for (const day of H.dateRange(from, to)) {
    const label = 'reconstruida via historico HubSpot | corte ' + day + ' 23:59 BRT';
    const rows = H.buildRows(loaded.ids, loaded.hist, loaded.ownerMap, H.cutoffForDay(day), label);
    const dailyCount = await bq.snapshotCount(day, bq.TABLE_DAILY);
    if (dailyCount === 0) {
      await bq.insertSnapshotRows(day, 'diario', rows, null, bq.TABLE_DAILY, H.HEADERS);
    } else if (dailyCount !== rows.length) {
      throw new Error(day + ' daily PARCIAL: existente=' + dailyCount + ' esperado=' + rows.length + ' | recusa skip silencioso');
    }
    const gold = isFriday(day) || isMonthEnd(day) || goldExtra.has(day);
    if (gold) {
      const goldCount = await bq.snapshotCount(day, bq.TABLE_WEEKLY);
      if (goldCount === 0) {
        await bq.insertSnapshotRows(day, isMonthEnd(day) ? 'mensal' : 'semanal', rows, null, bq.TABLE_WEEKLY, H.HEADERS);
      } else if (goldCount !== rows.length) {
        throw new Error(day + ' weekly PARCIAL: existente=' + goldCount + ' esperado=' + rows.length + ' | recusa skip silencioso');
      }
    }
    console.log(day + ' | daily=' + rows.length + (gold ? ' | gold=sim' : ''));
  }
})().catch(e => { console.error('[backfill] ERRO:', e.message); process.exit(1); });
