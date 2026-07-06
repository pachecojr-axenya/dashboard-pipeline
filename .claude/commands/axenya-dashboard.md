# /axenya-dashboard — Protocolo de avaliação do Dashboard Axenya

Sempre que o usuário pedir para **avaliar, auditar ou trabalhar** no Dashboard Axenya,
execute este protocolo **antes de qualquer análise ou edição de código**.

## 1. Ativar o servidor local (porta 3002)

```powershell
Start-Process -FilePath "node" -ArgumentList "scripts/local-server.js" `
  -WorkingDirectory "D:\0 PACHECO\Pacheco Remoto\Pacheco Remoto\10 PROJETOS\01 AXENYA\01 Projetos\Dashboard Ivan\dashboard-ivan-visual" `
  -PassThru -WindowStyle Hidden
```

Aguardar ~3 segundos e confirmar que o servidor responde:

```powershell
Invoke-WebRequest -Uri "http://localhost:3002/novo" -UseBasicParsing | Select-Object StatusCode
```

Resultado esperado: `StatusCode: 200`.

> O `local-server.js` carrega o `.env.local` automaticamente (`LOCAL_DEV_BYPASS=true`,
> `HUBSPOT_TOKEN`, `SESSION_SECRET`). Não é necessário Google OAuth localmente.

## 2. Enviar todas as requisições pelo ambiente local

- Base URL: `http://localhost:3002`
- **Nunca** usar o domínio de produção (`project-bsmfu.vercel.app`) para validar código não deployado.
- Rotas disponíveis: `/novo` (CRO), `/novo-board`, `/novo-ae`, `/novo-bdr`, `/novo-48h`, `/novo-cs`, `/novo-cotacao`, `/forecast`
- APIs disponíveis: `http://localhost:3002/api/forecast-table`, `/api/funnel-stages`, etc.

## 3. Ler os arquivos de contexto (nesta ordem)

1. `README.md` — contexto, objetivo, stakeholders, convenções
2. `STATUS_LOG.md` — seção "Diretrizes do Projeto" + entradas recentes (junho)
3. `AUDITORIA_GRAFICOS.md` — estado de validação de cada gráfico (🟢🟠🔴🟡)

## 4. Verificar rotas-chave antes de reportar qualquer achado

```powershell
@("/novo", "/novo-board", "/novo-ae", "/novo-bdr") | ForEach-Object {
  $r = Invoke-WebRequest -Uri "http://localhost:3002$_" -UseBasicParsing
  "$_ → $($r.StatusCode)"
}
```

Todas devem retornar 200. Qualquer 4xx ou 5xx é um problema a reportar antes de prosseguir.

## 5. Só então prosseguir com a avaliação

Com o servidor ativo e as rotas confirmadas, execute a análise solicitada pelo usuário.
