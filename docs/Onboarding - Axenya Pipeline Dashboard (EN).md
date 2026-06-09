# Axenya Pipeline Dashboard — Onboarding Guide

**Version 5.7 · April 2026**

---

## 1. Introduction and Access

### What is the Pipeline Dashboard?

The Axenya Pipeline Dashboard is the executive analytics tool for Axenya's sales funnel. It centralizes HubSpot data into interactive dashboards, providing real-time visibility into pipeline health, revenue, AE and BDR performance, Customer Success, and quoting operations.

### Login

1. Open the **Axenya Pipeline Dashboard** application.
2. Enter your corporate **email** (@axenya.com).
3. Enter the **password** provided by your administrator.
4. Check **"Remember login"** to keep your session active for 48 hours.
5. Click **"Entrar"** (Login).

> **Tip:** If your session expires after 48h, your email will be pre-filled — just re-enter your password.

### HubSpot Connection

On first use or when reconfiguration is needed:

1. Click the **⚙ (Settings)** icon in the top-right corner.
2. Enter the **HubSpot Private App Token**.
3. Select the **auto-refresh interval** (5min, 15min, 30min, or 1h).
4. Click **"Save & Test"** to validate the connection.
5. Click **"Pull Data Now"** to load data immediately.

The status indicator will show the date/time of the last update and the number of deals loaded.

---

## 2. Main Navigation

### Dashboard Tabs

The dashboard has the following main tabs:

| Tab | Target Audience | What It Shows |
|-----|----------------|---------------|
| **Last 48h** | Everyone | Sales activity from the last 48 hours: new deals, meetings, stage movements, and activity gaps |
| **CRO Dashboard** | Leadership | Executive view: revenue, weighted pipeline, forecast, coverage, risk analysis, and AI insights |
| **AE Performance** | AEs & Managers | Account Executive performance: efficiency, volume, win rate, velocity, and coaching |
| **BDR Performance** | BDRs & Managers | BDR activity: weekly origination, activity heatmap, and handoff quality |
| **CS Dashboard** | Customer Success | Client portfolio, engagement, churn risk, renewals, and KAM analysis |
| **Cotação** | Operations | Quote tickets: lifecycle, SLA, throughput, and aging |

### Toolbar

At the top of the dashboard you'll find:

- **Date Filter** — Quick buttons (Current Month, Last Month, Q3, Q4, Q1, Last 3 months) and a custom period selector.
- **Brokerage Toggle** — Include/exclude the brokerage fee (15%) in revenue calculations.
- **Impl.=Ganho Toggle** — Reclassify deals in Implantação stage as Won in metrics.
- **Refresh Button** — Manually refresh data from HubSpot.
- **Auto-Refresh** — Dropdown to configure automatic data refresh.
- **Search** — "Search deals & companies..." field to quickly find any deal or company.
- **✎ Layout** — Edit mode to rearrange charts.

---

## 3. Filters and Controls

### Date Range Filter

The date filter affects most charts and metrics in the AE Performance, BDR Performance, and CRO Dashboard tabs.

- **Quick presets:** Click any button (e.g., "Q1 '26") to apply instantly.
- **Custom period:** Select start and end month/year, then click **"Apply"**.
- **Reset:** Click **"Reset"** to return to the default period (all data).

> **Important:** The date filter does **not** affect the open pipeline (which is always a current snapshot) or the Last 48h tab (which uses the last 48 hours from the data pull timestamp).

### Global Toggles

**Brokerage (Agenciamento)**
- **On:** Adds a 15% brokerage fee on the monthly premium to all revenue calculations.
- **Off:** Shows only the service fee / commission revenue (default).
- Affects: revenue cards, won deals tables, weighted pipeline.

**Impl.=Ganho**
- **On:** Deals in "Implantação" stage are counted as "Won" across all metrics.
- **Off:** Only deals in "Ganho" stage are considered won (default).
- An orange banner appears at the top when this toggle is active.

### CS Dashboard Filters

- **Segments:** All | Current Customers | New Clients (Implantação)
- **Migrated Only:** Shows only fully migrated/onboarded companies.
- **Active Only:** Shows only companies with "Ativo" status.

