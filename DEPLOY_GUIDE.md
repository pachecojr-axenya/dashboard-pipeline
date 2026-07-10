# Diretrizes de Deploy do Dashboard Axenya

> **Aviso para IAs e Desenvolvedores:** Leia este documento ANTES de realizar qualquer alteração de infraestrutura, linkar projetos no Vercel ou realizar deploy para produção.

Este documento consolida todas as configurações necessárias para que o deploy da aplicação funcione corretamente em produção, com especial atenção à autenticação via Google OAuth.

---

## 1. Infraestrutura e Vercel

O projeto utiliza **Vercel Serverless Functions**.
- Devido à limitação de 12 serverless functions no plano "Hobby", o deploy deste projeto **deve ser feito no plano Vercel Pro** (na conta/team da empresa Axenya).
- **Nunca** tente fazer deploy no plano Hobby, pois falhará com erro de limite de functions (existem mais de 20 endpoints na pasta `api/`).

### Como realizar o Deploy
1. Certifique-se de estar linkado ao team correto: `vercel switch` (selecionar o team da Axenya).
2. Certifique-se de estar linkado ao projeto correto: `vercel link --project prj_WlrmzEWZ9LXoRgeUCzy125UDlYLS`.
3. Depois de commit/push, rode o preflight canônico: `node scripts/preflight-deploy.js`.
4. Faça o deploy para produção: `npm run deploy`.

> Regra canônica desde 2026-07-10: **não deployar árvore local suja, branch diferente de `main`, HEAD diferente de `origin/main`, projeto Vercel errado ou pacote sem os endpoints recentes.** O script `scripts/preflight-deploy.js` bloqueia esses casos antes do upload.

---

## 2. Configuração do Google OAuth e Redirecionamentos

O sistema de login utiliza Google Identity Services (GIS). Para que o popup do Google funcione em produção:

