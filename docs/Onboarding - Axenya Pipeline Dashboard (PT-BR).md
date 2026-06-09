# Axenya Pipeline Dashboard — Guia de Onboarding

**Versão 5.7 · Abril 2026**

---

## 1. Introdução e Acesso

### O que é o Pipeline Dashboard?

O Axenya Pipeline Dashboard é a ferramenta executiva de análise do funil de vendas da Axenya. Ele centraliza dados do HubSpot em dashboards interativos, oferecendo visibilidade em tempo real sobre pipeline, receita, performance de AEs e BDRs, Customer Success e operações de cotação.

### Login

1. Abra o aplicativo **Axenya Pipeline Dashboard**.
2. Insira seu **e-mail** corporativo (@axenya.com).
3. Digite a **senha** fornecida pelo administrador.
4. Marque **"Remember login"** para manter a sessão ativa por 48 horas.
5. Clique em **"Entrar"**.

> **Dica:** Caso a sessão expire após 48h, seu e-mail será pré-preenchido — basta inserir a senha novamente.

### Conexão com HubSpot

Na primeira utilização ou quando necessário reconfigurar:

1. Clique no ícone **⚙ (Configurações)** no canto superior direito.
2. Insira o **HubSpot Private App Token**.
3. Selecione o **intervalo de atualização automática** (5min, 15min, 30min ou 1h).
4. Clique em **"Save & Test"** para validar a conexão.
5. Clique em **"Pull Data Now"** para carregar os dados imediatamente.

O indicador de status mostrará a data/hora da última atualização e a quantidade de deals carregados.

---

## 2. Navegação Principal

### Abas do Dashboard

O dashboard possui as seguintes abas principais:

| Aba | Público-Alvo | O que mostra |
|-----|-------------|--------------|
| **Last 48h** | Todos | Atividade de vendas das últimas 48 horas: novos deals, reuniões, movimentações de estágio e gaps de atividade |
| **CRO Dashboard** | Liderança | Visão executiva: receita, pipeline ponderado, forecast, cobertura, análise de risco e insights de IA |
| **AE Performance** | AEs e Gestores | Performance dos Account Executives: eficiência, volume, win rate, velocity e coaching |
| **BDR Performance** | BDRs e Gestores | Atividade dos BDRs: originação semanal, heatmap de atividade e qualidade de handoff |
| **CS Dashboard** | Customer Success | Portfólio de clientes, engajamento, risco de churn, renovações e análise de KAMs |
| **Cotação** | Operações | Tickets de cotação: ciclo de vida, SLA, throughput e aging |

### Barra de Ferramentas

No topo do dashboard você encontra:

- **Filtro de Data** — Botões rápidos (Mês Atual, Último Mês, Q3, Q4, Q1, Últimos 3 meses) e seletor customizado de período.
- **Toggle Brokerage** — Inclui/exclui a taxa de agenciamento (15%) nos cálculos de receita.
- **Toggle Impl.=Ganho** — Reclassifica deals em Implantação como Ganho nas métricas.
- **Botão Refresh** — Atualiza os dados manualmente a partir do HubSpot.
- **Auto-Refresh** — Dropdown para configurar atualização automática.
- **Busca** — Campo "Search deals & companies..." para encontrar rapidamente qualquer deal ou empresa.
- **✎ Layout** — Modo de edição para reorganizar os gráficos.

---

## 3. Filtros e Controles

### Filtro de Período

O filtro de data afeta a maioria dos gráficos e métricas das abas AE Performance, BDR Performance e CRO Dashboard.

- **Presets rápidos:** Clique em um dos botões (ex: "Q1 '26") para aplicar instantaneamente.
- **Período customizado:** Selecione mês/ano de início e fim, depois clique em **"Apply"**.
- **Reset:** Clique em **"Reset"** para voltar ao período padrão (todos os dados).

> **Importante:** O filtro de período **não** afeta o pipeline aberto (que é sempre um snapshot do momento atual) nem a aba Last 48h (que usa as últimas 48 horas a partir do horário da última atualização de dados).

### Toggles Globais

**Brokerage (Agenciamento)**
- **Ligado:** Adiciona 15% de taxa de agenciamento sobre o prêmio mensal em todos os cálculos de receita.
- **Desligado:** Mostra apenas a receita de vitalício/comissionamento (padrão).
- Afeta: cards de receita, tabelas de won deals, pipeline ponderado.

**Impl.=Ganho**
- **Ligado:** Deals em estágio "Implantação" são contados como "Ganho" em todas as métricas.
- **Desligado:** Apenas deals em "Ganho" são considerados como vencidos (padrão).
- Um banner laranja aparece no topo quando este toggle está ativado.

### Filtros do CS Dashboard

- **Segmentos:** All | Current Customers | New Clients (Implantação)
- **Migrated Only:** Mostra apenas empresas totalmente migradas/implantadas.
- **Active Only:** Mostra apenas empresas com status "Ativo".

