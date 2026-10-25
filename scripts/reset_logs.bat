@echo off
type nul > "C:\Users\Haider\PhpstormProjects\spotify-shuffler\logs\pm2.log"
if %errorlevel% equ 0 (
    echo File content cleared successfully.
) else (
    echo Failed to clear the file content. Please check the file path and permissions.
)