@echo off
rem ---------------------------------------------------------------
rem  Laikela local launcher
rem  IMPORTANT: keep this file pure ASCII with CRLF line endings.
rem  Non-ASCII bytes + "chcp" in the same file makes cmd.exe read the
rem  rest of the file at a wrong byte offset and split lines in half,
rem  which shows up as "'xxx' is not recognized as an internal command".
rem  Chinese output belongs to scripts/serve.mjs, not to this file.
rem ---------------------------------------------------------------
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo.
echo   Laikela - local launch
echo   ------------------------------------------------
echo.

where node >nul 2>nul
if errorlevel 1 goto no_node

node "%~dp0scripts\serve.mjs" %*
set CODE=%ERRORLEVEL%

if not "%CODE%"=="0" goto failed
endlocal
exit /b 0

:no_node
echo   [ERROR] Node.js not found.
echo   Please install Node 20 or newer: https://nodejs.org
echo.
pause
endlocal
exit /b 1

:failed
echo.
echo   Launch failed (exit code %CODE%). Copy the output above to the developer.
echo.
pause
rem keep endlocal and exit on ONE line: %CODE% is expanded before endlocal runs
endlocal & exit /b %CODE%
