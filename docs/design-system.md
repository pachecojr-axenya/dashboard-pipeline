# Proposta de Design System Unificado | Dashboard Axenya

> Documento de **levantamento/proposta**. Nenhum arquivo `public/*.html` foi
> editado para produzir este relatório — é leitura + análise. Toda implementação
> sugerida aqui é para o dono decidir e sequenciar depois, seguindo a filosofia
> de *strangler fig* já adotada no projeto (ADR-001, `docs/dashboard-2.0/decisoes-adr.md`):
> nunca reescrever tudo de uma vez, sempre extrair/promover gradualmente, com
> gate de paridade visual antes de cada passo.

Padrão-ouro escolhido pelo dono: **`public/dashboard.html`** (CRO Dashboard).

---

## 0. Descoberta estrutural que muda a leitura de tudo abaixo

O `dashboard.html` tem um `<style>` inline (`dashboard.html:13-247`) com um bloco
`:root` (`dashboard.html:15-16`) que declara toda a paleta. **Mas esse `:root`
inline não é o que realmente pinta a tela.** Ele é sobrescrito por
`public/premium.css` (carregado *depois*, via
`<link rel="stylesheet" href="/premium.css?v=5">` em `dashboard.html:248`) —
como os dois são seletores `:root` de especificidade idêntica, o que vem depois
no documento vence a cascata. `premium.css:20-69` (dark) e `premium.css:71-107`
(light) são os valores **realmente renderizados**.

Isso significa que **`premium.css` já é, hoje, a camada de unificação visual do
projeto** — está incluído em praticamente todos os 15 painéis (única exceção
confirmada: `forecast-delta.html`). O problema não é "não existe um sistema
compartilhado"; é que **cada painel ainda carrega uma cópia local do `:root` /
`.novo-card` / `.tab-sub` / etc. que ou está morta (sobrescrita, mas confusa e
arriscada) ou usa nomes de classe que o `premium.css` não sabe traduzir** (então
fica genuinamente divergente). A proposta de unificação (seção 3) parte desse
diagnóstico: menos "criar um design system do zero", mais "parar de duplicar o
que já existe e fechar os buracos que `premium.css` ainda não cobre".

---

## 1. Sistema extraído do `dashboard.html` (+ `premium.css`, que vence em runtime)

### 1.1 Variáveis CSS (`:root`) — valores REALMENTE renderizados

Fonte: `premium.css:20-69` (dark, default) e `premium.css:71-107` (light,
`html[data-theme="light"]`).

| Var | Dark | Light | Uso |
|---|---|---|---|
| `--bg` | `#070b15` | `#f2f5f9` | fundo da página |
| `--card` | `#0f1727` | `#ffffff` | fundo de card/tabela |
| `--card2` | `#192334` | `#edf1f6` | fundo secundário (pills, inputs, thumb) |
| `--border` | `#243349` | `#dce3ec` | bordas |
| `--text` | `#eef3fb` | `#15202e` | texto principal |
| `--text2` | `#9aa9bf` | `#536179` | texto secundário/label |
| `--muted` | `#64748b` | `#8493a8` | texto terciário (subtítulos de KPI) |
| `--teal` | `#2dd4bf` | `#0f766e` | cor de destaque/marca |
| `--green` | `#34d399` | `#15803d` | positivo |
| `--red` | `#fb7185` | `#e11d48` | negativo/erro |
| `--orange` | `#f59e0b` | `#d97706` | alerta |
| `--yellow` | `#fbbf24` | `#a16207` | alerta secundário |
| `--blue` | `#60a5fa` | `#2563eb` | dado neutro/informativo |
| `--accent` / `--accent-glow` | `#2dd4bf` / `rgba(45,212,191,.15)` | `#0f766e` / `rgba(15,118,110,.12)` | glow de hover em KPI/foco |
| `--hover` / `--even-s` / `--hover-s` | tons translúcidos de cinza-azulado | idem, claros | zebra e hover de tabela |
| `--pm-card-bg`, `--pm-card-shadow`, `--pm-card-shadow-hover`, `--pm-glass`, `--pm-ring` | tokens compostos (gradiente/sombra/glass) | idem | usados por `.novo-card`, `.kpi-card`, drawers, modal |

`html` raiz tem `data-theme="dark"` fixo por padrão (`dashboard.html:2`); o toggle
troca para `data-theme="light"` via `toggleTheme()` (função que cada página
define — dependência documentada no `nav.js:9`).

### 1.2 Tipografia

- Fonte: **Inter** self-hosted via `@font-face` (`premium.css:11-17`, woff2,
  weight 100-900, `cv01` congelado — glifo do "1" sem serifa, inclusive em
  numerais tabulares) — vence a versão via Google Fonts que cada HTML ainda
  linka no `<head>` (ex. `dashboard.html:12`), por ser declarada por último na
  cascata. Fallback: `'Segoe UI', system-ui, sans-serif`.
- Corpo: `font-size:13px; line-height:1.5` (`dashboard.html:17`).
- `h1`: `1.45rem/700/-.025em` (`premium.css:158-163`) — sobrescreve o
  `1.5rem/700/-.02em` do inline (`dashboard.html:19`).
- `.kpi-value`: `clamp(1.35rem,.95rem+1.3vw,2rem)/800` no inline
  (`dashboard.html:160`), mas `premium.css:263-270` redefine para
  `2.15rem/700/-.03em` fixo (sem `clamp`) com `font-variant-numeric:normal` —
  **o tamanho fluido do inline nunca aparece**, o KPI sempre renderiza 2.15rem.
- `.kpi-label`: `.63rem/700` uppercase, `color:var(--text2)`
  (`premium.css:256-261`).
- `.kpi-sub`: `.71rem`, `color:var(--muted)` (`premium.css:272`).
- `font-feature-settings:'cv01' 1` no `body` (`premium.css:118`).

### 1.3 Cards de gráfico (`.novo-card`)

Grid: `.novo-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(480px,1fr));gap:1.1rem}`
(`dashboard.html:65` + gap redefinido em `premium.css:202`).

Card: `background:var(--pm-card-bg)` (gradiente sutil + cor sólida),
`border:none`, `border-radius:16px`, `padding:1.35rem 1.55rem`,
`box-shadow:var(--pm-card-shadow)`, hover `translateY(-2px)` + sombra maior
(`premium.css:204-215`) — sobrescreve o inline mais simples
(`radius:10px; padding:1.25rem 1.5rem`, sem sombra/hover, `dashboard.html:66`).

