'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const apiUrl = process.env.NO_SHOW_API_URL || 'http://localhost:3002/api/forecast-table?includeLost=true&includeContext=true';
const telemetryDir = process.env.NO_SHOW_TELEMETRY_DIR || path.resolve(root, '../../..', '80_System', 'Telemetry');
const telemetryFile = path.join(telemetryDir, 'no_show_release_gate.jsonl');
const tempFile = path.join(os.tmpdir(), `axenya-no-show-gate-${process.pid}.json`);
const startedAt = Date.now();
const event = {
  schema_version: 1,
  gate: 'bdr-no-show-release',
  timestamp: new Date().toISOString(),
  status: 'error',
  commit: null,
  branch: null,
  node: process.version,
  checks: {},
};

function sha(value) { return crypto.createHash('sha256').update(value || '').digest('hex'); }

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function run(label, command, args, options) {
  const start = Date.now();
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', env: process.env, maxBuffer: 20 * 1024 * 1024, ...(options || {}) });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  process.stdout.write(output);
  event.checks[label] = {
    status: result.status === 0 ? 'pass' : 'fail',
    exit_code: result.status,
    duration_ms: Date.now() - start,
    output_sha256: sha(output),
  };
  if (result.status !== 0) throw new Error(`${label} falhou com exit ${result.status}`);
  return result.stdout || '';
}

function audit(label, from, to) {
  const raw = run(label, process.execPath, ['scripts/audit-bdr-no-show.js', '--api-file', tempFile, '--from', from, '--to', to]);
  const parsed = JSON.parse(raw);
  event.checks[label].metrics = {
    canonical_meetings: parsed.canonical_meetings,
    excluded_outside_roster: parsed.excluded_outside_roster,
    coverage_pct: parsed.metrics.coverage_pct,
    incidence_pct: parsed.metrics.incidence_pct,
    open_no_shows: parsed.metrics.open_no_shows,
    outside_sla: parsed.metrics.outside_sla,
    invariants_pass: Object.values(parsed.invariants).every(Boolean),
  };
}

async function main() {
  event.commit = git(['rev-parse', 'HEAD']);
  event.branch = git(['branch', '--show-current']);

  const response = await fetch(apiUrl, { headers: { Accept: 'application/json' } });
  const body = await response.text();
  event.checks.api_local = {
    status: response.ok ? 'pass' : 'fail',
    http_status: response.status,
    output_sha256: sha(body),
  };
  if (!response.ok) throw new Error(`api_local retornou HTTP ${response.status}`);
  const payload = JSON.parse(body);
  if (!payload.success || !Array.isArray(payload.deals)) throw new Error('api_local retornou payload inválido');
  fs.writeFileSync(tempFile, body, { encoding: 'utf8', mode: 0o600 });

  run('npm_check', 'npm', ['run', 'check']);
  audit('audit_since_mar_2026', '2026-03-01', new Date().toISOString().slice(0, 10));
  const from30 = new Date();
  from30.setDate(from30.getDate() - 30);
  audit('audit_last_30d', from30.toISOString().slice(0, 10), new Date().toISOString().slice(0, 10));
  run('browser_smoke', 'npm', ['run', 'smoke:no-show']);
  event.status = 'success';
}

main().catch(error => {
  event.error = error.message;
  process.exitCode = 1;
}).finally(() => {
  event.duration_ms = Date.now() - startedAt;
  try { fs.unlinkSync(tempFile); } catch (_) {}
  fs.mkdirSync(telemetryDir, { recursive: true });
  fs.appendFileSync(telemetryFile, `${JSON.stringify(event)}\n`, 'utf8');
  console.log(`[no-show-gate] ${event.status.toUpperCase()} | telemetry=${telemetryFile}`);
});
