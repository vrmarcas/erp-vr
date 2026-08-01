@echo off
echo.
echo =========================================
echo  FASE 5 — Deploy Cloud Functions (NOVO)
echo  Apenas adminCreateUser e afins
echo  NAO toca Valeria, MetaAds, GoogleAds
echo =========================================
echo.

cd /d "C:\Projetos\ERP VR"

echo Compilando TypeScript...
cd functions
call npm run build
if errorlevel 1 (
  echo ERRO na compilacao TypeScript. Abortando.
  pause
  exit /b 1
)
cd ..

echo.
echo Deployando APENAS as novas functions...
firebase deploy --only functions:adminCreateUser,functions:adminUpdateUserRole,functions:adminToggleStatus,functions:adminResendInvite,functions:adminRevokeSessions,functions:adminListUsers

echo.
echo =========================================
echo  Concluido!
echo =========================================
pause