1. **Domínio Canônico:** O Google OAuth exige que o domínio de origem seja estritamente validado.
2. **Atualização no Console do Google Cloud:** Ao mudar o domínio de deploy ou criar uma nova URL no Vercel (ex: `https://project-bsmfu.vercel.app`), este domínio **precisa obrigatoriamente** ser adicionado no [Google Cloud Console](https://console.cloud.google.com/):
   - Em **Origens JavaScript autorizadas** (ex: `https://project-bsmfu.vercel.app`)
   - Em **URIs de redirecionamento autorizados** (ex: `https://project-bsmfu.vercel.app/api/auth/callback`)

### O Script de Redirecionamento (`login.html`)
Para evitar erros de `redirect_uri_mismatch` causados pelas URLs imutáveis temporárias do Vercel (ex: `app-hash-team.vercel.app`), existia um script de *canonical redirect* no `public/login.html`.
- Se o projeto mudar de domínio final (ex: para `pipeline.axenya.com`), esse script no `login.html` pode precisar ser reativado e atualizado para forçar os usuários sempre para a URL primária.
- **Dica:** Atualmente ele está comentado para permitir testes flexíveis nas URLs base do Vercel.

---

## 3. Variáveis de Ambiente Obrigatórias (Produção)

No painel do Vercel, o projeto **precisa** ter as seguintes variáveis de ambiente configuradas no escopo de **Produção**:

| Variável | Descrição |
|----------|-----------|
| `HUBSPOT_TOKEN` | Private App Token do HubSpot. |
| `CLAUDE_API_KEY` | Chave da API Anthropic para a inteligência artificial (Jarvis). |
| `SESSION_SECRET` | String aleatória (mínimo 32 caracteres) para assinar os JWTs de sessão (HMAC-SHA256). |
| `GOOGLE_CLIENT_ID` | Client ID gerado no Google Cloud Console. |
| `GOOGLE_CLIENT_SECRET` | Client Secret gerado no Google Cloud Console. |
| `ALLOWED_ORIGIN` | URL exata de produção sem trailing slash (ex: `https://project-bsmfu.vercel.app`). Essencial para o CORS do backend aprovar as requisições. |
| `ALLOWED_EMAILS` | Lista separada por vírgula de e-mails extras autorizados (além dos 5 hardcoded no `lib/auth.js`). |

> **Nota sobre o `LOCAL_DEV_BYPASS=true`:**
> Esta variável NUNCA deve ser colocada em produção. Ela existe apenas no `.env.local` para pular a autenticação do Google OAuth e verificar o dashboard rodando com dados locais e mock de usuário.

---

## 4. Estrutura de Rotas (Rewrite)

O Vercel está configurado (`vercel.json`) para mapear rotas "amigáveis" para arquivos `.html` estáticos.
- A página após o login redireciona para a rota `/dashboard`.
- O `vercel.json` faz o rewrite de `/dashboard` para o arquivo `dashboard.html`. Para alterar o destino, edite a chave `destination` da rota `/dashboard` no `vercel.json`.

Mapa atual de rotas (`vercel.json`):

| Rota | Arquivo |
|------|---------|
| `/` | `login.html` |
| `/dashboard` ou `/novo` | `dashboard.html` |
| `/novo-board` | `board.html` |
| `/novo-ae` | `ae.html` |
| `/novo-bdr` | `bdr.html` |
| `/novo-48h` | `48h.html` |
| `/novo-cs` | `cs.html` |
| `/novo-cotacao` | `cotacao.html` |
| `/forecast` | `forecast.html` |

---

## 5. Verificação pós-deploy

Após `vercel --prod --yes`, confirmar que o ambiente de produção está correto:

```bash
# Páginas públicas devem retornar 200
curl -o /dev/null -s -w "%{http_code}" https://project-bsmfu.vercel.app/
curl -o /dev/null -s -w "%{http_code}" https://project-bsmfu.vercel.app/novo

# APIs devem retornar 401 (auth ativa — LOCAL_DEV_BYPASS ausente em prod)
curl -o /dev/null -s -w "%{http_code}" https://project-bsmfu.vercel.app/api/auth/me
curl -o /dev/null -s -w "%{http_code}" https://project-bsmfu.vercel.app/api/forecast-table
```

Se `/api/auth/me` retornar 200 sem cookie, o bypass está ativo em produção — **reverter o deploy imediatamente**.

---

## 6. Sobre `ALLOWED_EMAILS`

A variável `ALLOWED_EMAILS` é **aditiva** à lista hardcoded em `lib/auth.js`: qualquer e-mail nela entra como autorizado _além_ dos já fixos no código.

- **Formato:** lista separada por vírgula, sem espaços. Ex.: `maria@axenya.com,pedro@axenya.com`
- **Se vazia ou ausente:** só os e-mails hardcoded em `lib/auth.js` têm acesso.
- **Domínio `@axenya.com`:** dependendo da lógica em `lib/auth.js`, pode haver verificação de domínio além da lista — confirmar antes de adicionar e-mails externos.

---

## 7. Mapa real da infra Vercel (2026-07-10) — LEIA ANTES DE DEPLOYAR

> Levantado e corrigido em 2026-07-10. Evita redescobrir tudo na próxima sessão.

### Projetos e domínios

| Projeto Vercel | Conta/Team | Plano | Domínios | Status |
|---|---|---|---|---|
| `dashboard-axenya` | team `axenya-f1a041f6` (`team_kMpQxhA68GkDKY9ZxS2vn7Ge`) | Pro | `project-bsmfu.vercel.app` + `axenya-pipeline-dashboard.vercel.app` | **CANÔNICO — deployar aqui** |
| `axenya-pipeline-dashboard-legacy` | "Samuel Alencar's projects" (`team_mPRF3KjR2KN77fZP5X2Om9Dj`) | Hobby | nenhum (domínio movido) | LEGADO. Deploys ficam BLOCKED (limite de funções do Hobby). Buildava do repo espelho `salencar-lang/axenya-pipeline-dashboard` (histórico divergente). NÃO usar. |

O domínio que o time usa (`axenya-pipeline-dashboard.vercel.app`) foi movido para o canônico em 2026-07-10 (projeto legado renomeado para liberar o subdomínio; nada deletado).

### Tokens e secrets (GCP Secret Manager, projeto `gen-lang-client-0423905839`)

| Secret GCP | Conteúdo | Uso |
|---|---|---|
| `vercel_personal_token` | Token Vercel com acesso ao team Axenya | Deploy do canônico: `npx vercel deploy --prod --yes --token "$(gcloud secrets versions access latest --secret=vercel_personal_token --project=gen-lang-client-0423905839)"` |
| `Vercel_Growth` | Token da conta pessoal | Só para administrar o projeto legado |
| `Vercel` | Revogado (Not authorized) | Não usar |
| `axenya-hubspot-pat-shared` | PAT HubSpot do portal 44715285 | `HUBSPOT_TOKEN` do Vercel (aplicado em 2026-07-10 após o token anterior do canônico expirar) e dev local |
| `oauth-client-pipeline-dashboard` | JSON do OAuth client Google `596382399844-fabidm…` (projeto GCP da Axenya) | `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` do canônico (aplicado 2026-07-10) |
| `axenya-opencode-gsc-service-account-json-shared` | Service Account JSON | `GOOGLE_SERVICE_ACCOUNT_JSON` (list-attack/sheets) |

### OAuth Google (client `596382399844-fabidm…`)

- Autoriza HOJE: origem `https://axenya-pipeline-dashboard.vercel.app` + redirect `.../api/auth/callback`.
- `redirect_uri` é derivado do host da request (`api/auth/callback.js`) — cada domínio novo do projeto precisa ser adicionado ao client no Console (`gen-lang-client-0423905839` → Credentials); client clássico NÃO tem API de edição.
- PENDENTE: adicionar `https://project-bsmfu.vercel.app` (origem + `/api/auth/callback`) se alguém for logar por essa URL.

### Gotchas de validação (custaram tempo em 2026-07-10)

1. **`public/bdr.html` tem 3 bytes NUL históricos** — `grep` sem `-a` trata a resposta como binária e NÃO imprime nada (parece que a feature não subiu quando subiu). Validar com `grep -a` ou python `bytes.count`.
2. **Polling agressivo em domínio `.vercel.app` dispara o Vercel Security Checkpoint** (challenge por IP, `x-vercel-mitigated: challenge`, ~5-10 min). Validar com UMA requisição, não com loop de 5s.
3. **`vercel deploy` via CLI pode ficar pendurado em "Building…"** mesmo com o build pronto — confirmar pelo campo `readyState` da API (`/v13/deployments/<url-do-deployment>`); o id `dpl_…` na API precisa do prefixo, o hash do inspect URL sozinho retorna not_found.
4. **Envs `sensitive` (SESSION_SECRET, SNAPSHOT_SECRET, CRON_SECRET) não são decriptáveis** via API — validação autenticada de produção exige login real; valide o `HUBSPOT_TOKEN` direto contra `api.hubapi.com` antes de gravar.
5. **Trocar env NÃO afeta deployment existente** — sempre redeployar + re-aliasar `axenya-pipeline-dashboard.vercel.app` (o alias explícito garante: `POST /v2/deployments/<dpl_id>/aliases`).
