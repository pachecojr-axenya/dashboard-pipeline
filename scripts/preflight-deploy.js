'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EXPECTED_ORIGIN = 'github.com/pachecojr-axenya/dashboard-pipeline';
const EXPECTED_PROJECT_ID = 'prj_WlrmzEWZ9LXoRgeUCzy125UDlYLS';
const EXPECTED_ORG_ID = 'team_kMpQxhA68GkDKY9ZxS2vn7Ge';

const REQUIRED_PATHS = [
  'api/bdr-leads.js',
  'api/bdr-list-attack.js',
  'api/forecast-table.js',
  'public/bdr.html',
  'public/bdr-no-show.html',
  'public/bdr-no-show.js',
  'public/bdr-list-attack.html',
  'public/bdr-list-attack.js',
  'public/forecast.html',
  'public/revenue-engine.js',
  'public/premium.js',
  'vercel.json',
];

const REQUIRED_ROUTES = [
  '"/novo-bdr/no-show"',
  '"/novo-bdr/list-attack"',
  '"/dashboard/bdr/no-show"',
  '"/dashboard/bdr/list-attack"',
];

const FORBIDDEN_TRACKED_PATHS = [
  '.env',
  '.env.local',
  '.vercel/project.json',
  '.claude/settings.local.json',
  'lib/credentials.json',
];

function fail(msg) {
  console.error(`\n[deploy-preflight] FAIL | ${msg}`);
  process.exit(1);
}

function sh(args) {
  return execFileSync(args[0], args.slice(1), { cwd: ROOT, encoding: 'utf8' }).trim();
}

function relExists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function main() {
  const origin = sh(['git', 'remote', 'get-url', 'origin']);
  if (!origin.includes(EXPECTED_ORIGIN)) fail(`origin incorreto: ${origin}`);

  const branch = sh(['git', 'rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') fail(`branch atual é ${branch}; deploy canônico exige main`);

  const status = sh(['git', 'status', '--porcelain']);
  if (status) fail('working tree suja. Commit/stash antes de deployar.');

  const head = sh(['git', 'rev-parse', 'HEAD']);
  const upstream = sh(['git', 'rev-parse', 'origin/main']);
  if (head !== upstream) fail(`HEAD (${head.slice(0, 7)}) difere de origin/main (${upstream.slice(0, 7)})`);

  REQUIRED_PATHS.forEach(rel => { if (!relExists(rel)) fail(`arquivo obrigatório ausente: ${rel}`); });

  const vercelJson = fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8');
  REQUIRED_ROUTES.forEach(route => { if (!vercelJson.includes(route)) fail(`rewrite obrigatório ausente em vercel.json: ${route}`); });

  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  if (packageJson.dependencies && Object.keys(packageJson.dependencies).length) fail('dependências runtime inesperadas; este projeto deve permanecer zero-deps.');

  const tracked = new Set(sh(['git', 'ls-files']).split(/\n/).filter(Boolean));
  FORBIDDEN_TRACKED_PATHS.forEach(rel => { if (tracked.has(rel)) fail(`arquivo sensível trackeado: ${rel}`); });

  const projectPath = path.join(ROOT, '.vercel', 'project.json');
  if (fs.existsSync(projectPath)) {
    const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
    if (project.projectId !== EXPECTED_PROJECT_ID) fail(`Vercel projectId incorreto: ${project.projectId}`);
    if (project.orgId !== EXPECTED_ORG_ID) fail(`Vercel orgId incorreto: ${project.orgId}`);
  } else {
    console.warn('[deploy-preflight] WARN | .vercel/project.json ausente; ok em CI, mas CLI local precisa estar linkado ao projeto canônico.');
  }

  console.log(`[deploy-preflight] PASS | origin/main ${head.slice(0, 7)} | projeto canônico ok`);
}

main();
