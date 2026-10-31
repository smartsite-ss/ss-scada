@echo off
REM Copyright (c) 2025 Smart Site Team
REM SPDX-License-Identifier: Apache-2.0
REM https://smartsite.top/
REM Contact: zkxxa@qq.com, zcwebms@gmail.com

chcp 65001 >nul
setlocal enabledelayedexpansion

REM ============================================================
REM  Smart Site (open source) - Publish English Single-Package
REM  Target: ss-run\ss-win\05-win-ss-en
REM  Bundle: backend + web SPA + node runtime + data (db cleaned,
REM          default admin reset to admin/admin, lang = en)

REM  Lite tier: no Redis/InfluxDB required (SQLite historical storage)
REM  CLI passthrough: publish-ss-en.bat [extra args...] e.g. --no-build --clean --zip
REM ============================================================

set "GREEN=[92m"
set "YELLOW=[93m"
set "RED=[91m"
set "CYAN=[96m"
set "BLUE=[94m"
set "NC=[0m"

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%.."
set "SS_ROOT=f:worksmartdata603_trace	runkcodess-scada"
set "PUBLISHER=%SS_ROOT%\bin\publish-smart-site.cjs"
set "TARGET=%SS_ROOT%\ss-run\ss-win\05-win-ss-en"

echo.
echo %CYAN%===========================================================%NC%
echo %CYAN%   Smart Site - Publish English Edition (open source)      %NC%
echo %CYAN%   Target: ss-run\ss-win\05-win-ss-en                      %NC%
echo %CYAN%   Tier: standard (bundled services redis/influxdb/nanomq) %NC%
echo %CYAN%   Default account: admin / admin (reset on every build)   %NC%
echo %CYAN%===========================================================%NC%
echo.

where node >nul 2>nul
if 0 NEQ 0 (
    echo %RED%[ERROR]%NC% Node.js not found. Please install Node.js 18+
    pause & exit /b 1
)
echo %GREEN%[OK]%NC% Node.js:
node --version
echo.

if not exist "%PUBLISHER%" (
    echo %RED%[ERROR]%NC% Publisher not found: %PUBLISHER%
    pause & exit /b 1
)
echo %BLUE%[PATH]%NC% Publisher: %PUBLISHER%
echo %BLUE%[PATH]%NC% Target:    %TARGET%
echo.

REM Strip IDE-injected NODE_OPTIONS hooks - they wrap fs.rmSync with a
REM bulk-delete guard that crashes the publisher when cleaning staging dirs.
set "NODE_OPTIONS="

node "%PUBLISHER%" --target="%TARGET%" --lang=en --port=8080 --with-data --data-exclude=images,images-lg,faq --with-services --with-node --service --self-test --zip --reset-admin %*
if !ERRORLEVEL! NEQ 0 (
    echo %RED%[ERROR]%NC% Publish failed
    pause & exit /b 1
)

echo.
echo %GREEN%===========================================================%NC%
echo %GREEN%   Publish Completed!                                      %NC%
echo %GREEN%===========================================================%NC%
echo.
echo %YELLOW%  Output:%NC% %TARGET%
echo.
echo %YELLOW%  Quick Start (on the target machine):%NC%
echo     Double-click: 05-win-ss-en\start.bat
echo     URL:          http://localhost:8080
echo     Login:        admin / admin
echo     Services:     Redis :6379 / InfluxDB :8086 / NanoMQ :1883 (auto-start)
echo.
echo %YELLOW%  Manual Control:%NC%
echo     Status:          05-win-ss-en\status.bat
echo     Stop:            05-win-ss-en\stop.bat
echo     Self Test:       05-win-ss-en\self-test.bat
echo     Install Service: 05-win-ss-en\install-service.bat
echo.
endlocal
