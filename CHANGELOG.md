# CHANGELOG — dashboard-ivan-visual

Registro completo de todas as alterações feitas no projeto.
Formato: `[DATA] ARQUIVO — Descrição da alteração`

---

## Sessão 1 (data aproximada: 2026-06-07 / 08)

### public/dashboard.html

- **Remoção do Jarvis** — removidos os dois painéis do Jarvis (~630 linhas) e limpeza da função `switchView()` que referenciava o Jarvis.

- **Tema claro — cores do gráfico** — corrigidas as cores dos textos e grid do gráfico `buildNovoVidasAE()` para reagirem ao tema. Adicionada lógica `isLight`, `cGrid` com valores distintos para dark/light. `toggleTheme()` reconstruído para chamar `buildNovoVidasAE()` quando o gráfico existe.

- **Click nas barras do gráfico — modal de deals** — adicionado handler `onClick` no Chart.js: ao clicar em uma barra, abre modal com a listagem dos deals daquele AE. Deals vinculados ao HubSpot via URL `https://app.hubspot.com/contacts/44444289/deal/{hs_id}`.

- **Total de Vidas no modal** — adicionada `<tfoot>` com linha de total da coluna Vidas na tabela do modal.

- **STAGE_PROB — valores atualizados** — probabilidades padrão atualizadas para bater com imagem de referência:
  - Cotação: 33%
  - Proposta Enviada: 28,5%
  - Consultoria: 61,1%
  - Negociação: 42%
  - Implantação: 58,1%
  - Ganho: 100%
  - Standby: 12%
  - Diagnóstico: 6%

