# SEO Performance | `/growth/seo`

Painel de busca orgânica lido AO VIVO do Google Search Console. Substitui a
conferência manual no relatório nativo do GSC, que não junta na mesma tela linha
do tempo, comparação de períodos e movimentação por entidade.

Construído em 2026-08-06. Toda decisão abaixo foi **medida** na propriedade, não
herdada de convenção de mercado.

---

## Arquivos

| Arquivo | Papel |
|---|---|
| `lib/gsc.js` | Cliente Search Console. Auth Service Account JWT RS256, `searchAnalytics.query`, `freshness()`, retry e cache de token. |
| `lib/seo-analytics.js` | Semântica: categorias, marca, seções, janelas de comparação, agregação, deltas e rollups. **Puro, zero rede.** |
| `api/seo-performance.js` | Endpoint `GET /api/seo-performance`. Junta tudo e devolve um payload por janela (base ancorada ou livre). |
| `public/seo-performance.html` | Chrome da página (mesmo CSS das subpáginas BDR/Growth) + CSS de tabela ordenável e strip de comparação. |
| `public/seo-performance.js` | `SeoPerf`: strip de bases, KPIs, linha do tempo SVG, 10 visões, modo Movimentação/Agregado, janela livre, ordenação, filtros, busca, drilldowns, CSV. |
| `scripts/test-seo-performance.js` | 47 asserções de contrato, zero rede. Roda no `npm run check`. |
| `scripts/smoke-seo-performance-browser.js` | Smoke funcional por CDP. `npm run smoke:seo-perf`. |

## Configuração

| Env var | Valor | Origem |
|---|---|---|
| `GSC_SERVICE_ACCOUNT_JSON` | JSON da service account | Secret Manager `axenya-opencode-gsc-service-account-json-shared` (projeto `gen-lang-client-0423905839`) |
| `GSC_SITE_URL` | `sc-domain:axenya.com` | fixo; há default no código |

A service account é `growth@gen-lang-client-0423905839.iam.gserviceaccount.com` e
tem `siteOwner` na propriedade. Se aparecer 403, é permissão no Search Console, não
credencial: adicionar esse e-mail como usuário da propriedade.

Local:

```bash
GSC_SERVICE_ACCOUNT_JSON="$(gcloud secrets versions access latest \
  --secret=axenya-opencode-gsc-service-account-json-shared \
  --project=gen-lang-client-0423905839)" \
LOCAL_DEV_BYPASS=true node scripts/local-server.js 3007
# http://localhost:3007/growth/seo
```

---

## As 10 armadilhas medidas (não regredir)

1. **`dataState: 'all'` mostra queda falsa.** Os 2 últimos dias vêm parciais: em
   06/08/2026 o dia corrente aparecia com **1 clique** contra ~130 dos dias
   fechados. Todo cálculo usa `final`; `all` só serve para contar quantos dias
   parciais existem depois do corte. Última data fechada e defasagem vão no
   payload (`frescor`) e aparecem no bloco de cobertura.

2. **Fim de semana rende ~1/4 de um dia útil.** Médias de 89 dias: domingo 36 e
   sábado 32 cliques/dia contra 124, 125 e 127 de segunda a quarta. Por isso as
   janelas são **múltiplos de 7**: WoW 7, MoM 28 (4 semanas), QoQ 91 (13 semanas),
   YoY 28 contra 28 de **364** dias atrás (52 semanas, preserva o dia da semana).
   O teste de contrato compara os histogramas de dia da semana das duas pontas e
   exige igualdade — e prova que uma janela de 30 dias falharia nisso.

3. **`dimensions: ['date','query']` estoura e não pagina.** Em 90 dias devolveu
   exatamente 25.000 linhas e `startRow: 25000` devolveu **0**. Não existe
   paginação além do teto. Por isso nunca cruzamos data com entidade: pedimos o
   agregado da janela A, o da janela B, e subtraímos.

4. **Posição e CTR não se somam.** No mesmo conjunto, posição por média simples
   deu 7,90 e ponderada por impressão 8,00; CTR por média de CTRs deu 0,77%
   contra 1,61% recalculado. Agregação é sempre ponderada por impressão (posição)
   e `clicks/impressions` (CTR).

5. **A soma da série diária reproduz o agregado da API com igualdade de float.**
   Verificado em 08/05 a 04/08/2026: `dimensions: []` e a soma por data deram
   ambos 8.108 cliques, 676.778 impressões e posição 6.400175537620904. Por isso
   os KPIs de **todas** as bases saem de UMA série diária, e é impossível o KPI
   divergir do gráfico. Trocar de base só refaz a movimentação por entidade.

6. **A dimensão `query` cobre uma fração do site.** Em 90 dias: 27,5% dos cliques
   e 20,4% das impressões, porque o Google anonimiza cauda longa. Somar a coluna
   de cliques da tabela **nunca** vai dar o total do site. A cobertura é exibida em
   número e vira aviso de higiene abaixo de 40%.

