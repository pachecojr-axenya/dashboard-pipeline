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
| 1 | Os 3 arquivos base (extração) | 🟠 catálogo entregue | gate pendente: revisão do dono via [catalogo.md](catalogo.md) |
| 2 | Consumo da referência | ✅ fechada (2026-07-14) | núcleo religado com paridade: forecast-table, funnel-stages, snapshot-format, hubspot.js (incl. tickets), régua flat do front via `semantic-ref.js` gerado. Cauda documentada (BDR/watcher/scripts, todos com IDs já catalogados e vigiados pelo check); pendência de decisão: divergência Implantação 0.581×1.0 |
| 3 | Drawer gerado do catálogo (golden: Forecast) | 🟠 todos os painéis de forecast cobertos | /forecast (5 seções), /forecast-overall + 8 painéis de etapa (AE + dedup; seções dinâmicas por painel ficam à mão), /forecast-delta (memória de cálculo inteira). Gate pendente: auditoria do dono. Restante: painéis fora do grupo forecast (CRO/Board/AE via NOVO_HELP_CHARTS) |
| 4 | Dado manual de primeira classe + configs globais | ⬜ não iniciada |
| 5 | Componente de gráfico parametrizado | ⬜ não iniciada |
| 6 | Manifestos + novos domínios | ⬜ não iniciada |
| 7 | Operacional (deploy GitHub, alertas, fuso, telemetria) | ⬜ não iniciada |

Atualize esta tabela a cada fase fechada (gate cumprido = fase fecha).

## Relação com os canônicos do 1.0

As regras vigentes do repo (STATUS_LOG.md | Diretrizes, README.md, AUDITORIA_GRAFICOS.md,
DEPLOY_GUIDE.md, docs/github-source-of-truth.md) **continuam valendo integralmente**
durante toda a migração. Em conflito, vale o canônico do 1.0 até que um ADR daqui
o substitua explicitamente.
