#!/usr/bin/env node
// Build a Sankey-style SVG of the full lead flow.
// Requires /tmp/live-deals.json and /tmp/stage-history.json populated
// by a prior HubSpot pull (see README at the bottom of this script).
'use strict';
const fs = require('fs');
const path = require('path');

const deals = require('/tmp/live-deals.json');
const hist  = require('/tmp/stage-history.json');

const STAGE_MAP = {
  '1144746905': 'Reunião Agendada',
  '1144746906': 'Diagnóstico',
  '1144746908': 'Cotação',
  '1144746909': 'Consultoria',
  '1144746910': 'Negociação',
  '1144746911': 'Perdido',
  '1144844314': 'Ganho',
  '1288611084': 'Implantação',
  '1317543716': 'Stand by'
};
const FUNNEL = ['Reunião Agendada','Diagnóstico','Cotação','Consultoria','Negociação','Implantação','Ganho'];
const EXCL = ['bradesco seguros', 'buckler', 'kardbank'];
const isExcl = d => EXCL.some(p => (d.name||'').toLowerCase().indexOf(p) >= 0);

// Compute, for each deal, the set of funnel stages it has ever been in.
const cleanDeals = deals.filter(d => !isExcl(d));
const stageSets = cleanDeals.map(d => {
  const h = hist[d.hs_id] || [];
  const names = new Set();
  h.forEach(e => { const n = STAGE_MAP[e.v]; if (n) names.add(n); });
  // include current stage for coverage (Impl=Ganho reclassification doesn't affect live-pulled data here)
  if (STAGE_MAP[d.stage] || FUNNEL.indexOf(d.stage) >= 0) names.add(d.stage);
  return { d, names };
});

// Count ever-reached per stage
const ever = Object.fromEntries(FUNNEL.map(s => [s, 0]));
stageSets.forEach(({names}) => FUNNEL.forEach(s => { if (names.has(s)) ever[s]++; }));

// For the terminal outcome column we classify each deal by its CURRENT status
// plus its deepest funnel stage reached, so every created deal lands somewhere.
const outcomes = {
  won: 0, lost_early: 0, lost_mid: 0, lost_late: 0,
  open_early: 0, open_mid: 0, open_late: 0, stale: 0
};
const todayMs = Date.now();
let statusTotals = { won:0, lost:0, open:0 };
stageSets.forEach(({d, names}) => {
  statusTotals[d.status] = (statusTotals[d.status]||0) + 1;
  let deepest = -1;
  FUNNEL.forEach((s,i) => { if (names.has(s) && i > deepest) deepest = i; });
  if (d.status === 'won') { outcomes.won++; return; }
  const tier = deepest <= 0 ? 'early' : deepest <= 3 ? 'mid' : 'late';
  if (d.status === 'lost') outcomes['lost_' + tier]++;
  else {
    const ageDays = d.created_date ? (todayMs - new Date(d.created_date).getTime())/86400000 : 0;
    if (d.status === 'open' && ageDays > 90 && d.stage !== 'Stand by') outcomes.stale++;
    else outcomes['open_' + tier]++;
  }
});

console.log('Total deals:', cleanDeals.length);
console.log('Status:', statusTotals);
console.log('Ever reached:');
FUNNEL.forEach(s => console.log('  ' + s + ': ' + ever[s]));
console.log('Outcomes:', outcomes);

// ---- SVG generation ----
const W = 1600, H = 900, M = {t: 70, r: 320, b: 60, l: 180};
const innerW = W - M.l - M.r;
const innerH = H - M.t - M.b;
const total = cleanDeals.length;

// Columns: [0]=Created(1), [1..7]=funnel stages, [8]=Outcomes(groups)
const cols = 9;
const colX = i => M.l + (innerW * i / (cols - 1));

// Scale bar height to count (max = total)
const hFor = n => Math.max(2, (n / total) * innerH);

