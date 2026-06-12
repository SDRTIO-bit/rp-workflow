Write-Host "Starting Agent Workflow Platform..." -ForegroundColor Green
Write-Host ""

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "[1/2] Starting Backend API server..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$projectRoot\apps\server'; npm run dev" -WindowStyle Normal

Start-Sleep -Seconds 2

Write-Host "[2/2] Starting Frontend dev server..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$projectRoot\apps\web'; npm run dev" -WindowStyle Normal

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Servers are starting..." -ForegroundColor Cyan
Write-Host ""
Write-Host "  Backend:  http://127.0.0.1:5180" -ForegroundColor Green
Write-Host "  Frontend: http://127.0.0.1:5173" -ForegroundColor Green
Write-Host ""
Write-Host "  Wait a few seconds, then open browser." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Read-Host "Press Enter to exit"
