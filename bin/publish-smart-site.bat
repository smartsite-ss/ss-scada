@echo off

REM Copyright (c) 2025 Smart Site Team
REM SPDX-License-Identifier: Apache-2.0
REM https://smartsite.top/
REM Contact: zkxxa@qq.com, zcwebms@gmail.com

chcp 65001 >nul
setlocal enabledelayedexpansion

REM ============================================================
REM  Smart Site - Single Package Publisher (S1 / S5, no Nginx)
REM
REM  Assemble backend + frontend into one folder. Default output:
REM      ss-run\ss-win\04-win-node\   (way 4: start.bat starts node directly)
REM      ss-run\ss-win\05-win-exe\    (way 5: --exe, thin launcher SmartSite.exe)
REM  Both are self-contained forms (DATA_DIR=./data) and may reuse
REM  ss-run\ss\base_services (Redis / InfluxDB) otherwise.
REM
REM  Plan: docs\00-全局\发布\单包发布方案.md
REM         docs\00-全局\发布\后台发布成exe方案.md  (way 5)
REM         ss-run\ss-win\README.md                (per-way staging dirs)
REM
REM  Usage:
REM    publish-smart-site.bat                     Build all + assemble (way 4, port 4200)
REM    publish-smart-site.bat --exe --with-node --standalone
REM                                               Way 5: thin launcher SmartSite.exe
REM                                               (auto output ss-run\ss-win\05-win-exe)
REM    publish-smart-site.bat --launcher=node     Explicit way 4 (default)
REM    publish-smart-site.bat --standalone --port=8080
REM                                               Self-contained Windows package:
REM                                               frontend+backend + data + bundled
REM                                               base services, one-click start.bat
REM    publish-smart-site.bat --with-data         Bundle data/ only (DATA_DIR=./data)
REM    publish-smart-site.bat --with-data --no-user-data
REM                                               Bundle data assets only (no db/projects)
REM    publish-smart-site.bat --with-services     Bundle base_services (redis+influxdb2)
REM    publish-smart-site.bat --with-node --service --zip
REM                                               Bundle node.exe / generate Windows
REM                                               service scripts / produce zip+sha256
REM    publish-smart-site.bat --data-exclude=images,images-lg,projects
REM                                               Slim data (exclude these dirs)
REM    publish-smart-site.bat --tier=lite         Lite tier env (no Redis/InfluxDB)
REM    publish-smart-site.bat --port=4300         Custom port
REM    publish-smart-site.bat --mode=scada        Product mode: full|scada|data
REM    publish-smart-site.bat --no-build          Reuse existing dist (fast)
REM    publish-smart-site.bat --clean             Wipe target dir first
REM    publish-smart-site.bat --link-deps         Junction node_modules (fast, not portable,
REM                                               skips @ss-node/* overlay -> module gate fails)
REM    publish-smart-site.bat --no-web            Backend only
REM    publish-smart-site.bat --no-server         Frontend only
REM
REM  Output (default / self-contained):
REM    <target>\dist  node_modules  i18n  web  .env  [data]  [base_services]  [rtdb]
REM    <target>\start.bat  stop.bat  status.bat  README.md  VERSION.json
REM    way 5 (<target>\SmartSite.exe) adds: SmartSite.exe  start-node.bat
REM
REM  Doc: docs\00-全局\发布\Windows单机发布方案.md
REM ============================================================

cd /d "%~dp0.."
set "PROJECT_ROOT=%CD%"
set "PACKER=%PROJECT_ROOT%\bin\publish-smart-site.cjs"
REM Default target follows the publisher (way 4); --exe switches to ss-run\ss-win\05-win-exe
set "TARGET=%PROJECT_ROOT%\ss-run\ss-win\04-win-node"
set "PKG_LAUNCHER=node"
for %%A in (%*) do (
    if /i "%%~A"=="--exe" set "PKG_LAUNCHER=exe"
    if /i "%%~A"=="--launcher=exe" set "PKG_LAUNCHER=exe"
)
if /i "%PKG_LAUNCHER%"=="exe" (
    set "TARGET=%PROJECT_ROOT%\ss-run\ss-win\05-win-exe"
)

if not exist "%PACKER%" (
    echo [ERROR] packer not found: %PACKER%
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] node not found in PATH.
    exit /b 1
)

node "%PACKER%" %*
set "PKG_EXIT=%ERRORLEVEL%"

if not "%PKG_EXIT%"=="0" (
    echo.
    echo [ERROR] Package failed with exit code %PKG_EXIT%.
    if "%~1"=="" pause
    exit /b %PKG_EXIT%
)

echo.
echo ============================================================
echo  Package ready:
echo    %TARGET%
echo.
if /i "%PKG_LAUNCHER%"=="exe" (
    echo  Run   : %TARGET%\SmartSite.exe   ^(thin launcher, way 5^)
    echo          %TARGET%\start.bat        ^(same, for double-click^)
    echo          %TARGET%\start-node.bat   ^(node form, visible logs^)
) else (
    echo  Run   : %TARGET%\start.bat
)
echo  Status: %TARGET%\status.bat
echo  Stop  : %TARGET%\stop.bat
echo ============================================================
echo.

if "%~1"=="" pause
exit /b 0
