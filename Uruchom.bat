@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Brakuje Node.js. Zainstaluj Node.js, aby uruchomic przesylanie przez Wi-Fi.
  pause
  exit /b 1
)
node server.js
if errorlevel 1 pause
