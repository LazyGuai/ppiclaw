@echo off
setlocal
cd /d "%~dp0"

set "NO_PAUSE="
if /I "%~1"=="--no-pause" (
  set "NO_PAUSE=1"
  shift
)

echo [launcher] Building @mariozechner/pi-feishu...
call npm run build --workspace @mariozechner/pi-feishu
if errorlevel 1 (
  echo [launcher] Build failed.
  if not defined NO_PAUSE pause
  exit /b 1
)

echo [launcher] Starting Feishu bot...
node packages\feishu\dist\main.js %*
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo [launcher] Feishu bot exited with code %EXIT_CODE%.
  if not defined NO_PAUSE pause
)
exit /b %EXIT_CODE%
