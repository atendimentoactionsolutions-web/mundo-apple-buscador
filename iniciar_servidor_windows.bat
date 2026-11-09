@echo off
chcp 65001 >nul
title Mundo Apple Pro - Servidor Local
color 0A

echo ======================================================================
echo           🍎 MUNDO APPLE PRO - SISTEMA LOCAL (WINDOWS)
echo ======================================================================
echo.

:: 1. Verificar se o Node.js está instalado
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERRO] Node.js não foi encontrado no seu Windows!
    echo.
    echo Por favor, baixe e instale a versão LTS do Node.js:
    echo 👉 https://nodejs.org/
    echo.
    echo Após instalar, feche e abra este arquivo novamente.
    echo.
    pause
    exit /b 1
)

:: 2. Verificar dependências
if not exist "node_modules\" (
    echo [INFO] Instalando dependências pela primeira vez...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERRO] Falha ao instalar dependências.
        pause
        exit /b 1
    )
)

:: 3. Verificar arquivo .env
if not exist ".env" (
    if exist ".env.example" (
        echo [INFO] Configurando arquivo .env automaticamente...
        copy .env.example .env >nul
    )
)

echo [OK] Node.js detectado!
echo [OK] Iniciando Guardião Auto-Healer e Servidor Local...
echo.
echo ======================================================================
echo 🌐 Painel da Loja: http://localhost:3333
echo 📱 Na rede Wi-Fi: use o IP deste computador :3333
echo ======================================================================
echo.

:: Abre o navegador automaticamente após 2 segundos
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3333"

:: Executa o Guardião (que mantém o servidor e a sincronização vivos)
node scripts/auto-healer.js

pause
