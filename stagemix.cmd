@echo off
rem ============================================================
rem  Stage Mix - command line launcher
rem  Usage: stagemix [start|stop|restart|status|tray|install|uninstall|help]
rem ============================================================
setlocal enableextensions

set "ROOT=%~dp0"
set "ACTION=%1"

if "%ACTION%"==""               set "ACTION=help"
if /i "%ACTION%"=="start"       goto run
if /i "%ACTION%"=="stop"        goto run
if /i "%ACTION%"=="restart"     goto run
if /i "%ACTION%"=="status"      goto run
if /i "%ACTION%"=="tray"        goto run
if /i "%ACTION%"=="install"     goto run
if /i "%ACTION%"=="uninstall"   goto run
if /i "%ACTION%"=="help"        goto help
if /i "%ACTION%"=="/?"          goto help
if /i "%ACTION%"=="-h"          goto help

echo [ERROR] Unknown command: %ACTION%
echo.
goto help

:run
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\stagemix.ps1" -Action %ACTION%
exit /b %errorlevel%

:help
echo Stage Mix - command line launcher
echo.
echo Usage: stagemix ^<command^>
echo.
echo Commands:
echo   start      Start Stage Mix in the background (plus the tray icon)
echo   stop       Stop Stage Mix
echo   restart    Restart Stage Mix
echo   status     Show whether Stage Mix is running
echo   tray       Re-open the tray indicator if it was closed
echo   install    Add this folder to your user PATH  (so "stagemix" works from anywhere)
echo   uninstall  Remove this folder from your user PATH
echo   help       Show this help
echo.
echo Tip: run "stagemix install" once, then open a new terminal window.
exit /b 0
