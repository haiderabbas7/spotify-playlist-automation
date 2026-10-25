@echo off
rem Empties the log file of the app
type nul > "%~dp0..\logs\pm2.log"
if %errorlevel% equ 0 (
    echo File content cleared successfully.
) else (
    echo Failed to clear the file content. Please check the file path and permissions.
)
