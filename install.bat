@echo off
chcp 65001 >nul 2>&1
rem ===========================================================================
rem  xechat-dsh installer (Windows)
rem
rem  This .bat is only a launcher for install.ps1 - the real logic lives in
rem  PowerShell so that environment probing, error handling and verification
rem  exist in exactly one place. Two implementations would drift apart and
rem  every bug would have to be fixed twice.
rem
rem  NOTE: keep this file ASCII-only. cmd.exe reads .bat in the OEM codepage
rem  (GBK on zh-CN Windows), so UTF-8 Chinese comments get mangled into
rem  commands and the script fails with "'xxx' is not recognized".
rem
rem  Usage:
rem    install.bat                    install into the web profile
rem    install.bat -Profile desktop   install into the desktop profile
rem    install.bat -Tgz xechat-dsh-0.1.0.tgz
rem    install.bat -DryRun            check environment only
rem    install.bat -Uninstall         uninstall
rem ===========================================================================

setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
set "PS1=%SCRIPT_DIR%install.ps1"

if not exist "%PS1%" (
    echo [X] install.ps1 not found
    echo     It should sit next to this file: %SCRIPT_DIR%
    exit /b 1
)

rem Prefer pwsh (PowerShell 7+), fall back to the bundled powershell (5.1)
set "PS_EXE="
where pwsh >nul 2>&1 && set "PS_EXE=pwsh"
if not defined PS_EXE (
    where powershell >nul 2>&1 && set "PS_EXE=powershell"
)
if not defined PS_EXE (
    echo [X] PowerShell not found
    echo     Windows 10/11 ships powershell.exe; install PowerShell 7 if it is really missing
    exit /b 1
)

rem -NoProfile      : avoid aliases / policies from the user profile
rem -ExecutionPolicy Bypass : applies to this process only, changes no system setting
"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*

set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
    echo.
    echo Installer exited with code %RC%. See the messages above.
)

rem When launched by double-click the window would vanish instantly; wait for input
if "%~1"=="" (
    echo.
    pause
)
exit /b %RC%
