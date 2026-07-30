'use strict';
/**
 * backfill-snapshot-config.js — sidecar RETROATIVO para fotos anteriores à Fase 2.
 *
 * As fotos históricas não têm config sidecar → o Δ convicção delas cai no fallback
 * flagado. Este script reconstrói a config de avaliação de cada data com regras de
 * resgate HONESTAS (cada componente diz de onde veio; o que não é reconstruível é
 * marcado, nunca inventado):
 *
 *   1. stageProb — do GIT: `git show <commit>:semantic/referencia.json` do último
 *      commit ≤ D (fim do dia). Linha do tempo: até 2026-07-14 o painel usava a
 *      régua painel_default (aposentada em 2026-07-15, D4/ADR-008 → forecast_flat
 *      única). Regra mecânica: painel_default sendo OBJETO no catálogo da época →
 *      é ela; aposentada (string) → forecast_flat. Datas anteriores ao catálogo
 *      (< 2026-07-14) usam o primeiro commit (8976175), que documentou a régua
 *      então vigente. Chaves ausentes na painel_default (ex.: Reunião Agendada)
 *      são completadas pela forecast_flat DA ÉPOCA (o motor precisa delas).
 *   2. probManual — só entradas com data ≤ D (campo `by` "Nome | AAAA-MM-DD" ou
 *      `at`). Sem data → excluída e logada.
 *   3. faturamentoManual — estado ATUAL do KV com `backfilled_partial: true`
 *      (histórico não existe; decisão consciente).
 *
 * Datas-alvo: BQ weekly_gold + daily (listSnapshotDates) + abas legadas do Sheets
 * (semanais YYYY-MM-DD e mensais "Mmm AAAA" → data de CAPTURA real = fim do mês).
 *
 * Escrita: lib/snapshot-config.saveRaw com source 'backfill:<data-do-resgate>' —
 * idempotente por data (NUNCA sobrescreve sidecar capturado ao vivo).
 *
 * Uso:
 *   node scripts/backfill-snapshot-config.js            # dry-run (imprime o plano)
 *   node scripts/backfill-snapshot-config.js --apply    # grava
 *   (dataset alvo segue lib/env.js: local = _dev; produção exige NODE_ENV=production)
 */
const { execSync } = require('child_process');
const bq = require('../lib/bigquery');
const env = require('../lib/env');
const snapshotConfig = require('../lib/snapshot-config');
const PM = require('../lib/prob-manual');
const kv = require('../lib/kv');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const RESCUE_DATE = new Date().toISOString().slice(0, 10);
const CATALOG_FIRST_COMMIT = '8976175'; // Fase 1 do catálogo (2026-07-14) — documenta a régua pré-existente
const MESES = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };

function log(s) { console.log(s); }

// ── 1. stageProb da época (git) ──────────────────────────────────────────────
const _rulerCache = {};
function stageProbAt(date) {
  if (_rulerCache[date]) return _rulerCache[date];
  let commit = '';
  try {
    commit = execSync('git log -1 --format=%h --until="' + date + ' 23:59" -- semantic/referencia.json', { encoding: 'utf8' }).trim();
  } catch (e) { /* sem git → cai no primeiro commit */ }
  if (!commit) commit = CATALOG_FIRST_COMMIT;
  const raw = execSync('git show ' + commit + ':semantic/referencia.json', { encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 });
  const ref = JSON.parse(raw);
  const reguas = ref.reguas_probabilidade || ref.reguas || {};
  const flat = (reguas.forecast_flat && reguas.forecast_flat.valores) || {};
  const painel = reguas.painel_default;
  const painelVals = (painel && typeof painel === 'object') ? (painel.valores || painel) : null;
  const usePainel = !!painelVals;   // objeto = vigente na época; string = aposentada (>= 2026-07-15)
  // painel_default não cobre todas as etapas do motor (ex.: Reunião Agendada) →
  // completa com a forecast_flat DA MESMA época.
  const merged = usePainel ? Object.assign({}, flat, painelVals) : Object.assign({}, flat);
  const out = { commit, rulerKey: usePainel ? 'painel_default' : 'forecast_flat', stageProb: merged };
  _rulerCache[date] = out;
  return out;
}

// ── 2. probManual da época (entradas datadas ≤ D) ───────────────────────────
function entryDate(e) {
  if (e && typeof e.by === 'string') { const m = e.by.match(/\|\s*(\d{4}-\d{2}-\d{2})/); if (m) return m[1]; }
  if (e && typeof e.at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(e.at)) return e.at.slice(0, 10);
  return null;
}
function probManualAt(date, allEntries, warnings) {
  const out = {};
  Object.keys(allEntries).forEach(id => {
    const e = allEntries[id];
    const d = entryDate(e);
    if (!d) { warnings.push('probManual ' + id + ' SEM DATA (by/at) → excluído de todas as datas'); return; }
    if (d <= date) out[id] = e;
  });
  return out;
}

