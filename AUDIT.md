# Auditoria — Axenya Pipeline Dashboard

> **Última auditoria:** 2026-04-16  
> **Auditor:** Orchestrator (Claude Opus 4.6)  
> **Escopo:** Todos os arquivos do repo — lib/, api/, public/, scripts/

Este documento lista **todos os pontos que precisam de ajuste**, organizados por severidade.
Cada item tem um marcador `FIXME`, `TODO` ou `NEEDS_ADJUSTMENT` correspondente no código-fonte.

---

## Legenda de Severidade

| Severidade | Significado | Ação |
|:----------:|-------------|------|
| **P0** | Segurança — risco de exposição de dados | Corrigir imediatamente |
| **P1** | Bug — funcionalidade quebrada em produção | Corrigir esta sprint |
| **P2** | Cálculo — lógica de negócio incorreta ou incompleta | Corrigir antes de confiar nos números |
| **P3** | Manutenção — dead code, tech debt, melhorias | Corrigir quando possível |
| **P4** | Melhoria — nice to have | Backlog |

---

## P0 — Segurança

### S01. `credentials.json` versionado no git
- **Arquivo:** `lib/credentials.json`
- **Problema:** Contém hashes SHA-256 de senhas de 60+ usuários. Está tracked no git e foi pushed para o repo da org.
- **Risco:** Hashes SHA-256 sem salt são vulneráveis a rainbow tables. Qualquer pessoa com acesso ao repo pode tentar reverter.
- **Ação:**
  1. Remover do git tracking: `git rm --cached lib/credentials.json`
  2. Adicionar ao `.gitignore`: `lib/credentials.json`
  3. Considerar rotacionar senhas (ou confirmar que o login por senha foi desativado em favor do Google OAuth)
- **Marcador no código:** `FIXME(S01)` em `lib/credentials.json`

### S02. Hashes SHA-256 sem salt
- **Arquivo:** `scripts/generate-credentials.js` (linha 120)
- **Problema:** `crypto.createHash('sha256').update(password)` — sem salt. Duas senhas iguais geram o mesmo hash.
- **Risco:** Vulnerável a rainbow tables e ataques de dicionário.
- **Ação:** Se o login por senha ainda for necessário, migrar para `bcrypt` ou `scrypt` com salt. Se não for necessário (Google OAuth é o único método), remover o sistema de senhas.
- **Marcador no código:** `FIXME(S02)` em `scripts/generate-credentials.js`

---

## P1 — Bugs

### B01. `login.js` referencia `attemptLogin` inexistente
- **Arquivo:** `api/login.js` (linha 8)
- **Problema:** `const { attemptLogin } = require('../lib/auth')` — mas `auth.js` não exporta `attemptLogin`. O endpoint `/api/login` vai crashar com `TypeError: attemptLogin is not a function`.
- **Impacto:** O login por email/senha está quebrado. Não afeta produção porque o login é via Google OAuth.
- **Ação:** Remover `api/login.js` (dead code) ou reimplementar `attemptLogin` se o login por senha for necessário.
- **Marcador no código:** `FIXME(B01)` em `api/login.js`

### B02. `explore-tickets.js` verifica role `admin` que nunca é atribuído via Google OAuth
- **Arquivo:** `api/explore-tickets.js` (linha 18)
- **Problema:** `if (user.role !== 'admin')` — mas o Google OAuth atribui role `staff` ou `guest`. Nenhum usuário consegue acessar este endpoint.
- **Ação:** Definir lógica de admin (ex: whitelist de emails) ou remover a restrição.
- **Marcador no código:** `FIXME(B02)` em `api/explore-tickets.js`

---

## P2 — Cálculos e Lógica de Negócio

### C01. `cleanOwnerName` — mapeamento hardcoded de nomes
- **Arquivo:** `lib/hubspot.js` (linhas 71-89)
- **Problema:** Mapeamento manual de nomes com `if/else` chain. Quando um AE/BDR entra ou sai da empresa, é preciso editar o código.
- **Exemplos de inconsistência:**
  - `Fernando Siqueira` e `Fernando Henrique` são mapeados para o mesmo nome (`Fernando Henrique`) na linha 76 — qualquer Fernando com sobrenome contendo "siqueira" OU "henrique" vira "Fernando Henrique"
  - `André Pontes` e `Andre Pontes` (sem acento) são tratados separadamente na lista `AE_NAMES` mas unificados no `cleanOwnerName`
