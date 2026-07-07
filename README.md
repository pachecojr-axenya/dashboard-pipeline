# Axenya | CRO Dashboard (Forecast)

> Painel de pipeline e forecast de vendas da Axenya, para uso do **CRO e da diretoria (BoD)**.
> Este arquivo é o **ponto de partida de contexto**: qualquer pessoa ou IA que pegue o projeto
> deve conseguir entender, lendo só ele, **o que estamos construindo, para quê e o que define sucesso**.
>
> Fonte do contexto estratégico: sessão de validação com o CRO (Ivan Gouvea) em **12/06/2026**
> (`00 Base de Conhecimento/Reuniões/2026-06-12 - [Validacao Forecast]`). Estado técnico vivo: ver
> **[STATUS_LOG.md](STATUS_LOG.md)**.

---

## 1. O que é o projeto

Um dashboard web que **automatiza o processo de forecast** que antes era feito manualmente
(exportações de planilha, documentos duplicados, montagem à mão — o processo da Cíntia). Ele puxa os
deals direto do HubSpot e os transforma na **fonte única de verdade** para a leitura de pipeline e
projeção de receita.

O problema que ele resolve, nas palavras do CRO: *"hoje cada um olha uma coisa diferente, de um jeito
diferente, porque ninguém fez o trabalho de garantir que o número está correto."* O dashboard existe
para que todos (CRO, diretoria, ops) olhem **o mesmo número, validado, no mesmo lugar**.

Diferencial que o CRO mais valorizou: a **memória de cálculo**. Todo indicador expõe, sob demanda, os
campos do HubSpot que usa e a fórmula aplicada — para qualquer um auditar de onde veio o número.

---

## 2. A pergunta-norte

Tudo no CRO Dashboard serve para responder **uma pergunta macro**:

> ### “Vou ou não vou bater a meta?”

Para respondê-la, o CRO precisa de tudo num só lugar: taxa de conversão (geral e por etapa), receita
média, ciclo de vendas, e a contribuição de cada conta para o forecast. E quando a resposta for
**“não”**, o painel precisa ajudar a **levantar hipóteses e diagnosticar onde erramos** (custo por
vida? receita média? ciclo? originação?).

---

## 3. Como o CRO lê o forecast (modelo mental)

Conceitos que vieram direto do CRO e que orientam o desenho dos gráficos:

- **Taxa de conversão ajustada** — o conceito-chave. Além da conversão bruta (hoje ~2,2% sobre tudo),
  o forecast precisa de `ganhos ÷ (ganhos + perdidos)`, ou seja, **só sobre deals já finalizados**.
  Isso remove o pipe ainda em aberto e **não depende do ciclo de vendas**. Como ~1/3 dos deals
  históricos ainda estão ativos, assume-se que eles converterão na mesma proporção dos finalizados —
  permitindo **projetar quantos fechamentos ainda virão** do pipe aberto.
- **Ciclo de vendas vs. tempo até resposta** — “tempo até ganhar” e “tempo até ganhar/perder” são
  perguntas diferentes e ambas válidas. Manter as duas leituras (toggle), com rótulos claros.
- **Capital a risco** — o toggle *Implantação = Ganho* existe porque, na régua geral, **implantação já é
  ganho** (não se perde conta depois de implantada). A distinção é mantida só para enxergar **capital
  a risco** até a assinatura (houve caso real de conta dada como ganha que “sumiu”).
- **Quebrar por porte de empresa** — PME e conta grande têm velocidades muito diferentes; visão
  agregada distorce. Buckets sugeridos: **0–200 / 200–2.000 / >2.000 vidas**.

---

## 4. O que define sucesso (princípios inegociáveis)

1. **Validação é o maior trabalho — não o design.** *"Com IA você cria coisas muito rápido, mas criar
   errado não vale nada"* (Mariano, via Ivan). O diferencial é bater **cada número contra o HubSpot**.
   Validar o **histórico primeiro**; se o histórico bate, mês/semana provavelmente batem (Aurilia).
