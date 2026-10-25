@echo off
rem Starts the app in the background with PM2. All paths are relative to this script, so the project folder can be anywhere.
cd /d "%~dp0.."
if not exist logs mkdir logs

pm2 start dist/src/main.js --name spotify-playlist-automation --log "%~dp0..\logs\pm2.log"

exit /b 0
