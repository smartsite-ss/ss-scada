@echo off
chcp 65001 >nul
setlocal
REM  InfluxDB one-time initialization: creates org/bucket, writes INFLUXDB_TOKEN to .env
REM  Auto-invoked by _start-services.bat ("auto" = no pause). Manual: init-influxdb.bat [user] [password]
cd /d "%~dp0"
set "SS_NODE=node"
if exist "%~dp0node\node.exe" set "SS_NODE=%~dp0node\node.exe"
where %SS_NODE% >nul 2>nul || if not exist "%SS_NODE%" (
    echo [ERROR] node not found for init-influxdb
    if not "%~1"=="auto" pause
    exit /b 1
)
"%SS_NODE%" "%~dp0init-influxdb.cjs" %*
set "SS_EXIT=%ERRORLEVEL%"
if not "%~1"=="auto" pause
exit /b %SS_EXIT%
