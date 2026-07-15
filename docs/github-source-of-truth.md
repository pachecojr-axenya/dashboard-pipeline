# GitHub como fonte da verdade | Fluxo prático do Dashboard

Regra simples:

> Se não está commitado e pushado no GitHub, não vai para produção.

Este documento existe para evitar deploys locais divergentes apagando trabalho de outra pessoa.

## Antes de começar

```bash
git fetch origin
git status --short --branch
git log --oneline --decorate -5
```

- Se estiver atrás de `origin/main`, atualize antes.
- Se houver arquivo sem commit, decida se ele entra no trabalho ou fica fora.
- Se for mexer em menu/API/lib/deploy, avise antes.

## Durante o trabalho

Crie branch, faça commits claros e suba para o GitHub:

```bash
git checkout -b <nome>/<escopo-curto>
git add <arquivos>
git commit -m "feat(area): descreve a mudança"
git push origin HEAD
```

Trabalho sem push ainda é local. Não usar como base de produção.

## Antes de deploy

```bash
git fetch origin
git status --short --branch
git log --oneline --decorate -5
npm run check
npm run predeploy
```

`npm run predeploy` é a forma canônica; ele chama `node scripts/preflight-deploy.js`.

Deploy só se:

- working tree limpa;
- commit no GitHub;
- base atualizada;
- sem conflito pendente com outra pessoa;
- rotas críticas checadas.

## Lock no Slack

Antes:

```text
LOCK deploy dashboard | owner: <nome> | commit: <hash> | escopo: <rotas> | ETA: <min>
```

Depois:

```text
UNLOCK deploy dashboard | prod: <hash> | smokes: <rotas> | status: OK/atenção
```

## Smokes mínimos

```text
/novo
/forecast
/novo-bdr
/novo-bdr/treble
/novo-bdr/workload
/novo-bdr/no-show
/novo-bdr/list-attack
```

HTML deve retornar `200`. API sem sessão retornar `401` é esperado.

## Arquivos de alto risco

Coordene antes de mexer/deployar:

- `public/nav.js`
- `public/premium.js` **e todo o território BDR (`bdr*`, `api/bdr-*`) — dono: Samuel; não mexer sem coordenar com ele**
- blocos `PANELS` inline, se ainda existirem
- `vercel.json`
- `api/*`
- `lib/*`
- `forecast-engine.js`
- `revenue-engine.js`
- auth/deploy

Menu hoje: enquanto a integração com `public/nav.js` não for mergeada, `origin/main` ainda usa `PANELS` inline nas páginas grandes e `premium.js` nas subpáginas BDR. Se `public/nav.js` virar fonte única, portar todos os itens novos para ele e remover/neutralizar fontes paralelas no mesmo PR.

## Fim do dia

Antes de encerrar:

```bash
git status --short --branch
```

Se houver mudança importante local, commitar e pushar para branch. Não deixar trabalho crítico só na máquina.
