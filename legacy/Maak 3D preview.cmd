@echo off
REM Sleep een of meer mp4-bestanden (of een map) op dit icoon.
REM Voor elke LED-kolom video komt er een "<naam> - 3D Kolom.html" naast te staan.
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0New-KolomPreview.ps1" %*
echo.
echo Druk op een toets om te sluiten...
pause >nul