2. **Nenhum número é “verde” (validado) até os filtros de tempo existirem e cada indicador puxar a data
   certa** (criação vs. fechamento vs. prevista). Por isso a prioridade #1 foi **implementar os filtros
   de tempo antes de validar** — colocar o filtro é o mesmo trabalho de validação, então fazer os
   filtros primeiro evita validar duas vezes.
3. **Não expor número não validado como pronto.** Risco real de a diretoria pegar um número e usar numa
   apresentação. Enquanto não validado: comunicar *“work in progress”* e **não marcar verde**.
4. **Memória de cálculo sempre visível.** Cada gráfico precisa dizer quais campos do HubSpot usa, a
   fórmula, e **qual data o filtro de período aplica**.
5. **Auditabilidade dos dados de origem.** Ex.: roster de motivos de perda precisa ser revisto (eliminar
   “outros”/“escolheu outra corretora” sem submotivo) — lixo na origem invalida a análise.

> **Estado de validação é sinalizado pelo emoji no título de cada gráfico:**
> 🟢 estrutura/cálculo corretos (origem ainda a validar) · 🟠 calcula certo, com ressalva (amostra
> pequena, escopo, cobertura parcial, proxy) · 🔴 o que mostra diverge do título · 🟡 ainda não analisado.
> Detalhes em **[AUDITORIA_GRAFICOS.md](AUDITORIA_GRAFICOS.md)**.

---

## 5. Stakeholders

| Pessoa | Papel | O que importa para o projeto |
|---|---|---|
| **Ivan Gouvea** | CRO — usuário principal e dono da visão | Define a pergunta-norte e o modelo mental. Prioriza a pergunta de negócio sobre estética (mas valoriza o design). Confia no número validado. |
| **Mariano** | Liderança acima do CRO | Pode pegar um número e levar ao board — daí o cuidado de não expor nada não validado. |
| **Aurilia (Auris)** | Operações / Marketing | Validar histórico primeiro; visão de futuro (dashboard unificado forecast + campanhas em tempo real). |
| **Cíntia** | Dona do processo manual de forecast | Referência do processo que está sendo automatizado. |
| **Ágatta** | Account Executive | Parceira na auditoria dos motivos de perda. |
| **Pacheco Jr** | Construtor do dashboard | Pensa visualmente; valida cada número no HubSpot. |

---

## 6. Estado atual

