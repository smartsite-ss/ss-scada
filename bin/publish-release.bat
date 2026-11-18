@echo off

REM Copyright (c) 2025 Smart Site Team
REM SPDX-License-Identifier: Apache-2.0
REM https://smartsite.top/
REM Contact: zkxxa@qq.com, zcwebms@gmail.com

chcp 65001 >nul
setlocal

REM ============================================================
REM  Smart Site - Release uploader (GitHub + Gitee)
REM
REM  Uploads the packages produced by publish-smart-site.bat to
REM  both release pages:
REM      https://github.com/smartsite-ss/ss-scada/releases
REM      https://gitee.com/stuhu/ss-scada/releases
REM
REM  Plan / design: docs-e\publish\Releases发布方案-GitHub与Gitee.md
REM
REM  Credentials (never committed):
REM      bin\release.local.env
REM          GITHUB_TOKEN=...
REM          GITEE_TOKEN=...
REM
REM  Usage:
REM    publish-release.bat --tag=v7.0.3 --dry-run     Preview the upload plan
REM    publish-release.bat --tag=v7.0.3               Upload to GitHub + Gitee
REM    publish-release.bat --tag=v7.0.3 --only-gitee  Gitee only
REM    publish-release.bat --self-check               Validate tag/assets/tokens
REM    publish-release.bat --help                     All options
REM
REM  Typical sequence:
REM    1) publish-smart-site.bat --zip ...            (build + zip + sha256)
REM    2) publish-release.bat --tag=v7.0.3 --dry-run  (check what will be uploaded)
REM    3) publish-release.bat --tag=v7.0.3            (publish)
REM ============================================================

cd /d "%~dp0.."
if errorlevel 1 (
    echo [ERROR] Cannot resolve the repository root.
    exit /b 1
)

set "UPLOADER=%CD%\bin\publish-release.cjs"
if not exist "%UPLOADER%" (
    echo [ERROR] uploader not found: %UPLOADER%
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] node not found in PATH.
    exit /b 1
)

if "%~1"=="" (
    echo.
    echo Usage: bin\publish-release.bat --tag=vX.Y.Z [--dry-run] [--only-gitee] ...
    echo        bin\publish-release.bat --help
    echo.
    node "%UPLOADER%" --help
    exit /b 1
)

node "%UPLOADER%" %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo [ERROR] release upload finished with exit code %EXIT_CODE%.
)

exit /b %EXIT_CODE%
