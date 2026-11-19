@echo off
cd /d "%~dp0"
if exist node.exe (start "" /min node.exe dist\main.js manager) else (start "" /min node dist\main.js manager)