Header do card: `.novo-card-header{display:flex;gap:.6rem;margin-bottom:1rem}`
+ `h3{font-size:.9rem;font-weight:600;letter-spacing:-.01em}`
(`dashboard.html:67-68` + `premium.css:217-223`).

### 1.4 KPI cards (`.kpi-card` / `.kpi-sec`)

`border-radius:18px; padding:1.45rem 1.7rem; box-shadow:var(--pm-card-shadow)`,
com `::after` (glow radial `var(--accent-glow)` que aparece no hover) e
`translateY(-3px)` (`premium.css:229-254`) — sobrescreve o inline mais plano
(`radius:14px`, sem glow, `dashboard.html:156-158`). Existe uma variante
secundária `.kpi-sec` (KPIs menores, linha de apoio) com o mesmo tratamento em
escala reduzida (`premium.css:274-295`).

### 1.5 Tabela (`table.lb`)

`th`: `color:var(--teal)`, uppercase, `letter-spacing:.1em`,
`border-bottom:1px solid` teal-tinted, `position:sticky;top:0`
(`dashboard.html:198` + `premium.css:298-306`). `tbody tr:nth-child(even)` tem
fundo `var(--even-s)`; hover de linha usa `var(--hover-s)` **e** ganha um
`box-shadow: inset 3px 0 0 var(--teal)` na primeira célula — feature que só
existe em `premium.css:311-312`, ausente do inline.

### 1.6 Toggle / segmented control (`.tab-sub`)

Padrão Apple-style com thumb deslizante: `.tab-sub` (pill container) +
`.tab-sub-thumb` (elemento absoluto que se move via `left`/`width`,
transição `.22s cubic-bezier`) + `.tab-sub-btn` (texto, `.active` = cor cheia +
weight 600). Definido no inline em `dashboard.html:85-92` (thumb
`rgba(255,255,255,.14)` sólido) e redefinido por `premium.css:315-330` (thumb
vira gradiente `linear-gradient(135deg, teal, blue)` translúcido). Esta é a
implementação canônica que a Regra de código do `STATUS_LOG.md`
("Toggles… Apple-style `.tab-sub`+`.tab-sub-btn`+`.tab-sub-thumb`") documenta.

### 1.7 Badge / tag

- `.novo-code-tag` — tag de identificação do gráfico (ex. `N06B`), monospace,
  teal, pill, oculta por padrão e revelada por `body.novo-info-on`
  (`dashboard.html:73-75`).
- `.hdr-date-badge` — pill de data ativa no filtro, `var(--card2)` +
  `var(--border)`, valor em negrito teal (`dashboard.html:112-114`).
- `.health-dot` (verde/amarelo/vermelho, animado com glow) — indicador de saúde
  do painel no menu, injetado por `nav.js:35-41` (ver ressalva na seção 2.6:
  usa uma **terceira paleta hardcoded**, não as vars oficiais).

### 1.8 Drawer de informação "i" (padrão canônico)

- Botão: `.novo-info-btn` — círculo 14px, borda 1.5px `var(--text2)`, oculto por
  padrão (`display:none`), revelado por `body.novo-info-on .novo-info-btn`
  (toggle "?" do header) — `dashboard.html:71-72`.
- Tooltip de hover: `#novo-tip` com `.nt-text`/`.nt-code`, glass blur
  (`dashboard.html:77-82`).
- Drawer lateral: `.novo-help-drawer` (desliza da direita, 540px, glass
  `--pm-glass`) + `.novo-help-hdr`/`.novo-help-body`
  (`dashboard.html:239-246`); conteúdo vem do registro `NOVO_HELP_CHARTS`
  (mapa `key → {campos, fórmula, filtro de data}`) e a função `_infoBtn(tooltip, key)`
  abre o drawer filtrado pela `key` do gráfico clicado.

### 1.9 Estado vazio / erro

