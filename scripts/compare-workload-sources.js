'use strict';
/**
 * compare-workload-sources.js | prova a paridade do Workload entre o medallion
 * e o armazém canônico, antes de trocar a fonte da tela.
 *
 *   node scripts/compare-workload-sources.js --adc
 *   node scripts/compare-workload-sources.js --adc --dias=60
 *   node scripts/compare-workload-sources.js --adc --since=2026-07-01 --until=2026-07-31
 *
 * Chama `/api/bdr-workload-semantic` DUAS vezes, `fonte=medallion` e
 * `fonte=armazem`, e compara métrica por métrica. É o mesmo método do
 * `compare-warehouse-endpoints.js`: manter a rota antiga viva e comparar achou 7
 * defeitos silenciosos na F5 que trocar e olhar a tela não acharia.
 *
 * A ASSERÇÃO NÃO É "OS NÚMEROS BATEM".
 * WhatsApp e atividades DEVEM divergir: o armazém mede a automação do Treble à
 * parte (decisão de 10/08/2026 | automação não é esforço do BDR) e o medallion
 * ainda a soma no total. Afrouxar o limiar para caber a diferença ensinaria a
 * ignorar o resultado. Então a asserção é:
 *
 *     medallion − armazém == exatamente o que o medallion chama de Treble
 *
 * e, a que realmente autoriza a troca:
 *
 *     WhatsApp MANUAL bate na unha | nenhuma mensagem digitada por gente se perde
 *
 * O terceiro caminho, `whatsapp_automacao_total` lido direto do mart, REPROVOU a
 * primeira versão desta asserção e por isso ficou: eu tinha escrito que o delta
 * seria a automação do armazém, e medi 951 contra 454. Os dois lados discordam
 * de QUEM é dono da automação | o Treble grava `communications` sem
 * `hubspot_owner_id`, então nenhum dos dois sabe: o armazém infere pelo dono no
 * INSTANTE do toque e o medallion pelo dono ATUAL, e ~497 mensagens que o
 * medallion credita ao roster o armazém credita a quem detinha o contato durante
 * o trânsito da distribuição, fora do roster. Não muda nenhum número migrado
 * (automação não entra no esforço em nenhuma das duas réguas), mas invalida
 * qualquer leitura de "automação por BDR". Mart que só bate consigo mesmo não
 * foi provado | este script existe por causa disso.
 *
 * Não roda no CI: o caminho `fonte=medallion` faz overlay ao vivo do HubSpot
 * quando a janela inclui hoje. É ferramenta de migração, para rodar quando
 * alguém desconfia de um número.
 *
 * Credenciais: idem compare-warehouse-endpoints.js (GOOGLE_SERVICE_ACCOUNT_JSON
 * ou --adc; HUBSPOT_TOKEN sai do secret se não estiver no ambiente).
 */

const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ARGS = process.argv.slice(2);
const ADC = ARGS.includes('--adc');
function arg(nome, padrao) {
  const hit = ARGS.find((a) => a.startsWith(`--${nome}=`));
  return hit ? hit.split('=')[1] : padrao;
}

process.env.LOCAL_DEV_BYPASS = process.env.LOCAL_DEV_BYPASS || 'true';

if (ADC) {
  const TOKEN = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
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
    if (!res.ok) throw new Error('BQ ' + res.status + ': ' + JSON.stringify(data).slice(0, 300));
    const fields = (data.schema && data.schema.fields) || [];
    const rows = (data.rows || []).map((r) => {
      const o = {};
      (r.f || []).forEach((cell, i) => { o[fields[i].name] = bq.decodeCell(cell.v, fields[i]); });
      return o;
    });
    return { fields: fields.map((f) => f.name), rows };
  };
}
if (!process.env.HUBSPOT_TOKEN) {
  try {
    process.env.HUBSPOT_TOKEN = execSync(
      'gcloud secrets versions access latest --secret=axenya-hubspot-pat-shared --project=gen-lang-client-0423905839',
      { encoding: 'utf8' }).trim();
  } catch { /* segue: o overlay live falha com mensagem clara */ }
}

