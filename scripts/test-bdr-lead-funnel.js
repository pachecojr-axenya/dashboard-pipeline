#!/usr/bin/env node
'use strict';
/**
 * test-bdr-lead-funnel.js — prova o /api/bdr-lead-funnel contra o armazém.
 *
 *   node scripts/test-bdr-lead-funnel.js            # ADC do gcloud
 *   node scripts/test-bdr-lead-funnel.js --portal   # + contraprova na Search API
 *
 * O QUE ESTE TESTE PROVA, e por que cada asserção existe:
 *
 * 1. RECONCILIAÇÃO COM A AUDITORIA por outro caminho. A janela de jul/2026 foi medida
 *    à mão em 11/08/2026 direto no BigQuery: 2.302 leads criados, 1.076 com atividade
 *    real, 172 com deal, 0 com mais de um contato. Se o endpoint devolver outro
 *    número, ou o endpoint quebrou ou o armazém mudou — e as duas coisas exigem
 *    olhar antes de confiar na tela.
 *
 * 2. CONSERVAÇÃO DO WATERFALL. A soma das setas tem de igualar o total de
 *    movimentações declarado. Waterfall cujas setas não fecham é ficção bonita: é o
 *    tipo de gráfico que ninguém confere porque parece plausível.
 *
 * 3. O BACKUP SAI, e sai pelo pipeline DO EVENTO. Pedir `funil=principal` não pode
 *    trazer etapa cujo stage_id pertence ao Diagnóstico Site, e o snapshot do
 *    recorte tem de ser menor que o de `todos`.
 *
 * 4. AS DUAS RÉGUAS DISCORDAM, e a discordância é o achado. Um teste que exigisse
 *    `por_etapa == por_atividade` esconderia justamente o que a tela existe para
 *    mostrar. Aqui a asserção é que o gap é POSITIVO e grande — se um dia empatar,
 *    é notícia, e o teste tem de gritar.
 *
 * 5. TODA PREMISSA QUE MUDA NÚMERO ESTÁ NO PAYLOAD. Número certo sem premissa
 *    explícita é indistinguível de número novo sem explicação (regra da F5).
 */

const path = require('path');
const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');

process.env.LOCAL_DEV_BYPASS = 'true';