7. **A dimensão `page` infla impressão.** Cliques por página fecham (100,5% do
   total), impressões dão 129,5%, porque duas URLs na mesma SERP contam impressão
   cada uma. Impressão por página serve para comparar páginas entre si, nunca com
   o total do site.

8. **Bucket parcial não pode exibir variação.** O mês corrente com 4 de 31 dias
   comparado ao mês fechado anterior devolvia −88,5% de clique. Bucket parcial vai
   cinza, marcado, e com `dc`/`dpct`/`dp` em `null` de propósito. O smoke checa
   isso.

9. **A série tem que ter tamanho múltiplo de 7.** `DIAS_TIMELINE = 455` (65
   semanas exatas). Com 456 sobrava um bucket semanal de 1 dia no começo e o
   bucket seguinte comparava semana cheia contra semana quebrada.

10. **Rótulo de página precisa carregar fragmento, host e query.** Três colisões
   reais, medidas em janelas diferentes: 27 rótulos iguais porque o Google indexa
   "links para seções" como URLs próprias (`...#cronograma-120-dias`); 6 hosts
   servindo `/` porque a propriedade é `sc-domain:` (inclusive
   `http://axenya.com/` com 13 cliques, ou seja, a versão http continua
   indexada); e variantes de query string indexadas (`?utm_campaign=post`,
   `?__hstc=...` do HubSpot) aparecendo separadas da URL limpa. Sem os três no
   rótulo, a tabela mostra linhas visualmente idênticas com números diferentes.
   `sectionOf` continua ignorando fragmento e query, e subdomínio virou a seção
   própria `Subdomínios` para não inflar a Home.

Bônus: `searchAppearance` volta vazio nesta propriedade — não usar como dimensão.
O horizonte disponível era 501 dias (desde 24/03/2025); a API corta em ~16 meses.

---

## Convenções da tela

- **Posição menor é melhor.** `deltaPosition` é `atual − anterior`, então valor
  negativo é ganho e é pintado de **verde**. É a única métrica da página com essa
  inversão.
- **`novo` e `perdido` são status próprios**, não ±100%. Quando o clique empata, o
  status olha impressão e só muda com 20% ou mais de variação.
- **Ordem padrão** é maior movimento absoluto de clique (`↕`), porque é o que
  explica a variação do total. Clicar no cabeçalho alterna decrescente, crescente
  e (nas colunas de variação) absoluto.
- **Separador de texto é sempre `|`.** Travessão só como placeholder de sem dado.

## Modos da tabela | Movimentação e Agregado

O toggle acima da tabela troca o que as colunas contam, sem nova ida à API.

- **Movimentação** (default): Δ de cliques, impressões e posição contra a janela de
  referência, mais o status (`novo`, `perdido`, `subiu`, `caiu`, `estável`). Ordem
  default é o maior movimento absoluto de clique.
- **Agregado**: as colunas de variação saem e entram cliques, impressões, CTR,
  posição e **participação** de cada linha no total da dimensão. É a visão geral
  para ler um período no detalhe. Ordem default é cliques.

O denominador da participação é o **total da dimensão na janela**, calculado no
servidor sobre o universo inteiro (`totaisDimensao`), não sobre as linhas que
couberam no payload — senão a coluna mentiria sempre que houvesse corte. Para
consultas esse total é menor que o total do site (anonimização), então a
participação é "dentro do que a dimensão explica"; o bloco de cobertura diz quanto
é isso.

## Janela livre | De e Até

Preencher **De** e **Até** e clicar em Aplicar troca a base para `Personalizado`
(`?from=&to=`). A janela de referência default é o período imediatamente anterior,
do MESMO tamanho — é o único default que não inventa premissa; `?cmpFrom=&cmpTo=`
permite escolhê-la à mão.

Dois vieses possíveis, e os dois viram aviso de higiene em vez de silêncio:

| Situação | O que a tela diz |
|---|---|
| Intervalo não múltiplo de 7 (ex.: mês de 31 dias) | as duas pontas não têm a mesma quantidade de sábados e domingos, então parte da variação é calendário. Os números **absolutos** do modo Agregado não são afetados, só a variação. |
| Referência de tamanho diferente | a variação compara períodos de duração diferente e não deve ser lida como performance. |

A data final é sempre limitada ao último dia **fechado**; se o pedido passar dele,
`janelas.limitadoAoFechado` vem `true` e os campos da tela são reescritos com a
janela realmente consultada.

## Novos | o que não existia antes

Uma consulta ou página é **nova** quando teve **zero impressão** na janela de
referência e tem impressão na janela atual. Há duas visões dedicadas (`Novos` e
`Novas páginas`), sem as colunas "antes" (seriam zero por definição): o que
interessa é o tamanho da estreia, se já converteu clique e em que posição entrou.

Duas decisões que fazem essa visão funcionar:

1. **Novos vêm em array próprio do servidor** (`movimentos.novos`), ordenado por
   impressão. Filtrar a tabela de movimentação não serviria: um termo novo sem
   clique tem `Δcliques = 0` e afundaria na ordenação por variação.
