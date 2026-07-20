# Dashboard Axenya

Ao trabalhar neste dashboard, rode o protocolo `/axenya-dashboard` (sobe o servidor
local na porta 3002 e valida as rotas) e leia os arquivos canônicos que ele indica,
nesta ordem:

1. `README.md` | contexto, objetivo, stakeholders, convenções.
2. `STATUS_LOG.md` | seção "Diretrizes do Projeto" (Regras primárias inegociáveis)
   + entradas recentes.
3. `AUDITORIA_GRAFICOS.md` | estado de validação de cada gráfico.
4. `docs/github-source-of-truth.md` | regra prática de GitHub como fonte da verdade antes de deploy.
5. `docs/dashboard-2.0/README.md` | quando o trabalho tocar o projeto Dashboard 2.0
   (migração por fases): charter, ADRs e plano de migração.

Este arquivo é só um **ponteiro**, de propósito: não guarda regra nem contexto para
não existir conteúdo duplicado que possa desatualizar. As regras vivem nos arquivos
acima. Em especial, a **fonte única de receita** é a **Regra primária nº 3** do
`STATUS_LOG.md`, e a **fonte da verdade de deploy** é GitHub/commit pushado
conforme `docs/github-source-of-truth.md`. Spec de build do Pipeline Coverage:
`docs/coverage-pipeline-v1-spec.md`. Regras de **receita do Forecast por etapa**
(motor único, aplicável a todos os painéis): `docs/forecast-revenue-rules.md`.