- **Filtros de tempo implementados** nos 7 painéis (prioridade #1 do CRO). Cada painel filtra por janela
  de período; no CRO o seletor tem presets (Mês atual, Mês passado, etc.), trimestre e intervalo de meses
  com calendário próprio.
- **Memória de cálculo por gráfico** — o botão **“i”** abre os campos do HubSpot + fórmula + **qual campo
  de data o filtro usa** (criação `createdate`, fechamento `close_date` ou prevista
  `data_prevista_para_receita`). O botão **“?”** do topo **mostra/oculta** os “i” e as tags de
  identificação (C01/P01/N01…) de todos os cards.
- **Bilíngue PT/EN** — toggle no topo; tudo o que é interface segue o idioma selecionado.
- **Configurações** — probabilidades por etapa, meta de receita (MTD) e o toggle *Implantação = Ganho*
  (ligado por padrão).
- **Painéis modulares** (um HTML por painel) para poder agregar/duplicar em visões de apresentação no
  futuro.
- **Fonte única de receita (forecast)** — o gráfico **Forecast Total** do CRO Dashboard usa o mesmo
  motor por deal do painel Forecast (`forecast-engine.js`: régua `calcReceitaMes` + faturamento manual +
  cohorts de BDR). Duas linhas fixas, **Receita Real** e **Receita Probabilizada**, que batem mês a mês
  com o painel **Forecast Overall**. Regra de receita detalhada na Regra primária nº 3 do STATUS_LOG.

---

## 7. Arquitetura

**Stack:** Vanilla HTML + JS (ES5, sem framework, sem bundler) · Chart.js 4.4.1 · funções serverless
Vercel (Node 18+) · HubSpot CRM API v3 · Google OAuth (auth) · hospedagem Vercel.

### Painéis e rotas

| Rota | Arquivo | Painel |
|---|---|---|
| `/` | `public/login.html` | Login (Google OAuth) |
| `/novo` (ou `/dashboard`) | `public/dashboard.html` | **CRO Dashboard** (o forecast — coração do projeto) |
| `/novo-board` | `public/board.html` | Board View |
| `/novo-ae` | `public/ae.html` | AE Performance |
| `/novo-bdr` | `public/bdr.html` | BDR Performance |
| `/novo-bdr/list-attack` | `public/bdr-list-attack.html` | BDR Performance \| Ataque à Lista |
| `/novo-48h` | `public/48h.html` | Last 48h |
| `/novo-cs` | `public/cs.html` | CS Dashboard |
| `/novo-cotacao` | `public/cotacao.html` | Cotação |
| `/forecast` | `public/forecast.html` | Forecast (visão dedicada) |

> O CRO Dashboard concentra a lógica inline em `public/dashboard.html`. Menu lateral e dropdown de
> painéis são gerados por um bloco `PANELS` compartilhado, idêntico em todas as páginas.
>
> **Nota sobre as rotas:** os arquivos não têm mais o prefixo `novo-`, mas as **rotas** mantêm o prefixo
> (`/novo`, `/novo-board`, …) — preservadas de propósito para não quebrar links já compartilhados. O
> mapeamento rota→arquivo fica em `vercel.json` (`rewrites`) e, para o servidor local, em
> `scripts/local-server.js`.

### Dados

- **`GET /api/forecast-table`** — deals ativos dos pipelines **Vendas + Bid** (fonte principal do CRO,
  Board, AE, BDR, Last 48h; CS e Cotação também usam como proxy enquanto as APIs próprias não existem).
- **`GET /api/funnel-stages`** — histórico de etapas (via `propertiesWithHistory`) para o Funil de
  Conversão.
- `api/pull-hubspot`, `api/pull-cs-data`, `api/pull-tickets`, `api/watcher-deals` e os endpoints de IA
  (`api/ai-*`, `api/jarvis-chat`) existem para fluxos secundários/legados.
- Cron diário (`/api/snapshot`, 02:59) para snapshot.

### Filtro de período (compartilhado)

`public/filter-bar.js` é um módulo autocontido (classes `axf-*`, injeta o próprio CSS) usado pelas 6
views além do CRO. O CRO tem implementação inline própria. Detalhe: o teste de janela é **tolerante**
(registro sem data não é descartado), então painéis sem campo de data — CS/Cotação — exibem a barra sem
esvaziar.

### Autenticação

- **Produção:** Google OAuth (`@axenya.com`) → sessão JWT. APIs exigem sessão (retornam 401 sem ela).
- **Local:** `LOCAL_DEV_BYPASS=true` no `.env.local` injeta um usuário mock e dispensa o OAuth.
  **Nunca** habilitar bypass em produção (o `.env*.local` está no `.vercelignore`).

---

## 8. Rodar localmente

> **Protocolo para IAs — obrigatório antes de qualquer avaliação ou edição:**
> ative o servidor local na porta 3002 e envie todas as requisições pelo ambiente local
> (`http://localhost:3002`). Use o comando `/axenya-dashboard` para o passo-a-passo completo.

Há duas formas de rodar localmente:

**Opção A — `local-server.js` (recomendada, zero dependências externas):**

```powershell
# A partir de dashboard-ivan-visual/
node scripts/local-server.js
# Acesse: http://localhost:3002/novo
```

Carrega o `.env.local` automaticamente (inclui `LOCAL_DEV_BYPASS=true`). Não requer login no Vercel CLI.

**Opção B — Vercel CLI:**

```powershell
vercel dev --listen 3002 --yes
# Acesse: http://localhost:3002/novo  (ou /dashboard)
```

> No Windows, `npm start` (que chama `scripts/dev.js` → `spawnSync('vercel')`) pode não resolver o
> binário do Vercel; usar `vercel dev` direto é mais confiável. Para dados reais é preciso o
> `HUBSPOT_TOKEN` preenchido no `.env.local`.

---

## 9. Deploy

```bash
vercel --prod --yes        # projeto Vercel: dashboard-axenya
```

- Alias de produção atual: **https://project-bsmfu.vercel.app**.
- Pós-deploy, confirmar: páginas (`/`, `/novo`, …) respondem **200** e as APIs (`/api/auth/me`,
  `/api/forecast-table`) respondem **401** — sinal de que a **auth está ativa** (bypass ausente em prod).
- Regras detalhadas de infraestrutura/OAuth/Vercel: **[DEPLOY_GUIDE.md](DEPLOY_GUIDE.md)**.

---

## 10. HubSpot — mapeamento

- **Portal ID:** `44715285` (links de deal: `https://app.hubspot.com/contacts/44715285/deal/{id}`)
- **Pipeline Vendas:** `782758156` · **Pipeline Bid:** `894130090`

**Etapas Vendas:** Reunião Agendada `1144746905` · Diagnóstico `1144746906` · Cotação `1144746908` ·
Consultoria `1144746909` · Negociação `1144746910` · Stand by `1317543716` · Implantação `1288611084` ·
Ganho `1144844314` · Perdido `1144746911`

**Etapas Bid:** Cotação `1363560722` · Proposta Enviada `1349620555` · Consultoria `1349620556` ·
Negociação `1353387279` · Implantação `1353457025` · Ganho `1353387280` · Standby `1373066362`

Propriedades custom relevantes: `vidas`, `premio_mensal`, `sdr` (BDR), `arr_estimado`,
`primeira_fatura`, `notes_last_updated` (→ dias sem atividade), `data_prevista_para_receita`,
`closedate`/`createdate`.

---

## 11. Convenções de código

- **Sem TypeScript, sem bundler, sem dependências npm** — ES5 puro no front-end.
- **Separador de texto é SEMPRE `|`** — nunca `—`, `–`, `-` ou `·` em texto exibido. O travessão só vale
  como placeholder de “sem dado” (`'—'`).
- **Toggles** (seletores de modo): segmented control Apple-style via `.tab-sub` / `.tab-sub-btn` /
  `.tab-sub-thumb`.
- **i18n:** todo texto de interface passa por `t('chave')`, com paridade total entre os dicionários
  `pt` e `en`. Nomes de etapa do CRM (Cotação, Negociação…) ficam em PT nos dois idiomas (nomes próprios).
- **Menu lateral / dropdown de painéis:** fonte única (`PANELS`), propagada para os 7 arquivos.
- **STATUS_LOG.md:** registrar uma linha por mudança, a cada iteração.

---

## 12. Mapa de documentação

| Arquivo | Para quê |
|---|---|
| **README.md** (este) | Contexto, objetivo e o que define sucesso. Comece por aqui. |
| **[STATUS_LOG.md](STATUS_LOG.md)** | Estado técnico vivo: diretrizes, arquitetura detalhada, histórico de iterações. Atualizado a cada mudança. |
| **[AUDITORIA_GRAFICOS.md](AUDITORIA_GRAFICOS.md)** | Análise crítica de cada gráfico (o que promete × o que mostra) e a semântica dos emojis de veredito. |
| **[DEPLOY_GUIDE.md](DEPLOY_GUIDE.md)** | Regras de deploy, Vercel e Google OAuth. |

---

## 13. Visão de futuro

- **Dashboard unificado** combinando forecast com **campanhas/marketing em tempo real** (Aurilia).
- **Visões de apresentação para o board** — duplicar/derivar gráficos numa leitura mais direta. O
  desenho modular (um HTML por painel) já antecipa essa agregação. Cada conversa do board é um momento
  diferente da empresa: o objetivo é **facilitar pegar os dados**, não prever exatamente o que será
  pedido.

---

_Proprietário. Uso interno Axenya._
