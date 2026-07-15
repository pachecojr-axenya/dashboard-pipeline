# Dashboard 2.0 | Índice canônico

> Pasta canônica do projeto **Dashboard 2.0** dentro do repo. O 2.0 não é um projeto
> novo: é o dashboard atual (1.0) ganhando a camada semântica que falta por baixo,
> por **extração e promoção** do que já existe — nunca por reescrita do que funciona
> (estratégia *strangler fig*, ver [ADR-001](decisoes-adr.md#adr-001)).

## Ordem de leitura

1. **[charter.md](charter.md)** | quem consome, as 20 perguntas que o dash responde,
   e o registro build-vs-buy. É o filtro de vaidade: painel que não rastreia a uma
   pergunta do charter não se constrói.
2. **[decisoes-adr.md](decisoes-adr.md)** | decisões de arquitetura numeradas
   (ADR-001…), com contexto, alternativas e status.
3. **[plano-migracao.md](plano-migracao.md)** | as fases 0–7, cada uma com objetivo,
   entregável, gate de auditoria e rollback.
4. **[fonte/](fonte/)** | cópias congeladas (2026-07-14) dos documentos de
   planejamento originais, para o racional completo viver no histórico do git.
   Originais vivem em `01 Projetos/Dashboard Axenya/Dashboard 2.0/` (fora do repo).

## Estado das fases

| Fase | Nome | Estado |
|---|---|---|
| 0 | Charter + decisões | ✅ fechada (aprovada pelo dono em 2026-07-14) |
| 1 | Os 3 arquivos base (extração) | ✅ fechada (gate: revisão do dono concluída em 2026-07-15 — réguas, remuneração, etapas, times e regras) |
| 2 | Consumo da referência | ✅ fechada (2026-07-14) | núcleo religado com paridade: forecast-table, funnel-stages, snapshot-format, hubspot.js (incl. tickets), régua flat do front via `semantic-ref.js` gerado. Cauda documentada (BDR/watcher/scripts, todos com IDs já catalogados e vigiados pelo check); pendência de decisão: divergência Implantação 0.581×1.0 |
| 3 | Drawer gerado do catálogo (golden: Forecast) | ✅ fechada no grupo forecast (gate: auditoria do dono concluída em 2026-07-15; renderer v2 pós-feedback) | Extensão futura: painéis CRO/Board/AE via NOVO_HELP_CHARTS |
| 4 | Dado manual de primeira classe + configs globais | 🟠 4a + 4b-núcleo entregues | 4a: faturamento manual com meta/selo ✏️. 4b: `api/config-global` (KV, D1–D3), toggle Premissas×Calculada honrado por CRO/Board via prob-engine, etapas_ativas globais server-side. Restante: AE consumir C07 na posição calculada + UI de etapas globais (passe do header) |
| 5 | Componente de gráfico parametrizado | ⬜ não iniciada |
| 6 | Manifestos + novos domínios | ⬜ não iniciada |
| 7 | Operacional (deploy GitHub, alertas, fuso, telemetria) | ⬜ não iniciada |

Atualize esta tabela a cada fase fechada (gate cumprido = fase fecha).

## Territórios de dono (coordenação entre pessoas/sessões)

| Território | Dono | Arquivos | Regra |
|---|---|---|---|
| **Subpáginas BDR** | **Samuel** | `bdr*.html`, `bdr*.js`, `premium.js`, `api/bdr-*` | **Não mexer sem coordenar com o Samuel.** Detalhes: menu delas vem de `premium.js`/`NAV_MODEL` (segunda fonte espelhada do `nav.js` — mudança de menu precisa ser portada nos dois); `bdr.html` tem 3 bytes NUL (nunca sed); elas NÃO carregam `semantic-ref.js` — os módulos compartilhados (`settings-modal.js`, `prob-engine.js`) carregam nelas com **fallback literal espelhado da régua única** (mantido em sincronia pelo código; ver `forecast_flat.usada_em` no catálogo). A migração 2.0 delas acontece com/pelo Samuel. |
| Demais painéis + camada semântica | Pacheco (+ sessões de IA coordenadas) | resto do repo | Regras de sessões paralelas do STATUS_LOG |

## Relação com os canônicos do 1.0

As regras vigentes do repo (STATUS_LOG.md | Diretrizes, README.md, AUDITORIA_GRAFICOS.md,
DEPLOY_GUIDE.md, docs/github-source-of-truth.md) **continuam valendo integralmente**
durante toda a migração. Em conflito, vale o canônico do 1.0 até que um ADR daqui
o substitua explicitamente.
