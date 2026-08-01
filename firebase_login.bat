@echo off
chcp 65001 >nul
echo.
echo ============================================
echo   FIREBASE LOGIN - ERP VR Marcas
echo ============================================
echo.
echo Aguarde: vai abrir o browser para autorizar.
echo Clique em "Permitir" e volte aqui.
echo.
npx --yes firebase-tools@13 login
echo.
echo Login concluido! Agora rode: deploy_valeria_log.bat
echo.
pause
