@echo off
cd /d C:\Users\Haider\PhpstormProjects\spotify-shuffler

pm2 start dist/src/main.js --name spotify_shuffler --log C:\Users\Haider\PhpstormProjects\spotify-shuffler\logs\pm2.log
::--no-autorestart

exit /b 0