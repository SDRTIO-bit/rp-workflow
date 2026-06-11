@echo off
echo Starting Agent Workflow Platform...
echo.
echo Backend: http://127.0.0.1:5180
echo Frontend: http://127.0.0.1:5173
echo.
start "Backend" cmd /k "cd /d %~dp0apps\server && npm run dev"
timeout /t 3 /nobreak >nul
start "Frontend" cmd /k "cd /d %~dp0apps\web && npm run dev"
echo.
echo Servers started! Close this window or press Ctrl+C to stop.
pause