function rect(x, y, w, h, fill, stroke = 'none') {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" rx="4"/>`;
}
function text(x, y, str, {size=12, fill='#e6edf3', anchor='start', weight=400} = {}) {
  return `<text x="${x}" y="${y}" font-family="system-ui,-apple-system,sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${str}</text>`;
}

// Colors
const C = {
  teal: '#3ab8b7', green: '#3fb950', red: '#f85149', orange: '#d29922',
  blue: '#58a6ff', purple: '#ab47bc', yellow: '#e3b341', grey: '#6e7681',
  bg: '#0d1117', surface: '#161b22', line: '#30363d', text: '#e6edf3', text2: '#8b949e'
};

// Layout: each column has one or more blocks
const nodeW = 28;
const nodes = []; // {x, y, h, label, count, color}
const flows = []; // {x1,y1,h1, x2,y2,h2, color, opacity}

// Column 0 — Created
const createdY = M.t + innerH/2 - hFor(total)/2;
nodes.push({ col: 0, x: colX(0), y: createdY, h: hFor(total), label: 'Created', count: total, color: C.teal });

// Columns 1..7 — each funnel stage, centered vertically on its count
FUNNEL.forEach((s, i) => {
  const n = ever[s];
  const h = hFor(n);
  const y = M.t + innerH/2 - h/2;
  const colorByIdx = [C.teal, C.blue, C.blue, C.purple, C.orange, C.orange, C.green];
  nodes.push({ col: i+1, x: colX(i+1), y, h, label: s, count: n, color: colorByIdx[i] });
});

// Column 8 — outcomes stacked
const outOrder = [
  { key: 'won', label: 'Won', color: C.green },
  { key: 'open_late', label: 'Open — Late (Consultoria+)', color: C.blue },
  { key: 'open_mid', label: 'Open — Mid (Diag./Cot.)', color: C.blue, alpha: '99' },
  { key: 'open_early', label: 'Open — Early (RA)', color: C.blue, alpha: '66' },
  { key: 'stale', label: 'Stale (open >90d)', color: C.orange },
  { key: 'lost_late', label: 'Lost — Late', color: C.red },
  { key: 'lost_mid', label: 'Lost — Mid', color: C.red, alpha: '99' },
  { key: 'lost_early', label: 'Lost — Early (≤RA)', color: C.red, alpha: '66' }
];
const outTotal = Object.values(outcomes).reduce((a,b)=>a+b, 0);
const outH = hFor(outTotal);
let cursorY = M.t + innerH/2 - outH/2;
outOrder.forEach(o => {
  const n = outcomes[o.key] || 0;
  if (n === 0) return;
  const h = hFor(n);
  nodes.push({ col: 8, x: colX(8), y: cursorY, h, label: o.label, count: n, color: o.color + (o.alpha||'') });
  cursorY += h + 2;
});

// ---- Flows between columns ----
// From Created → every funnel stage except 'gone' deals
// We'll draw a flow from each column to the next for the count that advanced

// Flow from col 0 (Created) → col 1 (RA): `ever[RA]`
// Flow: Created (not RA) → directly to outcomes: total - ever[RA]
// Between funnel stages: from col i to col i+1 = ever[FUNNEL[i+1]]
// Between funnel stages: drop = ever[FUNNEL[i]] - ever[FUNNEL[i+1]] → flow to outcomes
// From funnel to outcomes: the drop at each stage goes to terminal outcomes.

function flow(fromNode, toNode, n, color, opacity=0.35) {
  // We'll scale flow thickness by n / total
  const th = hFor(n);
  // simple bezier between right edge of fromNode and left edge of toNode
  const x1 = fromNode.x + nodeW;
  const x2 = toNode.x;
  const y1 = fromNode.y + fromNode.h/2;
  const y2 = toNode.y + toNode.h/2;
  const cx1 = x1 + (x2-x1)*0.5;
  const cx2 = x2 - (x2-x1)*0.5;
  flows.push(`<path d="M ${x1} ${y1-th/2} C ${cx1} ${y1-th/2} ${cx2} ${y2-th/2} ${x2} ${y2-th/2} L ${x2} ${y2+th/2} C ${cx2} ${y2+th/2} ${cx1} ${y1+th/2} ${x1} ${y1+th/2} Z" fill="${color}" opacity="${opacity}"/>`);
}

