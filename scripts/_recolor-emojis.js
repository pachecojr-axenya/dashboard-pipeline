// Troca o 🟡 dos títulos de cada gráfico pela cor do veredito da auditoria.
// Uso: node _recolor-emojis.js [--apply]   (sem --apply = dry-run, só conta)
const fs = require('fs'), path = require('path');
const apply = process.argv.includes('--apply');
const PUB = path.join(__dirname, '..', 'public');

const DASH = {
  waterfall:'🔴', netflow:'🟠', stageprog:'🔴', openpipe2:'🟢', risktable:'🟢',
  cohort:'🟠', freshness:'🟢', passthru:'🔴', winratesize:'🔴', sizewindow:'🟠',
  vidaswindow:'🟠', winfactor:'🔴', coverage:'🟠', piperev12:'🟠', segdoughnut:'🟢',
  visibility:'🟢', timeinstage:'🟠', speedqualify:'🔴', timetomeeting:'🟠', reassign:'🟠',
  financial:'🟢', wonmonthly:'🟢', piperevstage:'🟢', weightedrevstage:'🟢', receivables:'🟠', risktriage:'🟢'
};
const BOARD = {
  bd_rev_trend:'🟢', bd_won_monthly:'🟠', bd_pipe_stage:'🟠', bd_conversion:'🔴', bd_deal_bench:'🟠',
  bd_concentration:'🟢', bd_entry_exit:'🔴', bd_arr_bridge:'🔴', bd_won_size:'🟠', bd_forecast:'🔴'
};
const BOARD_KPI = [
  ["kpi('🟡 ARR Ganho Total'", "kpi('🟢 ARR Ganho Total'"],
  ["kpi('🟡 Pipeline Aberto (ARR)'", "kpi('🟢 Pipeline Aberto (ARR)'"],
  ["kpi('🟡 ARR Ganho (mês atual)'", "kpi('🟢 ARR Ganho (mês atual)'"],
  ["kpi('🟡 Forecast Ponderado'", "kpi('🟢 Forecast Ponderado'"]
];

function countReplace(str, find, repl) {
  let n = 0, i = 0;
  while ((i = str.indexOf(find, i)) !== -1) { n++; i += find.length; }
  return { str: str.split(find).join(repl), n };
}

function doFile(file, fn) {
  let s = fs.readFileSync(file, 'utf8');
  const before = (s.match(/🟡/g) || []).length;
  const log = [];
  s = fn(s, log);
  const after = (s.match(/🟡/g) || []).length;
  console.log('\n=== ' + path.basename(file) + ' ===');
  log.forEach(l => console.log('  ' + l));
  console.log('  🟡 antes: ' + before + ' | depois: ' + after + ' | trocados: ' + (before - after));
  if (apply) { fs.writeFileSync(file, s, 'utf8'); console.log('  [gravado]'); }
}

doFile(path.join(PUB, 'dashboard.html'), (s, log) => {
  for (const k in DASH) {
    let r;
    r = countReplace(s, "t_" + k + ":'🟡 ", "t_" + k + ":'" + DASH[k] + " "); s = r.str; const a = r.n;
    r = countReplace(s, "key:'" + k + "', title:'🟡 ", "key:'" + k + "', title:'" + DASH[k] + " "); s = r.str; const b = r.n;
    log.push(k + ' ' + DASH[k] + ' | i18n(pt+en)=' + a + ' help=' + b);
  }
  return s;
});

doFile(path.join(PUB, 'board.html'), (s, log) => {
  for (const k in BOARD) {
    const r = countReplace(s, k + ":'🟡 ", k + ":'" + BOARD[k] + " "); s = r.str;
    log.push(k + ' ' + BOARD[k] + ' | i18n=' + r.n);
  }
  BOARD_KPI.forEach(pair => { const r = countReplace(s, pair[0], pair[1]); s = r.str; log.push('KPI ' + pair[1].slice(5, 30) + ' | ' + r.n); });
  return s;
});
