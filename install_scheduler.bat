@echo off
REM ---------------------------------------------------------------------------
REM Installs the hourly Windows Task Scheduler entry that runs the paper bot.
REM
REM Why this exists: the bot was previously meant to be driven by a Claude
REM cloud scheduled task, which could not reliably reach this machine, and
REM before that by a terminal window somebody had to leave open. Neither
REM worked - the trade log stayed empty for the project's entire life. This is
REM a plain OS-level timer with no dependency on Claude or on a terminal.
REM
REM Runs only while Gabe is logged on (no stored password, by design - a task
REM configured to run whether-or-not-logged-on needs credentials cached on
REM disk, which is not worth it for a paper bot). If the machine is asleep the
REM cycle is simply skipped; hourly polling on a 4h-bar strategy tolerates that
REM easily, and every piece of state is on disk so a missed hour costs nothing.
REM
REM   install_scheduler.bat            install / replace the task
REM   install_scheduler.bat remove     delete it
REM
REM Inspect it any time with:  schtasks /query /tn HyperliquidPaperBot /v /fo LIST
REM ---------------------------------------------------------------------------
setlocal
set "TASKNAME=HyperliquidPaperBot"
set "PYEXE=C:\Users\gdoch\AppData\Local\Programs\Python\Python312\python.exe"
set "RUNNER=%~dp0scheduled_cycle.py"

if /i "%~1"=="remove" (
    schtasks /delete /tn "%TASKNAME%" /f
    echo Removed scheduled task "%TASKNAME%".
    goto :eof
)

REM Invoke python.exe directly, NOT a .bat. The first version of this task
REM wrapped the cycle in run_paper_cycle.bat and died mid-run with exit code
REM 0xC000013A (STATUS_CONTROL_C_EXIT) - the cmd.exe console that a batch task
REM creates can receive a control event and take the Python child down with it,
REM leaving a half-finished cycle and a bare '^C' in the log.
schtasks /create /tn "%TASKNAME%" /tr "\"%PYEXE%\" \"%RUNNER%\"" /sc hourly /mo 1 /f /rl LIMITED
if errorlevel 1 (
    echo.
    echo FAILED to create the scheduled task.
    goto :eof
)
echo.
echo Installed "%TASKNAME%" - runs one paper-bot cycle every hour.
echo   run now:    schtasks /run /tn %TASKNAME%
echo   check:      schtasks /query /tn %TASKNAME% /v /fo LIST
echo   log:        data\paper_run.log
echo   remove:     install_scheduler.bat remove
endlocal
