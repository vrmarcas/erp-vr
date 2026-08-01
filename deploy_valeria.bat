@echo off
cd /d "C:\Projetos\ERP VR"
echo.
echo === DEPLOY 1/2: Functions Valeria ===
firebase deploy --only functions:valeria --config firebase-valeria.json
echo.
echo === DEPLOY 2/2: Firestore Rules ===
firebase deploy --only firestore:rules
echo.
echo === CONCLUIDO ===
pause
