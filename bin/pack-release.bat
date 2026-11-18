@echo off

REM Copyright (c) 2025 Smart Site Team
REM SPDX-License-Identifier: Apache-2.0
REM https://smartsite.top/
REM Contact: zkxxa@qq.com, zcwebms@gmail.com

chcp 65001 >nul
setlocal

REM ============================================================
REM  Smart Site - release packer with bilingual notes
REM
REM  Stages one version under ss-run\ss-win\release\<tag>\:
REM    app dir + zip + sha256 + RELEASE-NOTES-en.md
REM    + RELEASE-NOTES-zh-CN.md + release-manifest.json
REM
REM  Design: docs-e\publish\Releases发布方案-GitHub与Gitee.md
REM
REM  Usage:
REM    pack-release.bat v7.0.3 --standalone --port=4200
REM    pack-release.bat --tag=v7.0.3 --standalone --no-build
REM    pack-release.bat v7.0.3 --notes-zh=bin\release-notes\v7.0.3.zh-CN.md
REM    pack-release.bat v7.0.3 --skip-pack            (regroup + notes only)
REM
REM  Next step: publish-release.bat --tag=v7.0.3
REM ============================================================

cd /d "%~dp0.."
if errorlevel 1 (
    echo [ERROR] Cannot resolve the repository root.
    exit /b 1
)

set "PACKER=%CD%\bin\pack-release.cjs"
if not exist "%PACKER%" (
    echo [ERROR] packer not found: %PACKER%
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] node not found in PATH.
    exit /b 1
)

if "%~1"=="" (
    echo.
    echo Usage: bin\pack-release.bat vX.Y.Z [publish-smart-site options]
    echo        bin\pack-release.bat --help
    echo.
    node "%PACKER%" --help
    exit /b 1
)

node "%PACKER%" %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo [ERROR] release staging finished with exit code %EXIT_CODE%.
)

exit /b %EXIT_CODE%
