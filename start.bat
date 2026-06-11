@echo off
echo Starting Agent Workflow Platform...
echo.

cd /d "%~dp0"

echo [1/2] Starting Backend API server...
start "Backend" cmd /k "cd /d %~dp0apps\server && npm run dev"

echo [2/2] Starting Frontend dev server...
start "Frontend" cmd /k "cd /d %~dp0apps\web && npm run dev"

echo.
echo ========================================
echo   Servers are starting...
echo.
echo   Backend:  http://127.0.0.1:5180
echo   Frontend: http://127.0.0.1:5173
echo.
echo   Wait a few seconds, then open browser.
echo ========================================
echo.
pause