// ── 3. faturamento manual (estado atual, marcado parcial) ────────────────────
async function faturamentoAtual() {
  if (kv.isConfigured && kv.isConfigured()) {
    try { const v = await kv.getJSON('forecast:faturamento_manual'); if (v && typeof v === 'object') return v; } catch (e) { /* vazio */ }
  }
  try { const j = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'faturamento-manual.json'), 'utf8')); if (j && typeof j === 'object') return j; } catch (e) { /* sem arquivo */ }
  return {};
}

// ── Datas-alvo ───────────────────────────────────────────────────────────────
function monthEnd(ym) { const last = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate(); return ym + '-' + String(last).padStart(2, '0'); }
async function targetDates() {
  const dates = new Set();
  if (bq.isConfigured()) {
    for (const tbl of [bq.TABLE_WEEKLY, bq.TABLE_DAILY]) {
      try { (await bq.listSnapshotDates(tbl)).forEach(d => { if (/^\d{4}-\d{2}-\d{2}$/.test(d.tab)) dates.add(d.tab); }); }
      catch (e) { log('  ⚠ BQ ' + tbl + ' indisponível: ' + e.message.slice(0, 120)); }
    }
  }
  try {
    const { listTabs } = require('../lib/sheets');
    (await listTabs()).forEach(t => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(t)) { dates.add(t); return; }
      const m = t.match(/^([A-Za-zÀ-ÿ]{3}) (\d{4})$/);
      if (m) {
        const mo = MESES[m[1].toLowerCase()];
        if (mo == null) return;
        const ym = m[2] + '-' + String(mo + 1).padStart(2, '0');
        if (ym >= '2026-06') dates.add(monthEnd(ym));   // captura REAL = fim do mês, não o refDate dia-15
      }
    });
  } catch (e) { log('  ⚠ Sheets indisponível: ' + e.message.slice(0, 120)); }
  return [...dates].sort();
}

(async () => {
  log('== backfill-snapshot-config | ' + (APPLY ? 'APPLY' : 'DRY-RUN') + ' ==');
  log('ambiente: ' + env.name + ' | dataset BQ alvo: ' + (bq.isConfigured() ? env.forecastDataset() : '(BQ off → /tmp)'));
  const dates = await targetDates();
  if (!dates.length) { log('Nenhuma data-alvo encontrada.'); process.exit(1); }
  log('datas-alvo (' + dates.length + '): ' + dates.join(', ') + '\n');

  const allManual = await PM.readAll();
  const fm = await faturamentoAtual();
  const globalWarn = new Set();
  let saved = 0, skipped = 0;

  for (const date of dates) {
    const warnings = [];
    const ruler = stageProbAt(date);
    const pm = probManualAt(date, allManual, warnings);
    warnings.forEach(w => globalWarn.add(w));
    const cfg = {
      stageProb: ruler.stageProb,
      probManual: pm,
      faturamentoManual: Object.assign({}, fm),
      backfilled_partial: true,   // faturamento manual = estado atual (histórico não existe)
      backfill: { rescuedAt: RESCUE_DATE, rulerKey: ruler.rulerKey, rulerCommit: ruler.commit },
      savedAt: new Date().toISOString(),
      source: 'backfill:' + RESCUE_DATE,
    };
    const pmIds = Object.keys(pm);
    log(date + ' | régua ' + ruler.rulerKey + '@' + ruler.commit
      + ' (Cotação ' + (ruler.stageProb['Cotação'] != null ? (ruler.stageProb['Cotação'] * 100).toFixed(1) + '%' : '—')
      + ', Implantação ' + (ruler.stageProb['Implantação'] != null ? (ruler.stageProb['Implantação'] * 100).toFixed(1) + '%' : '—') + ')'
      + ' | probManual: ' + (pmIds.length ? pmIds.join(',') : '(nenhum ≤ data)')
      + ' | fatManual: atual (parcial)');
    if (APPLY) {
      const r = await snapshotConfig.saveRaw(date, cfg);
      if (r.saved) { saved++; log('  → gravado'); }
      else { skipped++; log('  → pulado (' + (r.reason || r.error || '?') + ')'); }
    }
  }
  if (globalWarn.size) { log('\nAvisos:'); [...globalWarn].forEach(w => log('  ⚠ ' + w)); }
  log('\n' + (APPLY ? ('APPLY: ' + saved + ' gravado(s), ' + skipped + ' pulado(s) (idempotência preserva sidecars ao vivo).')
    : 'DRY-RUN: nada gravado. Rode com --apply para executar.'));
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
