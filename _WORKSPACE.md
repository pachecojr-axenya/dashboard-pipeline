---
type: workspace
status: active
created: 2026-04-10
updated: 2026-04-10
tags: [#workspace/pipeline-dashboard, #theme/sales, #theme/hubspot, #theme/security]
---

# Pipeline Dashboard — Workspace

> Dashboard executivo de vendas da Axenya. Centraliza dados do HubSpot em dashboards interativos com IA (Claude).

## Quick Links

| Recurso | URL |
|---------|-----|
| **HubSpot Portal** | https://app.hubspot.com/contacts/44715285 |

## Origem

Convertido do app Electron macOS v5.7.0 (`Axenya Pipeline Dashboard-5.7.0-arm64.dmg`) para web app Vercel v6.0.

### Vulnerabilidades corrigidas (11)

| # | Severidade | Vulnerabilidade | Fix |
|:-:|:----------:|----------------|-----|
| S1 | P0 | HubSpot PAT hardcoded em main.js | `process.env.HUBSPOT_TOKEN` |
| S2 | P0 | Claude API key hardcoded em main.js | `process.env.CLAUDE_API_KEY` |
| S3 | P0 | Senhas em plaintext no credentials.json | Apenas hashes SHA-256 |
| S4 | P0 | Senha universal para todos os 66 usuários | Senhas individuais por usuário |
| S5 | P1 | `list-users` IPC expunha senhas | Campo `password` removido |
| S6 | P1 | Prompt injection via dados HubSpot | `sanitize.js` em todos os inputs Claude |
| S7 | P1 | Senha salva em plaintext no localStorage | Apenas email salvo, JWT em sessionStorage |
| S8 | P1 | Dependência alpha com range aberto | Zero deps externas |
| S9 | P2 | Token HubSpot em plaintext no disco | Vercel env vars (nunca em disco) |
| S10 | P2 | Cache CRM em plaintext no disco | sessionStorage (limpo ao fechar) |
| S11 | P2 | Sem security headers | X-Frame-Options, CSP, CORS restrito |

## Arquitetura

```
Browser
  |
  +-- /login.html (tela de login)
  |     |
  |     +-- POST /api/login → JWT (48h)
  |
  +-- /dashboard.html (1MB, frontend completo)
  |     |
  |     +-- electron-shim.js (bridge: window.electronAPI → fetch)
  |     |
  |     +-- POST /api/pull-hubspot → deals do pipeline 782758156
  |     +-- POST /api/pull-cs-data → companies + vigência
  |     +-- POST /api/pull-tickets → cotação pipeline 847948895
  |     +-- POST /api/deal-activities → notas/emails/calls/meetings
  |     +-- POST /api/company-activities → idem por company
  |     +-- POST /api/company-deals → deals associados
  |     +-- POST /api/ai-analysis → Claude proxy (CRO insights)
  |     +-- POST /api/ai-company-analysis → Claude (CS risk)
  |     +-- POST /api/ai-cs-insights → Claude (portfolio)
  |     +-- GET/POST /api/settings → configurações
  |     +-- GET /api/users → lista de usuários (sem senhas)
  |
  Vercel Serverless Functions (Node 18+)
  |
  +-- process.env.HUBSPOT_TOKEN (GCP: axenya-hubspot-pat-shared)
  +-- process.env.CLAUDE_API_KEY (GCP: claude_code_api_key_prodtech)
  +-- process.env.SESSION_SECRET (gerado aleatório, 64 chars)
  +-- process.env.ALLOWED_ORIGIN (domínio de produção)
```

## Estrutura de arquivos

```
/
├── public/
│   ├── dashboard.html      ← frontend monolítico (1MB, 13708 linhas)
│   ├── login.html           ← tela de login
│   ├── electron-shim.js     ← bridge electronAPI → fetch
│   └── icon.png
├── api/
│   ├── _helpers.js          ← CORS, auth, token helpers
│   ├── login.js             ← POST /api/login
│   ├── pull-hubspot.js      ← POST /api/pull-hubspot
│   ├── pull-cs-data.js      ← POST /api/pull-cs-data
│   ├── pull-tickets.js      ← POST /api/pull-tickets
│   ├── deal-activities.js   ← POST /api/deal-activities
│   ├── company-activities.js
│   ├── company-deals.js
│   ├── ai-analysis.js       ← Claude proxy
│   ├── ai-company-analysis.js
│   ├── ai-cs-insights.js
│   ├── explore-tickets.js
│   ├── ticket-activities.js
│   ├── settings.js
│   └── users.js
├── lib/
│   ├── auth.js              ← JWT HMAC-SHA256 (zero deps)
│   ├── hubspot.js           ← HubSpot API client (fetch)
│   ├── claude.js            ← Claude API client
│   ├── sanitize.js          ← anti-prompt-injection
│   └── credentials.json     ← hashes SHA-256 (sem plaintext)
├── scripts/
│   └── generate-credentials.js  ← regenerar senhas
├── package.json
├── vercel.json
├── .gitignore
└── .npmrc
```

## Deploy no Vercel (passo a passo)

### 1. Conectar repo ao Vercel

1. Abrir https://vercel.com/new
2. Importar `salencar-lang/axenya-pipeline-dashboard`
3. Framework Preset: **Other** (não é Next.js)
4. Root Directory: `.` (raiz)
5. Build Command: *(vazio — não precisa de build)*
6. Output Directory: `public`
7. Clicar **Deploy**

### 2. Configurar Environment Variables

No Vercel Dashboard → Settings → Environment Variables:

| Variável | Valor | Onde obter |
|----------|-------|-----------|
| `HUBSPOT_TOKEN` | *(valor do secret)* | `gcloud secrets versions access latest --secret=axenya-hubspot-pat-shared --project=gen-lang-client-0423905839` |
| `CLAUDE_API_KEY` | *(valor do secret)* | `gcloud secrets versions access latest --secret=claude_code_api_key_prodtech --project=gen-lang-client-0423905839` |
| `SESSION_SECRET` | *(gerar 64 chars aleatórios)* | `openssl rand -hex 32` |
| `ALLOWED_ORIGIN` | *(URL de produção — não publicar no repo)* | *(ajustar após deploy)* |

**IMPORTANTE:** Marcar todas como **Production + Preview + Development**.

### 3. Configurar domínio customizado (opcional)

1. Vercel Dashboard → Settings → Domains
2. Adicionar `pipeline.axenya.com`
3. Configurar DNS CNAME no provedor

### 4. Testar

1. Acessar a URL do Vercel
2. Login com email @axenya.com + senha individual
3. Verificar que "Pull Data Now" carrega deals do HubSpot
4. Verificar que insights de IA funcionam

## Abas do Dashboard

| Aba | Público | Conteúdo |
|-----|---------|----------|
| Last 48h | Todos | Atividade recente: novos deals, reuniões, movimentações |
| CRO Dashboard | Liderança | Receita, pipeline ponderado, forecast, risco, IA |
| AE Performance | AEs/Gestores | Eficiência, volume, win rate, velocity, coaching |
| BDR Performance | BDRs/Gestores | Originação semanal, heatmap, qualidade handoff |
| CS Dashboard | Customer Success | Portfólio, engajamento, churn risk, renovações |
| Cotação | Operações | Tickets cotação: SLA, throughput, aging |

## Fórmulas de receita

| Cenário | Fórmula |
|---------|---------|
| >= 200 vidas | 100% PM (1o mês) + 5% PM x 11 meses |
| < 200 vidas | 100% PM x 3 meses + 2% PM x 9 meses |
| Fee por vida | Valor de `receita_vitalicio_estimada` |

Pipeline ponderado = Receita Estimada x Probabilidade do estágio:
- Reunião Agendada: 2.7% | Diagnóstico: 4.6% | Cotação: 10.1%
- Consultoria: 15.6% | Negociação: 26.9% | Implantação: 53.8%

## Senhas

- Geradas por `scripts/generate-credentials.js`
- Formato: `{username}{6 dígitos aleatórios}` (ex: `igartner847291`)
- Arquivo `PASSWORDS_FIRST_RUN.txt` gerado localmente para distribuição
- **DELETAR** após distribuir para os usuários
- Para regenerar: `node scripts/generate-credentials.js`

## Validação de deploy (2026-04-10)

| Teste | Resultado |
|-------|-----------|
| Login page (GET /) | ✅ HTTP 200 |
| Dashboard page (GET /dashboard) | ✅ HTTP 200 |
| electron-shim.js injetado | ✅ Presente |
| Login real (salencar@axenya.com) | ✅ JWT retornado |
| Auth guard (sem token) | ✅ 401 Unauthorized |
| Pull HubSpot deals | ✅ 841 deals |
| Double-check vs API direta | ✅ 841 = 841 MATCH |
| Pull CS data | ✅ 216 companies, 113 vigência deals |
| Pull Cotação tickets | ✅ 50 tickets |

## Segurança operacional

- [ ] **URGENTE:** Revogar HubSpot PAT antigo (`pat-na1-ca36292e-...`) exposto no DMG
- [ ] **URGENTE:** Revogar Claude API key antiga (`sk-ant-api03-GFNj2...`) exposta no DMG
- [x] Configurar env vars no Vercel (4/4)
- [x] Testar login + pull de dados
- [ ] Distribuir senhas individuais (PASSWORDS_FIRST_RUN.txt)
- [ ] Deletar PASSWORDS_FIRST_RUN.txt após distribuição

## Referências

- [[20_Company/Sales/_SALES|Sales MOC]]
- [[.opencode/skills/hubspot-ops/SKILL.md|HubSpot Ops Skill]]
- Onboarding original: `C:\Users\alenc\Downloads\Onboarding - Axenya Pipeline Dashboard (PT-BR).md`

[[HOME|<- Mission Control]]