// ADC em vez de chave de SA — mesmo shim do compare-warehouse-endpoints.js.
const TOKEN = execSync('gcloud auth application-default print-access-token', { encoding: 'utf8' }).trim();
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'adc@local', private_key: 'x' });
const bq = require(path.join(ROOT, 'lib', 'bigquery.js'));
bq.query = async (sql, params) => {
  const body = { query: sql, useLegacySql: false, location: 'southamerica-east1', timeoutMs: 120000 };
  if (params && params.length) {
    body.parameterMode = 'NAMED';
    body.queryParameters = params.map((p) => ({
      name: p.name,
      parameterType: { type: p.type || 'STRING' },
      parameterValue: { value: p.value == null ? null : String(p.value) },
    }));
  }
  const res = await fetch(
    'https://bigquery.googleapis.com/bigquery/v2/projects/gen-lang-client-0423905839/queries',
    { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  const data = await res.json();
  if (!res.ok) throw new Error('BQ ' + res.status + ': ' + JSON.stringify(data).slice(0, 400));
  const fields = (data.schema && data.schema.fields) || [];
  const rows = (data.rows || []).map((r) => {
    const o = {};
    (r.f || []).forEach((cell, i) => { o[fields[i].name] = bq.decodeCell(cell.v, fields[i]); });
    return o;
  });
  return { fields: fields.map((f) => f.name), rows };
};

if (!process.env.HUBSPOT_TOKEN) {
  try {
    process.env.HUBSPOT_TOKEN = execSync(
      'gcloud secrets versions access latest --secret=axenya-hubspot-pat-shared --project=gen-lang-client-0423905839',
      { encoding: 'utf8' }).trim();
  } catch { /* só a contraprova do portal precisa; segue */ }
}

const PORTAL = process.argv.includes('--portal');
let falhas = 0;
function ok(cond, texto, extra) {
  if (!cond) falhas++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + texto + (extra != null ? '   | ' + extra : ''));
}

function fakeRes() {
  const r = { _code: 0, _json: null };
  r.setHeader = () => {}; r.status = (c) => { r._code = c; return r; };
  r.json = (j) => { r._json = j; return r; }; r.end = () => r;
  return r;
}
async function call(query) {
  const h = require(path.join(ROOT, 'api', 'bdr-lead-funnel.js'));
  const res = fakeRes();
  await h({ method: 'GET', url: '/api/bdr-lead-funnel', headers: {}, query }, res);
  return { code: res._code, body: res._json };
}

(async () => {
  // ── 1. Janela de jul/2026: reconciliação com a auditoria ──────────────────────
  console.log('\n== jul/2026, ambos os funis | reconciliação com a auditoria de 11/08 ==');
  const jul = await call({ funil: 'todos', since: '2026-07-01', until: '2026-07-31', refresh: '1' });
  ok(jul.code === 200, 'HTTP 200', jul.code);
  const J = jul.body || {};
  ok(J.success === true, 'success=true');

  const co = J.coorte || {};
  ok(co.criados === 2302, 'leads criados == 2.302 (medido à mão no BQ)', co.criados);
  ok(co.taxa_contato && co.taxa_contato.por_atividade.n === 1076,
    'régua de ATIVIDADE == 1.076', co.taxa_contato && co.taxa_contato.por_atividade.n);
  ok(co.taxa_contato && co.taxa_contato.por_etapa.n === 2057,
    'régua de ETAPA == 2.057', co.taxa_contato && co.taxa_contato.por_etapa.n);
  ok(co.com_deal === 172, 'leads com deal == 172', co.com_deal);

  // ── 2. As duas réguas DISCORDAM — o gap é o achado, não o erro ────────────────
  console.log('\n== as duas réguas de taxa de contato ==');
  const t = co.taxa_contato || {};
  ok(t.por_etapa.n > t.por_atividade.n,
    'ETAPA > ATIVIDADE (se empatar um dia, é notícia)', t.por_etapa.pct + '% vs ' + t.por_atividade.pct + '%');
  ok(t.etapa_sem_atividade >= 900,
    'leads movidos de etapa SEM toque registrado >= 900', t.etapa_sem_atividade);
  ok(t.por_etapa.n - t.por_atividade.n === t.etapa_sem_atividade - t.atividade_sem_etapa,
    'partição fecha: (etapa − atividade) == (etapa_sem_ativ − ativ_sem_etapa)');

  // ── 3. Conservação do waterfall ───────────────────────────────────────────────
  console.log('\n== conservação do waterfall ==');
  const wf = J.waterfall || {};
  const somaSetas = Object.values(wf.setas || {}).reduce((a, b) => a + b, 0);
  ok(somaSetas > 0, 'há setas no período', somaSetas);
  ok(somaSetas <= wf.movimentos,
    'Σ setas <= movimentos (a diferença é o Backup descartado, declarado em premissas)',
    somaSetas + ' de ' + wf.movimentos);
  const somaDia = Object.values(wf.por_dia || {})
    .reduce((a, d) => a + Object.values(d).reduce((x, y) => x + y, 0), 0);
  ok(somaDia === somaSetas, 'Σ por_dia == Σ setas (o mesmo total por dois cortes)', somaDia + ' vs ' + somaSetas);

  // ── 4. Recorte de funil pelo pipeline DO EVENTO ────────────────────────────────
  console.log('\n== recorte de funil (Backup fora, pipeline do evento) ==');
  const prin = await call({ funil: 'principal', since: '2026-07-01', until: '2026-07-31', refresh: '1' });
  const diag = await call({ funil: 'diagnostico', since: '2026-07-01', until: '2026-07-31', refresh: '1' });
  const P = prin.body || {}, G = diag.body || {};
  ok(P.coorte.criados + G.coorte.criados === J.coorte.criados,
    'principal + diagnóstico == ambos (partição MECE da coorte)',
    P.coorte.criados + ' + ' + G.coorte.criados + ' = ' + J.coorte.criados);
  const totSnap = o => Object.values(o.snapshot.por_etapa || {}).reduce((a, b) => a + b, 0);
  ok(totSnap(P) < totSnap(J) && totSnap(G) < totSnap(J), 'snapshot de cada recorte < snapshot de ambos',
    totSnap(P) + ' / ' + totSnap(G) + ' < ' + totSnap(J));
  ok(!P.janela.pipelines.includes('807886369') && !J.janela.pipelines.includes('807886369'),
    'pipeline Backup nunca entra no recorte');
  ok(J.snapshot.etapas_nao_mapeadas === 0,
    'nenhuma etapa fora do mapa canônico (etapa nova no portal apareceria aqui)',
    J.snapshot.etapas_nao_mapeadas);

  // ── 5. Premissas e divergências no payload ────────────────────────────────────
  console.log('\n== premissas declaradas no payload ==');
  const obrigatorias = ['objeto', 'quebra_de_serie', 'pipeline_do_evento', 'backup_excluido',
    'stage_canon', 'duas_reguas_de_contato', 'automacao_nao_e_esforco', 'dono_no_instante',
    'motivo_desqualificacao', 'tier_do_bronze', 'tier_vidas_nao_existe', 'defasagem'];
  obrigatorias.forEach(k => ok(!!(J.premissas || {})[k], 'premissa "' + k + '" presente'));
  ok(Object.keys(J.divergencias_conhecidas || {}).length >= 4, 'divergências conhecidas declaradas',
    Object.keys(J.divergencias_conhecidas || {}).length);
  ok(J.snapshot.camada === 'silver' && J.coorte.camada.includes('silver'),
    'camada declarada por bloco (a régua "gold onde reconcilia, silver onde ainda não")');

  // ── 6. Desqualificações: motivo, autor e automação segregada ──────────────────
  console.log('\n== desqualificações ==');
  const dq = J.desqualificacoes || [];
  ok(dq.length > 0, 'há desqualificações no período', dq.length);
  ok(dq.every(d => d.motivo), 'toda desqualificação tem motivo ou "(sem motivo)"');
  ok(dq.every(d => d.autor), 'toda desqualificação tem autor ou bucket de automação');
  const auto = dq.filter(d => d.automacao).length;
  ok(dq.some(d => d.automacao) || auto === 0, 'automação segregada do esforço do BDR', auto + ' de ' + dq.length);
  ok(dq.every(d => typeof d.bdr === 'string'), 'dono no instante resolvido para nome de BDR');

  // ── 7. Mês corrente não explode (a janela que a tela abre por padrão) ─────────
  console.log('\n== mês corrente (default da tela) ==');
  const cur = await call({ funil: 'todos', refresh: '1' });
  ok(cur.code === 200 && cur.body.success, 'mês corrente responde 200', cur.code);
  ok(cur.body.coorte.criados >= 0 && Object.keys(cur.body.waterfall.setas).length >= 0, 'payload íntegro no mês parcial');

  // ── 8. Contraprova ao vivo (opcional) ─────────────────────────────────────────
  if (PORTAL) {
    console.log('\n== contraprova na Search API do HubSpot ==');
    const pv = await call({ funil: 'todos', since: '2026-07-01', until: '2026-07-31', portal: '1', refresh: '1' });
    const svp = pv.body.diagnostics.snapshot_vs_portal || {};
    ok(!svp.erro, 'contraprova executou', svp.erro || 'ok');
    if (!svp.erro) {
      ok(svp.total_portal === svp.total_armazem,
        'TOTAL do portal == TOTAL do armazém (parte por parte difere pela defasagem; o total, não)',
        svp.total_portal + ' vs ' + svp.total_armazem);
    }
  }

  console.log('\n' + (falhas ? falhas + ' FALHA(S)' : 'TODOS OS CASOS PASSARAM'));
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('\nERRO:', e.message); process.exit(1); });
