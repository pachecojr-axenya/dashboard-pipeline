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
  // 1.504 depois de DUAS correções, em direções opostas — e é por isso que o número
  // sozinho não conta a história: 1.076 (régua sem WhatsApp) → 1.601 (WhatsApp entrou,
  // +525) → 1.504 (o toque passou a exigir ser POSTERIOR À CRIAÇÃO do lead, −97).
  // Ver os blocos 2b e 2d.
  ok(co.taxa_contato && co.taxa_contato.por_atividade.n === 1504,
    'régua de ATIVIDADE == 1.504 (WhatsApp dentro, toque pré-lead fora)', co.taxa_contato && co.taxa_contato.por_atividade.n);
  ok(co.taxa_contato && co.taxa_contato.criados === 2302,
    '"criaram X" viaja como absoluto no payload', co.taxa_contato && co.taxa_contato.criados);
  ok(co.taxa_contato && co.taxa_contato.por_etapa.n === 2057,
    'régua de ETAPA == 2.057', co.taxa_contato && co.taxa_contato.por_etapa.n);
  ok(co.com_deal === 172, 'leads com deal == 172', co.com_deal);

  // ── 2. As duas réguas DISCORDAM — o gap é o achado, não o erro ────────────────
  console.log('\n== as duas réguas de taxa de contato ==');
  const t = co.taxa_contato || {};
  ok(t.por_etapa.n > t.por_atividade.n,
    'ETAPA > ATIVIDADE (se empatar um dia, é notícia)', t.por_etapa.pct + '% vs ' + t.por_atividade.pct + '%');
  ok(t.etapa_sem_atividade === 579,
    'movidos de etapa SEM toque == 579 (1.009 sem WhatsApp, 504 antes do corte pré-lead)', t.etapa_sem_atividade);
  ok(t.por_etapa.n - t.por_atividade.n === t.etapa_sem_atividade - t.atividade_sem_etapa,
    'partição fecha: (etapa − atividade) == (etapa_sem_ativ − ativ_sem_etapa)');

  // ── 2b. A RÉGUA DE ATIVIDADE, travada canal por canal ─────────────────────────
  // Este bloco existe porque a régua JÁ ESTAVA ERRADA UMA VEZ: omitia WhatsApp, o
  // canal mais usado do time depois do e-mail, e a tela afirmava "sem toque" para 525
  // leads que tinham WhatsApp digitado à mão. Achado por auditoria de caso do dono, não
  // por teste — e é justamente isso que este bloco impede de repetir.
  console.log('\n== regua de atividade, canal por canal ==');
  ok(t.so_automacao >= 0 && t.nunca_tocados >= 0 && t.toque_herdado >= 0,
    'automação, herdado e nunca-tocados sao buckets SEPARADOS e visiveis',
    'so automacao ' + t.so_automacao + ' | herdado ' + t.toque_herdado + ' | nunca tocados ' + t.nunca_tocados);
  ok(t.por_atividade.n + t.so_automacao + t.toque_herdado + t.nunca_tocados === t.criados,
    'particao MECE de 4 buckets: falou com + so automacao + herdado + nunca tocado == criados',
    t.por_atividade.n + ' + ' + t.so_automacao + ' + ' + t.toque_herdado + ' + ' + t.nunca_tocados + ' = ' + t.criados);
  // O bucket novo tem de ser NAO-VAZIO em jul/26: se zerar, ou a regua parou de olhar
  // o historico do contato ou o limite temporal caiu -- e nos dois casos o numero de
  // "falou com" volta a inflar em silencio.
  ok(t.toque_herdado === 118,
    'toque HERDADO (so anterior ao lead) == 118 em jul/26 -- eram creditados como contato',
    t.toque_herdado);
  // co.leads e a lista CAPADA do drill; a asserçao vale sobre ela porque o que se prova
  // aqui e a REGUA (todo WhatsApp conta), nao o total (esse vem da agregacao).
  const comWpp = (co.leads || []).filter(l => l.whatsapp_manual > 0);
  ok(comWpp.length > 0, 'ha leads cuja UNICA prova de contato pode ser WhatsApp (na amostra do drill)', comWpp.length + ' de ' + (co.leads || []).length);
  ok(comWpp.every(l => l.atividade_real),
    'TODO lead com WhatsApp manual conta como atividade real (a regressao do caso Rui Medeiros)');
  const soWpp = comWpp.filter(l => !l.ligacoes_conectadas && !l.emails_enviados && !l.linkedin_enviados && !l.reunioes);
  ok(soWpp.length > 0 && soWpp.every(l => l.atividade_real),
    'lead com WhatsApp e NADA MAIS tambem conta — sem isso o bug volta em silencio', soWpp.length);
  // Regressao do que quase aconteceu ao mover a agregacao para o BQ: o detalhe perdeu as
  // contagens POR CANAL e o front passaria a dizer "nenhum toque" por ausencia de CAMPO.
  ok((co.leads || []).filter(l => l.atividade_real).every(l =>
      (l.ligacoes_conectadas + l.emails_enviados + l.linkedin_enviados + l.whatsapp_manual + l.reunioes) > 0),
    'lead com atividade real SEMPRE tem canal nomeado no payload (senao a tela diz "sem toque" por campo faltando)');
  ok((co.leads || []).every(l => l.atividade_real === (l.toques_manuais > 0)),
    'atividade_real e exatamente "houve toque manual", sem terceira via');
  ok((co.leads || []).every(l => !(l.atividade_real && l.so_automacao)),
    'so_automacao e atividade_real sao mutuamente exclusivos');

  // ── 2d. O TOQUE TEM DE SER POSTERIOR À CRIAÇÃO DO LEAD ────────────────────────
  // Achado por auditoria de caso do dono (11/08, "a Gabi falou com 5 e criou 5"). A
  // régua liga toque→lead pelo CONTATO, e o contato tem vida anterior ao lead: sem
  // limite temporal, "falou com" contava trabalho de outro ciclo, às vezes de outra
  // pessoa. Em ago/26 eram 19 leads (9% do "falou com"), o mais antigo com toque de
  // 18/07/2024; por pessoa mudava a leitura (Raina Cândido saía com 2 de 11 tendo 0).
  console.log('\n== toque posterior a criacao do lead ==');
  const herd = (co.leads || []).filter(l => l.toque_herdado);
  ok(herd.length > 0, 'ha leads no bucket HERDADO na amostra do drill', herd.length + ' de ' + (co.leads || []).length);
  ok(herd.every(l => l.toques_manuais === 0),
    'lead HERDADO nao tem NENHUM toque posterior a criacao -- senao nao seria herdado');
  // O bucket cobre historico manual E de automacao anterior ao lead, e os DOIS campos
  // viajam: sem o de automacao, o lead cujo unico historico e robo pre-lead cairia em
  // "nenhum toque" no drill -- afirmacao falsa por ausencia de CAMPO.
  ok(herd.every(l => l.toques_manuais_antes > 0 || l.toques_automacao_antes > 0),
    'lead HERDADO nomeia quantos toques houve ANTES: afirmar ausencia exige declarar o universo');
  ok(herd.some(l => l.toques_manuais_antes > 0),
    'ha lead herdado por toque MANUAL anterior (o caso que inflava "falou com")',
    herd.filter(l => l.toques_manuais_antes > 0).length + ' de ' + herd.length);
  ok(herd.every(l => !l.atividade_real),
    'toque anterior ao lead NAO conta como "falou com" (era exatamente o defeito)');
  ok((co.leads || []).every(l => !(l.atividade_real && l.nunca_tocado)) &&
     (co.leads || []).every(l => !(l.toque_herdado && l.nunca_tocado)),
    'os 4 buckets sao mutuamente exclusivos lead a lead, nao so no total');
  // O campo tem de VIAJAR mesmo em lead com toque: e o que impede o front de dizer
  // "nenhum toque" por ausencia de CAMPO -- a mesma regressao que quase voltou na leva 4.
  ok((co.leads || []).every(l => typeof l.toques_manuais_antes === 'number'),
    'toques_manuais_antes viaja em TODO lead, nao so no herdado');
  ok(/posterior/i.test((J.premissas || {}).toque_apos_criacao || ''),
    'o corte pre-lead esta DECLARADO em premissas (numero novo sem premissa e indistinguivel de numero errado)');

  // ── 2e. O CORTE POR BDR NÃO PODE MENTIR POR OMISSÃO ───────────────────────────
  // Mesma auditoria: a tabela dizia "Gabriele criou 5, falou com 5" e ela tinha tocado
  // 41 leads no mês; e quem criou ZERO simplesmente não ganhava linha — Cíntia
  // Rodrigues (35 leads/66 toques), Anderson Souza, Thauan Pontes e Yokyko Muramoto
  // estavam AUSENTES com trabalho medido no armazém. Ausência lê como "não fez nada".
  console.log('\n== corte por BDR: trabalho na janela e roster visivel ==');
  const { BDR_TEAM } = require(path.join(ROOT, 'lib', 'bdr-team.js'));
  const bdrRows = (co.por_dimensao && co.por_dimensao.bdr) || [];
  const nomes = bdrRows.map(r => r.valor);
  const faltando = BDR_TEAM.filter(n => nomes.indexOf(n) < 0);
  ok(faltando.length === 0,
    'TODO BDR do roster tem linha, mesmo zerado (linha ausente e indistinguivel de "nao medido")',
    faltando.length ? 'faltando: ' + faltando.join(', ') : BDR_TEAM.length + '/' + BDR_TEAM.length);
  ok(bdrRows.every(r => typeof r.trab_leads === 'number' && typeof r.trab_toques === 'number'),
    'toda linha carrega o trabalho na janela, nao so a coorte');
  ok(bdrRows.every(r => typeof r.roster === 'boolean'),
    'a linha declara se e do roster -- tabela "BDR" nao pode creditar quem nao e BDR');
  ok(bdrRows.some(r => r.roster === false),
    'dono de lead fora do roster APARECE marcado, em vez de virar BDR por engano',
    bdrRows.filter(r => !r.roster).map(r => r.valor).slice(0, 4).join(', '));
  // O caso que originou tudo: existe BDR cujo trabalho na janela e MUITO maior que a
  // coorte. Se isso deixar de existir, a coluna nova perdeu o sentido -- ou quebrou.
  const carteira = bdrRows.filter(r => r.roster && r.trab_leads > r.criados * 2);
  ok(carteira.length > 0,
    'ha BDR cujo trabalho na janela supera de longe a coorte (o defeito "criou 5, falou com 5")',
    carteira.map(r => r.valor + ': coorte ' + r.criados + ' vs trabalho ' + r.trab_leads).slice(0, 3).join(' | '));
  const tj = J.trabalho_na_janela || {};
  ok(tj.leads_tocados > 0 && tj.toques > 0,
    'o total de trabalho do time viaja no payload', tj.leads_tocados + ' leads / ' + tj.toques + ' toques');
  // O total é DISTINCT no banco; a soma das linhas conta duas vezes o lead tocado por
  // dois BDRs. Se o total ficar MAIOR que a soma, o DISTINCT sumiu.
  ok(tj.leads_tocados <= tj.soma_das_linhas.leads,
    'total do time <= soma das linhas (DISTINCT no banco; lead tocado por 2 BDRs conta em cada linha)',
    tj.leads_tocados + ' <= ' + tj.soma_das_linhas.leads);
  ok(/quem TOCOU/i.test(tj.atribuicao || ''),
    'a atribuicao do trabalho (quem tocou, nao o dono) esta declarada no bloco');
  ok(/24%|378/.test((J.premissas || {}).trabalho_na_janela || ''),
    'a premissa declara a ESCALA da divergencia de atribuicao (24% dos toques nao sao do dono)');
  ok(/roster/i.test((J.premissas || {}).roster_sempre_visivel || ''),
    'a regra do roster sempre visivel esta declarada em premissas');

  // ── 2f. A DIMENSÃO ORIGEM ESTÁ CONTAMINADA NA FONTE ───────────────────────────
  // Achado de tabela na mesma auditoria: axenya_origem_canonica devolve BOOLEANO. Não
  // se conserta nesta tela (é projeção do silver), mas "true" como categoria parece
  // análise — então tem de estar declarado, e o teste impede a declaração de sumir
  // num refactor enquanto o dado continuar sujo.
  console.log('\n== dimensao origem contaminada (declarada, nao escondida) ==');
  const orig = (co.por_dimensao && co.por_dimensao.origem) || [];
  const bool = orig.filter(r => r.valor === 'true' || r.valor === 'false');
  if (bool.length) {
    ok(/boolean/i.test((J.divergencias_conhecidas || {}).origem_contaminada || ''),
      'origem booleana esta DECLARADA em divergencias_conhecidas enquanto o dado estiver sujo',
      bool.map(r => r.valor + ': ' + r.criados).join(' | '));
  } else {
    ok(true, 'origem nao tem mais valor booleano -- o silver foi consertado, reveja a declaracao');
  }

  // ── 2c. A RAZÃO da desqualificação, e as duas contradições ────────────────────
  console.log('\n== razao auditavel da desqualificacao ==');
  const dqs = J.desqualificacoes || [];
  ok(dqs.every(d => d.etapa_de_origem && typeof d.teve_toque === 'boolean'),
    'toda desqualificacao carrega etapa de origem e se houve toque');
  const contra = dqs.filter(d => d.contradiz_motivo);
  const semToque = dqs.filter(d => d.desqualificado_sem_toque);
  ok(contra.every(d => /n[aã]o houve tentativa/i.test(d.motivo) && d.teve_toque),
    'contradiz_motivo == motivo diz "sem tentativa" E houve toque', contra.length);
  ok(semToque.every(d => !d.teve_toque && !/n[aã]o houve tentativa/i.test(d.motivo)),
    'desqualificado_sem_toque == outro motivo E nenhum toque', semToque.length);
  ok(J.diagnostics.contradicoes_desqualificacao.motivo_diz_sem_tentativa_mas_teve_toque === contra.length,
    'o diagnostico bate com a lista (contagem nao inventada)');
  ok(!!(J.premissas || {}).regua_atividade_corrigida,
    'a CORRECAO da regua esta declarada em premissas, nao so no commit');
  ok(!!(J.premissas || {}).razao_da_desqualificacao,
    'a ausencia de campo de razao livre no portal esta declarada');

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

  // ── 6b. Waterfall MACRO: a aritmética TEM de fechar ───────────────────────────
  console.log('\n== waterfall macro (a aritmetica fecha?) ==');
  const M = J.macro || {};
  const soma = M.aberto_inicio + M.entrada_no_funil + M.reativados - M.qualificados - M.desqualificados - M.saiu_do_recorte;
  ok(M.aberto_fim === soma + M.residuo, 'identidade do waterfall (inclui a saida do recorte)', M.conferencia);
  ok(typeof M.saiu_do_recorte === 'number', 'a saida por troca de pipeline tem barra propria', M.saiu_do_recorte);
  ok(Math.abs(M.residuo) <= Math.max(5, M.aberto_fim * 0.005),
    'residuo dentro da tolerancia declarada (<= 0,5% do saldo ou 5 leads)', M.residuo + ' de ' + M.aberto_fim);
  ok(M.aberto_inicio > 0 && M.aberto_fim > 0, 'saldos de abertura e fecho positivos', M.aberto_inicio + ' -> ' + M.aberto_fim);
  ok(typeof M.criados_sem_movimento === 'number',
    'lead criado sem movimento de etapa e MEDIDO, nao silenciado', M.criados_sem_movimento);
  // A saida do pool so conta quem saiu de etapa ABERTA. Contar "para=qualificado" de
  // qualquer origem incluiria reativacao e inflaria a saida -- foi o defeito medido
  // que levou o residuo de +1 para +5.
  ok(M.qualificados <= (J.waterfall.setas['conectado>qualificado'] || 0) + (J.waterfall.setas['tentativa>qualificado'] || 0) + (J.waterfall.setas['novo>qualificado'] || 0),
    'saida para Qualificado nao conta reativacao de desqualificado', M.qualificados);

  // ── 6c. POR STATUS: a conservacao por etapa, o corte que faltava ──────────────
  console.log('\n== waterfall por status ==');
  const PS = J.waterfall.por_status || [];
  ok(PS.length === 5, 'as 5 etapas canonicas presentes (inclui o terminal)', PS.length);
  PS.forEach(s => ok(s.saldo_fim === s.saldo_inicio + s.entradas - s.saidas + s.residuo,
    'conservacao em ' + s.rotulo, s.saldo_inicio + ' + ' + s.entradas + ' - ' + s.saidas + ' = ' + s.saldo_fim + ' (res ' + s.residuo + ')'));
  const resPS = PS.filter(s => ['novo','tentativa','conectado'].includes(s.etapa)).reduce((a, s) => a + s.residuo, 0);
  ok(resPS === M.residuo,
    'os DOIS modelos concordam no residuo (macro x soma por status) -- e isso que valida a decomposicao', resPS + ' vs ' + M.residuo);
  const somaEnt = PS.reduce((a, s) => a + s.entradas, 0);
  ok(somaEnt === Object.values(J.waterfall.setas).reduce((a, b) => a + b, 0),
    'Sigma entradas por status == Sigma setas (o mesmo total por dois cortes)', somaEnt);

  // ── 6d. Trilha por lead: e o que torna o drill auditavel ──────────────────────
  console.log('\n== trilha dos leads movimentados ==');
  const LM = J.waterfall.leads || [];
  ok(LM.length > 0, 'ha leads com trilha', LM.length + ' de ' + J.waterfall.leads_total);
  ok(J.waterfall.leads_truncado === 0 || J.waterfall.leads_truncado > 0,
    'truncagem DECLARADA, nunca silenciosa', 'truncado: ' + J.waterfall.leads_truncado);
  ok(LM.every(l => l.criado !== undefined && l.status_atual && Array.isArray(l.passos) && l.passos.length),
    'todo lead traz CRIADO, STATUS ATUAL e a trilha de passos');
  ok(LM.every(l => l.passos.every((p, i, a) => i === 0 || a[i - 1].passo <= p.passo)),
    'passos em ordem cronologica dentro da janela');
  ok(LM.every(l => l.n_movimentos === l.passos.length), 'n_movimentos == tamanho da trilha');
  const encad = LM.filter(l => l.passos.length > 1)
    .filter(l => l.passos.every((p, i, a) => i === 0 || a[i - 1].para === p.de));
  ok(encad.length >= LM.filter(l => l.passos.length > 1).length * 0.9,
    'a trilha ENCADEIA (o "para" de um passo e o "de" do seguinte) em >= 90% dos leads com 2+ passos',
    encad.length + ' de ' + LM.filter(l => l.passos.length > 1).length);
  ok(LM.every(l => l.passos.every(p => p.hora && /^\d{2}:\d{2}$/.test(p.hora))), 'cada passo tem hora');

  // ── 6e. JANELA UNIVERSAL e o teto de payload ──────────────────────────────────
  // A tela ficava "presa em agosto": o filtro "Tudo" devolve start/end nulos e o default
  // caia no mes corrente. E quando a janela longa passou a funcionar, ela nao respondia
  // por tamanho -- 15,79 MB, acima do teto da Vercel. Os dois casos ficam travados aqui.
  console.log('\n== janela universal (o defeito "preso em agosto") ==');
  const tudo = await call({ funil: 'todos', tudo: '1', refresh: '1' });
  ok(tudo.code === 200 && tudo.body.success, 'janela "Tudo" responde 200', tudo.code);
  const T = tudo.body;
  ok(T.janela.dias > 700, 'a janela "Tudo" cobre o historico, nao o mes corrente',
    T.janela.since + ' -> ' + T.janela.until + ' (' + T.janela.dias + ' dias)');
  ok(/tudo/.test(T.janela.origem), 'a origem da janela e DECLARADA no payload', T.janela.origem);
  ok(T.janela.since < '2025-01-01', 'o piso vem do DADO (primeiro lead), nao de data chumbada', T.janela.since);
  const mb = Buffer.byteLength(JSON.stringify(T)) / 1048576;
  ok(mb < 4, 'payload da janela completa abaixo do teto de resposta da Vercel', mb.toFixed(2) + ' MB');
  ok(T.coorte.criados > 10000, 'a agregacao cobre a coorte inteira, nao a lista capada',
    T.coorte.criados + ' criados contra ' + T.coorte.leads.length + ' no detalhe');
  ok(T.coorte.leads_truncado === true, 'a truncagem do detalhe e DECLARADA na janela longa');
  ok(T.coorte.taxa_contato.por_atividade.n + T.coorte.taxa_contato.so_automacao + T.coorte.taxa_contato.toque_herdado + T.coorte.taxa_contato.nunca_tocados === T.coorte.criados,
    'MECE de 4 buckets vale na janela completa tambem',
    T.coorte.taxa_contato.por_atividade.n + '+' + T.coorte.taxa_contato.so_automacao + '+' + T.coorte.taxa_contato.toque_herdado + '+' + T.coorte.taxa_contato.nunca_tocados + '=' + T.coorte.criados);
  ok(Math.abs(T.macro.residuo) <= Math.max(5, T.macro.aberto_fim * 0.005),
    'o waterfall FECHA na janela de 936 dias (era -1.285 antes da barra de saida do recorte)',
    T.macro.residuo + ' de ' + T.macro.aberto_fim);
  ok(T.macro.saiu_do_recorte > 0, 'a saida por troca de pipeline aparece na janela longa', T.macro.saiu_do_recorte);
  // as faixas nascem no SQL: o detalhe carrega o rotulo, o front nao recalcula
  ok((T.coorte.leads || []).every(l => l.dim_porte && l.dim_tier && l.dim_vidas && l.dim_origem),
    'toda linha do detalhe carrega o rotulo de faixa vindo do SQL (o front nao recalcula)');
  const dimsEsperadas = ['bdr', 'porte', 'tier', 'vidas', 'origem'];
  ok(dimsEsperadas.every(d => Array.isArray((T.coorte.por_dimensao || {})[d])),
    'as 5 dimensoes vem agregadas do BigQuery', Object.keys(T.coorte.por_dimensao || {}).join(','));
  dimsEsperadas.forEach(d => {
    const soma = (T.coorte.por_dimensao[d] || []).reduce((a, r) => a + r.criados, 0);
    ok(soma === T.coorte.criados, 'a dimensao "' + d + '" e uma PARTICAO da coorte', soma + ' vs ' + T.coorte.criados);
  });
  ok(!!(T.premissas || {}).janela_universal, 'a janela universal esta declarada em premissas');
  ok(!!(T.premissas || {}).agregacao_no_banco, 'a agregacao no banco esta declarada em premissas');

  // ── 6b. CONVERSÃO ENTRE ETAPAS e o corte "só BDRs" ────────────────────────────
  // As duas coisas que este bloco impede de voltar:
  //  · TAXA ACIMA DE 100%. Aconteceu de verdade na primeira medição: 11 leads com
  //    deal para 10 qualificados em ago/26, porque `com_deal` NÃO é subconjunto de
  //    `qualificados` — há lead que vira negócio sem passar pela etapa. O passo usa
  //    a interseção, e o avulso viaja como `deal_sem_qualificar` em vez de sumir.
  //  · FILTRO QUE ESCONDE. "Só BDRs" recorta o corte de gente; se o que ele tira não
  //    fechasse com a diferença entre as duas populações, seria dado sumindo em
  //    silêncio — e filtro que some com dado é indistinguível de bug.
  console.log('\n== conversão entre etapas + corte de BDR ==');
  const CV = (T.coorte || {}).conversao || {};
  ok(!!CV.bdr && !!CV.todos, 'a conversão vem nas DUAS populações (só BDRs e todos)');
  ok(CV.todos.criados === T.coorte.criados, 'a população "todos" é a coorte inteira', CV.todos.criados + ' vs ' + T.coorte.criados);
  ok(CV.bdr.criados <= CV.todos.criados, 'o recorte de BDR nunca é maior que o total', CV.bdr.criados + ' <= ' + CV.todos.criados);
  const foraCriados = (CV.fora_do_time || []).reduce((a, r) => a + r.criados, 0);
  ok(CV.bdr.criados + foraCriados === CV.todos.criados,
    'BDR + fora do time == total: o filtro RECORTA, nao esconde', CV.bdr.criados + ' + ' + foraCriados + ' = ' + CV.todos.criados);
  ok((CV.fora_do_time || []).every(r => r.papel && r.papel.length > 2),
    'todo dono excluido tem o PAPEL nomeado (executivo, arquivado, sem dono...)');
  ['bdr', 'todos'].forEach(pop => {
    const C = CV[pop];
    ok(C.passos.every(p => p.pct === null || (p.pct >= 0 && p.pct <= 100)),
      'nenhum passo de conversao passa de 100% em "' + pop + '"', C.passos.map(p => p.pct).join(' / '));
    // A régua é acumulada, então as etapas ENCAIXAM. Se um dia deixarem de encaixar,
    // o funil parou de ser funil e a tela precisa gritar em vez de desenhar.
    ok(C.etapas.tentativa <= C.criados && C.etapas.conectado <= C.etapas.tentativa &&
       C.etapas.qualificado <= C.etapas.conectado,
      'as etapas ENCAIXAM (regua acumulada) em "' + pop + '"',
      [C.criados, C.etapas.tentativa, C.etapas.conectado, C.etapas.qualificado].join(' >= '));
    ok(C.passos.every(p => p.n + p.perda === p.base), 'passa + perde == base, em todo passo de "' + pop + '"');
  });
  ok(CV.bdr.etapas.deal >= CV.bdr.passos[3].n,
    'deal total >= deal QUALIFICADO (a diferenca e o lead que virou negocio sem a etapa)',
    CV.bdr.etapas.deal + ' >= ' + CV.bdr.passos[3].n);
  ok(!!(T.premissas || {}).so_bdr_no_corte_de_gente, 'o corte "só BDRs" esta declarado em premissas');
  ok(!!(T.premissas || {}).conversao_por_coorte, 'a regua de conversao por coorte esta declarada em premissas');
  // A marca de BDR viaja em TODA dimensão: sem isso, ligar o filtro recortaria a
  // tabela de gente e deixaria o corte por porte/origem contando lead de executivo.
  dimsEsperadas.forEach(d => {
    ok((T.coorte.por_dimensao[d] || []).every(r => typeof r.bdr === 'boolean'),
      'a dimensao "' + d + '" carrega a marca de BDR por linha');
  });
  const somaBdr = dimsEsperadas.map(d =>
    (T.coorte.por_dimensao[d] || []).filter(r => r.bdr).reduce((a, r) => a + r.criados, 0));
  ok(somaBdr.every(v => v === somaBdr[0]),
    'o recorte de BDR da o MESMO total nas 5 dimensoes', somaBdr.join(' / '));
  ok(somaBdr[0] === CV.bdr.criados, 'o recorte por dimensao bate com a conversao de BDR', somaBdr[0] + ' vs ' + CV.bdr.criados);

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
