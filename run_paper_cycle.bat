@echo off
REM ---------------------------------------------------------------------------
REM Manual single cycle of the paper bot - double-click, or run from a terminal.
REM
REM This is a thin wrapper around scheduled_cycle.py, which is the SAME code
REM path the hourly Windows task uses. Deliberately so: when the manual and
REM scheduled paths differ, "it works when I run it myself" stops being
REM evidence that the schedule works, which is how this bot previously sat
REM silent for a week while appearing fine on demand.
REM
REM The hourly task calls python.exe -> scheduled_cycle.py directly, with no
REM cmd.exe in the chain (a batch-wrapped task died with 0xC000013A when its
REM console took a control event). This wrapper exists only for convenience.
REM
REM Install / remove the hourly schedule with install_scheduler.bat.
REM ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"

set "PYEXE=C:\Users\gdoch\AppData\Local\Programs\Python\Python312\python.exe"
if not exist "%PYEXE%" set "PYEXE=python"

"%PYEXE%" -u scheduled_cycle.py
echo.
echo Cycle finished with exit code %ERRORLEVEL%. Full log: data\paper_run.log
endlocal
