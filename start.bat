@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
set "API_URL=http://127.0.0.1:8000/api/health"
set "APP_URL=http://127.0.0.1:5173/"
set "CHECK_ONLY="
if /I "%~1"=="--check" set "CHECK_ONLY=1"

where py >nul 2>nul
if not errorlevel 1 (
  set "PYTHON=py -3"
) else (
  where python >nul 2>nul || (
    echo [ERROR] Python 3 is not found. Install Python 3.11 or newer and add it to PATH.
    exit /b 1
  )
  set "PYTHON=python"
)

where node >nul 2>nul || (
  echo [ERROR] Node.js is not found. Install Node.js LTS and restart this script.
  exit /b 1
)
where npm.cmd >nul 2>nul || (
  echo [ERROR] npm.cmd is not found. Reinstall Node.js LTS and restart this script.
  exit /b 1
)

%PYTHON% --version || exit /b 1
node --version || exit /b 1
call npm.cmd --version || exit /b 1

if defined CHECK_ONLY (
  echo [OK] Python, Node.js and npm.cmd are available.
  echo Run start.bat without arguments to install dependencies and start JobPilot.
  exit /b 0
)

call :require_free_port 8000 "FastAPI"
if errorlevel 1 exit /b 1
call :require_free_port 5173 "Vite"
if errorlevel 1 exit /b 1

if not exist "%ROOT%backend\.venv\Scripts\python.exe" (
  echo [INFO] Creating backend virtual environment...
  %PYTHON% -m venv "%ROOT%backend\.venv" || exit /b 1
)
set "VENV_PY=%ROOT%backend\.venv\Scripts\python.exe"

echo [INFO] Installing backend dependencies...
"%VENV_PY%" -m pip install -r "%ROOT%backend\requirements.txt" || exit /b 1

echo [INFO] Installing frontend dependencies...
pushd "%ROOT%frontend" || exit /b 1
call npm.cmd install || (popd & exit /b 1)
popd

echo [INFO] Starting FastAPI and Vite in separate windows...
start "JobPilot API" cmd /k "cd /d ""%ROOT%backend"" && ""%VENV_PY%"" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"
start "JobPilot Frontend" cmd /k "cd /d ""%ROOT%frontend"" && call npm.cmd run dev -- --host 127.0.0.1 --strictPort"

call :wait_url "%API_URL%" "FastAPI"
if errorlevel 1 exit /b 1
call :wait_url "%APP_URL%" "Vite"
if errorlevel 1 exit /b 1

echo [OK] JobPilot is ready: %APP_URL%
if not defined BROWSER_OPENED (
  set "BROWSER_OPENED=1"
  start "" "%APP_URL%"
)
exit /b 0

:require_free_port
set "PORT=%~1"
set "SERVICE=%~2"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$listener=Get-NetTCPConnection -State Listen -LocalPort %PORT% -ErrorAction SilentlyContinue; if ($listener) { exit 1 }; exit 0"
if errorlevel 1 (
  echo [ERROR] Port %PORT% is already in use. Stop the existing %SERVICE% process and run start.bat again.
  exit /b 1
)
exit /b 0

:wait_url
set "URL=%~1"
set "SERVICE=%~2"
echo [INFO] Waiting for %SERVICE%...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddSeconds(30); do { try { if ((Invoke-WebRequest -UseBasicParsing '%URL%' -TimeoutSec 2).StatusCode -eq 200) { exit 0 } } catch {}; Start-Sleep -Milliseconds 500 } while ((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 (
  echo [ERROR] %SERVICE% did not become ready in 30 seconds. Check its window for details.
  exit /b 1
)
exit /b 0
