@echo off
echo.
echo =========================================
echo  Deploy Hosting — ERP VR Marcas
echo  Publica index.html no Firebase Hosting
echo  NAO toca Functions, Firestore, regras
echo =========================================
echo.

cd /d "C:\Projetos\ERP VR"

echo Deployando APENAS o Hosting...
firebase deploy --only hosting

echo.
echo =========================================
echo  Concluido! Acesse: erp-vrmarcas.web.app
echo =========================================
pause