- **Drawer de Configurações (lado direito)** — criado painel deslizante (#novo-prob-drawer) com probabilidades de etapa editáveis, persistência em localStorage, animação de slide-in, backdrop com blur. Funções: `novoOpenProbEditor()`, `novoCloseProbEditor()`, `novoSaveProbEditor()`.

- **Separadores** — substituídos todos os travessões (—) por barra vertical (|) nos títulos.

- **Tooltip do gráfico simplificado** — tooltip do botão "i" reescrito para listar explicitamente todas as etapas do segmento COTACAO_PLUS: Cotação, Proposta Enviada, Consultoria, Negociação, Standby, Implantação.

- **Título do gráfico** — alterado para "Vidas e Deals por AE | Ativos".

- **Duplo botão CSV corrigido** — `openModal()` detecta presença de tabela `.lb` e oculta o botão estático `.btn-export` do header quando o botão dinâmico de CSV é injetado. `closeModal()` restaura a visibilidade.

- **Fonte Inter — correção do "1" com serifa** — substituído `font-variant-numeric: tabular-nums` por `lining-nums` em todos os lugares (CSS e tabelas). Adicionado `Chart.defaults.font.family` e `Chart.defaults.font.size` globalmente em `buildNovoVidasAE()`.

- **Modal de deals — 16 colunas** — expandida a tabela de deals para:
  Deal | AE | Pipe | Etapa | Dias | Colab. | Vidas | 1ª Fatura | Modelo | Agenc. | Vit. | Prob AE | P. Etapa | P. Ajust. | Quarter | Dt. Receita

- **Ordenação de colunas no modal** — implementadas funções `novoSortDeals(col)` e `_novoSortVal(d, col)`. Indicadores ↑/↓ por coluna via `<span id="ndsi-N">`. Estado mantido em `_novoModalSort`. Geração de linhas extraída para `_novoDealsRows()` com formatadores a nível de módulo (`_ne`, `_np`, `_ni`, `_nb`, `_nd`, `_nr`).

- **Content blur** — adicionado efeito de desfoque no conteúdo principal ao abrir qualquer modal/drawer. CSS: `.content-blur { filter: blur(4px); pointer-events: none; user-select: none }`. Função `setContentBlur(on)` aplica/remove a classe em `.container` e `#view-novo`. Chamado em `openModal()`, `closeModal()`, `openDrawer()`, `closeDrawer()`, `novoOpenProbEditor()`, `novoCloseProbEditor()`, `openSettings()`, `closeSettings()`.

- **Título do drawer de Configurações** — aumentado para `font-size: 1.35rem`.

- **Nav drawer — remoção do logo** — removido o SVG do logo Axenya do drawer esquerdo.

- **Nav drawer — texto alterado** — "Dashboard Axenya" substituiu o texto anterior no topo do drawer.

---

## Sessão 2 (2026-06-08 / 09)

### api/forecast-table.js

- **Remoção do fallback STAGE_PROB no servidor** — o cálculo de `prob` (probabilidade do deal) foi simplificado: removida a terceira opção de fallback que usava `STAGE_PROB[stageName]`. Agora `probabilidade` reflete apenas o valor customizado do AE (`probabilidade_de_fechamento_`) ou o `hs_deal_stage_probability` do HubSpot. Motivo: alinhar com a lógica de `calcProbInfo()` do dash-forecast, que usa `cp == null` para detectar que o AE não informou probabilidade — o fallback mascarava esse null e quebrava o cálculo de penalidade/bônus.

  ```
  ANTES: custom → hs_deal_stage_probability → STAGE_PROB[stageName]
  DEPOIS: custom → hs_deal_stage_probability
  ```

### public/dashboard.html

- **`_calcProbInfo(d)` adicionada** — função que implementa exatamente a fórmula de probabilidade ajustada do dash-forecast:
  - `sp` = probabilidade da etapa (de `NOVO_STAGE_PROB`)
  - `cp` = probabilidade informada pelo AE (pode ser null)
  - Se `cp == null` → usa `sp`
  - Se `cp ≤ sp − 0.30` → penalidade: `sp × 0.9`
  - Se `cp ≥ sp + 0.30` → bônus: `sp × 1.1`
  - Caso contrário → usa `sp`

- **`_novoDealsRows()` atualizado** — colunas P. Etapa e P. Ajust. passaram a usar `_calcProbInfo(d).sp` e `_calcProbInfo(d).final` respectivamente, no lugar de lógica inline incorreta.

- **`_novoSortVal()` atualizado** — cases 12 (P. Etapa) e 13 (P. Ajust.) passaram a usar `_calcProbInfo(d).sp` e `_calcProbInfo(d).final`.

- **`openDrawer()` corrigido** — removida a chamada `setContentBlur(true)` de dentro de `openDrawer()`. O nav drawer já possui backdrop próprio; o blur aplicado a `#view-novo` com `pointer-events: none` tornava o botão de menu não-clicável após determinadas interações.

- **`closeDrawer()` mantido** — `setContentBlur(false)` foi mantido em `closeDrawer()` como salvaguarda para limpar qualquer estado de blur residual.

- **`DOMContentLoaded` — reset de blur** — adicionada chamada `setContentBlur(false)` no início do handler de `DOMContentLoaded` para garantir que estado de blur travado não persista entre navegações.

### public/novo-dashboard.html (NOVO ARQUIVO)

- **Criado arquivo standalone** — novo painel completamente independente do `dashboard.html`, acessível em `/novo` ou `/novo-dashboard.html`. Carrega os dados automaticamente ao abrir.
- Contém toda a funcionalidade do Novo Dashboard:
  - Gráfico "Vidas e Deals por AE | Ativos" (Chart.js + ChartDataLabels)
  - Click nas barras → modal com 16 colunas + ordenação
  - Drawer de Configurações (probabilidades editáveis)
  - i18n PT/EN
  - Alternância de tema claro/escuro
  - Skeleton de carregamento
  - Exportação CSV (layout completo)
  - Link de volta para Dashboard Ivan no menu esquerdo
- `setContentBlur` simplificada: atua apenas sobre `#view-novo` (sem dependência de `.container` do dashboard original).

### vercel.json

- **Rota `/novo` adicionada** — mapeada para `/novo-dashboard.html`.

---

## Como usar este log

Sempre que fizer uma alteração, registre aqui no formato:

```
### public/nome-do-arquivo.html (ou api/arquivo.js)
- **Nome da alteração** — descrição do que mudou, por que mudou e qual era o estado anterior se relevante.
```

Indique a sessão/data no cabeçalho do bloco quando iniciar uma nova conversa.
