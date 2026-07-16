'use strict';
/** Integration smoke do serving BQ do Forecast. Requer local-server ativo. */

const port = process.argv[2] || '3007';
const base = 'http://localhost:' + port;
let fails = 0;
function check(name, cond, detail) {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
  if (!cond) fails++;
}
async function get(path) {
  const r = await fetch(base + path);
  const j = await r.json();
  return { status: r.status, body: j };
}

(async () => {
  const fotos = await get('/api/history?action=fotos');
  check('lista weekly via BQ', fotos.status === 200 && fotos.body.success && fotos.body.source === 'bq', 'fotos=' + ((fotos.body.fotos || []).length));

  // Datas nao-sextas: provam que action=compare resolve no daily, nao na sexta.
  const cmp = await get('/api/history?action=compare&a=2026-07-08&b=2026-07-09');
  check('compare daily nao-sexta', cmp.status === 200 && cmp.body.success, 'status=' + cmp.status);
  check('datas resolvidas exatas', cmp.body.a && cmp.body.a.resolvedTab === '2026-07-08' && cmp.body.b.resolvedTab === '2026-07-09',
    (cmp.body.a && cmp.body.a.resolvedTab) + ' -> ' + (cmp.body.b && cmp.body.b.resolvedTab));
  check('invariante delta', cmp.body.invariant && cmp.body.invariant.ok === true);

  const snap = await get('/api/history?action=snapshot&tab=2026-07-08');
  check('snapshot daily via BQ', snap.status === 200 && snap.body.success && (snap.body.deals || []).length === 1354,
    'deals=' + ((snap.body.deals || []).length));

  const row = cmp.body.waterfall && cmp.body.waterfall[0] && cmp.body.waterfall[0].key;
  const drill = row ? await get('/api/history?action=compare-drill&a=2026-07-08&b=2026-07-09&row=' + encodeURIComponent(row) + '&measure=prob12') : { status: 0, body: {} };
  check('drill daily via BQ', drill.status === 200 && drill.body.success && Array.isArray(drill.body.deals), 'row=' + row);

  console.log('\n' + (fails ? 'FAIL: ' + fails : 'OK: integration BQ Forecast'));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
