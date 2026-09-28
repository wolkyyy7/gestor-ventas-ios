@echo off
title Publicar en GitHub Pages
cd /d "%~dp0"
echo ========================================================
echo   Publicar Gestor de Ventas en GitHub Pages (Gratis)
echo ========================================================
echo.
echo Pasos previos:
echo 1. Entra en https://github.com/new y crea un repositorio:
echo    - Nombre sugerido: gestor-ventas-ios
echo    - Marcalo como Publico
echo    - NO anadas README ni .gitignore (ya estan creados aqui)
echo.
set /p REPO_URL="Pega aqui la URL de tu repositorio de GitHub: "

if "%REPO_URL%"=="" (
    echo No has introducido ninguna URL. Operacion cancelada.
    pause
    exit /b
)

git remote remove origin 2>nul
git remote add origin %REPO_URL%
git branch -M main
git push -u origin main

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================================
    echo  ¡Publicado con exito en GitHub!
    echo ========================================================
    echo Ya se ha configurado el despliegue automatico.
    echo En unos segundos tu app estara online y lista para tu iPhone 17.
) else (
    echo.
    echo [AVISO] Si te ha pedido iniciar sesion en GitHub, completa el inicio en el navegador y vuelve a intentarlo.
)
echo.
pause
