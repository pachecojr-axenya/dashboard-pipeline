# Menu lateral — grupo BDR (acordeão)

> Status: **live** desde 2026-07-14. Autor: Growth/IA.

## O que é

O item **BDR Performance** no menu lateral vira uma "pasta" com uma **setinha**
(chevron ˅). Clicar no chevron expande/recolhe as subpáginas de BDR; clicar no
rótulo continua navegando para a visão geral (`/novo-bdr`). O grupo **auto-expande**
quando a página atual é uma das subpáginas de BDR.

Subpáginas do grupo `bdr` (na ordem):

| Rótulo | Rota | Arquivo | Health |
|---|---|---|---|
| BDR Performance (pai) | `/novo-bdr` | `bdr.html` | g |
| Workload \| Intraday | `/novo-bdr/workload` | `bdr-workload.html` | y |
| No-Show | `/novo-bdr/no-show` | `bdr-no-show.html` | g |
| Ataque à Lista | `/novo-bdr/list-attack` | `bdr-list-attack.html` | g |
| Treble | `/novo-bdr/treble` | `bdr-treble.html` | y |

O padrão de acordeão é o **mesmo** já usado por **Forecast › Overall** (grupo `forecast`).
Só os grupos `bdr` e `forecast` usam esse formato; o resto do menu é plano.

## Onde vive (⚠️ DUAS fontes — mantenha em sincronia)

O dashboard tem **dois** renderizadores de menu, por razões históricas. Ambos
precisam conhecer o grupo BDR:

1. **Páginas "grandes"** (`dashboard.html`, `board.html`, `ae.html`, `cs.html`,
   `cotacao.html`, `48h.html`, `forecast*.html` e `bdr.html`): trazem o menu
   **inline**, a partir do array `PANELS` dentro de cada arquivo. Renderiza
   `<a href>` e usa `window.toggleNavGroup(grp, event)` + chevron com
   `id="nav-acc-ch-<grp>"`. Itens do grupo carregam `data-grp`, subitens têm
   `.nav-sub`, o pai tem `.nav-acc`, e o estado recolhido é `.nav-collapsed`.

2. **Subpáginas de BDR** (`bdr-workload.html`, `bdr-no-show.html`,
   `bdr-list-attack.html`, `bdr-treble.html`): NÃO têm menu inline. O menu é
   montado pelo **`public/premium.js`** (`buildCanonicalNav` + array `NAV_MODEL`),
   que roda em todas as páginas que carregam `premium.js`. Renderiza `<li data-href>`
   com delegação de clique; o chevron é `.nav-acc-chevron[data-acc-grp="<grp>"]`
   e o toggle é **local** (`toggleGroup`), de propósito **sem** escrever em
   `window.toggleNavGroup` — para não colidir com a versão inline nas páginas grandes.

> Nas páginas grandes o `premium.js` também roda, mas o menu inline é reconstruído
> depois e prevalece. Por isso a versão do `premium.js` mantém o toggle local.

### Regra de manutenção

Ao **adicionar/remover/renomear** uma página do menu ou mudar o grupo BDR, atualize
**os DOIS lugares**:

- o array `PANELS` inline (procure `var PANELS=[` — está igual em 10 arquivos
  `.html`; um patch em lote mantém todos idênticos), e
- o array `NAV_MODEL` em `public/premium.js`.

CSS do acordeão (subpáginas): `public/premium.css`, seção "Acordeão de subpáginas".
CSS do acordeão (páginas grandes): inline em cada `.html` (`.nav-item.nav-sub`,
`.nav-acc-chevron`, `.nav-collapsed`).

## Modelo de dados (campos por item)

- `acc: true` — item é o **pai** do grupo (ganha chevron).
- `sub: true` — item é **filho** (indentado, recolhível).
- `grp: '<id>'` — id do grupo (ex.: `'bdr'`, `'forecast'`). Pai e filhos compartilham.
- `health: 'g' | 'y' | 'r'` — bolinha de status (live / wip / not working).

## Como testar

Servidor local (bypass de auth): `node scripts/local-server.js 3002`, depois abrir
`/novo-bdr/workload` (subpágina → premium.js) e `/novo` (grande → inline) e conferir:
o grupo BDR aparece, o chevron expande/recolhe, e a subpágina atual fica destacada.
`npm run check` valida a sintaxe de `premium.js` e os blocos inline.