### Cotação Filters

- **Segments:** All | Open | Closed

---

## 4. Cards, Charts, and Drill-downs

### KPI Cards (Hero Cards)

The large cards at the top of each tab show key metrics. **Most are clickable** — clicking opens a modal with complete details.

**Drill-down examples:**
- **Won Deals** → Full table with company, vidas, monthly premium, revenue model, estimated annual revenue, and contract start date.
- **Pipeline Coverage** → Coverage chart by stage with conversion probabilities.
- **Weighted Pipeline** → Breakdown by stage with raw and weighted values.

### Interactive Charts

All charts have a **context menu** (three-dot icon ⋯) with options:
- **Export PNG** — Save the chart as an image.
- **Export CSV** — Download the chart's underlying data.
- **Fullscreen** — Expand for a larger view.

**Available chart types:**
- **Bar charts** — AE/BDR leaderboards, monthly volume, stage distribution.
- **Line charts** — Win rate trends, meeting rate, revenue forecast.
- **Donut/Pie** — Deal size distribution, risk breakdown, revenue model split.
- **Heatmaps** — Weekly activity, engagement, velocity by stage.
- **Funnel** — Pipeline waterfall with BDR/AE segmentation.

### Drill-down System

The dashboard features a layered navigation system:

1. **Level 1** — Click a card or chart to open the details modal.
2. **Level 2** — Inside the modal, click a company or metric to go deeper.
3. **Level 3** — Individual deal details (full info, team, history).

Use the **"← Back"** button to return to the previous level.

### Sortable Tables

All tables in modals have **clickable column headers for sorting**:
- Click a header to sort ascending (↑) or descending (↓).
- The ⇅ icon indicates that a column is sortable.

---

## 5. Revenue Formulas and Advanced Features

### Estimated Revenue Calculation

Axenya's estimated annual revenue is calculated based on the **Monthly Premium (PM)** and the deal's **number of lives (vidas)**:

| Scenario | Formula | Example (PM = R$ 100K) |
|----------|---------|----------------------|
| **≥ 200 lives** | 100% PM (1st month) + 5% PM × 11 months | R$ 100K + R$ 55K = **R$ 155K/yr** |
| **< 200 lives** | 100% PM × 3 months + 2% PM × 9 months | R$ 300K + R$ 18K = **R$ 318K/yr** |
| **Fee per life** | Value from "Receita Vitalício Estimada" property | As per HubSpot |

**Weighted Pipeline:** Estimated Revenue × Stage Win Probability

Stage probabilities are based on historical Bayesian conversion rates:
- Reunião Agendada: 2.7% · Diagnóstico: 4.6% · Cotação: 10.1%
- Consultoria: 15.6% · Negociação: 26.9% · Implantação: 53.8%

### Layout Customization

1. Click **"✎ Layout"** to enter edit mode.
2. **Drag** charts to reorder within a section or move between sections.
3. Click **"Done"** to save.
4. Use **"⤓ Export"** to save your layout as a JSON file.
5. Use **"⤒ Import"** to restore a saved layout.
6. Use **"Reset Layout"** to return to the default layout.

### AI Insights

The dashboard automatically generates analyses using artificial intelligence:

- **CRO Analysis** — Insights on pipeline health, risks, and recommendations (CRO tab).
- **Deal Risk Triage** — Top 20 deals ranked by risk level with automatic scoring.
- **CS Strategic Insights** — Weekly priorities and strategic recommendations (CS tab).
- **Contextual Alerts** — Automatic alerts when anomalies are detected in the data.

### Debug & Formula Inspector

For advanced users, the **Formula Inspector** (available in the AE Performance tab) allows you to:
- View the exact formulas used for each KPI.
- Execute custom JavaScript expressions against the data.
- Audit data consistency.

> **Warning:** This is a developer tool. Use with caution.

---

**Need help?** Contact your system administrator or open an internal support request.

*Dashboard excl. Bradesco Seguros (1M lives), Buckler Group (invalid).*