2. **O corte de payload é a UNIÃO de três ordenações** — topo por variação, topo
   por volume e todos os novos. Cortar só pelas maiores variações (como era na
   primeira versão) descartava silenciosamente a linha de altíssima impressão que
   não mexeu (a que interessa no modo Agregado) e o novo sem clique. As contagens
   das três fatias saem em `movimentos.corte`.

Cuidado com a referência curta: com DoD (1 dia), uma consulta que simplesmente não
apareceu naquele dia já conta como nova. A higiene avisa quando a referência tem
menos de 7 dias. Perdidos são o espelho e ficam a um clique no filtro de Status.

**Exemplo real (julho/2026 contra junho):** 2.374 consultas novas, e as 12 maiores
são todas do cluster CID/burnout/z73 (`cid z73.0` estreou com 2.438 impressões).
Só 23 das 800 carregadas já converteram clique — o resto apareceu e não foi
clicado, o que é a fila de trabalho de título e meta description.

## Categorias

Regra de texto sobre a consulta normalizada, primeira que casa vence. A ordem é
deliberada: específica antes de genérica, senão `reajuste plano de saúde` cairia em
`Plano de saúde empresarial` e a visão de reajuste ficaria vazia.

`Marca` · `NR-01 | PGR | Riscos psicossociais` · `Saúde mental | Absenteísmo` ·
`Afastamento | INSS | CID` · `FAP | CNAE | eSocial` · `Reajuste | VCMH | ANS` ·
`Plano de saúde empresarial` · `SST | Ergonomia | NR-17` · `Produto | Tecnologia` ·
`Benefícios | RH` · `Outros`

Os agregados por categoria usam o universo INTEIRO de consultas da janela, mesmo
quando a tabela está cortada por payload ou filtrada por busca.

## Marca vs não-marca

O corte mais importante do painel: marca mede reconhecimento e mídia, não-marca
mede conteúdo e ranqueamento. Somar os dois esconde qual motor está andando. São
marca as variantes de digitação que aparecem de fato no relatório: `axenya`,
`axenia`, `anexya`, `axeny`.

## Custo e cache

11 chamadas ao GSC por base (1 série diária de 455 dias, 2 de frescor, query e
page × 2 janelas, device e country × 2 janelas), em paralelo. Medido: **2,5 a 2,7
segundos**, payload de 495 KB (WoW) a 638 KB (janela livre de 31 dias). Cache de 6 horas em KV +
memória do lambda, porque o GSC fecha dado uma vez por dia. Quota do Google é 1.200
consultas/minuto por propriedade — folga de duas ordens de grandeza.

## Baseline validado em 06/08/2026 (último dia fechado 04/08)

| Base | Janela | Cliques | Anterior | Variação | Posição |
|---|---|---|---|---|---|
| DoD | 04/08 | 129 | 127 | +1,6% | 6,43 |
| WoW | 29/07 a 04/08 | 629 | 674 | −6,7% | 6,66 |
| MoM | 08/07 a 04/08 | 2.543 | 2.311 | +10,0% | 6,50 |
| QoQ | 06/05 a 04/08 | 8.274 | 2.446 | +238,3% | 6,40 |
| YoY | 08/07 a 04/08 | 2.543 | 375 | +578,1% | 6,50 |

Seções na janela WoW: Blog 545 cliques, Home 73, Observatório 4, Soluções 4.
Marca 57 contra não-marca 100.

## Validação

```bash
node scripts/test-seo-performance.js                                    # 47 asserções, zero rede
npm run check                                                            # inclui o de cima
npm run smoke:seo-perf -- --base-url=http://localhost:3007 --base=wow    # smoke funcional CDP
```

O smoke exige: 4 KPIs hero, 5 cartões de comparação com exatamente 1 ativo, linha
do tempo com barras e linha de posição, 8 visões, ordenação que muda a ordem DE
FATO (e valida a monotonicidade da coluna), busca que filtra e preserva o texto
digitado, troca de visão que troca as colunas, drill de grupo com as entidades
dentro, drill de KPI, drawer de memória de cálculo, drill de período, agregação por
mês com bucket parcial sem variação, destaque de fim de semana e média móvel na
granularidade de dia, bloco de higiene com linhas, modo Agregado sem coluna de
variação e com participação dentro de 0 a 100%, visão Novos sem coluna "antes" e
ordenada por impressão, janela livre de/até com o aviso de intervalo não múltiplo
de 7, rótulos de página sem duplicata, e **console sem erro**. Roda verde nas 5
bases (wow, mom, qoq, dod, yoy).

## Dívidas conhecidas

- **Google Ads e GA4 não entram aqui.** Este painel é só busca orgânica. O
  cruzamento de orgânico com pago vive em `/growth/performance`.
- **Sem conversão.** O GSC não sabe o que aconteceu depois do clique. Ligar clique
  orgânico a lead do HubSpot exige `utm_source`/landing page e é trabalho separado.
- **`searchAppearance` vazio** impede a visão de rich result.
