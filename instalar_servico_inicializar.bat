@echo off
chcp 65001 >nul
title Configurar Inicialização Automática - Mundo Apple

echo ======================================================================
echo   Configurando Mundo Apple para iniciar sozinho ao ligar o Windows
echo ======================================================================
echo.

set SCRIPT_DIR=%~dp0
set TARGET=%SCRIPT_DIR%iniciar_segundo_plano.vbs
set SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\MundoAppleBuscador.lnk

powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath = '%TARGET%'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.Save()"

if exist "%SHORTCUT%" (
    echo [SUCESSO] Configuração concluída!
    echo.
    echo Toda vez que você ligar o Windows, o sistema iniciará em segundo plano
    echo automaticamente e nunca fechará sozinho.
    echo.
) else (
    echo [AVISO] Não foi possível criar o atalho automático.
    echo Você pode simplesmente criar um atalho de "iniciar_segundo_plano.vbs"
    echo e colar dentro da pasta Inicializar do Windows (shell:startup).
    echo.
)

pause