const nCreated = nodes.find(n => n.col === 0);
const nRA = nodes.find(n => n.col === 1);
flow(nCreated, nRA, ever['Reunião Agendada'], C.teal, 0.4);

// Funnel → funnel transitions
for (let i = 1; i < FUNNEL.length; i++) {
  const from = nodes.find(n => n.col === i);
  const to = nodes.find(n => n.col === i + 1);
  flow(from, to, ever[FUNNEL[i]], C.teal, 0.4);
}

// Won flow: from Ganho → Won outcome block
const nGanho = nodes.find(n => n.col === 7);
const nWon = nodes.find(n => n.label === 'Won');
if (nWon) flow(nGanho, nWon, outcomes.won, C.green, 0.6);

// ---- SVG assembly ----
let svg = '';
svg += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="background:${C.bg}">`;
svg += `<style>.title{font-family:system-ui;fill:${C.text};}</style>`;

// Title
svg += text(M.l, 32, 'Pipeline Flow — All Deals, Ever-Reached by Stage', {size:22, weight:700});
svg += text(M.l, 54, `Total created: ${total}  ·  Won: ${statusTotals.won}  ·  Lost: ${statusTotals.lost}  ·  Open: ${statusTotals.open}  ·  pulled ${new Date().toISOString().slice(0,10)}`, {size:12, fill:C.text2});

// Flows first (so nodes overlay)
svg += flows.join('\n');

// Nodes with labels
nodes.forEach(n => {
  svg += rect(n.x, n.y, nodeW, n.h, n.color);
  // Label to left of first col, to right of last col, above otherwise
  if (n.col === 0) {
    svg += text(n.x - 10, n.y + n.h/2 - 4, n.label, { anchor: 'end', size: 13, weight: 600 });
    svg += text(n.x - 10, n.y + n.h/2 + 14, n.count.toLocaleString(), { anchor: 'end', size: 12, fill: C.text2 });
  } else if (n.col === 8) {
    svg += text(n.x + nodeW + 10, n.y + Math.min(n.h/2 + 4, n.h - 2), `${n.label}: ${n.count}`, { size: 12 });
  } else {
    svg += text(n.x + nodeW/2, n.y - 8, n.label, { anchor: 'middle', size: 12, weight: 600 });
    svg += text(n.x + nodeW/2, n.y - 22, n.count.toLocaleString(), { anchor: 'middle', size: 14, weight: 700, fill: C.text });
  }
});

// Drop annotations between funnel stages
for (let i = 0; i < FUNNEL.length; i++) {
  const prevCount = i === 0 ? total : ever[FUNNEL[i-1]];
  const curCount = ever[FUNNEL[i]];
  const drop = prevCount - curCount;
  const pct = prevCount > 0 ? (curCount / prevCount * 100).toFixed(1) : '0';
  const from = nodes.find(n => n.col === i);
  const to = nodes.find(n => n.col === i+1);
  const midX = (from.x + nodeW + to.x) / 2;
  const midY = M.t + innerH + 20;
  svg += text(midX, midY, `${pct}% advance`, { anchor: 'middle', size: 10, fill: C.text2 });
  svg += text(midX, midY + 14, `(−${drop})`, { anchor: 'middle', size: 10, fill: C.red });
}

// Axis-like guide
svg += text(M.l, H - 18, 'Left: entry point  ·  Middle: cumulative deals that ever reached each funnel stage  ·  Right: current terminal outcome',
  { size: 11, fill: C.text2 });

svg += '</svg>';

const outPath = path.resolve(__dirname, '..', 'pipeline-flow.svg');
fs.writeFileSync(outPath, svg);
console.log('\nSaved:', outPath);
