'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const value = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const input = value('--api-file');
if (!input) throw new Error('Use --api-file <resposta-json> [--from yyyy-mm-dd] [--to yyyy-mm-dd]');

const context = {
  console,
  window: {},
  document: { addEventListener() {}, getElementById() { return null; }, documentElement: { getAttribute() { return 'dark'; }, setAttribute() {} } },
  localStorage: { getItem() { return null; }, setItem() {} },
  setTimeout,
  clearTimeout,
  Date,
  Math,
  Array,
  Object,
  String,
  Number,
  RegExp,
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'public', 'semantic-ref.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'public', 'bdr-no-show.js'), 'utf8'), context);
const T = context.window.NoShowBDR._test;
const payload = JSON.parse(fs.readFileSync(input, 'utf8'));
const from = value('--from') || '2026-03-01';
const to = value('--to') || new Date().toISOString().slice(0, 10);
const raw = (payload.deals || []).filter(d => d.data_reuniao_agendada >= from && d.data_reuniao_agendada <= to);
const normalized = raw.map(T.normalizeDeal);
const canonical = normalized.filter(r => r.isCanonicalBdr);
const excluded = normalized.filter(r => !r.isCanonicalBdr);
const metrics = T.metrics(canonical);
const recovery = canonical.filter(r => r.openNoShow);
const outside = canonical.filter(r => r.outsideSla);

assert.strictEqual(outside.length, recovery.filter(r => r.outsideSla).length);
assert.ok(outside.every(r => r.stage !== 'Perdido' && !r.recovered && !r.rescheduled));
assert.ok(canonical.every(r => T.bdrRoster().includes(r.bdr)));
assert.ok(metrics.noShows <= metrics.knownOutcomes);

const byBdr = T.bdrRoster().map(name => {
  const rows = canonical.filter(r => r.bdr === name);
  const known = rows.filter(r => r.knownOutcome).length;
  const noShows = rows.filter(r => r.noShow).length;
  const open = rows.filter(r => r.openNoShow).length;
  const out = rows.filter(r => r.outsideSla).length;
  return {
    name,
    scheduled: rows.length,
    known,
    coverage_pct: rows.length ? +(known / rows.length * 100).toFixed(1) : null,
    no_shows_historical: noShows,
    incidence_pct: known ? +(noShows / known * 100).toFixed(1) : null,
    open,
    outside_sla: out,
  };
});

console.log(JSON.stringify({
  period: { from, to },
  input_meetings: raw.length,
  canonical_meetings: canonical.length,
  excluded_outside_roster: excluded.length,
  metrics: {
    known_outcomes: metrics.knownOutcomes,
    coverage_pct: canonical.length ? +(metrics.knownOutcomes / canonical.length * 100).toFixed(1) : null,
    no_shows_historical: metrics.noShows,
    incidence_pct: metrics.knownOutcomes ? +(metrics.noShows / metrics.knownOutcomes * 100).toFixed(1) : null,
    open_no_shows: metrics.openNoShows,
    outside_sla: metrics.outsideSla,
    recovered: metrics.recovered,
  },
  invariants: {
    outside_sla_reconciles_recovery_table: true,
    no_ae_as_bdr: true,
    outside_sla_excludes_closed_states: true,
  },
  by_bdr: byBdr,
}, null, 2));
