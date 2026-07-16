'use strict';
/**
 * Reconstrói fotos semanais passadas via HubSpot propertiesWithHistory e grava
 * na planilha legada. A lógica point-in-time vive em lib/snapshot-history.js e
 * é a mesma usada pelo backfill HubSpot -> BQ.
 *
 * Uso: node scripts/reconstruct-weekly.js YYYY-MM-DD [YYYY-MM-DD ...]
 */

const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..');

if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_SA_KEY_FILE) {
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = fs.readFileSync(process.env.GOOGLE_SA_KEY_FILE, 'utf8');
}
if (!process.env.HUBSPOT_TOKEN) {
  const p = path.join(REPO, '.env.local');
  if (fs.existsSync(p)) {
    const line = fs.readFileSync(p, 'utf8').split(/\r?\n/).find(l => l.startsWith('HUBSPOT_TOKEN='));
    if (line) process.env.HUBSPOT_TOKEN = line.slice('HUBSPOT_TOKEN='.length).trim().replace(/^['"]|['"]$/g, '');
  }
}

const sheets = require('../lib/sheets');
const H = require('../lib/snapshot-history');

(async () => {
  const days = process.argv.slice(2);
  if (!days.length || days.some(d => !/^\d{4}-\d{2}-\d{2}$/.test(d))) {
    throw new Error('Uso: node scripts/reconstruct-weekly.js YYYY-MM-DD [YYYY-MM-DD ...]');
  }
  if (!process.env.HUBSPOT_TOKEN) throw new Error('HUBSPOT_TOKEN nao configurado');

  const loaded = await H.loadHistory(process.env.HUBSPOT_TOKEN, () => process.stdout.write('.'));
  process.stdout.write('\n');
  const today = new Date().toISOString().substring(0, 10);
  for (const day of days) {
    const existing = await sheets.readSnapshot(day).catch(() => []);
    if (existing.length > 0) { console.log('[' + day + '] PULADA: aba ja existe.'); continue; }
    const label = 'reconstruida em ' + today + ' via historico HubSpot | corte ' + day + ' 23:59 BRT';
    const rows = H.buildRows(loaded.ids, loaded.hist, loaded.ownerMap, H.cutoffForDay(day), label);
    for (let i = 0; i < rows.length; i += 400) {
      await sheets.writeMonthlySnapshot(day, H.HEADERS, rows.slice(i, i + 400));
    }
    console.log('[' + day + '] gravada: ' + rows.length + ' deals, ' + H.HEADERS.length + ' colunas.');
  }
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
