@echo off
chcp 65001 >nul
cd /d "C:\Projetos\ERP VR"
echo ============================================================
echo   ERP VR — Commit + Push para GitHub
echo   Versao: S1-S4 Refatoracao de Estabilizacao
echo ============================================================
echo.
node "C:\Projetos\ERP VR\git_commit_push.js"
echo.
pause
