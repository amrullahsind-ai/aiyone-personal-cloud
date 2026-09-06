@echo off
setlocal
title Aiyone Personal
cd /d "%~dp0"

rem Cari Node.js: pakai yang ada di PATH dulu, baru lokasi umum.
set "AIYONE_NODE="
where node >nul 2>nul && set "AIYONE_NODE=node"

if not defined AIYONE_NODE (
  for %%P in (
    "%ProgramFiles%\nodejs\node.exe"
    "%ProgramFiles(x86)%\nodejs\node.exe"
    "%LOCALAPPDATA%\Programs\nodejs\node.exe"
    "%APPDATA%\nvm\node.exe"
  ) do (
    if not defined AIYONE_NODE if exist %%P set "AIYONE_NODE=%%~P"
  )
)

if not defined AIYONE_NODE (
  echo.
  echo Node.js tidak ditemukan di komputer ini.
  echo Install Node.js versi 18 atau lebih baru dari https://nodejs.org
  echo lalu jalankan kembali file ini.
  echo.
  pause
  exit /b 1
)

echo.
echo Aiyone akan berjalan di http://localhost:4173
echo Jangan tutup jendela ini selama Aiyone digunakan.
echo Tekan Ctrl+C untuk berhenti.
echo.

start "" "http://localhost:4173/"
"%AIYONE_NODE%" server.js
echo.
echo Aiyone berhenti.
pause
