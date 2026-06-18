---
type: spec
status: proposed
workflow: code
change: hardening-cro-dashboard-forecast-board-ready
repo: https://github.com/pachecojr-axenya/dashboard-pipeline
owner: Axenya
priority: P0/P1
created_at: 2026-06-16
goal: "CRO Dashboard confiável, auditável e pronto para decisões de forecast do CRO e do Board."
tags: [#theme/code, #theme/revops, #theme/hubspot, #theme/dashboard, #theme/forecast, #theme/auditability]
---

# SPEC | Axenya CRO Dashboard | Hardening de Forecast, Filtros e Auditabilidade

## 0. TL;DR

O `dashboard-ivan-visual` já entrega uma versão web funcional do dashboard de forecast da Axenya, com visual forte, dados vindos do HubSpot, autenticação via Google OAuth, múltiplos painéis e memória de cálculo por gráfico. O próximo salto não é criar mais gráficos; é tornar cada número confiável o suficiente para ser usado pelo CRO e pela diretoria sem risco de interpretação errada.

Esta spec parte do estado anterior ao hardening final: filtros de data já existem, mas a semântica de data ainda não está totalmente estabilizada; alguns gráficos usam `createdate`, outros deveriam usar `close_date`, outros deveriam usar `data_prevista_para_receita`; modais nem sempre mostram as colunas necessárias para auditar a conta; alguns cards duplicam perguntas; e os painéis secundários ainda precisam seguir o mesmo contrato do CRO Dashboard.

O objetivo é fechar 8 frentes MECE:

1. **Contratos de Métrica e Datas** | definir exatamente qual base cada indicador usa.
2. **Forecast e Receita** | alinhar N14, Forecast e premissas comerciais.
3. **Funil e Conversão Ajustada** | implementar a leitura do Ivan: `ganhos / (ganhos + perdidos)`.
4. **Modal, Tabela e Drill-down** | garantir que cada gráfico seja auditável ao clicar.
5. **Card Registry e Identificadores** | códigos estáveis para edição, revisão e QA.
6. **Painéis Secundários** | Board, AE, BDR, 48h, CS e Cotação com semântica honesta.
7. **UX Operacional** | filtros sticky, cards reorganizáveis, toggles de premissa e i18n.
8. **Validação e Deploy** | smoke tests, i18n parity, API 401 em produção e checklist de release.

O resultado esperado é um dashboard que responde com clareza: **vou bater a meta ou não?** E, se a resposta for não, onde está o problema.

---

## 1. Goal

Transformar o CRO Dashboard em uma fonte única de verdade para forecast, com:

- Métricas de receita e pipeline calculadas com data correta.
- Conversão ajustada baseada em deals finalizados.
- Forecast mensal reconciliável com a tabela dedicada de Forecast.
- Memória de cálculo completa por gráfico.
- Drill-downs com colunas suficientes para auditar cada número.
- Painéis secundários consistentes com a lógica do CRO.
- Títulos, tooltips e help drawers coerentes em PT/EN.
- Filtros globais que não distorcem snapshots.
- Rotina de validação antes de marcar qualquer número como confiável.

### Métrica de sucesso final

O CRO deve conseguir abrir o dashboard, filtrar um período e responder:

- Quanto já ganhei?
- Quanto tenho aberto?
- Quanto o forecast projeta?
- Qual é a conversão ajustada?
- Quais deals explicam o número?
- Qual campo do HubSpot e qual fórmula geraram o resultado?

Sem precisar pedir outra planilha para reconciliar.

---

## 2. Non-goals

Fora do escopo desta spec:

- Reescrever o front-end em React, Next.js ou TypeScript.
- Migrar Chart.js para outra lib.
- Substituir HubSpot como fonte primária.
- Criar warehouse/BigQuery agora.
- Resolver o desenho completo de CS e Cotação sem APIs próprias.
- Mudar definições comerciais sem validação com Ivan/Aurilia.
- Criar novos gráficos por volume, sem antes validar os existentes.
- Marcar cards como verdes/validados antes de reconciliar com HubSpot.

---

## 3. Diagnóstico do estado atual

### 3.1 Pontos verdes a preservar

| Área | Achado | Decisão |
|---|---|---|
| Arquitetura | Vanilla HTML/JS, sem build complexo | Preservar simplicidade operacional |
| Deploy | Vercel com rewrites e serverless | Preservar rotas existentes |
| Auth | Google OAuth e APIs protegidas em produção | Manter fail-closed |
| Dados | `/api/forecast-table` centraliza deals Vendas + Bid | Usar como base principal do CRO |
| Histórico | `/api/funnel-stages` traz histórico de etapa | Usar para funil e passagem por Diagnóstico |
| Memória de cálculo | Drawer por gráfico já existe | Expandir e padronizar |
| i18n | Toggle PT/EN já existe no CRO | Manter paridade obrigatória |
| Design | Visual aprovado pelo CRO | Não refazer layout sem necessidade |

### 3.2 Amarelos arquiteturais

| Frente | Problema | Impacto |
|---|---|---|
| Filtros | Mesmo filtro global aplicado a métricas com datas diferentes | Receita, pipeline e forecast podem divergir |
| Pipeline ativo | Definição de ativo varia entre cards | P09, P08, C01/C02/C05/C07/C08 podem não bater |
| Forecast | N14 simplificado vs Forecast dedicado | Board pode ver números divergentes |
| Conversão | Alguns gráficos usam `ganhos / (ganhos + abertos)` | Não segue modelo mental do Ivan |
| Modais | Tabelas sem campos de auditoria suficientes | Difícil provar origem do número |
| IDs | Alguns cards sem código estável | QA e pedidos ficam ambíguos |
| Painéis secundários | Board/AE/BDR/48h usam filtros e bases próprias | Risco de números conflitantes entre views |
| Proxies | CS/Cotação usam deals como proxy | Precisa ser explícito para evitar decisão errada |

### 3.3 Vermelhos a corrigir antes de revisão executiva

| Risco | Onde aparece | Correção esperada |
|---|---|---|
| Número de receita filtrado por criação | KPIs e gráficos financeiros | Usar `close_date` ou data de ganho definida |
| Taxa de ganho errada | S01, N09, N12, AE/BDR | Usar `ganhos / (ganhos + perdidos)` |
| Forecast sem recorrência mensal | N14 | Replicar lógica do Forecast dedicado |
| Modal sem prova de cálculo | P01, N14 e listas gerais | Colunas de data, ARR, probabilidade e receita mensal |
| Buckets vazios | Gráficos de barras | Remover categorias sem valor |
| Reunião Agendada sem toggle | Pipeline Ativo | Tornar premissa configurável |
| S04 não filtrável | Taxa de Reunião | Usar janela global via funil histórico |

---

## 4. Princípios arquiteturais

1. **A data governa a métrica** | criação, fechamento e previsão não são intercambiáveis.
2. **Snapshot não é período** | pipeline ativo é estado atual; não deve sumir por filtro de criação, salvo decisão explícita.
3. **Taxa de ganho é sempre ajustada** | `ganhos / (ganhos + perdidos)`, nunca `ganhos / (ganhos + abertos)`.
4. **Forecast precisa explicar deal por deal** | todo valor mensal deve abrir tabela com receita real e probabilizada.
5. **Toda divergência aparente precisa ser nomeada** | se N14 tem menos deals que P09, o título deve dizer por quê.
6. **Modais são auditoria, não detalhe decorativo** | colunas devem provar a fórmula do card.
7. **IDs são parte da governança** | todo card deve ter código estável para QA, edição e conversa com o CRO.
8. **Sem número com aparência de validado sem validação** | não usar verde como selo de verdade antes da reconciliação.

---

## 5. Target Architecture

### 5.1 Arquitetura alvo incremental

```txt
public/dashboard.html
  | usa helpers locais enquanto não há modularização
  | define contratos de métrica por card
  | renderiza CRO Dashboard

public/board.html
public/ae.html
public/bdr.html
public/48h.html
public/cs.html
public/cotacao.html
  | devem seguir a mesma semântica de dados
  | usam filter-bar.js quando aplicável

api/forecast-table.js
  | normaliza deals Vendas + Bid
  | expõe campos necessários para tabelas e forecast

api/funnel-stages.js
  | expõe histórico de etapas com entered_date
  | suporta since/until

future public/shared/
  | table.js
  | modal.js
  | card-registry.js
  | chart-utils.js
  | filters.js
  | i18n.js
```

### 5.2 Contratos de dados obrigatórios

| Tipo de métrica | Base | Campo de data |
|---|---|---|
| Pipeline ativo | Deals abertos atuais | Sem filtro de período |
| Originação | Deals criados | `createdate` |
| Receita ganha | Deals ganhos | `close_date` ou data de ganho definida |
| Perdidos | Deals perdidos | `close_date` |
| Conversão ajustada | Ganhos + perdidos | `close_date` |
| Forecast mensal | Deals abertos com data prevista | `data_prevista_para_receita` |
| Funil histórico | Histórico de etapas | `entered_date` |
| Engajamento | Deals abertos com atividade | `notes_last_updated` |

### 5.3 Registry de cards

Todo card deve ter:

- `key` interna estável.
- Código visível (`Pxx`, `Sxx`, `Cxx`, `Nxx`, `Bxx`).
- Descrição de fórmula.
- Campos HubSpot usados.
- Campo de data governante.
- Base de deals usada.
- Tipo de drill-down esperado.

---

# 6. Workstreams MECE

## Workstream A | Contratos de filtros e bases de dados

### A1. Definir helpers centrais no CRO

**Problema**  
Cards calculam bases diretamente em vários pontos do HTML.

**Requisitos**

- Criar helpers para bases principais:
  - `_novoCurrentActivePipeline()`.
  - `_novoWon()`.
  - `_novoLost()`.
  - `_novoClosedKpiRange()`.
  - `_novoPipeRevDeals()`.
  - `_novoDealsByDate(field)`.

**Tasks**

- [ ] Mapear todos os usos de `_novoDeals.filter(...)`.
- [ ] Substituir filtros diretos por helpers.
- [ ] Documentar data governante no `NOVO_FILT_FIELD`.
- [ ] Garantir que P09, P08, C01, C02, C05, C07, C08 usam a mesma base ativa.

**Acceptance criteria**

- P09 e P08 batem em total de deals.
- C01/C02/C05/C07/C08 mostram total de deals considerado.
- Nenhum gráfico de resultado usa `createdate` por acidente.

---

### A2. Pipeline Ativo com premissas configuráveis

**Problema**  
Reunião Agendada pode ou não ser considerada ativa, e isso precisa ser controlável.

**Requisitos**

- Adicionar toggle em Configurações:
  - `Ativos incluem Reunião Agendada`.
- Persistir em `localStorage`.
- Aplicar em todos os cards de ativos.

**Acceptance criteria**

- Desligar o toggle remove Reunião Agendada de P09/P08/C01/C02/C05/C07/C08.
- O total exibido nos títulos muda junto.
- A memória de cálculo explica a premissa.

---

## Workstream B | Receita, forecast e N14

### B1. N14 alinhado ao Forecast dedicado

**Problema**  
N14 mostra forecast mensal, mas precisa bater com a lógica do `forecast.html`.

**Requisitos**

- Usar `data_prevista_para_receita` como mês de início.
- Preencher todas as colunas mensais a partir da entrada de receita.
- Calcular Receita Real com a mesma fórmula do Forecast:
  - `Fee por vida` recorrente.
  - `Corretagem` por agenciamento, porte e mês `n`.
- Calcular Receita Probabilizada como Receita Real x probabilidade final.
- Mostrar tabela mensal no modal com grupos:
  - Receita Real.
  - Receita Probabilizada.

**Tasks**

- [ ] Criar `_novoForecastCalcReceita(n, deal)`.
- [ ] Criar `_novoPipeRevMonthValue(deal, month, weighted)`.
- [ ] Criar `_novoForecastLikeTable(deals, months)`.
- [ ] Fazer N14 ir até dez/27.
- [ ] Adicionar toggles `Real | Probabilizado` e `Receita | Deals`.
- [ ] Ocultar `Real | Probabilizado` quando modo = Deals.
- [ ] Fixar escala Y entre Real e Probabilizado.

**Acceptance criteria**

- Tabela do N14 preenche todos os meses a partir da data prevista.
- Receita Probabilizada é sempre menor ou igual à Real quando probabilidade <= 100%.
- Alternar Real/Probabilizado não muda escala de eixo Y.
- Modo Deals não exibe toggle Real/Probabilizado.
- Título mostra `X de Y ativos`, explicando cobertura.

---

## Workstream C | Conversão e taxas de ganho

### C1. Fórmula padrão de taxa de ganho

**Problema**  
Alguns gráficos usam abertos no denominador, o que distorce a leitura do Ivan.

**Regra obrigatória**

```txt
taxa_de_ganho = deals ganhos / (deals ganhos + deals perdidos)
```

**Aplica em**

- S01.
- S02.
- S03.
- N09.
- N12.
- Painéis AE/BDR quando houver win rate.

**Acceptance criteria**

- Nenhum card chamado win rate usa `ganhos + abertos`.
- Subtítulos mostram numerador e denominador.
- Drill-down abre ganhos e perdidos quando a métrica precisa provar a taxa.

---

## Workstream D | Modais, tabelas e auditabilidade

### D1. Tabelas padrão dos modais

**Problema**  
Tabelas de drill não mostram sempre os campos necessários para auditar cálculo.

**Requisitos**

- Todas as tabelas devem ter:
  - Deal com link HubSpot.
  - AE.
  - Pipeline.
  - Etapa.
  - Vidas.
  - ARR.
  - Probabilidade final.
  - Datas relevantes.
  - BDR quando aplicável.
- Headers com tooltip.
- Rodapé sticky com totais.
- Probabilidade final média no rodapé.

**Acceptance criteria**

- Usuário consegue auditar por que o deal entrou na métrica.
- Header e footer ficam visíveis durante scroll.
- Coluna BDR alinha à esquerda.
- Títulos das colunas ficam uppercase, mas sem letter-spacing.

---

### D2. Modais segmentáveis

**Requisitos**

- C01: filtro por AE.
- N07/N09: filtro por tempo de engajamento.
- N09: filtro por faixa de vidas, se a leitura exigir bucket da barra.
- N10/N11/N12 quando existirem: filtro por segmento da barra.

**Acceptance criteria**

- Modal permite reproduzir visualmente a barra clicada.
- Contagem do filtro bate com a barra.
- Export CSV respeita o filtro visual da tabela.

---

## Workstream E | Funil histórico, S04 e N18

### E1. C09 com filtro global

**Problema**  
Funil histórico tinha filtro local e não respondia ao filtro global.

**Requisitos**

- `/api/funnel-stages` aceita `since` e `until`.
- C09 usa `_novoFilter.start` e `_novoFilter.end` quando filtro global está ativo.
- S04 usa a mesma base do funil carregado.

**Acceptance criteria**

- Aplicar filtro global muda C09 e S04.
- O funil não precisa de filtro local separado.

---

### E2. N18 dias até Diagnóstico

**Problema**  
`dias_no_pipe` mede tempo até hoje, não tempo até entrar em Diagnóstico.

**Requisitos**

- `/api/funnel-stages` deve expor `entered_date` por deal/etapa.
- N18 calcula `entered_date(Diagnóstico) - createdate`.
- A contagem para quando o deal entra em Diagnóstico.

**Acceptance criteria**

- N18 considera todos os deals que já passaram por Diagnóstico.
- N18 não conta tempo depois de Diagnóstico.
- Se o funil ainda não carregou, mostrar fallback ou estado de loading honesto.

---

## Workstream F | Painéis secundários

### F1. Board View

**Requisitos**

- Usar `includeLost=true` quando calcular conversão.
- Separar snapshot de período.
- Adicionar IDs de cards com toggle no topo.
- Manter tags ocultas por padrão.
- IDs em série `Bxx`.

**Acceptance criteria**

- Board não mostra conversão baseada em abertos.
- Board tem IDs de cards ativáveis.
- Board usa mesma linguagem de dados do CRO.

### F2. AE/BDR/48h

**Requisitos**

- AE: win rate ajustado por AE.
- BDR: origem BDR usa `sdr`, não colaboradores.
- 48h: janela fixa, sem interferência do filtro global.

**Acceptance criteria**

- Painéis secundários não contradizem o CRO.
- Tooltips deixam explícita a semântica de data.

### F3. CS/Cotação

**Requisitos**

- Enquanto forem proxies, títulos precisam dizer `proxy`.
- Não aplicar filtro global de `createdate` em snapshot de base.
- Planejar APIs próprias:
  - `/api/cs-accounts`.
  - `/api/tickets`.

**Acceptance criteria**

- Usuário não confunde proxy com dado real de CS/ticket.
- Filtro global não esvazia dashboards proxy.

---

## Workstream G | UX operacional

### G1. Filtros globais sticky

**Requisitos**

- Barra de filtros permanece visível ao rolar.
- Aplicar filtro não manda a página para o topo.
- Filtro visualmente claro em dark/light.

**Acceptance criteria**

- `window.scrollY` é preservado após render.
- Filtro continua acessível em dashboards longos.

### G2. Cards reorganizáveis

**Requisitos**

- Cards podem ser reordenados por drag-and-drop.
- Ordem salva por usuário quando possível.
- Fallback local em dev.
- Reordenação limitada dentro de seções para não destruir narrativa.

**Acceptance criteria**

- Ordem persiste após reload.
- Usuários diferentes podem ter preferências diferentes.
- Cards continuam funcionando após reorder.

---

## Workstream H | Validação, QA e release

### H1. Checks obrigatórios

Toda alteração deve rodar:

```powershell
node scripts/_check-inline-js.js public/dashboard.html
node scripts/_i18n-parity.js public/dashboard.html
node scripts/_smoke-render.js public/dashboard.html includeLost
```

Quando APIs forem alteradas:

```powershell
node --check api/funnel-stages.js
node --check api/forecast-table.js
```

### H2. Smoke de produção

Depois do deploy:

| Checagem | Esperado |
|---|---|
| `/` | 200 |
| `/novo` | 200 |
| `/novo-board` | 200 |
| `/api/auth/me` sem sessão | 401 |
| `/api/forecast-table` sem sessão | 401 |

### H3. Checklist de validação manual

- [ ] P09/P08/C01/C02/C05/C07/C08 têm mesma base ativa quando aplicável.
- [ ] P02/P06/S01/S02/S03 batem no total de ganhos do recorte.
- [ ] S04 muda ao aplicar filtro global.
- [ ] C09 muda ao aplicar filtro global.
- [ ] N14 tabela preenche meses posteriores à data prevista.
- [ ] N18 usa data de entrada em Diagnóstico.
- [ ] Modais têm coluna suficiente para auditar fórmula.
- [ ] Nenhuma barra zero aparece quando o gráfico puder omitir a categoria.

---

## 7. Ordem de implementação sugerida

1. Normalizar helpers de data/base no `dashboard.html`.
2. Alinhar P-cards e S-cards críticos.
3. Corrigir C-cards de Pipeline Ativo.
4. Corrigir C09/S04 com funil global.
5. Corrigir N14 com Forecast-like table.
6. Corrigir N18 com `entered_date`.
7. Remover gráficos redundantes.
8. Padronizar tabelas e modais.
9. Aplicar IDs, reordenação e filtros sticky.
10. Propagar semântica para Board/AE/BDR/48h/CS/Cotação.
11. Rodar validações.
12. Deploy e smoke em produção.

---

## 8. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Mudar base de um card e quebrar comparação histórica | Registrar em STATUS_LOG e tooltip |
| Remover gráfico que alguém usa | Manter função morta temporária e documentar remoção |
| N14 divergir do Forecast | Copiar fórmula e validar mês a mês |
| IDs mudarem durante QA | Congelar registry antes da revisão com Ivan |
| Filtros globais afetarem snapshot | Separar `none`, `create`, `close`, `prev`, `funnel` |
| Proxy parecer dado real | Títulos com `proxy` e help explícito |

---

## 9. Definition of Done

Esta spec só deve ser considerada concluída quando:

- Todos os cards visíveis têm base, data e fórmula documentadas.
- P09, P08 e gráficos de Pipeline Ativo batem quando deveriam bater.
- P02/P06/S01/S02/S03 usam a mesma base de ganhos.
- Toda taxa de ganho usa `ganhos / (ganhos + perdidos)`.
- N14 bate conceitualmente com o Forecast dedicado.
- N18 mede tempo até Diagnóstico, não tempo até hoje.
- Modais têm tabelas auditáveis com totalizadores.
- Board/AE/BDR/48h não contradizem o CRO.
- CS/Cotação são explicitamente proxies.
- Checks de sintaxe, i18n e smoke render passam.
- Deploy de produção responde 200 nas páginas e 401 nas APIs protegidas sem sessão.

---

_Proprietário. Uso interno Axenya._