- **Risco:** Deals atribuídos ao owner errado nos relatórios.
- **Ação:** Extrair para um arquivo de configuração (`owner-mapping.json`) ou resolver via HubSpot owner ID (mais confiável que nome).
- **Marcador no código:** `NEEDS_ADJUSTMENT(C01)` em `lib/hubspot.js`

### C02. `AE_NAMES` — lista estática de Account Executives
- **Arquivo:** `lib/hubspot.js` (linhas 24-28)
- **Problema:** Lista hardcoded. Quando um AE entra ou sai, precisa editar o código e fazer deploy.
- **Ação:** Buscar dinamicamente do HubSpot (owners com role AE) ou mover para env var / config file.
- **Marcador no código:** `NEEDS_ADJUSTMENT(C02)` em `lib/hubspot.js`

### C03. Determinação de `source` (BDR vs AE) é simplista
- **Arquivo:** `lib/hubspot.js` (linha 254)
- **Problema:** `source: bdrRaw ? 'bdr' : 'ae'` — se o campo `sdr` tem qualquer valor, o deal é marcado como "sourced by BDR". Não valida se o SDR é realmente um BDR ativo.
- **Risco:** Deals com SDR preenchido incorretamente (ex: AE que preencheu o campo errado) são contados como BDR-sourced.
- **Ação:** Validar contra uma lista de BDRs ativos ou usar uma propriedade dedicada no HubSpot.
- **Marcador no código:** `NEEDS_ADJUSTMENT(C03)` em `lib/hubspot.js`

### C04. `vidas` parseado como `parseInt` — pode gerar NaN silencioso
- **Arquivo:** `lib/hubspot.js` (linha 250)
- **Problema:** `vidas: p.vidas ? parseInt(p.vidas) : 0` — se `p.vidas` é uma string não-numérica (ex: "N/A", "pendente"), `parseInt` retorna `NaN`. O frontend pode somar `NaN` sem perceber.
- **Ação:** Adicionar validação: `const v = parseInt(p.vidas); vidas: isNaN(v) ? 0 : v`
- **Marcador no código:** `NEEDS_ADJUSTMENT(C04)` em `lib/hubspot.js`

### C05. `premio` parseado como `parseFloat` — pode ser `null` ou `NaN`
- **Arquivo:** `lib/hubspot.js` (linha 251)
- **Problema:** `premio: p.premio_mensal ? parseFloat(p.premio_mensal) : null` — retorna `null` quando não preenchido, mas `NaN` quando preenchido com texto. Inconsistência no tipo de retorno.
- **Ação:** Normalizar: `const pm = parseFloat(p.premio_mensal); premio: isNaN(pm) ? null : pm`
- **Marcador no código:** `NEEDS_ADJUSTMENT(C05)` em `lib/hubspot.js`

### C06. `days_in_stage` usa propriedade HubSpot que pode estar desatualizada
- **Arquivo:** `lib/hubspot.js` (linha 261)
- **Problema:** `ls_days_in_stage` é uma propriedade calculada do HubSpot que pode ter delay de atualização. Para cálculos de velocidade de pipeline, seria mais preciso calcular a partir de `hs_date_entered_*`.
- **Ação:** Considerar calcular server-side a partir do `stage_history` para maior precisão.
- **Marcador no código:** `NEEDS_ADJUSTMENT(C06)` em `lib/hubspot.js`

### C07. CS Companies filtradas apenas por `kam_responsavel HAS_PROPERTY`
- **Arquivo:** `lib/hubspot.js` (linha 302)
- **Problema:** Qualquer empresa com KAM preenchido é considerada "CS". Não filtra por status ativo/inativo, lifecycle stage, ou se realmente é cliente.
- **Risco:** Empresas inativas ou prospects com KAM preenchido aparecem no dashboard CS.
- **Ação:** Adicionar filtro por `ativo_ou_inativo_` = "Ativo" e/ou `lifecyclestage` = "customer".
- **Marcador no código:** `NEEDS_ADJUSTMENT(C07)` em `lib/hubspot.js`