**Não há um componente único e deliberado no próprio `dashboard.html`/`premium.css`
para isso** — é a maior lacuna que o próprio padrão-ouro tem (ver seção 3.3).
Textos como "sem dados" aparecem como células de tabela com `title` sem estilo
dedicado (`dashboard.html:3808`, comentário "linhas da tabela — 'title' =
separador de seção sem dados"). O restante dos painéis, cada um por conta
própria, inventou 6+ variações diferentes (catalogadas na seção 2).

### 1.10 Dark mode

`data-theme="dark"` fixo no `<html>` por padrão; `html[data-theme="light"]`
redefine as mesmas vars (`premium.css:71-107`). Ícones sol/lua trocam via
`.novo-theme-sun`/`.novo-theme-moon` com `display:none/block` condicional a
`[data-theme="light"]` (`dashboard.html:60-61`, injetado globalmente também por
`nav.js:43-46`). Depende de `toggleTheme()`, função que cada página implementa
por conta própria (`STATUS_LOG.md`, Regra de código, "Toggles…").

### 1.11 Módulos já compartilhados (não duplicados)

| Módulo | Função | Quem inclui |
|---|---|---|
| `public/nav.js` | Menu lateral + dropdown de título — "fonte única" (`nav.js:3`) com `PANELS` completo (10+ itens, subitens de Forecast e BDR, rodapé Sair/Tema/Idioma) | Os 10 painéis "principais": dashboard, board, ae, cs, cotacao, forecast, forecast-stage, forecast-delta, forecast-panel, 48h |
| `public/premium.css` | Skin visual "Mission Control": tokens, cards, tabelas, tabs, drawers, modal, animação de entrada | 14 dos 15 painéis (falta só `forecast-delta.html`) |
| `public/premium.js` | (1) wrapper do `Chart.js` que remapeia paleta legada→premium e aplica gradiente/glow nas barras; (2) `NAV_MODEL`/`buildCanonicalNav` — um **segundo** construtor de menu, mais curto que o do `nav.js` (ver 2.6); (3) stagger de entrada dos cards | Todos os 15 painéis |
| `public/filter-bar.js` | Barra de filtro de período (`AxFilter.*`) | board, ae, bdr, cs, cotacao, 48h (incluído, mas só usado de fato em board/ae/bdr/cotacao — ver 2.2/2.4) |
| `public/settings-modal.js` | Drawer de config (Implantação=Ganho, Ativos+Reunião Agendada, Ativos+Standby) | dashboard, board, ae, bdr, 48h — **cs e cotação não incluem** (ver 2.4) |
| `public/shared-charts.js` | Construtores de gráfico genuinamente compartilhados (comentário `"=Cxx"` marca a origem) | dashboard, board, ae — nenhum outro painel |

---

## 2. Tabela de fragmentação por painel

Legenda de severidade: 🔴 divergência visível/funcional real · 🟡 código morto/duplicado (sem efeito visual hoje, risco de manutenção) · 🟢 alinhado ao padrão.

### 2.1 `board.html` / `ae.html`

Ambos incluem `premium.css?v=5`, `premium.js?v=5`, `filter-bar.js?v=1`,
`settings-modal.js?v=2`, `shared-charts.js?v=1`, `nav.js?v=4`
(`board.html:136-141`, `ae.html:10,139-142`). Os dois têm o **mesmo** bloco
`<style>` inline (cópia-colada idêntica entre si) — a divergência é sempre
frente ao `premium.css`, não entre os dois arquivos.

| # | Achado | Local | Observado | Padrão | Sev. |
|---|---|---|---|---|---|
| 1 | `:root` local com paleta pré-premium | `board.html:15`, `ae.html:20-21` | `--bg:#0d1117 --teal:#3ab8b7 --green:#3fb950 --red:#f85149` etc. | `premium.css:22-34` (`--bg:#070b15 --teal:#2dd4bf`…) vence em runtime | 🟡 |
| 2 | `.novo-card`/`.kpi-card` locais incompletos | `board.html:53,67`, `ae.html:73,93` | radius 10px/14px, sem sombra/glow | `premium.css:204-254` (16px/18px, sombra, glow) — vence em runtime | 🟡 |
| 3 | `.tab-sub-thumb` local sem gradiente | `board.html:111-115`, `ae.html:86-90` | `background:rgba(255,255,255,.14)` sólido | `premium.css:323-330` (gradiente teal/azul) — vence em runtime | 🟡 |
| 4 | `table.lb` local sem hover-inset teal | `board.html:84-90`, `ae.html:114-120` | falta `tr:hover td:first-child{box-shadow:inset 3px 0 0 var(--teal)}` | `premium.css:311-312` — vence em runtime | 🟡 |
| 5 | **Cores de gráfico Chart.js com hex/rgba da paleta antiga** | `board.html` KPI-hover-glow, `.novo-code-tag`, `.stage-chip` (`board.html:56,68,119-120`); `ae.html:446` `STAGE_COLORS` (7 entradas), `ae.html:460` `_novoTheme()` cores de eixo | `rgba(58,184,183,*)` teal antigo, `rgba(63,185,80,*)` verde antigo, `rgba(248,81,73,*)` vermelho antigo, hex `#1f2328`/`#e6edf3` (texto antigo) | Equivalente atual: `#2dd4bf`/`#34d399`/`#fb7185`/`#eef3fb`. **Nuance importante**: para cores passadas a `backgroundColor`/`borderColor` de dataset do Chart.js, `premium.js:27-46` já contém um mapa `MAP_DARK`/`MAP_LIGHT` que remapeia esses 8 pares RGB legados em tempo de execução — a maior parte disso **já é corrigida silenciosamente**; a exceção é qualquer cor fora dessas 8 entradas (nenhuma encontrada aqui) e qualquer uso em CSS puro (box-shadow/border, não coberto pelo remap, que só intercepta `new Chart(...)`) | 🟡 (dataset, provavelmente já remapeado) / 🔴 (CSS puro: glow do KPI-hover e badge de código) |
| 6 | `_infoBtn`/`_codeTag` duplicados por painel | `board.html:397` (`_boardCodeTag`), `ae.html:313` (`_codeTag`) | mesma lógica, nomes de função diferentes | candidato a extração (ver seção 3.4) | 🟡 |
| 7 | Estado vazio/erro | `board.html:178,492,703,718`, `ae.html:176,464,518` | texto solto `color:var(--text2)`/`var(--red)`, botão inline `background:var(--teal)` | consistente com o que existe no padrão-ouro (que também não tem componente dedicado) | 🟢 |
| 8 | `.novo-info-btn`/`.novo-help-drawer` | idênticos entre os dois e ao padrão | — | — | 🟢 |

### 2.2 `cs.html` / `cotacao.html` / `48h.html`

Os três incluem `premium.css?v=5`, `premium.js?v=5`, `filter-bar.js?v=1`,
`nav.js?v=4`. **Só `48h.html` inclui `settings-modal.js?v=2`** — cs e cotação
não. Nenhum dos três inclui `shared-charts.js`.

| # | Achado | Local | Observado | Padrão | Sev. |
|---|---|---|---|---|---|
| 1 | `:root`/`.novo-card`/`.kpi-card` locais desatualizados | `cs.html:15,53,67`; `cotacao.html:15,53,82`; `48h.html:15,70,90-91` | mesma paleta/valores antigos dos itens 2.1.1-2.1.2 | idem — sobrescrito pelo premium.css | 🟡 |
| 2 | `filter-bar.js` incluído e **nunca usado** | `cs.html:107` | zero ocorrências de `AxFilter` no arquivo | cotacao.html usa `AxFilter` ativamente; cs.html paga o download à toa, sem filtro de período | 🔴 (funcional: painel não filtra por data, nenhum aviso disso na UI) |
| 3 | **Painel inteiro não usa gráfico com cores oficiais** — teal/verde/vermelho/laranja antigos hardcoded em 8+ `rgba()` de barras/doughnuts | `cs.html:294,307,322,337,352,372,387` | `rgba(58,184,183,.75)`, arrays com `rgba(88,166,255,*)/rgba(63,185,80,*)/rgba(210,153,34,*)/rgba(147,112,219,*)/rgba(248,81,73,*)` | equivalentes atuais `#2dd4bf/#34d399/#f59e0b/#fb7185`. Mesma ressalva do premium.js MAP_DARK (item 2.1.5): datasets provavelmente remapeados em runtime; confirmar visualmente | 🟡/🔴 (a confirmar) |
| 4 | `.banner-api` definido mas **morto** em `cs.html`; definido **e usado** em `cotacao.html` (só para erro de 1 dos 2 fetches) | `cs.html:95-98`; `cotacao.html:72-75,261` | classe idêntica, uso divergente | erro do 2º fetch de `cotacao.html` (deals) cai no padrão "texto solto" — dois padrões de erro no MESMO arquivo | 🔴 |
| 5 | **Bug estrutural confirmado**: CSS de `.modal`/`.modal-header`/`.modal-close`/`.modal-body`/`.btn-export`/`table.lb` órfão **depois de `</html>`** | `cotacao.html:363` (`</html>`) seguido de `cotacao.html:364-379` (regras soltas, sem `<style>` envolvendo) | Confirmado por leitura direta: essas classes **não existem** dentro do `<style>` real (`cotacao.html:13-87`) | `STATUS_LOG.md` (entrada 2026-07-29, "Cotação religado nos tickets") registra que esse EXATO tipo de bug foi corrigido ("CSS do modal/tabela estava ÓRFÃO… movido para dentro do `<style>`") — **mas o bug está presente hoje**, sugerindo regressão ou que o fix não cobriu este trecho. Fora do escopo de design system, mas é um achado que bloqueia a renderização correta do modal de drill-down deste painel — recomendo o dono verificar/re-aplicar o fix, com prioridade separada desta proposta | 🔴 **(bug funcional, não é só CSS)** |
| 6 | Drawer de informação "i" **incompleto**: só tooltip de hover, sem drawer lateral nem registro `*_HELP_CHARTS` | `cs.html:57-64,168-172`; `cotacao.html:60-65,151` | `_infoBtn` só popula `#novo-tip` | `48h.html` tem o padrão completo (`H48_HELP` + `.novo-help-drawer` + clique abre ficha, `48h.html:117-127,257-311`) — mesmo padrão do `dashboard.html` | 🔴 |
| 7 | Escopo do listener do "i" diverge entre os dois | `cs.html:169` vs `cotacao.html:153` | `cs.html` usa `closest('.novo-info-btn')` (qualquer "i"); `cotacao.html` usa `closest('.kpi-card .novo-info-btn')` (só dentro de KPI) | comportamento sutilmente diferente do mesmo componente entre arquivos irmãos | 🟡 |
| 8 | Toggles globais (Implantação=Ganho etc.) **não existem** | `cs.html`, `cotacao.html` (sem `settings-modal.js`) | `NOVO_WON_STAGE='Ganho'` fixo no código (`cs.html:182`, `cotacao.html:156`) | Todo o resto do menu (CRO/Board/AE/BDR/48h) respeita o toggle global via localStorage — cs/cotação divergem silenciosamente do resto do app sempre que o dono muda essa configuração em outro painel | 🔴 (divergência semântica, não só visual) |
| 9 | `.kpi-card:hover` local com regra extra e teal antigo | `48h.html:91` | `box-shadow:0 0 0 2px rgba(58,184,183,.35)` — cs.html/cotacao.html não têm essa regra no inline | fragmentação entre os 3 arquivos que deveriam ser cópias idênticas do mesmo componente | 🟡 |
| 10 | Paleta de gráfico própria com **cor sem equivalente em nenhum token** | `48h.html:466` | array inclui `rgba(230,150,80,.75)` (`#e69650`, laranja-marrom) | não bate com nenhuma das 8 entradas do `MAP_DARK`/`MAP_LIGHT` do `premium.js` — **não é remapeado em runtime**, é uma cor genuinamente fora do sistema | 🔴 |
| 11 | `_novoMkChart`/`_novoTheme`/`_ne`/`_ni`/`_fmtBig` reimplementados quase idênticos nos 3 | todo o arquivo | cópias locais | candidatos óbvios para `shared-charts.js` (nenhum dos 3 o inclui) | 🟡 |

### 2.3 Família Forecast — `forecast.html` / `forecast-stage.html` / `forecast-panel.html` / `forecast-delta.html`

#### `forecast.html` e `forecast-stage.html` (painéis grandes, ~5000+ linhas cada)

Ambos incluem `premium.css?v=5`, `premium.js?v=5`, `nav.js?v=4`. **Nenhum dos
dois inclui `filter-bar.js`, `settings-modal.js` ou `shared-charts.js`** — toda
lógica de filtro/config/gráfico é bespoke. `premium.js:24` marca a página com
a classe `html.pm-forecast` (por regex de path `/forecast/`), e
`premium.css:521-682` (seção 14, "INTEGRAÇÃO FORECAST") é uma **ponte
dedicada** que traduz visualmente `.seg-ctrl`, `.kpis`/`.kpi`, `.table-wrap`,
`.fbtn`, `.view-tab`, `.prob-modal` — os nomes de classe próprios do forecast —
para a mesma linguagem visual do resto do app, **sem exigir que o forecast
renomeie nada**. Confirmado que a ponte funciona para o que ela cobre.

| # | Achado | Local | Observado | Padrão | Sev. |
|---|---|---|---|---|---|
| 1 | `:root` local com paleta antiga | `forecast.html:15-33`, `forecast-stage.html:15-33` (byte-a-byte idênticos entre si) | mesma paleta pré-premium | sobrescrito pelo premium.css | 🟡 |
| 2 | Toggle usa nome próprio `.seg-ctrl`/`.seg-btn`, não `.tab-sub` | ambos | divergência de nomenclatura frente à convenção do `STATUS_LOG.md` | coberto pela ponte `html.pm-forecast .seg-ctrl` (`premium.css:540-555`) — visual ok | 🟡 (nome) |
| 3 | **Os dois arquivos-irmãos já divergiram entre si na MESMA funcionalidade** | `forecast.html:4974-4983` tem `_syncSegThumb()` (mede a largura real via JS, corrige bug de "assumia 2 botões idênticos", conforme comentário no próprio código); `forecast-stage.html` **não tem** essa função — usa `.seg-ctrl.on-historico::before{transform:translateX(100%)}` fixo (linha 114), quebra se os 2 botões tiverem larguras diferentes | `forecast.html` já corrigido; `forecast-stage.html` ainda no bug antigo | 🔴 (bug visual real em toggles com rótulos de tamanho desigual) |
| 4 | `.error-msg{color:#f85149}` hex fixo (não `var(--red)`) | `forecast.html:1586`, `forecast-stage.html:1586` (idêntico) | `#f85149` (vermelho antigo) | `var(--red)` atual é `#fb7185` — mensagem de erro renderiza com um vermelho visivelmente diferente do resto do app | 🔴 |
| 5 | Teal legado hardcoded em CSS puro, **fora do alcance da ponte `pm-forecast`** | `.filter-pill` (`forecast.html:433`), `.search-input-full:focus` (`:533`), `.domain-badge` (`:1577-1578`), FAB mobile (`:1653`), `.dm-pipe` (`forecast-stage.html:1343`) — mesmo conjunto repetido nos dois arquivos | `rgba(58,184,183,*)` | Nenhum desses seletores está na lista de tradução da seção 14 do `premium.css` — renderiza com o teal antigo (`#3ab8b7`) enquanto bordas/texto do resto da página já usam `#2dd4bf`. **Este é real e visível**, não passa por nenhum remap (CSS puro, não Chart.js) | 🔴 |
| 6 | Versões de asset divergentes entre os dois irmãos | `forecast.html:1828` `revenue-engine.js?v=2`; `forecast-stage.html:1787` `revenue-engine.js?v=1` | versão MENOR no forecast-stage | ⚠ Isso não é só estética — se `v1`/`v2` do `revenue-engine.js` tiverem comportamento de cálculo diferente, os dois painéis podem estar reportando receita calculada por lógicas diferentes, o que tocaria a **Regra primária nº 3** do `STATUS_LOG.md` (fonte única de receita). Recomendo checar se `v1`/`v2` são so cache-busters idênticos em conteúdo ou se o código realmente mudou — fora do escopo desta auditoria visual, mas vale alerta separado ao dono | 🔴 (potencial, a verificar — não confirmado como bug de receita, só como sinal de alerta) |
| 7 | `meta-ach.js` presente só em `forecast.html` | `forecast.html:1831` | ausente em `forecast-stage.html` | feature/módulo que um dos irmãos não carrega | 🟡 |
| 8 | Drawer de informação "i" **totalmente ausente** | ambos | zero ocorrências de `novo-info-btn`/`NOVO_HELP_CHARTS`/`_infoBtn` | dashboard.html tem o padrão completo | 🔴 |
| 9 | Estado vazio/erro: `.state`/`.state.err` (texto puro) | `forecast.html:1061-1070`; `forecast-stage.html:2230,3720,3730,3785,4762` | terceira variação de "vazio" do projeto (ver 2.5) | — | 🟡 (consistente entre os 2 irmãos, mas é mais um "dialeto" no total do projeto) |

#### `forecast-panel.html` (109 linhas, placeholder "em construção")

| # | Achado | Local | Observado | Padrão | Sev. |
|---|---|---|---|---|---|
| 1 | `:root` "meio-termo" — parte já bate com premium.css, parte não | `forecast-panel.html:13-14` | `--border:#243349`/`--muted:#64748b` já corretos; `--bg`/`--card`/`--teal` ainda antigos | indício de cópia parcialmente atualizada | 🟡 |
| 2 | Estado "vazio" com linguagem visual PRÓPRIA (3ª variação) | `.ph-card` (`:65-68,87`) | card com borda tracejada + emoji 🚧, `min-height:55vh` | diferente de `.state`/`.state.err` do forecast.html E de qualquer coisa em `premium.css` | 🔴 (fragmentação de linguagem para o mesmo propósito) |
| 3 | ~50 linhas de `.nav-drawer`/`.nav-item`/`.panel-switcher` replicadas manualmente | `:21-63` | valores idênticos ao que `premium.css:348-435` e o CSS injetado por `nav.js:19-51` já cobririam | código morto/duplicado, sem efeito visual (valores batem), mas peso de manutenção | 🟡 |
| 4 | `.health-dot.g/.y/.r` com uma **terceira paleta**, nem antiga nem premium | `:61-63` | `#2ecc71`/`#f1c40f`/`#e74c3c` (paleta "Flat UI") | Não existe `--green`/`--yellow`/`--red` equivalente nem no `:root` legado nem no `premium.css` — é hardcode puro. **Mesma paleta é injetada globalmente por `nav.js:39-41`**, então não é um bug isolado deste arquivo: o sistema de "health dot" nunca foi migrado para as vars oficiais em NENHUM lugar do projeto | 🔴 (mas é achado de escopo **global**, via `nav.js`, não deste arquivo especificamente) |

#### `forecast-delta.html` — o painel "principal" mais divergente do conjunto

**Não inclui `premium.css` nem `premium.js`** — confirmado por grep no arquivo
inteiro. Único asset compartilhado que carrega é `nav.js?v=4`
(`forecast-delta.html:984`).

| # | Achado | Local | Observado | Padrão | Sev. |
|---|---|---|---|---|---|
| 1 | `:root` próprio, com os valores antigos, **e sem nada que o sobrescreva** (não tem premium.css) | `forecast-delta.html:16-17` | `--bg:#0d1117 --card:#171f2e --teal:#3ab8b7` etc. — os MESMOS valores que em qualquer outro painel seriam mortos, aqui são **vivos** | Sem override, é o único painel do conjunto "principal" que renderiza de fato com a paleta antiga (mais escura/menos saturada que o resto do app) | 🔴 |
| 2 | Toggle sem thumb deslizante | `~linha 35` (bloco `.tab-sub`) | `border-radius:9px` (retangular), classe de estado ativo é `.on`, não `.active`; sem elemento `.tab-sub-thumb` | Divergência estrutural do componente, não só de cor — o segmented control deste painel não tem a animação Apple-style que o resto do app tem | 🔴 |
| 3 | Classes de card/KPI próprias | `.card` / `.kpi`/`.k`/`.v`/`.d` (ex. `:276,283,588`) | não são `.novo-card`/`.kpi-card`/`.kpi-label`/`.kpi-value` | Mesmo que se adicionasse `premium.css` a este arquivo, **nenhuma regra do premium se aplicaria** — precisa também renomear/apelidar as classes (ou estender premium.css com uma ponte dedicada, como já existe para `pm-forecast`) | 🔴 |
| 4 | Botão "i" com nome/estrutura próprios | `.ibtn` | círculo 24px, borda `var(--border)`, hover `color:var(--text)` | 4ª variação de botão de informação do projeto (ver 2.5) — sem drawer lateral, só um botão que provavelmente abre algo simples | 🟡 |

### 2.4 Família BDR — `bdr.html` + 4 subpáginas (**território do Samuel — ver aviso abaixo**)

> ⚠ `bdr-workload.html`, `bdr-treble.html`, `bdr-no-show.html` e
> `bdr-list-attack.html` são mantidas por **outro desenvolvedor (Samuel)**.
> Os achados abaixo são só documentação do estado atual — **nenhuma mudança
> nesses 4 arquivos deve ser implementada sem coordenar com ele antes**.
> `bdr.html` é o arquivo "principal" da família e tem bytes NUL herdados —
> pode ser **lido** normalmente, mas nunca editado com `sed`/scripts de texto
> (já corrompeu o arquivo uma vez, `STATUS_LOG.md`).

**Achado transversal mais importante desta família: existem DUAS fontes de
navegação divergentes, e os 5 arquivos usam a mais pobre das duas.**
`nav.js` se autodeclara "fonte única" (`nav.js:3`) com o `PANELS` completo
(subitens de Forecast, CS/Cotação ocultos-mas-presentes, rodapé com
Sair/Tema/Idioma). Mas `premium.js` **também** define um `NAV_MODEL`/
`buildCanonicalNav` próprio (`premium.js:246-328`) — um menu mais curto, sem
subitens de Forecast, sem CS/Cotação, sem rodapé. Nos 10 painéis "principais",
quem vence é o `nav.js` (incluído por último no documento, sobrescreve o que o
`premium.js` monta primeiro). **Mas nenhum dos 5 arquivos BDR inclui
`nav.js`** — só `premium.js` — então essa família **sempre** renderiza o menu
mais pobre e incompleto, nunca o oficial. É uma divergência funcional real,
não cosmética: usuário no BDR vê um menu lateral diferente (e menor) do que em
qualquer outro painel.

| # | Achado | Local | Observado | Padrão | Sev. |
|---|---|---|---|---|---|
| 1 | 5 arquivos sem `nav.js`, dependentes do `NAV_MODEL` incompleto do `premium.js` | todos os 5 | confirmado por grep — nenhum `bdr*.html` inclui `nav.js` | ver parágrafo acima | 🔴 |
| 2 | Versão de `premium.js`/`premium.css` mais NOVA que o resto do app | todos os 5 | `?v=10` (`bdr.html:132`, subpáginas idem) | os outros 10 painéis "principais" estão em `?v=5` — a família BDR já está numa versão adiantada, não atualizada para o resto ainda; risco de skew nos dois sentidos | 🟡 |
| 3 | `.novo-card`/`.kpi-card` (tratamento "premium") só existe em `bdr.html` | `bdr.html:68,93,956-958` usa corretamente; as 4 subpáginas usam `.card`/`.kpi` próprios (ex. `bdr-workload.html:76,84`) | confirmado por grep — zero ocorrências de `.novo-card`/`.kpi-card` nas 4 subpáginas | Como as regras do `premium.css` são por nome de classe, as 4 subpáginas **nunca recebem** o gradiente/glow/elevação do padrão-ouro — usam um token próprio `--shadow` (não existe em `premium.css` nem em `bdr.html`) | 🔴 |
| 4 | `table.lb`/`.tab-sub` ausentes nas 4 subpáginas | confirmado por grep | sistema próprio prefixado `v2-*` em `bdr-workload.html` (`.v2-kpi`, `.v2-stackbar`, `.v2-bdr-multi`…); `.tab`/`.tab.active` simples em `bdr-treble.html` (sem thumb); toggles tipo `.period-chip`/`.channel-chip` no lugar de `.tab-sub` | nenhuma reaproveita a nomenclatura oficial | 🔴 |
| 5 | Cores de gráfico hardcoded, algumas **fora de qualquer paleta conhecida** | `bdr-workload.html:165` (`fill:#3896B4`/`#3AB8B7` em SVG) | hex direto, sem var | `#3896B4` não corresponde a nenhum token antigo nem premium | 🔴 |
| 6 | `:root` local de `bdr-workload.html` tem valores **semanticamente errados** mesmo no fallback morto | `bdr-workload.html:13-14` | `--green:#3896B4` (azul, não verde!), `--yellow:#8b949e` (cinza), `--red:#6e7681` (cinza) | Os outros 4 arquivos da família usam a paleta semântica correta no fallback (`--green:#3fb950` etc.) — só este diverge mesmo no código-morto | 🟡 (mas incomum — se algum dia o override falhar, este arquivo pinta ERRADO, não só "antigo") |
| 7 | Aviso/erro com **4 nomes de classe diferentes** para o mesmo conceito | `bdr.html` → `.banner-warn`; `bdr-workload.html` → `.note.bdr-freeze`; `bdr-treble.html` → nenhuma classe dedicada; `bdr-no-show.html` → `.data-scope-warning` + `.big-idea` (vermelho 2px, o mais chamativo dos 5); `bdr-list-attack.html` → nenhuma | 5 variações | nenhuma reaproveita `.banner-warn` de `bdr.html` nem qualquer coisa de `dashboard.html` | 🔴 |
| 8 | Drawer "i" com nomenclatura paralela (mas consistente entre si) nas 4 subpáginas | `.calc-btn`/`.hover-tip`/`.help-drawer`/`.help-block` (ex. `bdr-workload.html:105-110`) | `bdr.html` usa o padrão canônico (`.novo-info-btn`/`#novo-tip`/`.novo-help-drawer`) | 5ª variação de botão de informação do projeto (ver 2.5) — as 4 subpáginas são consistentes ENTRE SI, só divergem do resto do app | 🟡 |
| 9 | `bdr-treble.html`: duas declarações de fonte conflitantes | `:10` (Roboto via Google Fonts) e `:14` (`body{font-family:Roboto,...}` forçando por cima do `Inter` já declarado) | único arquivo do projeto inteiro usando Roboto | inconsistência tipográfica isolada, fácil de corrigir (1 arquivo) | 🟡 |
| 10 | `bdr-list-attack.html`: JS hardcoded sobrepõe o indicador de saúde do `NAV_MODEL` | `:41` | `d.className='health-dot r title-health'` forçado no `DOMContentLoaded`, redundante com `health:'r'` já declarado em `premium.js:256`/`nav.js:64` | segunda fonte do mesmo dado, hardcoded no HTML em vez de vir só do menu | 🟡 |

### 2.5 Síntese: quantas "linguagens visuais" existem hoje para o mesmo componente

| Componente | Nº de variações encontradas | Onde |
|---|---|---|
| Botão de informação "i" | **5** | canônico `.novo-info-btn` (dashboard/board/ae/bdr.html) · tooltip-only sem drawer (cs/cotação) · `.calc-btn`/`.hover-tip`/`.help-drawer` (4 subpáginas BDR) · ausente (forecast.html/forecast-stage.html/forecast-panel.html) · `.ibtn` próprio (forecast-delta.html) |
| Estado vazio/erro/aviso | **7+** | texto solto `color:var(--red)` (maioria) · `.banner-api` (cs morto / cotação usado) · `.state`/`.state.err` (forecast/forecast-stage) · `.ph-card` com 🚧 (forecast-panel) · `.banner-warn` (bdr.html) · `.note.bdr-freeze` (bdr-workload) · `.data-scope-warning`+`.big-idea` (bdr-no-show) |
| Toggle/segmented control | **4** implementações distintas do CONCEITO, mesmo quando o nome é parecido | `.tab-sub`+thumb dinâmico (padrão-ouro) · `.tab-sub` sem thumb, `.on` (forecast-delta) · `.seg-ctrl` com thumb JS (forecast.html) vs. thumb fixo 50% (forecast-stage.html, já divergiu do irmão) · `.tab`/pills simples sem thumb (bdr-treble, `.period-chip` em bdr-workload) |
| Card de gráfico com elevação "premium" | presente em **6** painéis (dashboard, board, ae, bdr.html + os que herdam via classe certa), **ausente** em cs/cotação/48h (classe certa mas caindo em versão desatualizada só por cascata), **ausente estruturalmente** em forecast-delta e nas 4 subpáginas BDR (nome de classe errado) | — |
| Construtor de menu lateral | **2** (`nav.js` PANELS completo vs. `premium.js` NAV_MODEL incompleto) — os 10 painéis principais usam o completo por acidente de ordem de carregamento; os 5 BDR sempre usam o incompleto | — |

---

## 3. Proposta de unificação (priorizada por maior fragmentação × menor esforço)

A ordem abaixo é a de maior retorno visual/consistência por menor risco de
quebrar lógica existente — não é a ordem "correta" de arquitetura, é a ordem
de rollout recomendada.

### Tier 1 — baixo risco, alto retorno, front-only, sem tocar em `api/`/`lib/`

1. **Religar `forecast-delta.html` ao sistema compartilhado.** Adicionar
   `<link rel="stylesheet" href="/premium.css?v=5">` + `<script src="/premium.js?v=5"></script>`
   no `<head>` e renomear/apelidar `.card`→`.novo-card`, `.kpi`/`.k`/`.v`→
   `.kpi-card`/`.kpi-label`/`.kpi-value`, `.tab-sub` com thumb real. É o único
   arquivo "principal" hoje visualmente fora do sistema — maior ganho de
   consistência com o menor número de arquivos tocados (1).
2. **Apagar as ~13 cópias mortas de `:root`/`.novo-card`/`.tab-sub`/`table.lb`**
   espalhadas por `board.html`, `ae.html`, `cs.html`, `cotacao.html`, `48h.html`,
   `bdr.html`, `forecast.html`, `forecast-stage.html`, `forecast-panel.html` (e,
   coordenado com o Samuel, as 4 subpáginas BDR). Zero mudança visual (o
   `premium.css` já vence hoje), mas elimina o risco de regressão silenciosa se
   a ordem dos `<link>` mudar um dia, e corta ~150-200 linhas duplicadas por
   arquivo. É o item de **maior fragmentação de código-fonte** do levantamento
   inteiro, e o de **menor risco possível** (não muda nada que o usuário vê).
3. **Corrigir os hardcodes de cor que NÃO passam por nenhum remap** (CSS puro,
   não Chart.js): `.filter-pill`/`.search-input-full:focus`/`.domain-badge`/
   FAB/`.dm-pipe` em `forecast.html`/`forecast-stage.html`, `.error-msg` (hex
   fixo `#f85149`) nos mesmos dois arquivos, hover-glow do `.kpi-card` em
   `48h.html`, a cor órfã `rgba(230,150,80,*)` em `48h.html`. É um find-replace
   contido, sem lógica, com efeito visual real e imediato.
4. **Portar `_syncSegThumb()` de `forecast.html` para `forecast-stage.html`** —
   os dois arquivos-irmãos já divergiram no mesmo componente; é uma função só,
   contida, sem dependência de dado.
5. **Verificar/corrigir o CSS órfão de `cotacao.html` (linhas 364-379,
   depois de `</html>`)** — fora do escopo de design system, mas é um bug
   funcional que bloqueia o estilo correto do modal de drill-down deste
   painel; o `STATUS_LOG.md` registra que esse tipo de bug já foi corrigido
   antes, então pode ser regressão. Recomendo tratar como item isolado,
   independente da ordem de rollout do design system.

### Tier 2 — esforço médio, ainda front-only, mas cruza mais de um arquivo

6. **Extrair o drawer de informação "i" para um módulo compartilhado** (ver
   seção 3.4) — hoje é idêntico byte-a-byte entre dashboard/board/ae/bdr.html,
   então a extração em si é de risco zero; o ganho é permitir que cs.html,
   cotacao.html e a família forecast adotem o MESMO padrão em vez de inventar
   o próprio (ou não ter nenhum).
7. **Ligar `settings-modal.js` em `cs.html` e `cotacao.html`** — hoje os dois
   têm "Ganho" hardcoded e divergem silenciosamente do resto do app sempre que
   o dono muda o toggle global em outro painel. É uma correção de
   **comportamento**, não só de CSS — priorizar acima de itens puramente
   visuais por isso.
8. **Consolidar estado vazio/erro/aviso em um componente único** (ver seção
   3.4) com modificador de severidade (info/aviso/erro), oferecido pelo novo
   módulo compartilhado — substitui as 7+ variações hoje espalhadas. Fazer
   incrementalmente, painel a painel, começando pelos 10 "principais" antes de
   tocar na família BDR.
9. **Migrar o sistema de saúde (`health-dot`) para as vars oficiais**
   (`--green`/`--yellow`/`--red`) em vez da paleta Flat-UI hardcoded — hoje
   injetada globalmente por `nav.js:39-41` e duplicada em `forecast-panel.html:61-63`.
   Toca 2 arquivos só, e um deles (`nav.js`) já é o ponto único de verdade do
   menu — arrumar ali propaga para todo o app de uma vez.

### Tier 3 — esforço alto ou fora do meu controle (coordenar antes de agir)

10. **Resolver a duplicidade `nav.js` × `premium.js`/`NAV_MODEL`.** Duas
    opções: (a) incluir `nav.js` nos 5 arquivos BDR (mais simples, mas Samuel
    precisa validar que nada quebra no fluxo dele); (b) aposentar o
    `NAV_MODEL` interno do `premium.js` e fazer TODO o app depender só do
    `nav.js`. Qualquer uma exige decisão + coordenação com o Samuel antes de
    tocar nos arquivos dele.
11. **Migrar as 4 subpáginas BDR para `.novo-card`/`.kpi-card`/`.tab-sub`.**
    Maior esforço da lista — `bdr-workload.html` tem um sistema `v2-*`
    inteiro e próprio; não é só CSS, mexe em como o JS monta o DOM. Território
    do Samuel — documentar e propor, não implementar.
12. **Migrar `forecast.html`/`forecast-stage.html` (5000+ linhas cada) para
    `shared-charts.js`/`filter-bar.js`/`settings-modal.js`** em vez de suas
    reimplementações bespoke. Maior arquivo, maior risco (lógica de receita
    crítica), deve ser o ÚLTIMO item da lista e feito função por função, com
    gate de paridade (screenshot + `test-forecast-delta-e2e.js`-style) a cada
    extração — exatamente o modelo do ADR-001.
13. **Investigar a divergência de versão `revenue-engine.js` v1×v2** entre
    `forecast-stage.html` e `forecast.html` (achado 2.3.6) — não é item de
    design system, mas toca a Regra primária nº 3 (fonte única de receita); é
    prioridade de investigação técnica, independente do rollout visual.

### 3.4 O módulo novo proposto

**Não crie um novo arquivo de tokens CSS.** `premium.css` já cumpre esse papel
e já está incluído em 14 dos 15 painéis — duplicar essa responsabilidade num
`design-tokens.css` separado recriaria o mesmo problema que este documento
descreve (duas fontes do mesmo dado). A ação certa é **parar de duplicar
localmente** (Tier 1, item 2), não criar mais uma camada.

O que de fato falta — e onde um módulo novo se justifica, seguindo o mesmo
padrão de extração já usado para `nav.js`/`filter-bar.js`/`settings-modal.js`
(um `<script>`/`<link>` a mais por página, zero cópia de código) — é:

- **`public/help-drawer.js` (+ CSS injetado por ele, mesmo padrão do `nav.js`
  que injeta seu próprio `<style>`)**: promove o `.novo-info-btn`/`#novo-tip`/
  `.novo-help-drawer`/`_infoBtn`/registro `*_HELP_CHARTS` — hoje idêntico
  byte-a-byte entre dashboard/board/ae/bdr.html — para um módulo único que
  qualquer painel inclui e alimenta só com seu próprio mapa de `{key: {campos,
  fórmula, filtro}}`. Zero risco na extração inicial (é cópia exata do que já
  existe); o ganho é permitir que cs/cotação/forecast/BDR adotem o MESMO
  componente em vez de inventar o próprio.
- **Um componente de estado vazio/erro/aviso** (`AxUI.emptyState(msg)` /
  `AxUI.banner(msg, {severity:'info'|'warn'|'error', retry})`), no mesmo
  módulo ou em `settings-modal.js`-sibling novo, substituindo as 7+ variações
  da seção 2.5.
- **Extensão do mapa `MAP_DARK`/`MAP_LIGHT` do `premium.js`** (linhas 27-46)
  para cobrir as cores hardcoded que hoje escapam do remap automático (ex. o
  `#e69650` do 48h.html, entradas extras do `STAGE_COLORS` do ae.html) — não é
  um módulo novo, é um acréscimo de poucas linhas a um mecanismo que já existe
  e já faz esse trabalho para 90% dos casos.

---

## 4. Próximos passos sugeridos (ordem de implementação)

1. `forecast-delta.html` → religar a `premium.css`/`premium.js` + realinhar
   classes (Tier 1.1). Menor arquivo do grupo "principal" divergente, maior
   salto de consistência visual isolado.
2. Limpeza mecânica dos `:root`/componentes mortos nos 9 arquivos "principais"
   já mapeados (Tier 1.2) — pode ser feito com um mesmo checklist repetido por
   arquivo, validado por `npm run check` + screenshot antes/depois (gate de
   paridade, mesmo espírito do ADR-001).
3. Hardcodes de cor em CSS puro (Tier 1.3) + thumb dinâmico do forecast-stage
   (Tier 1.4) — dois itens pequenos, independentes, podem andar em paralelo
   com o item 2.
4. Verificação do CSS órfão de `cotacao.html` (Tier 1.5) — tratar como bug
   isolado, não esperar a fila do design system.
5. Extração do módulo de drawer de informação "i" (Tier 2.6) — primeiro
   promovendo o que já é idêntico (dashboard/board/ae/bdr.html), depois
   oferecendo a cs.html/cotacao.html/forecast a chance de adotar em vez de
   continuar com tooltip-only ou nada.
6. Ligar `settings-modal.js` em cs.html/cotacao.html (Tier 2.7) — prioridade
   maior que itens puramente visuais por ser uma divergência de comportamento.
7. Componente único de estado vazio/erro (Tier 2.8), painel a painel, começando
   pelos 10 principais.
8. Migração do `health-dot` para vars oficiais (Tier 2.9) — via `nav.js`, único
   arquivo, propaga para todo o app.
9. Levar os achados da família BDR (seção 2.4) e a investigação de
   `revenue-engine.js` v1×v2 (Tier 3.13) ao Samuel/dono para decidir prioridade
   e coordenar — nenhuma ação direta nos 4 arquivos dele antes disso.
10. Migração incremental de `forecast.html`/`forecast-stage.html` para os
    módulos compartilhados (Tier 3.12) — último item, maior risco, maior
    arquivo, só depois que os passos 1-9 já tiverem reduzido a superfície de
    divergência do resto do app.
