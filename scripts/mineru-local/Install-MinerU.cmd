@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-MinerU.ps1" %*
set "ARTINFACT_INSTALL_EXIT=%ERRORLEVEL%"
if not "%ARTINFACT_INSTALL_EXIT%"=="0" echo Installation failed. See the log path printed above.
pause
exit /b %ARTINFACT_INSTALL_EXIT%
