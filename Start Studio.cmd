@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Comic Beatdowns Studio
cd /d "%~dp0"
echo.
echo Comic Beatdowns Studio - Windows launcher
echo First launch installs the tools needed to run your private studio.
echo Windows may ask permission to install Python, Node.js, or FFmpeg.
echo.

py -3.12 -c "import sys" >nul 2>&1
if not errorlevel 1 goto use_launcher
if exist "%LocalAppData%\Programs\Python\Python312\python.exe" goto use_local_python
if exist "%ProgramFiles%\Python312\python.exe" goto use_system_python

where winget >nul 2>&1
if errorlevel 1 goto need_app_installer
echo Installing Python 3.12 using Windows Package Manager...
winget install --id Python.Python.3.12 --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
if errorlevel 1 goto failed
if exist "%LocalAppData%\Programs\Python\Python312\python.exe" goto use_local_python
if exist "%ProgramFiles%\Python312\python.exe" goto use_system_python
echo Python was installed. Close this window and double-click Start Studio again.
goto failed

:use_launcher
py -3.12 scripts\windows_start.py %*
goto finished

:use_local_python
"%LocalAppData%\Programs\Python\Python312\python.exe" scripts\windows_start.py %*
goto finished

:use_system_python
"%ProgramFiles%\Python312\python.exe" scripts\windows_start.py %*
goto finished

:need_app_installer
echo Install or update Microsoft's "App Installer" from the Microsoft Store,
echo then double-click Start Studio again. Windows Package Manager is required.
goto failed

:finished
if errorlevel 1 goto failed
echo.
echo Studio closed.
pause
exit /b 0

:failed
echo.
echo Setup could not finish. Keep this window open to read the error above.
pause
exit /b 1
