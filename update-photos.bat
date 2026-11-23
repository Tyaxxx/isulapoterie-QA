@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\correct-photos.ps1"
if errorlevel 1 goto end
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\generate-photos.ps1"
:end
pause