### Filtros da Cotação

- **Segmentos:** All | Open | Closed

---

## 4. Cards, Gráficos e Drill-downs

### Cards de KPI (Hero Cards)

Os cards grandes no topo de cada aba mostram as métricas principais. **A maioria é clicável** — ao clicar, abre-se um modal com detalhes completos.

**Exemplos de drill-down:**
- **Won Deals** → Tabela completa com empresa, vidas, prêmio mensal, modelo de receita, receita estimada anual e vigência.
- **Pipeline Coverage** → Gráfico de cobertura por estágio com probabilidades de conversão.
- **Weighted Pipeline** → Detalhamento por estágio com valores brutos e ponderados.

### Gráficos Interativos

Todos os gráficos possuem um **menu de contexto** (ícone de três pontos ⋯) com opções:
- **Export PNG** — Salvar o gráfico como imagem.
- **Export CSV** — Baixar os dados do gráfico.
- **Fullscreen** — Expandir para visualização ampliada.

**Tipos de gráfico disponíveis:**
- **Barras** — Leaderboards de AE/BDR, volume por mês, distribuição por estágio.
- **Linhas** — Tendências de win rate, meeting rate, forecast de receita.
- **Donut/Pizza** — Distribuição por tamanho de deal, risco, modelo de receita.
- **Heatmaps** — Atividade semanal, engajamento, velocity por estágio.
- **Funil** — Pipeline waterfall com segmentação BDR/AE.

### Sistema de Drill-down

O dashboard possui um sistema de navegação em camadas:

1. **Nível 1** — Clique em um card ou gráfico para abrir o modal de detalhes.
2. **Nível 2** — Dentro do modal, clique em uma empresa ou métrica para ir mais fundo.
3. **Nível 3** — Detalhes individuais do deal (informações completas, time, histórico).

Use o botão **"← Back"** para voltar ao nível anterior.

### Tabelas com Ordenação

Todas as tabelas nos modais possuem **colunas clicáveis para ordenação**:
- Clique no cabeçalho para ordenar ascendente (↑) ou descendente (↓).
- O ícone ⇅ indica que a coluna é ordenável.

---

## 5. Fórmulas de Receita e Funcionalidades Avançadas

### Cálculo de Receita Estimada

A receita estimada anual da Axenya é calculada com base no **Prêmio Mensal (PM)** e na quantidade de **vidas** do deal:

| Cenário | Fórmula | Exemplo (PM = R$ 100K) |
|---------|---------|----------------------|
| **≥ 200 vidas** | 100% PM (1° mês) + 5% PM × 11 meses | R$ 100K + R$ 55K = **R$ 155K/ano** |
| **< 200 vidas** | 100% PM × 3 meses + 2% PM × 9 meses | R$ 300K + R$ 18K = **R$ 318K/ano** |
| **Fee por vida** | Valor da propriedade "Receita Vitalício Estimada" | Conforme HubSpot |

**Pipeline Ponderado:** Receita Estimada × Probabilidade do Estágio

As probabilidades por estágio são baseadas em taxas históricas de conversão (Bayesian):
- Reunião Agendada: 2.7% · Diagnóstico: 4.6% · Cotação: 10.1%
- Consultoria: 15.6% · Negociação: 26.9% · Implantação: 53.8%

### Personalização de Layout

1. Clique em **"✎ Layout"** para entrar no modo de edição.
2. **Arraste** os gráficos para reordenar dentro da seção ou mover entre seções.
3. Clique em **"Done"** para salvar.
4. Use **"⤓ Export"** para salvar seu layout como arquivo JSON.
5. Use **"⤒ Import"** para restaurar um layout salvo.
6. Use **"Reset Layout"** para voltar ao layout padrão.

### Insights de IA

O dashboard gera automaticamente análises com inteligência artificial:

- **CRO Analysis** — Insights sobre saúde do pipeline, riscos e recomendações (aba CRO).
- **Deal Risk Triage** — Ranking dos top 20 deals por nível de risco, com pontuação automática.
- **CS Strategic Insights** — Prioridades semanais e recomendações estratégicas (aba CS).
- **Alertas Contextuais** — Alertas automáticos quando anomalias são detectadas nos dados.

### Debug & Formula Inspector

Para usuários avançados, o **Formula Inspector** (disponível na aba AE Performance) permite:
- Visualizar as fórmulas exatas usadas em cada KPI.
- Executar expressões JavaScript customizadas sobre os dados.
- Auditar a consistência dos dados.

> **Atenção:** Esta é uma ferramenta de desenvolvimento. Use com cautela.

---

**Precisa de ajuda?** Entre em contato com o administrador do sistema ou abra um chamado interno.

*Dashboard excl. Bradesco Seguros (1M vidas), Buckler Group (inválido).*
