@echo off
chcp 65001 >nul
cd /d "C:\Projetos\ERP VR"
echo ============================================================
echo   Valeria v2.1.2 - Fix: crm_leads -> valeria_leads
echo   Evita colisao com Kanban CRM do ERP
echo   (tambem inclui: erp_config + erp_orc_produtos fixes)
echo ============================================================
echo.
echo Iniciando deploy Firebase...
echo.
npx firebase deploy --only functions --config firebase-valeria.json --project erp-vrmarcas
echo.
echo ============================================================
echo   Deploy concluido. Verifique acima se 15/15 funcionaram.
echo ============================================================
echo.
pause
