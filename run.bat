@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set PORT=%1
if "%PORT%"=="" set PORT=8790
set Q=
if /i "%2"=="mock" set Q=?source=mock
if /i "%2"=="live" set Q=?source=live
set PY=python
py -3 --version >nul 2>&1 && set PY=py -3
echo [squad-sniffer] backend :%PORT%  (%PY%)
start "squad-sniffer backend :%PORT%" %PY% backend\proxy.py %PORT%
timeout /t 2 >nul
start "" "http://127.0.0.1:%PORT%/index.html%Q%"
echo 브라우저가 열렸습니다. 종료하려면 "squad-sniffer backend" 콘솔 창을 닫으세요.
echo   사용법: run.bat [포트] [mock^|live]   예) run.bat 8791 mock
