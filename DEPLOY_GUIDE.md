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
2. Certifique-se de estar linkado ao projeto correto: `vercel link --project prj_ID_DO_PROJETO`
3. Faça o deploy para produção: `vercel --prod --yes`

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