### C08. Owner cache de 5 minutos pode causar inconsistência
- **Arquivo:** `lib/hubspot.js` (linhas 92-113)
- **Problema:** Cache em memória de 5 min por instância serverless. Como Vercel pode ter múltiplas instâncias, cada uma tem seu próprio cache. Um owner novo pode aparecer em uma instância mas não em outra.
- **Impacto:** Baixo — owners mudam raramente. Mas pode confundir durante onboarding de novo AE.
- **Ação:** Aceitar o trade-off (performance vs consistência) ou aumentar o TTL para 15 min.
- **Marcador no código:** `TODO(C08)` em `lib/hubspot.js`

### C09. `watcher-deals.js` duplica `hubspotPost` e `fetchOwnerMap`
- **Arquivo:** `api/watcher-deals.js` (linhas 59-87)
- **Problema:** Reimplementa `hubspotPost` e `fetchOwnerMap` localmente em vez de usar `lib/hubspot.js`. Se a lógica mudar em um lugar, o outro fica desatualizado.
- **Ação:** Refatorar para usar `lib/hubspot.js`.
- **Marcador no código:** `TODO(C09)` em `api/watcher-deals.js`

### C10. `watcher-deals` — `filled` check considera `'0'` e `'false'` como não preenchido
- **Arquivo:** `api/watcher-deals.js` (linha 171)
- **Problema:** `filled: val != null && val !== '' && val !== '0' && val !== 'false'` — para campos numéricos, `0` pode ser um valor válido (ex: 0% de cashback). Para booleanos, `false` pode ser a resposta real.
- **Risco:** Campos legitimamente preenchidos com 0 ou false aparecem como "não preenchido" no Watcher.
- **Ação:** Diferenciar por tipo de campo. Campos numéricos: `filled` se `val != null && val !== ''`. Campos booleanos: `filled` se `val != null`.
- **Marcador no código:** `NEEDS_ADJUSTMENT(C10)` em `api/watcher-deals.js`

### C11. Stage history sort assume formato ISO de `hs_date_entered_*`
- **Arquivo:** `lib/hubspot.js` (linha 244)
- **Problema:** `stageHistory.sort((a, b) => a.entered < b.entered ? -1 : 1)` — comparação de strings. Funciona para ISO 8601 mas pode falhar se o HubSpot retornar formato diferente.
- **Ação:** Converter para `Date` antes de comparar para robustez.
- **Marcador no código:** `TODO(C11)` em `lib/hubspot.js`

---

## P3 — Dead Code e Tech Debt

### D01. `api/login.js` — endpoint legado quebrado
- **Arquivo:** `api/login.js`
- **Problema:** Referencia `attemptLogin` que não existe. É dead code do sistema de login por senha (pré-Google OAuth).
- **Ação:** Remover o arquivo. Se login por senha for necessário no futuro, reimplementar do zero.
- **Marcador no código:** `FIXME(B01)` (mesmo que B01)

### D02. `lib/credentials.json` — legado do sistema de senhas
- **Arquivo:** `lib/credentials.json`
- **Problema:** 342 linhas de hashes que não são usados em produção (login é via Google OAuth).
- **Ação:** Remover do repo. Manter backup local se necessário.
- **Marcador no código:** `FIXME(S01)` (mesmo que S01)

### D03. `scripts/generate-credentials.js` — legado
- **Arquivo:** `scripts/generate-credentials.js`
- **Problema:** Gera credentials para o sistema de login por senha que foi substituído pelo Google OAuth.
- **Ação:** Mover para `src_electron_backup/` ou remover.
- **Marcador no código:** `TODO(D03)` em `scripts/generate-credentials.js`

### D04. `api/users.js` — lista de usuários hardcoded
- **Arquivo:** `api/users.js` (linhas 11-80)
- **Problema:** 60+ usuários hardcoded no código. Quando alguém entra ou sai, precisa editar o código.
- **Ação:** Buscar do HubSpot owners API ou mover para config file.
- **Marcador no código:** `NEEDS_ADJUSTMENT(D04)` em `api/users.js`

