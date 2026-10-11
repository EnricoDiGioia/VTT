@echo off
rem Inicia um servidor local para testar o VTT. Feche esta janela para parar.
cd /d "%~dp0"
set "PY="
where py >nul 2>nul && set "PY=py"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY (
  echo.
  echo  Python nao encontrado.
  echo  Instale em https://www.python.org/downloads/ e marque "Add python.exe to PATH".
  echo.
  pause
  exit /b 1
)
echo.
echo  ===================== VTT - servidor local =====================
echo   No PC:      http://localhost:8000
echo   No celular (mesmo Wi-Fi), tente um destes:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do for /f "tokens=*" %%b in ("%%a") do echo               http://%%b:8000
echo   Para parar: feche esta janela.
echo  ================================================================
echo.
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8000"
%PY% servidor.py 8000
pause
