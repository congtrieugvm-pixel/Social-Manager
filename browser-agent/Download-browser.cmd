@echo off
cd /d "%~dp0"
node.exe dist\main.js fetch
pause
