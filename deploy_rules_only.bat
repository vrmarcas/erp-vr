@echo off
cd /d "C:\Projetos\ERP VR"
echo.
echo === DEPLOY: Firestore Rules ===
firebase deploy --only firestore:rules
echo.
echo === CONCLUIDO ===
pause
