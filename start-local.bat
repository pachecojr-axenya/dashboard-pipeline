@echo off
REM ============================================================
REM start-local.bat — Inicia o dashboard-ivan-visual localmente
REM Porta: http://localhost:3002
REM Bypass de auth: LOCAL_DEV_BYPASS=true
REM ============================================================

cd /d "%~dp0"

REM Carrega .env.local se existir
if exist ".env.local" (
    for /f "usebackq tokens=1,* delims==" %%A in (".env.local") do (
        set "line=%%A"
        if not "!line:~0,1!"=="#" (
            set "%%A=%%B"
        )
    )
)

REM Garante as vars essenciais
set LOCAL_DEV_BYPASS=true
if "%SESSION_SECRET%"=="" set SESSION_SECRET=dev-local-secret-nao-usar-em-producao-axenya-2026

echo.
echo  Dashboard Ivan Visual - Dev Server
echo  URL: http://localhost:3002
echo  Auth bypass: ATIVO (LOCAL_DEV_BYPASS=true)
echo  Para dados reais: cole HUBSPOT_TOKEN no .env.local
echo.

vercel dev --listen 3002 --yes
