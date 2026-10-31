@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:::: ============================================================
::::  Smart Site - Dual Remote Push (GitHub + Gitee sync)
::
::  Usage:
::    push-remote.bat            push current branch to both remotes
::    push-remote.bat master     push a specific branch to both remotes
::
::  Strategy (revised 2026-10-31):
::    1. GitHub (origin) is the source of truth - push it FIRST.
::    2. Gitee (gitee) is a mirror - ALWAYS attempted, even when
::       GitHub fails. GitHub is often unreachable from CN networks
::       (443 reset/timeout); skipping Gitee used to leave BOTH
::       remotes stale. Gitee-first-sync keeps at least one remote
::       up to date; GitHub catches up on the next run.
::    3. Large-binary guard: never commit files under
::       ss-run/ss/base_services/ or ss-run/ss-win/ (gitignored).
::       A single commit with ~150MB of binaries makes every push
::       fail ("git too large").
:: ============================================================

:::: Resolve repo root (bin/..) so the script works from any cwd
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%.." || (echo [FAIL] Cannot resolve repo root & exit /b 1)

:::: Branch from arg1, fallback to current checked-out branch
set "BRANCH=%~1"
if "%BRANCH%"=="" (
    for /f "delims=" %%B in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%B"
)

echo ============================================================
echo  Smart Site - Dual Remote Push
echo  Repo   : %cd%
echo  Branch : %BRANCH%
echo ============================================================

:::: Guard: branch must exist locally
git rev-parse --verify --quiet "%BRANCH%" >nul 2>&1
if errorlevel 1 (
    echo [FAIL] Branch "%BRANCH%" does not exist locally.
    exit /b 1
)

:::: Guard: refuse to push a detached HEAD
if "%BRANCH%"=="HEAD" (
    echo [FAIL] Detached HEAD state - checkout a branch first.
    exit /b 1
)

:::: Guard: refuse to push when the outgoing pack is huge (>50MB)
:::: (almost always means binaries were committed by mistake)
set "OUT_SIZE=0"
for /f "delims=" %%S in ('git rev-list --objects %BRANCH% --not --remotes^=origin 2^>nul ^| git cat-file --batch-check^="%%(objecttype) %%^(objectsize%%) %%^(objectname%%)" 2^>nul ^| findstr /b "blob " ') do (
    for /f "tokens=2" %%Z in ("%%S") do set /a OUT_SIZE+=%%Z/1024 2>nul
)
if %OUT_SIZE% GTR 51200 (
    echo [FAIL] Outgoing blobs total about %OUT_SIZE% KB ^(^>50MB^).
    echo        Large binaries detected - remove them from the commits
    echo        ^(gitignore + git reset --soft^) before pushing.
    exit /b 1
)

for /f "delims=" %%C in ('git rev-parse --short HEAD') do set "LOCAL_HEAD=%%C"
echo  Local  : %LOCAL_HEAD% (%BRANCH%)
echo.

set "GH_OK=0"
set "GE_OK=0"

echo [1/2] Pushing to GitHub (origin / source of truth) ...
git push origin %BRANCH%
if not errorlevel 1 (
    set "GH_OK=1"
    echo [ OK ] GitHub updated.
) else (
    echo.
    echo [WARN] GitHub push FAILED (network/443). Continuing with Gitee.
)

echo.
echo [2/2] Pushing to Gitee (gitee / mirror) ...
git push gitee %BRANCH%
if not errorlevel 1 (
    set "GE_OK=1"
    echo [ OK ] Gitee updated.
) else (
    echo [FAIL] Gitee push FAILED. Retry later with: git push gitee %BRANCH%
)

echo.
echo ============================================================
if "!GH_OK!"=="1" if "!GE_OK!"=="1" (
    echo  [DONE] Both remotes synced.
) else if "!GE_OK!"=="1" (
    echo  [PARTIAL] Gitee synced. GitHub unreachable - retry later:
    echo            git push origin %BRANCH%
) else if "!GH_OK!"=="1" (
    echo  [PARTIAL] GitHub synced. Gitee failed - retry later:
    echo            git push gitee %BRANCH%
) else (
    echo  [FAIL] Both remotes unreachable. Check network/proxy.
)
echo  Branch : %BRANCH%  Commit: %LOCAL_HEAD%
echo  GitHub : origin/%BRANCH%
echo  Gitee  : gitee/%BRANCH%
echo ============================================================
if "!GH_OK!"=="0" if "!GE_OK!"=="0" exit /b 1
exit /b 0
