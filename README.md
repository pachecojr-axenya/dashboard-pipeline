# Axenya Pipeline Dashboard

> Dashboard executivo de vendas com integracão HubSpot, análise AI (Claude) e autenticação Google OAuth.

**Acesso:** Restrito a `@axenya.com` (Google OAuth)

> **🚀 ATENÇÃO IAs e Desenvolvedores:** Para regras estritas de infraestrutura, Vercel Pro, e resolução de redirecionamentos do Google OAuth, leia obrigatoriamente o **[DEPLOY_GUIDE.md](file:///D:/0 PACHECO/Pacheco Remoto/Pacheco Remoto/10 PROJETOS/01 AXENYA/01 Projetos/Dashboard Ivan/dashboard-ivan-visual/DEPLOY_GUIDE.md)** antes de realizar qualquer modificação de deploy.
---

## Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (HTML estático)                               │
│  ┌──────────────┐ ┌──────────────┐ ┌─────────────────┐ │
│  │ login.html   │ │dashboard.html│ │hubspot-watcher  │ │
│  │ (Google GIS) │ │ (1MB, 8 abas)│ │     .html       │ │
│  └──────┬───────┘ └──────┬───────┘ └───────┬─────────┘ │
│         │                │                  │           │
│         │    electron-shim.js (bridge)      │           │
│         │    electronAPI → fetch()          │           │
└─────────┼────────────────┼──────────────────┼───────────┘
          │                │                  │
          ▼                ▼                  ▼
┌─────────────────────────────────────────────────────────┐
│  API Routes (Vercel Serverless Functions)                │
│                                                         │
│  Auth:     /api/auth/google, /api/auth/callback,        │
│            /api/auth/config                              │
│  HubSpot:  /api/pull-hubspot, /api/pull-cs-data,        │
│            /api/pull-tickets, /api/watcher-deals         │
│  AI:       /api/ai-analysis, /api/ai-company-analysis,  │
│            /api/ai-cs-insights, /api/jarvis-chat         │
│  Misc:     /api/deal-activities, /api/company-activities,│
│            /api/company-deals, /api/settings, /api/users │
│            /api/explore-tickets, /api/ticket-activities  │
└──────────────────────┬──────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐
    │ HubSpot  │ │ Claude   │ │ Google   │
    │ API v3   │ │ API      │ │ OAuth    │
    └──────────┘ └──────────┘ └──────────┘
```

### Decisões de design

| Decisão | Motivo |
|---------|--------|
| Zero dependências npm | Elimina supply chain risk. JWT manual, fetch nativo, crypto nativo. |
| HTML estático (não SPA) | Dashboard.html é 1MB monolítico — sem build step, sem framework. |
| `electron-shim.js` | Bridge que traduz `electronAPI.*` para `fetch()`. Permite reusar o frontend do Electron original sem reescrever. |
| Google OAuth (GIS) | Substitui login por senha. One Tap + fallback OAuth2 redirect. |
| Sanitização anti-injection | Todos os dados HubSpot são sanitizados antes de injetar em prompts Claude (`lib/sanitize.js`). |

---

## Abas do Dashboard

| # | Aba | Dados | Fonte |
|:-:|-----|-------|-------|
| 1 | **Last 48h** | Deals criados/movidos nas últimas 48h | `/api/pull-hubspot` |
| 2 | **Board View** | Kanban visual por estágio do pipeline | `/api/pull-hubspot` |
| 3 | **CRO Dashboard** | Métricas de conversão, funil, velocidade | `/api/pull-hubspot` |
| 4 | **AE Performance** | Performance por Account Executive | `/api/pull-hubspot` |
| 5 | **BDR Performance** | Performance por BDR (sourcing) | `/api/pull-hubspot` |
| 6 | **CS Dashboard** | Customer Success — empresas, vigência, risco | `/api/pull-cs-data` |
| 7 | **Cotação** | Pipeline de tickets de cotação | `/api/pull-tickets` |
| 8 | **HubSpot Watcher** | Data discipline — preenchimento de propriedades | `/api/watcher-deals` |

---

## Setup Local

### Pré-requisitos

- Node.js >= 18.0.0
- Vercel CLI (`npm i -g vercel`)
- Acesso ao projeto Vercel (pedir convite)

### Variáveis de ambiente

Criar `.env.local` na raiz:

```env
# HubSpot Private App Token (scopes: crm.objects.deals.read, crm.objects.companies.read, etc.)
HUBSPOT_TOKEN=pat-na1-XXXXX

# Claude API Key (Anthropic)
CLAUDE_API_KEY=sk-ant-XXXXX

# JWT Session Secret (mínimo 32 caracteres)
SESSION_SECRET=uma-string-aleatoria-com-pelo-menos-32-chars

# Google OAuth (Cloud Console > APIs & Services > Credentials)
GOOGLE_CLIENT_ID=XXXXX.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-XXXXX

# Domínio permitido para CORS
ALLOWED_ORIGIN=http://localhost:3000

# (Opcional) Emails externos permitidos, separados por vírgula
ALLOWED_EMAILS=parceiro@empresa.com
```

### Rodar

```bash
npm start            # Carrega .env.local e inicia Vercel dev em localhost:3000
```

> Por que não `vercel dev` direto? `vercel dev` não carrega `.env.local`
> automaticamente quando o projeto não tem framework detectado. O `npm start`
> usa `scripts/dev.js`, que lê o `.env.local` e em seguida chama `vercel dev`.

### Deploy

```bash
npm run deploy       # Deploy para produção no Vercel (CLI)
```

Em produção (auto-deploy via Git), no painel do Vercel garantir que estão
configuradas estas env vars no escopo **Production**:

- `HUBSPOT_TOKEN`, `CLAUDE_API_KEY`, `SESSION_SECRET` (≥32 chars)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `ALLOWED_ORIGIN=https://<dominio-prod>` (ex: `https://pipeline.axenya.com`)
- `ALLOWED_EMAILS` (opcional, lista separada por vírgula)

Notas operacionais:

- `vercel.json` define `maxDuration: 60` em `api/*` — requer plano **Pro**
  (Hobby é limitado a 10s e o Jarvis com Opus 4.7 + thinking pode dar timeout).
- O Jarvis usa `claude-opus-4-7`. A `CLAUDE_API_KEY` precisa de acesso a Opus 4.7.
- No Google Cloud Console o OAuth client precisa ter o domínio de produção em
  **Authorized JavaScript origins** e `https://<dominio>/api/auth/callback`
  em **Authorized redirect URIs**.

---

## Estrutura de Arquivos

```
.
├── api/                          # Serverless functions (Vercel)
│   ├── _helpers.js               # CORS, auth, token helpers
│   ├── auth/
│   │   ├── callback.js           # OAuth2 code exchange (fallback)
│   │   ├── config.js             # Retorna GOOGLE_CLIENT_ID (público)
│   │   └── google.js             # Verifica Google ID token → JWT
│   ├── ai-analysis.js            # Prompt livre → Claude
│   ├── ai-company-analysis.js    # Análise estruturada de conta CS
│   ├── ai-cs-insights.js         # Insights de portfólio CS
│   ├── jarvis-chat.js            # Chat multi-turn (Jarvis assistant)
│   ├── company-activities.js     # Atividades de uma empresa
│   ├── company-deals.js          # Deals de uma empresa
│   ├── deal-activities.js        # Atividades de um deal
│   ├── explore-tickets.js        # Debug: explorar pipelines de tickets
│   ├── login.js                  # ⚠️ LEGADO — ver AUDIT.md
│   ├── pull-cs-data.js           # Puxa dados CS (empresas + vigência)
│   ├── pull-hubspot.js           # Puxa todos os deals do pipeline
│   ├── pull-tickets.js           # Puxa tickets de cotação
│   ├── settings.js               # Settings do usuário
│   ├── ticket-activities.js      # Atividades de um ticket
│   ├── users.js                  # Lista de usuários (sem hashes)
│   └── watcher-deals.js          # Deals por owner+stage (HubSpot Watcher)
├── lib/                          # Módulos compartilhados
│   ├── auth.js                   # Google OAuth + JWT (HMAC-SHA256)
│   ├── claude.js                 # Claude API client + prompts CS
│   ├── credentials.json          # ⚠️ Hashes SHA-256 — ver AUDIT.md
│   ├── hubspot.js                # Core: fetch deals, CS, tickets, owners
│   └── sanitize.js               # Anti-prompt-injection
├── public/                       # Arquivos estáticos
│   ├── dashboard.html            # Dashboard principal (~1MB)
│   ├── electron-shim.js          # Bridge electronAPI → fetch
│   ├── hubspot-watcher.html      # HubSpot Watcher (standalone)
│   ├── icon.png                  # Favicon
│   └── login.html                # Tela de login (Google GIS)
├── scripts/
│   └── generate-credentials.js   # Gerador de hashes (legado)
├── docs/                         # Onboarding docs
├── src_electron_backup/          # Backup do Electron original (não versionado)
├── AUDIT.md                      # 🔍 Auditoria completa — LEIA PRIMEIRO
├── package.json
├── vercel.json
└── .gitignore
```

---

## API Routes — Referência Rápida

### Autenticação

Todas as rotas (exceto `/api/auth/*`) exigem header `Authorization: Bearer <jwt>`.

| Método | Rota | Body | Retorno |
|--------|------|------|---------|
| POST | `/api/auth/google` | `{ credential: "<google_id_token>" }` | `{ success, user, token }` |
| GET | `/api/auth/config` | — | `{ clientId }` |
| GET | `/api/auth/callback` | query: `code` | Redirect para `/dashboard#token=...` |

### HubSpot Data

| Método | Rota | Body | Retorno | Tempo |
|--------|------|------|---------|:-----:|
| POST | `/api/pull-hubspot` | — | Todos os deals do pipeline | ~30-60s |
| POST | `/api/pull-cs-data` | — | Empresas CS + vigência deals | ~20-40s |
| POST | `/api/pull-tickets` | — | Tickets de cotação | ~10-20s |
| POST | `/api/watcher-deals` | `{ owner, stage }` | Deals com fill status | ~5-10s |
| POST | `/api/deal-activities` | `{ hsId }` | Notes, emails, calls, meetings | ~5s |
| POST | `/api/company-activities` | `{ hsId }` | Atividades da empresa | ~5s |
| POST | `/api/company-deals` | `{ hsId }` | Deals da empresa | ~5s |
| POST | `/api/ticket-activities` | `{ hsId }` | Atividades do ticket | ~5s |
| POST | `/api/explore-tickets` | — | Pipelines + props (admin only) | ~5s |

### AI (Claude)

| Método | Rota | Body | Retorno |
|--------|------|------|---------|
| POST | `/api/ai-analysis` | `{ prompt }` | `{ text }` |
| POST | `/api/ai-company-analysis` | `{ companyData, activities }` | `{ analysis }` (JSON estruturado) |
| POST | `/api/ai-cs-insights` | `{ portfolioSummary }` | `{ insights }` (JSON estruturado) |
| POST | `/api/jarvis-chat` | `{ messages, systemPrompt, model? }` | `{ text }` |

### Misc

| Método | Rota | Body | Retorno |
|--------|------|------|---------|
| GET/POST | `/api/settings` | GET: — / POST: `{ settings }` | Status dos tokens |
| GET | `/api/users` | — | Lista de usuários (sem hashes) |

---

## HubSpot — Mapeamento de Pipeline

### Pipeline de Vendas (`782758156`)

| Stage ID | Nome | Tipo |
|----------|------|:----:|
| `1144746905` | Reunião Agendada | Open |
| `1144746906` | Diagnóstico | Open |
| `1144746908` | Cotação | Open |
| `1144746909` | Consultoria | Open |
| `1144746910` | Negociação | Open |
| `1317543716` | Stand by | Open |
| `1288611084` | Implantação | Open |
| `1144844314` | Ganho | Won |
| `1144746911` | Perdido | Lost |

### Pipeline de Cotação (`847948895`)

Usado pela aba "Cotação" para tickets de cotação de planos.

### Propriedades Custom Relevantes

| Propriedade | Tipo | Usado em |
|-------------|------|----------|
| `vidas` | number | Deals — quantidade de vidas do plano |
| `premio_mensal` | number | Deals — prêmio mensal em R$ |
| `sdr` | owner ID | Deals — BDR que originou |
| `a_reuniao_ocorreu_` | enum | Deals — "Sim"/"Não" |
| `tipo_de_negociacao` | enum | Deals — tipo de negociação |
| `receita_vitalicio_estimada` | number | Deals — receita vitalícia |
| `kam_responsavel` | text | Companies — KAM do CS |
| `vigencia_do_contrato_atual` | date | Companies — vigência |
| `maturidade_em_saude` | enum | Companies — maturidade |

---

## Segurança

### Implementado

- [x] Google OAuth com verificação server-side do ID token
- [x] JWT de sessão (HMAC-SHA256, 48h, `timingSafeEqual`)
- [x] Domínio restrito a `@axenya.com` + whitelist de emails
- [x] CORS restrito (sem wildcard `*`)
- [x] Headers de segurança (`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`)
- [x] Sanitização anti-prompt-injection em todos os dados antes do Claude
- [x] Zero dependências npm (zero supply chain risk)
- [x] Tokens nunca expostos no frontend (env vars do Vercel)
- [x] Rate limiting básico (mutex por instância serverless)
- [x] Input validation em todas as rotas

### Pendente — ver `AUDIT.md`

- [ ] `credentials.json` com hashes versionado no git (legado)
- [ ] `login.js` referencia `attemptLogin` que não existe (dead code)
- [ ] SHA-256 sem salt para hashes de senha (legado, não usado em produção)
- [ ] Rate limiting real (não apenas mutex em memória)
- [ ] Logs de auditoria persistentes

---

## Origem do Projeto

Este dashboard foi originalmente um app **Electron para macOS** (v5.7.0). Em abril/2026 foi reescrito como web app Vercel (v6.0), corrigindo 11 vulnerabilidades P0-P2 do original.

O `electron-shim.js` é o bridge que permite reusar o frontend HTML do Electron sem reescrever — traduz chamadas `electronAPI.*` para `fetch()` contra as API routes.

O `src_electron_backup/` contém o código original do Electron (não versionado, apenas referência local).

---

## Contribuindo

1. Clone o repo
2. Crie `.env.local` com as variáveis
3. `npm start`
4. **Leia `AUDIT.md` antes de fazer qualquer mudança** — contém todos os pontos que precisam de ajuste

### Regras

- **Zero dependências externas** — não adicionar pacotes npm
- **Nunca hardcodar tokens** — sempre `process.env.*`
- **Nunca expor hashes ou senhas** — nem em logs
- **Testar antes e depois** de qualquer mudança em `lib/hubspot.js`
- **Git author:** `Samuel Alencar <salencar@axenya.com>` (Vercel rejeita outros)

---

## Licença

Proprietário. Uso interno Axenya apenas.
