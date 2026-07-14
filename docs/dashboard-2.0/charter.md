# Charter | Dashboard 2.0

> **Status: ✅ APROVADO pelo dono em 2026-07-14** (aprovação expressa sem ajustes,
> com revisão posterior prevista — ajustes futuros são bem-vindos e devem ser
> registrados por edição direta ou ADR quando mudarem uma decisão).
> As 20 perguntas foram extraídas dos canônicos do 1.0 (pergunta-norte do README,
> modelo mental do CRO, painéis existentes) e das anotações do documento de
> planejamento.

## 1. O que o dashboard é

A **fonte única de conhecimento da empresa** para decisão: Sales/Forecast (núcleo
atual), expandindo para Marketing, CS e Implantação. Todo número é auditável
(proveniência por construção), bilíngue (PT/EN) e distingue explicitamente dado
calculado de dado inserido manualmente.

## 2. Consumidores e a decisão de cada um

| Consumidor | Decisão que o dash informa | Onde consome hoje |
|---|---|---|
| **Ivan Gouvea (CRO)** | Vou bater a meta? Onde alocar esforço de AE/BDR? O que reportar ao board? | `/novo`, `/forecast`, `/forecast-delta` |
| **Mariano + BoD** | Meta, investimento, contratação. Consome números em apresentação — por isso nada não-validado pode parecer pronto | via CRO (futuro: one-pager executivo) |
| **Aurilia (Ops/Marketing)** | Quais canais/campanhas geram pipeline que converte; validação de histórico | futuro painel Marketing |
| **Liderança de vendas** | Coaching de AE/BDR, cadência, deals parados | `/novo-ae`, `/novo-bdr`, `/novo-48h` |
| **CS** | Risco de churn, calendário de renovação, capital a risco | `/novo-cs` |
| **Cíntia / RevOps** | Qualidade do dado na origem, processo de forecast | drawers de proveniência, auditorias |
| **Pacheco Jr (dono/builder)** | O que validar, o que construir a seguir | tudo + AUDITORIA_GRAFICOS.md |

## 3. As 20 perguntas (proposta)

Legenda de cobertura hoje: ✅ coberta no 1.0 · 🟠 parcial · ⬜ gap.

### Forecast e meta (a pergunta-norte: "vou ou não vou bater a meta?")

| #   | Pergunta                                                                                    | Hoje                     |
| --- | ------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | Vou ou não vou bater a meta (mês / trimestre / ano)?                                        | ✅ `/forecast`, N06B      |
| 2   | Quanto da receita projetada é **real** (contratada/faturando) vs **probabilizada**?         | ✅ Regra primária nº 3    |
| 3   | Quanto pipeline preciso gerar para cobrir a meta (cobertura ×)?                             | ✅ N05                    |
| 4   | Quais deals movem o forecast e qual o risco de concentração?                                | ✅ top 10 / triagem       |
| 5   | O que mudou desde a última leitura (semana/mês)?                                            | ✅ `/forecast-delta`      |
| 6   | Se os top N deals escorregarem um trimestre, o que acontece? (cenário)                      | ⬜                        |
| 7   | Quando a resposta é "não bato": onde erramos — ciclo? receita média? conversão? originação? | 🟠 diagnóstico espalhado |

### Funil e conversão

| # | Pergunta | Hoje |
|---|---|---|
| 8 | Qual a taxa de conversão **ajustada** (`ganhos ÷ (ganhos+perdidos)`), geral e por etapa? | ✅ C06/C07 |
| 9 | Qual o ciclo de vendas e o tempo até resposta (ganhar vs ganhar/perder)? | 🟠 N07 validado; toggle das duas leituras pendente |
| 10 | Quantos fechamentos ainda virão do pipe aberto? (projeção pela conversão ajustada) | 🟠 |
| 11 | Por que perdemos? (motivos de perda, auditáveis) | 🟠 roster de motivos precisa limpeza na origem |

### Originação e topo de funil

| # | Pergunta | Hoje |
|---|---|---|
| 12 | Os BDRs estão gerando reuniões suficientes, com que qualidade e que esforço? | ✅ `/novo-bdr` + workload |
| 13 | Quais canais/origens geram pipeline que **converte** (não só volume)? | 🟠 `origem__originacao_` com ~17% preenchimento |
| 14 | A cadência de leads está saudável (trabalhados, taxa de contato, penetração)? | ✅ R16–R22 |

### Execução de vendas

| # | Pergunta | Hoje |
|---|---|---|
| 15 | Como cada AE performa (win rate real, ciclo, pipeline carregado)? | 🟠 `/novo-ae`; win rate sem perdidos em parte dos cards |
| 16 | Quais deals estão parados e precisam de ação agora? | ✅ stale / `/novo-48h` |

### CS e pós-venda

| # | Pergunta | Hoje |
|---|---|---|
| 17 | Quais contas têm risco de churn e quanta receita está em risco? | 🟠 `/novo-cs` (proxy) |
| 18 | Como está o calendário de renovações dos próximos 12 meses? | ✅ `/novo-cs` |
| 19 | Quanto capital está a risco entre "ganho" e assinatura/implantação concluída? | ✅ toggle Implantação = Ganho |

### Board

| # | Pergunta | Hoje |
|---|---|---|
| 20 | Quais são os 8–12 números que o board precisa ver numa página, com comparativo (YoY / vs plano)? | ⬜ executive snapshot |

> **Regra de uso:** todo painel/gráfico novo declara qual pergunta responde. Se não
> rastreia a nenhuma, é vaidade e não entra (princípio da Fase 0 do doc de
> planejamento). As ~370 visualizações do 1.0 serão gradualmente mapeadas a estas
> perguntas — as órfãs são candidatas a poda quando houver telemetria (Fase 7).

## 4. Registro build-vs-buy

**Decisão: continuar custom, dentro deste repo.** Detalhe e alternativas em
[ADR-001](decisoes-adr.md#adr-001). Resumo do racional:

- O que ferramentas prontas (Metabase/Looker/Power BI) dariam de graça (BI, i18n,
  auditoria) já existe aqui em grande parte: motor de receita validado
  (`forecast-engine.js`), sistema de snapshot com recompute determinístico, i18n
  PT/EN, drawers de proveniência — o custo já foi pago.
- O diferencial exigido pelo CRO (memória de cálculo por gráfico, régua de
  remuneração própria, dedup fee×corretagem, toggle Implantação=Ganho) é exatamente
  o que essas ferramentas não dão sem customização pesada.
- A opção híbrida (front custom + metrics layer pronto: dbt metrics, Cube.dev,
  Evidence) foi avaliada: adicionaria infra, dependências e curva de aprendizado a
  um projeto operado por não-programador com IA, contra o ganho de um catálogo que
  a Fase 1 entrega em 3 arquivos JSON.
- **Gatilhos de revisão** (reabrir esta decisão se): o catálogo passar de ~150
  métricas ativas; surgirem >3 fontes de dados além do HubSpot; entrar um
  engenheiro dedicado no time; ou o custo de manutenção do motor caseiro superar
  2 dias/mês.

## 5. Critérios de sucesso do 2.0

1. Dois painéis que usam a mesma métrica mostram o mesmo número **por construção**.
2. Qualquer número na tela se explica sozinho (drawer com os 11 campos do contrato).
3. Dado manual nunca se disfarça de dado duro (selo, timestamp, log).
4. Painel novo = manifesto + métricas de catálogo, sem decisão de arquitetura nova.
5. Nada do 1.0 validado se perde na travessia (gate de paridade em toda religação).