const bq = require(path.join(ROOT, 'lib', 'bigquery.js'));
const sem = require(path.join(ROOT, 'api', 'bdr-workload-semantic.js'))._test;

// Janela default TERMINA ONTEM. Incluir hoje misturaria o overlay ao vivo do
// HubSpot na comparação, e aí a diferença entre as fontes deixa de ser
// atribuível: parte vem da fonte, parte vem da hora em que cada lado foi lido.
function ymd(d) { return d.toISOString().slice(0, 10); }
function janela() {
  const since = arg('since');
  const until = arg('until');
  if (since && until) return { since, until };
  const dias = Number(arg('dias', '30'));
  const fim = new Date(Date.now() - 3 * 3600 * 1000);
  fim.setUTCDate(fim.getUTCDate() - 1);
  const ini = new Date(fim);
  ini.setUTCDate(ini.getUTCDate() - dias + 1);
  return { since: ymd(ini), until: ymd(fim) };
}

// Métricas comparadas. `esperado` diz o que fazer com a diferença:
//   'zero'      | qualquer diferença é defeito
//   'automacao' | a diferença TEM de ser exatamente o Treble do medallion
//   'aberto'    | divergência conhecida e declarada (vira aviso, não falha)
const METRICAS = [
  ['calls', 'Ligações', 'zero'],
  ['emails', 'E-mails', 'zero'],
  ['linkedin', 'LinkedIn', 'zero'],
  ['meetings', 'Reuniões', 'zero'],
  ['callsConversation', 'Ligações conectadas', 'zero'],
  ['callsNoAnswer', 'Sem resposta', 'zero'],
  ['callsBusy', 'Ocupado', 'zero'],
  ['callsWrongNumber', 'Número errado', 'zero'],
  ['callsNoOutcome', 'Sem desfecho', 'zero'],
  // A LINHA QUE AUTORIZA A TROCA. Se o WhatsApp digitado por gente divergir, a
  // migração está perdendo esforço real e não só reclassificando automação.
  ['whatsappManual', 'WhatsApp manual', 'zero'],
  ['whatsapp', 'WhatsApp (total)', 'automacao'],
  ['activities', 'Atividades', 'automacao'],
  // Os dois lados discordam de quem é dono do disparo automático. Não afeta
  // esforço em nenhuma das réguas, mas não pode passar calado.
  ['whatsappTreble', 'WhatsApp automação', 'aberto'],
  ['companiesTouched', 'Empresas tocadas', 'aberto'],
  ['contactsTouched', 'Contatos tocados', 'aberto'],
];

async function totais(fonte, w) {
  const req = { url: `/?v=2&since=${w.since}&until=${w.until}&fonte=${fonte}` };
  const payload = await sem.build(sem.parse(req));
  return { totals: payload.data.rhythm.totals, source: payload.source, quality: payload.quality };
}

// TERCEIRO CAMINHO. Lê a automação direto do mart do armazém, sem passar pelo
// endpoint, e restrito ao mesmo roster que a tela usa. Sem isto a comparação
// estaria conferindo o endpoint contra ele mesmo | e foi exatamente ele que
// reprovou a primeira versão da asserção (454 x 951, ver cabeçalho).
async function automacaoDoMart(w) {
  // Roster por ID, não por nome: `bdrOwnerIds(null)` devolve vazio de propósito
  // (o endpoint sem filtro de BDR não põe cláusula de owner no SQL e peneira por
  // nome canônico depois). `BDR_OWNER_MAP` é o MESMO roster escrito em id | são
  // 14 ids para 13 pessoas, porque Cintia Rodrigues tem dois.
  const { BDR_OWNER_MAP } = require(path.join(ROOT, 'lib', 'bdr-team.js'));
  const lista = Object.keys(BDR_OWNER_MAP).filter((id) => /^\d+$/.test(id)).map((id) => `'${id}'`).join(',');
  const sql = `SELECT SUM(whatsapp_automacao_total) automacao FROM ${sem.WAREHOUSE_TABLE} WHERE metric_date BETWEEN @since AND @until AND CAST(owner_id AS STRING) IN (${lista}) AND EXTRACT(DAYOFWEEK FROM metric_date) NOT IN (1,7)`;
  const { rows } = await bq.query(sql, [{ name: 'since', type: 'DATE', value: w.since }, { name: 'until', type: 'DATE', value: w.until }]);
  return Number((rows[0] && rows[0].automacao) || 0);
}

