@echo off
echo Stopping Agent Workflow Platform...
taskkill /F /FI "WINDOWTITLE eq Backend*" /T 2>nul
taskkill /F /FI "WINDOWTITLE eq Frontend*" /T 2>nul
echo Done!
pause
