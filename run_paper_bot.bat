@echo off
REM Double-click this to start the bot running detached in the background
REM (no visible window). It keeps running until you reboot or kill it via
REM Task Manager (look for "pythonw.exe"). Logs go to data\paper_run.log.
cd /d "%~dp0"
start "" /B pythonw main.py --mode paper --coins BTC,ETH,SOL --interval 60 --bar-interval 4h > data\paper_run.log 2>&1
echo Started. Check data\paper_run.log for output.