function pct(a, b) { const base = Math.max(Math.abs(a), Math.abs(b)); return base ? (Math.abs(a - b) / base) * 100 : 0; }

(async function main() {
  const w = janela();
  console.log(`\nWorkload | medallion x armazém | ${w.since} a ${w.until} (dias úteis, roster completo)\n`);

  const med = await totais('medallion', w);
  const arm = await totais('armazem', w);

  if (arm.source.fonteEfetiva !== 'armazem') {
    console.error('FALHOU: pedi fonte=armazem e o endpoint caiu para o medallion.');
    console.error(`  motivo: ${arm.source.fallbackErro || '(não declarado)'}`);
    console.error('  se fala em coluna desconhecida, falta rebuildar a imagem do ETL e atualizar os Jobs.');
    process.exit(1);
  }

  const automacaoArmazem = await automacaoDoMart(w);
  // O que SAI do total ao trocar de fonte é o Treble como o MEDALLION o conta,
  // não como o armazém o conta. Confundir os dois foi o erro que o 3º caminho
  // pegou: são quantidades diferentes porque as duas réguas de dono discordam.
  const trebleMedallion = Number(med.totals.whatsappTreble || 0);
  console.log(`Automação do Treble | medallion credita ${trebleMedallion} ao roster, armazém credita ${automacaoArmazem} (3º caminho, direto do mart)\n`);

  const largura = Math.max(...METRICAS.map((m) => m[1].length));
  let falhas = 0;
  let avisos = 0;
  METRICAS.forEach(([chave, rotulo, esperado]) => {
    const a = Number(med.totals[chave] || 0);
    const b = Number(arm.totals[chave] || 0);
    const delta = a - b;
    let marca = '  ok';
    if (esperado === 'zero' && delta !== 0) { marca = 'FALHA'; falhas += 1; }
    if (esperado === 'automacao') {
      if (delta === trebleMedallion) marca = '  ok (delta == Treble do medallion)';
      else { marca = `FALHA (delta ${delta} != Treble do medallion ${trebleMedallion})`; falhas += 1; }
    }
    if (esperado === 'aberto' && delta !== 0) { marca = `avisa (${pct(a, b).toFixed(1)}%)`; avisos += 1; }
    console.log(`  ${rotulo.padEnd(largura)} | medallion ${String(a).padStart(7)} | armazém ${String(b).padStart(7)} | delta ${String(delta).padStart(6)} | ${marca}`);
  });
  if (Number(arm.totals.whatsappTreble || 0) !== automacaoArmazem) {
    console.log(`\n  atenção | o endpoint devolveu ${arm.totals.whatsappTreble} de automação e o mart tem ${automacaoArmazem} lidos direto | o 3º caminho discorda do 1º`);
    falhas += 1;
  }

  console.log('');
  (arm.source.premissas || []).forEach((p) => console.log(`  premissa | ${p}`));
  if (arm.source.mescla) {
    const m = arm.source.mescla;
    console.log(`\n  mescla | ${m.linhasComRitmoDoArmazem} linhas com ritmo do armazém | ${m.linhasSoNoArmazem} só no armazém | ${m.linhasSoNoMedallion} só no medallion`);
  }
  console.log(`\n  camadas | ${JSON.stringify(arm.source.camadas)}`);

  if (falhas) { console.error(`\nREPROVOU | ${falhas} métrica(s) fora do esperado.\n`); process.exit(1); }
  console.log(`\nPASSOU | ${avisos} divergência(s) conhecida(s) em aberto.\n`);
})().catch((error) => { console.error(error); process.exit(1); });
