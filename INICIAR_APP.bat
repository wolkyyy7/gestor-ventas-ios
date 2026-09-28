@echo off
title Gestor de Ventas e Inventario - iOS Local
cd /d "%~dp0"
echo ========================================================
echo   Iniciando Gestor de Ventas e Inventario (iOS / PWA)
echo ========================================================
echo.

python server.py
if %ERRORLEVEL% NEQ 0 (
    echo Intentando con 'py'...
    py server.py
)

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] No se pudo iniciar el servidor. Asegurate de tener Python instalado.
    pause
)
