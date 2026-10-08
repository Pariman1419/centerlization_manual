@echo off
setlocal
set "ROOT=%~dp0"

if not exist "%ROOT%.venv\Scripts\python.exe" (
    echo [ERROR] Missing .venv. See README.md "Start Backend".
    pause
    exit /b 1
)

if not exist "%ROOT%frontend\node_modules" (
    echo Installing frontend dependencies...
    pushd "%ROOT%frontend"
    call npm.cmd ci
    popd
)

echo Starting backend  (http://127.0.0.1:8000)...
start "Manual Backend" /D "%ROOT%backend" "%ROOT%.venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

echo Starting frontend (http://127.0.0.1:5173)...
start "Manual Frontend" /D "%ROOT%frontend" cmd /k npm.cmd run dev

timeout /t 4 /nobreak >nul
start "" "http://127.0.0.1:5173/login"
endlocal
