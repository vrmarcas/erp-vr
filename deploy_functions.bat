@echo off
cd /d "C:\Projetos\ERP VR"
echo Compilando TypeScript e fazendo deploy das Cloud Functions...
firebase deploy --only functions
echo.
echo Pressione qualquer tecla para fechar.
pause
