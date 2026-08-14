'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(ROOT, 'public/bdr-workload-v2.js'), 'utf8');
const core = fs.readFileSync(path.join(ROOT, 'public/bdr-workload-v2-core.js'), 'utf8');
const charts = fs.readFileSync(path.join(ROOT, 'public/bdr-workload-v2-charts.js'), 'utf8');
const info = fs.readFileSync(path.join(ROOT, 'public/bdr-workload-info.js'), 'utf8');
const bdrHtml = fs.readFileSync(path.join(ROOT, 'public/bdr.html'), 'utf8');
const nav = fs.readFileSync(path.join(ROOT, 'public/nav.js'), 'utf8');
const premium = fs.readFileSync(path.join(ROOT, 'public/premium.js'), 'utf8');
const bdrPages = ['bdr.html', 'bdr-workload.html', 'bdr-no-show.html', 'bdr-list-attack.html', 'bdr-treble.html'].map((file) => fs.readFileSync(path.join(ROOT, 'public', file), 'utf8'));
const allJs = js + '\n' + core + '\n' + charts + '\n' + info;
const html = fs.readFileSync(path.join(ROOT, 'public/bdr-workload.html'), 'utf8');
function has(s, m) { assert(allJs.includes(s) || html.includes(s), m || `missing ${s}`); }
assert.equal((core.match(/\['(pulse|channels|management|penetration|evolution)'/g) || []).length, 5, '5 abas v2');
['bloquead', 'experimental', 'desabilitad', 'indisponível', 'bdr_daily_ops', 'snapshot observado'].forEach((word) => assert(!new RegExp(word, 'i').test(js), `texto proibido em strings v2: ${word}`));
assert(js.includes("dimMulti('Porte','porte','portes'") && js.includes("dimMulti('Segmento','segmento','segmentos'") && js.includes("dimMulti('Persona','persona','personas'"), 'multi-select porte/segmento/persona ausente');
['v2-line-area', 'v2-waterfall', 'v2-grouped', 'v2-ranking', 'v2-stacked'].forEach((cls) => has(cls, `componente SVG/lista ausente: ${cls}`));
// grouped delega o clique ao helper bar() (openDrill por barra A/B), então checa o helper.
['lineArea', 'waterfall', 'ranking', 'stacked'].forEach((fn) => { const ix = charts.indexOf('function ' + fn); assert(ix >= 0, `renderer ${fn}`); assert(charts.slice(ix, ix + 2200).includes('openDrill'), `${fn} sem openDrill`); });
assert(charts.indexOf('function grouped') >= 0 && charts.includes('function bar(') && /function bar\([^)]*\)[\s\S]*?openDrill/.test(charts), 'grouped/bar sem openDrill');
assert(js.includes('loadSeq') && js.includes('currentLoad(token)') && js.includes('loadSemantic(token)') && js.includes('loadPen(token)') && js.includes('loadCmp(token)'), 'request token/loadSeq ausente');
assert(core.includes('function validContext') && js.includes('if(validContext(context))p.context=context'), 'sanitização de context ausente');
['index:', 'component:', "'bdr:", 'metric:'].forEach((bad) => assert(!js.includes(bad), `context inválido ainda presente: ${bad}`));
assert(!/openDrill\([^\n]*date:/.test(js), 'context date inválido ainda usado em openDrill');
assert(js.includes('v2-kpi-main') && !js.includes('<button class="kpi v2-kpi'), 'card ainda usa button aninhado/inválido');
assert(html.includes('.v2-kpi-main{width:100%;background:transparent;border:0;color:inherit;text-align:left') && html.includes('.v2-kpi-main:focus-visible{outline:2px solid var(--teal)'), 'CSS do botão KPI v2 deve ser transparente e acessível');
assert(js.includes('openInfo:function') && js.includes('this.info(k)'), 'alias openInfo ausente');
assert(js.includes("'none'") && !js.includes("'total'];"), 'compare breakdown deve usar none, não total');
assert(js.includes("comparePreset==='7d'") && js.includes("porte:dimArr('portes').join(',')") && js.includes("segmento:dimArr('segmentos').join(',')") && js.includes("persona:dimArr('personas').join(',')"), 'compare filtros multi/preset semana ausentes');
assert(js.includes('function cmpRows') && js.includes('aPerBusinessDay') && js.includes('bPerBusinessDay'), 'normalização compare ausente');
assert(js.includes('function coveragePct') && js.includes('coveragePct(cov') && js.includes('wilson95.low') && js.includes('wilson95.high'), 'penetração coverage/association não corrigidos');
assert(js.includes('bdrOverride') && js.includes('p.bdr=bdrOverride') && js.includes('pageDrill:function(p){var d=state.drill;this.openDrill(d.kind,d.context,d.day,p,d.bdrOverride);'), 'override seguro BDR/paginação ausente');
assert(js.includes("p.context='channel:calls'") && js.includes('Calls detalhado exige BDR selecionado'), 'calls deve exigir BDR e context calls');
assert(js.includes("e.key==='Enter'||e.key===' '") && js.includes("tagName==='circle'") && js.includes("tagName==='rect'"), 'keyboard SVG Enter/Space ausente');
assert(js.includes('pageDrill'), 'modal paginação preservada');
assert(js.includes("unavailable(d,'associative_coverage'))return '—';if(v===0)return 0"), 'metricValue deve mostrar indisponível antes de preservar zero');
assert(js.includes("if(!cov.denominatorEligible)return panel(cards+note+st"), 'penetração deve renderizar empty state sem rankings quando denominador=0 e disclaimer permanente');
assert(js.includes("['insercao','Elegibilidade']"), 'domínio insercao deve aparecer como Elegibilidade');
assert(js.includes('Empresas elegíveis') && js.includes('Contatos elegíveis'), 'labels de gestão devem usar elegibilidade');
assert(js.includes('lead elegível criado no período; não criação real de company/contact'), 'memória de cálculo deve esclarecer elegibilidade vs criação real');
assert(js.includes('coorte empresa+owner com lead elegível criado no período, não território total'), 'penetração deve exibir disclaimer permanente de denominador');
assert(js.includes('mesmo owner em até 30 dias; correlação, não causalidade'), 'associação/conversão 30D deve declarar correlação, não causalidade');
assert(js.includes("if(!r.eligible)return panel(head+cards") && js.includes("st('empty','Nenhum lead elegível criado no período'"), 'pulso deve renderizar empty state de reatividade quando eligible=0');
assert(js.includes("['crm','CRM']") && js.includes("['contato_efetivo','Contato efetivo']"), 'domínios CRM habilitados');
assert(html.includes('/bdr-workload-v2-core.js?v=4') && html.includes('/bdr-workload-v2-charts.js?v=5') && html.includes('/bdr-workload-v2.js?v=14') && html.includes('/bdr-workload-info.js?v=4'), 'ordem/cache-busters v2 modular');
assert(html.indexOf('/bdr-workload-v2-core.js') < html.indexOf('/bdr-workload-v2-charts.js') && html.indexOf('/bdr-workload-v2-charts.js') < html.indexOf('/bdr-workload-v2.js?v=14'), 'ordem dos scripts v2 modular inválida');
assert(core.includes('window.WorkloadBDRV2Core') && charts.includes('window.WorkloadBDRV2Charts') && js.includes('WorkloadBDRV2Core') && js.includes('WorkloadBDRV2Charts'), 'namespaces modulares explícitos ausentes');
assert(js.includes('Período anterior equivalente') && core.includes('previousEquivalent') && core.includes('rangeDays'), 'janela anterior equivalente visível/correta em Canais');
assert(core.includes('2–3') && core.includes('4–5'), 'drill agrupado 2–3/4–5 ausente no front');
// Qualidade de ligacao por DESFECHO, nao por duracao (incidente 2026-07-27).
assert(js.includes("{label:'Conectadas'") && js.includes("{label:'Taxa de conexão'") && js.includes("{label:'Tempo em linha'"), 'cards de canal devem expor conectadas, taxa de conexao e tempo em linha');
assert(js.includes("['callsConversation','Lig. conectadas']") && js.includes("['connRate','Taxa conexão']") && js.includes("['talkTime','Tempo em linha']"), 'gestao deve ter colunas de conexao real');
assert(core.includes('function hms('), 'helper de tempo em linha (hms) ausente no core');
assert(!/≥1min|≥ 60 s|duração ≥ 1 min/.test(js + core + info + html), 'definicao antiga por duracao (>=1min) nao pode sobrar em texto de UI');
// E a definicao NOVA tem de estar escrita: conectada = CARIMBO do BDR. O card de
// auditoria (60s+ sem carimbo) so faz sentido junto dessa frase -- sozinho, ele
// vira um sexto desfecho na cabeca de quem le.
assert(/carimbo do BDR/.test(info), 'a ficha de Conectadas tem de dizer que e carimbo do BDR, nao deteccao de quem atendeu');
assert(js.includes("{label:'Longas sem conexão'"), 'card de auditoria do carimbo ausente na aba Canais');
assert(js.includes("context:'outcome:longa_sem_conexao'"), 'o card de auditoria tem de abrir drill (numero sem lista nao audita nada)');
assert(/Reunião agendada/.test(info) && /Reunião agendada/.test(js), 'o desfecho que nenhuma camada mapeia tem de aparecer na ficha E no aviso da tela');
assert(js.includes('hs_call_disposition') && info.includes('hs_call_disposition'), 'memoria de calculo deve citar a fonte hs_call_disposition');
assert(js.includes('fetch(\'/api/bdr-workload-config\'') && js.includes('WorkloadBDRV2.init()') && !js.includes('WorkloadBDR.init()'), 'visão única v2: config só para team, sem fallback v1');
assert(js.includes('role="dialog"') && js.includes("e.key==='Escape'") && js.includes("e.key==='Tab'"), 'modal acessível com escape/focus trap');
assert(js.includes('aria-sort') && js.includes('role="tablist"') && allJs.includes('role="button"'), 'a11y básica');
// multi-seleção de BDR + armazém de gráficos comparativos por BDR
assert(charts.includes('function multiLine') && charts.slice(charts.indexOf('function multiLine')).includes('openDrill'), 'renderer multiLine ausente ou sem openDrill');
['v2-multiline', 'v2-ref-line', 'v2-bdr-menu', 'v2-warehouse'].forEach((cls) => has(cls, `componente multi-BDR ausente: ${cls}`));
assert(core.includes('function movingAverage') && core.includes('function median') && core.includes('function seriesByBdr') && core.includes('function bdrList'), 'helpers de agregação por BDR ausentes');
assert(js.includes('function bdrWarehouse') && js.includes('function selectedBdrs') && js.includes('function apiBdr'), 'armazém por BDR / seleção múltipla ausente');
assert(js.includes('toggleBdr:function') && js.includes('clearBdrs:function') && js.includes('cmpMetric:function') && js.includes('cmpMovingAvg:function') && js.includes('cmpRefs:function'), 'métodos públicos multi-BDR ausentes');
assert(js.includes("q.set(arrKey,s.join(','))") && js.includes("Core.bdrList(q.get(arrKey))"), 'persistência de dimensões multi na URL ausente');
// multi-seleção de porte/segmento/persona + warehouse temático por aba + comparativo por setor
assert(js.includes('function dimMulti') && js.includes('toggleDim:function') && js.includes('clearDim:function'), 'multi-select genérico de dimensão ausente');
assert(js.includes('MULTI_DIMS') && js.includes("['porte','portes']") && js.includes("['segmento','segmentos']") && js.includes("['persona','personas']"), 'dimensões multi (portes/segmentos/personas) ausentes no estado/URL');
assert(js.includes('WAREHOUSE_BY_TAB') && js.includes('bdrWarehouse(d,WAREHOUSE_BY_TAB.pulse)') && js.includes('bdrWarehouse(d,WAREHOUSE_BY_TAB.channels)') && js.includes('bdrWarehouse(d,WAREHOUSE_BY_TAB.management)'), 'warehouse por BDR deve ser temático por aba (não clone)');
assert(js.includes('function sectorWarehouse') && js.includes('sectorWarehouse(d)'), 'comparativo por setor na Penetração ausente');
// Memórias de cálculo específicas e definição inequívoca de cobertura.
['Contato elegível', 'virou Lead no HubSpot', 'Empresa elegível', 'Contato tocado', 'Cobertura de toque', 'Cobertura de porte', 'Cobertura de segmento', 'Cobertura de persona', 'p50 ou mediana', 'Glossário essencial', 'data-workload-info-bound'].forEach((text) => assert(info.includes(text), `memória ou glossário ausente: ${text}`));
assert(info.includes("querySelectorAll('.v2-kpi')") && info.includes("querySelectorAll('.card h2')"), 'todos os KPIs e gráficos devem receber memória específica');
assert(info.includes('Não mede se porte, segmento ou persona estão preenchidos') && info.includes('Não informa se os contatos receberam abordagem'), 'cobertura de toque e completude de atributo devem permanecer distintas');
assert(info.includes("'CRM': 'Movimentos no CRM'") && info.includes("'SQL': 'Leads qualificados (SQL)'") && info.includes("'Elegíveis': 'Empresas elegíveis'"), 'rótulos técnicos devem ser traduzidos para linguagem de negócio');
// Regra temporária de meta: julho e agosto/2026 têm piso e teto inclusivos; outros meses só piso.
assert(bdrHtml.includes("var BDR_GOAL_CAPPED_MONTHS={'2026-07':true,'2026-08':true}"), 'meses excepcionais da meta ausentes');
assert(bdrHtml.includes("BDR_GOAL_CAPPED_MONTHS[_oym(d)] ? d.colaboradores<=2000 : true"), 'teto de 2.000 deve valer em julho e agosto/2026');
assert(bdrHtml.includes('d.colaboradores==null || d.colaboradores<30'), 'piso inclusivo de 30 ausente');
assert(bdrHtml.includes('REGRA TEMPORÁRIA DE JULHO E AGOSTO/2026') && bdrHtml.includes('O teto de 2.000 não se aplica aos demais meses'), 'caveat mensal deve estar explícito no ícone de informação');
const goalMatch = bdrHtml.match(/function _bdrCountsForGoal\(d\)\{([\s\S]*?)\n\}/);
assert(goalMatch, 'função real de elegibilidade da meta não encontrada');
const goal = new Function('d', '_oym', 'BDR_GOAL_CAPPED_MONTHS', goalMatch[1]);
const counts = (colaboradores, month) => goal({ colaboradores }, () => month, { '2026-07': true, '2026-08': true });
assert.strictEqual(counts(29, '2026-07'), false, '29 não conta em julho');
assert.strictEqual(counts(30, '2026-07'), true, '30 conta em julho');
assert.strictEqual(counts(2000, '2026-07'), true, '2.000 conta em julho');
assert.strictEqual(counts(2001, '2026-07'), false, '2.001 não conta em julho');
assert.strictEqual(counts(30, '2026-08'), true, '30 conta em agosto');
assert.strictEqual(counts(2000, '2026-08'), true, '2.000 conta em agosto');
assert.strictEqual(counts(2001, '2026-08'), false, '2.001 não conta em agosto');
assert.strictEqual(counts(2001, '2026-09'), true, 'fora de julho e agosto, preserva regra vigente sem teto');
// Semáforo solicitado no menu canônico.
assert(nav.includes("url:'/novo-bdr/workload',file:'bdr-workload.html',sub:'bdr',health:'y'"), 'Workload deve estar amarelo');
assert(nav.includes("url:'/novo-bdr/list-attack',file:'bdr-list-attack.html',sub:'bdr',health:'r'"), 'Ataque à Lista deve estar vermelho');
assert(nav.includes("url:'/novo-bdr/treble',file:'bdr-treble.html',sub:'bdr',health:'g'"), 'Treble deve estar verde');
assert(premium.includes("href: '/novo-bdr/workload', label: 'Workload | Intraday', health: 'y'"), 'Workload deve estar amarelo no menu interno');
assert(premium.includes("href: '/novo-bdr/list-attack', label: 'Ataque à Lista', health: 'r'"), 'Ataque à Lista deve estar vermelho no menu interno');
assert(premium.includes("href: '/novo-bdr/treble', label: 'Treble', health: 'g'"), 'Treble deve estar verde no menu interno');
// v=12: entrada Growth | Performance adicionada ao NAV_MODEL do premium.js
// (2026-08-06). Menu mudou => cache-buster sobe em TODA página que monta o menu
// por premium.js, senão o browser serve o menu antigo sem a rota nova.
bdrPages.forEach((page, index) => assert(page.includes('/premium.js?v=13'), `página BDR ${index} sem cache-buster canônico do menu`));
console.log('PASS bdr-workload-v2 UI static tests');