### D05. `STAGE_NAME_TO_ID` duplicado em `watcher-deals.js`
- **Arquivo:** `api/watcher-deals.js` (linhas 12-21)
- **Problema:** Mapeamento de stages duplicado (já existe em `lib/hubspot.js` como `STAGE_MAP` invertido).
- **Ação:** Criar `STAGE_NAME_TO_ID` em `lib/hubspot.js` e exportar.
- **Marcador no código:** `TODO(C09)` (mesmo que C09)

### D06. `PROP_MAP` em `watcher-deals.js` — mapeamento manual de propriedades
- **Arquivo:** `api/watcher-deals.js` (linhas 24-51)
- **Problema:** Mapeamento manual de nomes de display → nomes internos do HubSpot. Se uma propriedade mudar no HubSpot, precisa editar aqui.
- **Ação:** Considerar buscar propriedades dinamicamente via HubSpot Properties API, ou pelo menos mover para config file.
- **Marcador no código:** `NEEDS_ADJUSTMENT(D06)` em `api/watcher-deals.js`

---

## P4 — Melhorias

### M01. Rate limiting real
- **Problema:** O mutex `isPulling` é por instância serverless. Não protege contra abuse real.
- **Ação:** Implementar rate limiting com Vercel KV ou Upstash Redis.

### M02. Logs de auditoria persistentes
- **Problema:** Logs vão para `console.log` (Vercel logs, 1h de retenção no Hobby, 3d no Pro).
- **Ação:** Enviar logs críticos para um serviço externo (ex: Axiom, Datadog).

### M03. Cache de dados HubSpot
- **Problema:** Cada pull faz ~5-20 requests ao HubSpot. Sem cache entre requests.
- **Ação:** Implementar cache com Vercel KV (TTL 5 min) para reduzir latência e rate limit risk.

### M04. Testes automatizados
- **Problema:** Zero testes. Qualquer mudança em `lib/hubspot.js` pode quebrar cálculos silenciosamente.
- **Ação:** Adicionar testes unitários para `cleanOwnerName`, `pullHubSpotData`, parsing de deals.

### M05. `dashboard.html` monolítico (1MB)
- **Problema:** Um único arquivo HTML com todo o CSS, JS e lógica. Difícil de manter.
- **Ação:** Considerar split em componentes (mas manter zero-dependency).

---

## Resumo por Arquivo

| Arquivo | Issues | Severidade máxima |
|---------|:------:|:-----------------:|
| `lib/hubspot.js` | C01, C02, C03, C04, C05, C06, C07, C08, C11 | **P2** |
| `lib/credentials.json` | S01 | **P0** |
| `api/login.js` | B01 | **P1** |
| `api/watcher-deals.js` | C09, C10, D05, D06 | **P2** |
| `api/explore-tickets.js` | B02 | **P1** |
| `api/users.js` | D04 | **P3** |
| `scripts/generate-credentials.js` | S02, D03 | **P0** |
| `lib/auth.js` | — | OK |
| `lib/claude.js` | — | OK |
| `lib/sanitize.js` | — | OK |
| `api/_helpers.js` | — | OK |
| `api/auth/*.js` | — | OK |
| `api/pull-hubspot.js` | — | OK |
| `api/pull-cs-data.js` | — | OK |
| `api/pull-tickets.js` | — | OK |
| `api/ai-*.js` | — | OK |
| `api/jarvis-chat.js` | — | OK |
| `api/deal-activities.js` | — | OK |
| `api/company-*.js` | — | OK |
| `api/settings.js` | — | OK |
| `api/ticket-activities.js` | — | OK |

---

## Próximos Passos (Prioridade)

1. **[P0]** Remover `credentials.json` do git e rotacionar senhas (ou confirmar que login por senha está desativado)
2. **[P1]** Remover `api/login.js` (dead code)
3. **[P1]** Corrigir role check em `explore-tickets.js`
4. **[P2]** Corrigir parsing de `vidas` e `premio` (C04, C05) — NaN silencioso
5. **[P2]** Refatorar `cleanOwnerName` para config file (C01)
6. **[P2]** Corrigir `filled` check no Watcher (C10)
7. **[P2]** Adicionar filtro de status ativo no CS (C07)
8. **[P3]** Eliminar duplicação no `watcher-deals.js` (C09)
9. **[P4]** Testes unitários para `lib/hubspot.js`
