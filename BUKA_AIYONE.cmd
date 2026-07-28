@echo off
title Aiyone Personal
cd /d "%~dp0"
set "AIYONE_NODE=C:\Users\SDIT Mutiara Insani\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not exist "%AIYONE_NODE%" (
  echo Node.js tidak ditemukan.
  echo Install Node.js dari https://nodejs.org lalu jalankan kembali file ini.
  pause
  exit /b 1
)

start "" "http://localhost:4173/?v=aiyone-v9-ui"
echo.
echo Aiyone sedang berjalan di http://localhost:4173
echo Jangan tutup jendela ini selama Aiyone digunakan.
echo.
"%AIYONE_NODE%" server.js
pause
