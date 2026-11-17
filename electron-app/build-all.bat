@echo off
setlocal
pushd "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Error: Node.js and npm were not found. Install Node.js, then try again.
  goto failed
)

if not exist "node_modules\electron-builder\package.json" (
  echo Installing desktop app dependencies...
  call npm ci
  if errorlevel 1 goto failed
)

if not exist "account-manager\node_modules\electron-builder\package.json" (
  echo Installing account manager dependencies...
  call npm --prefix account-manager ci
  if errorlevel 1 goto failed
)

echo.
echo Building the desktop app portable executable...
call npm run build:portable
if errorlevel 1 goto failed

echo.
echo Building the desktop app installer...
call npm run build:win
if errorlevel 1 goto failed

echo.
echo Building the account manager...
call npm --prefix account-manager run build:win
if errorlevel 1 goto failed

echo.
echo All builds completed successfully.
echo Artifacts: dist
pause
popd
exit /b 0

:failed
set "BUILD_EXIT_CODE=%ERRORLEVEL%"
if "%BUILD_EXIT_CODE%"=="0" set "BUILD_EXIT_CODE=1"
echo.
echo Build failed. Review the error above before trying again.
pause
popd
exit /b %BUILD_EXIT_CODE%
