@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

::: ============================================================
:::  Smart Site - Dual Remote Push (GitHub + Gitee sync)
:::
:::  Usage:
:::    push-remote.bat            push current branch to both remotes
:::    push-remote.bat master     push a specific branch to both remotes
:::
:::  Strategy (docs-e/git-fetch-push-策略.md):
:::    1. GitHub (origin) is the source of truth - push it FIRST.
:::    2. Gitee is a mirror - push only AFTER GitHub succeeds.
:::    3. If GitHub fails (e.g. network blocked), Gitee push is
:::       SKIPPED on purpose, to keep both remotes consistent.
::: ============================================================

::: Resolve repo root (bin/..) so the script works from any cwd
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%.." || (echo [FAIL] Cannot resolve repo root & exit /b 1)

::: Branch from arg1, fallback to current checked-out branch
set "BRANCH=%~1"
if "%BRANCH%"=="" (
    for /f "delims=" %%B in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%B"
)

echo ============================================================
echo  Smart Site - Dual Remote Push
echo  Repo   : %cd%
echo  Branch : %BRANCH%
echo ============================================================

::: Guard: branch must exist locally
git rev-parse --verify --quiet "%BRANCH%" >nul 2>&1
if errorlevel 1 (
    echo [FAIL] Branch "%BRANCH%" does not exist locally.
    exit /b 1
)

::: Guard: refuse to push a detached HEAD
if "%BRANCH%"=="HEAD" (
    echo [FAIL] Detached HEAD state - checkout a branch first.
    exit /b 1
)

for /f "delims=" %%C in ('git rev-parse --short HEAD') do set "LOCAL_HEAD=%%C"
echo  Local  : %LOCAL_HEAD% (%BRANCH%)
echo.

echo [1/2] Pushing to GitHub (origin / source of truth) ...
git push origin %BRANCH%
if errorlevel 1 (
    echo.
    echo [FAIL] GitHub push FAILED. Gitee push SKIPPED.
    echo        GitHub is the source of truth - check network/proxy first,
    echo        then re-run this script. Do NOT push Gitee alone.
    exit /b 1
)
echo [ OK ] GitHub updated.

echo.
echo [2/2] Pushing to Gitee (gitee / mirror) ...
git push gitee %BRANCH%
if errorlevel 1 (
    echo.
    echo [FAIL] Gitee push FAILED. GitHub is already updated.
    echo        Retry later with: git push gitee %BRANCH%
    exit /b 1
)
echo [ OK ] Gitee updated.

echo.
echo ============================================================
echo  [DONE] Both remotes synced.
echo  Branch : %BRANCH%  Commit: %LOCAL_HEAD%
echo  GitHub : origin/%BRANCH%
echo  Gitee  : gitee/%BRANCH%
echo ============================================================
exit /b 0
