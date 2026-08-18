@echo off
setlocal
set PYTHONIOENCODING=utf-8
where py >nul 2>&1
if %ERRORLEVEL%==0 (
  py -3 -u "%~dp0host.py"
  exit /b %ERRORLEVEL%
)
python -u "%~dp0host.py"
exit /b %ERRORLEVEL%
