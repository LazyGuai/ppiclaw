@echo off
setlocal
cd /d "%~dp0"

set "NO_PAUSE="
if /I "%~1"=="--no-pause" (
  set "NO_PAUSE=1"
  shift
)

set "QQ_LOCK=packages\qqbot\data-qqbot\qqbot.lock"
set "RUNNING_PID="

for /f %%I in ('powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'packages[\\/]+qqbot[\\/]+dist[\\/]+main\.js' } | Select-Object -First 1 -ExpandProperty ProcessId; if($p){ $p }"') do set "RUNNING_PID=%%I"
if defined RUNNING_PID (
  echo [launcher] QQ bot is already running ^(PID %RUNNING_PID%^).
  echo [launcher] Skip start. If you need restart, run: powershell -ExecutionPolicy Bypass -File scripts\stop-chatbots.ps1
  if not defined NO_PAUSE pause
  exit /b 0
)

if exist "%QQ_LOCK%" (
  set /p LOCK_PID=<"%QQ_LOCK%"
  set "LOCK_STATUS="
  for /f %%I in ('powershell -NoProfile -Command "$pidText = '%LOCK_PID%'; if($pidText -match '^\d+$'){ $proc = Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq [int]$pidText } | Select-Object -First 1; if($proc){ 'EXISTS' } else { 'MISSING' } } else { 'INVALID' }"') do set "LOCK_STATUS=%%I"
  if "%LOCK_STATUS%"=="MISSING" (
    echo [launcher] Removing stale qqbot lock: %QQ_LOCK%
    del /f /q "%QQ_LOCK%" >nul 2>nul
  )
  if "%LOCK_STATUS%"=="INVALID" (
    echo [launcher] Removing invalid qqbot lock: %QQ_LOCK%
    del /f /q "%QQ_LOCK%" >nul 2>nul
  )
)

echo [launcher] Building @mariozechner/pi-qqbot...
call npm run build --workspace @mariozechner/pi-qqbot
if errorlevel 1 (
  echo [launcher] Build failed.
  pause
  exit /b 1
)

echo [launcher] Starting QQ bot...
node packages\qqbot\dist\main.js %*
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo [launcher] QQ bot exited with code %EXIT_CODE%.
  if not defined NO_PAUSE pause
)
exit /b %EXIT_CODE%
