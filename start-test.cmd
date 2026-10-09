@echo off
setlocal
cd /d "%~dp0"
set "npm_config_cache=%~dp0.tmp\npm-cache"
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "DESKISLAND_TEST_MODE=1"

if not exist "node_modules\electron\package.json" (
  echo Dependencies are not installed. Run npm ci from this folder first.
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo Preparing the Electron test runtime...
  call npm exec -- electron --version
  if errorlevel 1 exit /b 1
)

call npm run start:test
exit /b %errorlevel%
