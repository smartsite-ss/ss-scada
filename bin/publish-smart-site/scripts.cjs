// bin/publish-smart-site/scripts.cjs — 生成器：start/stop/status/self-test/service 等 .bat（UTF-8 BOM + CRLF）
// 由 bin/publish-smart-site.cjs 拆分而来（v7 模块布局）；共享状态经 ctx 注入。

'use strict';

module.exports = function make(ctx) {
  const { ROOT, fs, path, cp, os, opt,
    C,
    info,
    writeBat,
    LAUNCHER_SOURCE,
    LAUNCHER_BUILD_SCRIPT,
    SS_NODE,
    run } = ctx;

  // ─────────────────────────── 实现 ───────────────────────────

/**
 * start.bat：一键启动。
 *
 * 顺序：校验产物 → （Standard 档）拉起包内 redis/influxd 并等待端口就绪 → 前台启动后端
 * （后端托管前端 SPA ⇒ Web + API + WS 同端口）。
 *
 * 注：不依赖 `AUTO_START_BASE_SERVICES`（该键目前无消费方，见文件头 6)）；
 *     优先使用包内 node\node.exe（若随包带入），否则用 PATH 中的 node。
 */
function writeStartBat(pkg, fileName = 'start.bat') {
  const port = pkg.port;
  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal',
    'REM ============================================================',
    'REM  Smart Site - single-process launcher (S1, no Nginx)',
    `REM  Port: ${port}   Web+API: http://localhost:${port}/`,
    `REM  Mode: ${pkg.mode}   Tier: ${pkg.tier}   Self-contained: ${pkg.internalPaths ? 'yes' : 'no'}`,
    'REM ============================================================',
    'set "NODE_ENV=production"',
    'set "UV_THREADPOOL_SIZE=8"',
    'cd /d "%~dp0"',
    '',
    'if not exist "dist\\main.js" (',
    '    echo [ERROR] dist\\main.js not found. Re-run publish-smart-site.bat',
    '    pause',
    '    exit /b 1',
    ')',
    'if not exist "node_modules" (',
    '    echo [ERROR] node_modules not found. Re-run publish-smart-site.bat',
    '    pause',
    '    exit /b 1',
    ')',
    'if not exist ".env" (',
    '    echo [ERROR] .env not found. Re-run publish-smart-site.bat',
    '    pause',
    '    exit /b 1',
    ')',
    'if not exist "web\\index.html" (',
    '    echo [ERROR] web\\index.html not found - WEB_DIST_DIR hosting needs it. Re-run publish-smart-site.bat',
    '    pause',
    '    exit /b 1',
    ')',
    '',
    'REM ---- node binary: prefer the one bundled in node\\ ----',
    'set "SS_NODE=node"',
    'if exist "%~dp0node\\node.exe" set "SS_NODE=%~dp0node\\node.exe"',
  ];

  if (pkg.withServices) {
    writeStartServicesBat(pkg);
    // InfluxDB 一次性初始化（幂等）：setup 创建 org/bucket 并把 token 写回 .env（v7 同款模板）
    const tplDir = path.join(__dirname, 'templates');
    for (const f of ['init-influxdb.bat', 'init-influxdb.cjs']) {
      const src = path.join(tplDir, f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(pkg.dir, f));
      else info(C.warn(`! 缺少模板 ${f}，InfluxDB 初始化脚本未生成`));
    }
    lines.push(
      '',
      'REM ---- bundled base services (redis :6379 / influxdb :8086 / nanomq :1883) ----',
      'if exist "%~dp0_start-services.bat" call "%~dp0_start-services.bat"',
      'REM ---- one-time InfluxDB initialization (skipped automatically when already initialized) ----',
      'if exist "%~dp0init-influxdb.bat" call "%~dp0init-influxdb.bat" auto',
    );
  }

  lines.push(
    '',
    'echo ============================================================',
    'echo   Smart Site (single-process, no Nginx)',
    'echo ============================================================',
    `echo   Web / API : http://localhost:${port}/`,
    `echo   Health    : http://localhost:${port}/api/v1/system/health`,
    pkg.internalPaths
      ? 'echo   Data dir  : .\\data   (bundled with this package)'
      : 'echo   Data dir  : ..\\data   (shared, do NOT run together with :4000)',
    pkg.withServices
      ? 'echo   Services  : bundled (redis :6379 / influxdb :8086)'
      : `echo   Services  : external / tier=${pkg.tier}`,
    'echo ============================================================',
    'echo.',
    '"%SS_NODE%" --version',
    'echo.',
    'REM pass the ABSOLUTE entry path: stop.bat matches processes by command line containing this package root',
    '"%SS_NODE%" "%~dp0dist\\main.js"',
    'echo.',
    'echo [EXIT] service stopped',
    'pause',
    '',
  );
  writeBat(path.join(pkg.dir, fileName), lines);
}

/**
 * start.bat（--exe 形态）：一键启动 = 调用薄启动器 SmartSite.exe。
 *
 * 与 node 形态的差别只有一处：**入口换成 exe**（无控制台窗口，日志落 data/logs/launcher.log）。
 * 基础服务仍由启动器自己调用 _start-services.bat 拉起，后端行为与 node 形态完全一致。
 * 排障时可改用 start-node.bat（保留可见日志的经典 node 启动方式）。
 */
function writeStartBatExeLauncher(pkg) {
  const port = pkg.port;
  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal',
    'REM ============================================================',
    'REM  Smart Site - mode 5 thin exe launcher (plan A, zero backend changes)',
    `REM  Port: ${port}   Web+API: http://localhost:${port}/`,
    `REM  Mode: ${pkg.mode}   Tier: ${pkg.tier}   Launcher: exe`,
    'REM  SmartSite.exe only hides the console and starts node\\node.exe with',
    'REM  dist\\main.js. Troubleshooting with visible logs: start-node.bat',
    'REM ============================================================',
    'cd /d "%~dp0"',
    '',
    'if not exist "SmartSite.exe" (',
    '    echo [ERROR] SmartSite.exe not found. Re-run publish-smart-site.bat',
    '    pause',
    '    exit /b 1',
    ')',
    'if not exist "dist\\main.js" (',
    '    echo [ERROR] dist\\main.js not found. Re-run publish-smart-site.bat',
    '    pause',
    '    exit /b 1',
    ')',
    'if not exist "node\\node.exe" (',
    '    echo [ERROR] node\\node.exe not found - the thin launcher does not embed a Node runtime.',
    '    echo         Re-run publish-smart-site.bat with --with-node --exe',
    '    pause',
    '    exit /b 1',
    ')',
    '',
    'echo ============================================================',
    'echo   Smart Site (single-process, no Nginx, thin exe launcher)',
    'echo ============================================================',
    `echo   Web / API : http://localhost:${port}/`,
    `echo   Health    : http://localhost:${port}/api/v1/system/health`,
    'echo   Logs      : .\\data\\logs\\launcher.log',
    'echo ============================================================',
    'echo.',
    '',
    'REM detach so this cmd window closes immediately; the launcher keeps running',
    'start "" "%~dp0SmartSite.exe"',
    'exit /b 0',
    '',
  ];
  writeBat(path.join(pkg.dir, 'start.bat'), lines);
}

/**
 * 编译薄启动器（--exe）：调用 bin\build-launcher-exe.ps1，把 SmartSite.exe 放进包根。
 *
 * 不自行内联 csc 命令，保证「命令行编译」与「打包编译」走**同一份参数**（避免两处漂移）。
 */
function writeLauncherExe(pkg) {
  if (!fs.existsSync(LAUNCHER_BUILD_SCRIPT)) {
    console.error(`[ERROR] 薄启动器编译脚本缺失：${LAUNCHER_BUILD_SCRIPT}`);
    process.exit(1);
  }
  if (!fs.existsSync(LAUNCHER_SOURCE)) {
    console.error(`[ERROR] 薄启动器源码缺失：${LAUNCHER_SOURCE}`);
    process.exit(1);
  }

  const outputPath = path.join(pkg.dir, 'SmartSite.exe');
  const r = cp.spawnSync(
    'powershell',
    ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-File', LAUNCHER_BUILD_SCRIPT, '-OutputPath', outputPath],
    { stdio: 'inherit', cwd: ROOT },
  );
  if (r.status !== 0 || !fs.existsSync(outputPath)) {
    console.error('[ERROR] 薄启动器编译失败（见上方 csc 输出）');
    process.exit(1);
  }
  info(`SmartSite.exe 已生成（薄启动器，${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB）`);
}

/**
 * _start-services.bat：按 `.env` 档位拉起**包内**基础服务（start.bat 与 service-run.bat 共用）。
 *
 * - `REDIS_HOST=localhost` → 起 base_services\redis\redis-server.exe（cwd 必须是 redis 目录：redis.conf 用 `dir ./`）
 * - `HISTORICAL_DATA_BACKEND=influxdb` → 起 base_services\influxdb2-2.7.8\influxd.exe（其 config.yaml 用相对 exe 的 ../../rtdb）
 * - 端口已在监听则跳过（避免与外部/已有实例冲突）
 * - 注：不依赖 `AUTO_START_BASE_SERVICES`（该键无消费方，见文件头 6)）
 */
function writeStartServicesBat(pkg) {
  const lines = [
    '@echo off',
    'REM  Started by start.bat / service-run.bat - do not run directly',
    'setlocal',
    'cd /d "%~dp0"',
    '',
    'if not exist "base_services\\redis\\redis-server.exe" goto :ss_skip_redis',
    'findstr /r /c:"^REDIS_HOST=localhost" ".env" >nul 2>&1',
    'if errorlevel 1 goto :ss_skip_redis',
    'netstat -ano | findstr ":6379 " | findstr LISTENING >nul 2>&1',
    'if not errorlevel 1 goto :ss_skip_redis',
    'echo [INFO] starting Redis (:6379) from base_services\\redis ...',
    'pushd "base_services\\redis"',
    'start "ss-redis" /min redis-server.exe redis.conf',
    'popd',
    'call :ss_wait_port 6379 30',
    ':ss_skip_redis',
    '',
    'if not exist "base_services\\influxdb2-2.7.8\\influxd.exe" goto :ss_skip_influx',
    'findstr /r /c:"^HISTORICAL_DATA_BACKEND=influxdb" ".env" >nul 2>&1',
    'if errorlevel 1 goto :ss_skip_influx',
    'netstat -ano | findstr ":8086 " | findstr LISTENING >nul 2>&1',
    'if not errorlevel 1 goto :ss_skip_influx',
    'echo [INFO] starting InfluxDB (:8086) from base_services\\influxdb2-2.7.8 ...',
    'pushd "base_services\\influxdb2-2.7.8"',
    'start "ss-influxd" /min influxd.exe',
    'popd',
    'call :ss_wait_port 8086 60',
    ':ss_skip_influx',
    '',
    'if not exist "base_services\\nanomq\\bin\\nanomq.exe" goto :ss_skip_nanomq',
    'findstr /r /c:"^NANOMQ_PORT=1883" ".env" >nul 2>&1',
    'if errorlevel 1 goto :ss_skip_nanomq',
    'netstat -ano | findstr ":1883 " | findstr LISTENING >nul 2>&1',
    'if not errorlevel 1 goto :ss_skip_nanomq',
    'echo [INFO] starting NanoMQ (:1883) from base_services\\nanomq ...',
    'pushd "base_services\\nanomq\\bin"',
    'start "ss-nanomq" /min nanomq.exe start --conf ..\\config\\nanomq.conf',
    'popd',
    'call :ss_wait_port 1883 30',
    ':ss_skip_nanomq',
    'exit /b 0',
    '',
    'REM ---- helper: wait for a listening port (%%1=port, %%2=max seconds) ----',
    ':ss_wait_port',
    'set /a "SS_WAIT=0"',
    ':ss_wait_port_loop',
    'netstat -ano | findstr ":%~1 " | findstr LISTENING >nul 2>&1',
    'if not errorlevel 1 exit /b 0',
    'set /a "SS_WAIT+=1"',
    'if %SS_WAIT% GEQ %~2 exit /b 0',
    'REM use ping instead of timeout: timeout.exe needs a console (fails under a service/task)',
    'ping -n 2 127.0.0.1 >nul',
    'goto :ss_wait_port_loop',
    '',
  ];
  writeBat(path.join(pkg.dir, '_start-services.bat'), lines);
}

/**
 * self-test.bat / _selftest-run.bat：**目标机**可执行的自检。
 *
 * 就地运行（不是暂存副本）：用 Lite 档覆盖起一次后端 → 探活 health / 首页 / SPA 深路由 →
 * 调 stop.bat 收尾。会写 `data\logs\selftest-stdout.log` 与少量运行期数据，属预期。
 */
function writeSelfTestBat(pkg) {
  const port = pkg.port;
  writeBat(path.join(pkg.dir, '_selftest-run.bat'), [
    '@echo off',
    'chcp 65001 >nul',
    'REM  Launched by self-test.bat - do not run directly',
    'cd /d "%~dp0"',
    'set "NODE_ENV=production"',
    'set "UV_THREADPOOL_SIZE=8"',
    'set "REDIS_HOST="',
    'set "HISTORICAL_DATA_BACKEND=sqlite"',
    'set "SS_NODE=node"',
    'if exist "%~dp0node\\node.exe" set "SS_NODE=%~dp0node\\node.exe"',
    'if not exist "data\\logs" mkdir "data\\logs"',
    '"%SS_NODE%" "%~dp0dist\\main.js" >> "%~dp0data\\logs\\selftest-stdout.log" 2>&1',
    'exit /b %ERRORLEVEL%',
    '',
  ]);

  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal enabledelayedexpansion',
    'REM ============================================================',
    `REM  Self test for the deployed package (port ${port})`,
    'REM  Starts the backend with Lite overrides (no Redis/InfluxDB),',
    'REM  probes health / index / SPA deep route, then stops it again.',
    'REM ============================================================',
    'cd /d "%~dp0"',
    'if not exist "dist\\main.js" (echo [ERROR] dist\\main.js missing & pause & exit /b 1)',
    '',
    `netstat -ano | findstr ":${port} " | findstr LISTENING >nul 2>&1`,
    'if not errorlevel 1 (',
    `    echo [WARN] port ${port} is already listening - run stop.bat first, then retry.`,
    '    pause',
    '    exit /b 2',
    ')',
    '',
    'echo [INFO] starting backend for self test ...',
    'start "ss-selftest" /min cmd /c "%~dp0_selftest-run.bat"',
    '',
    'set "SS_OK=0"',
    'set /a "SS_I=0"',
    ':ss_wait',
    'set /a "SS_I+=1"',
    `for /f "delims=" %%c in ('powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 \'http://127.0.0.1:${port}/api/v1/system/health\').StatusCode } catch { 0 }"') do set "SS_HEALTH=%%c"`,
    'if "!SS_HEALTH!"=="200" goto :ss_ready',
    'if !SS_I! GEQ 90 goto :ss_timeout',
    'REM use ping instead of timeout: timeout.exe needs a console (fails with redirected stdin)',
    'ping -n 3 127.0.0.1 >nul',
    'goto :ss_wait',
    '',
    ':ss_timeout',
    'echo [FAIL] backend did not become healthy in 180s (health=!SS_HEALTH!)',
    'echo        see data\\logs\\selftest-stdout.log',
    'goto :ss_stop',
    '',
    ':ss_ready',
    `for /f "delims=" %%c in ('powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 6 \'http://127.0.0.1:${port}/\').StatusCode } catch { 0 }"') do set "SS_INDEX=%%c"`,
    `for /f "delims=" %%c in ('powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 6 \'http://127.0.0.1:${port}/system/device\').StatusCode } catch { 0 }"') do set "SS_SPA=%%c"`,
    'echo [OK]   health     = !SS_HEALTH!  (waited !SS_I! s)',
    'echo [OK]   index      = !SS_INDEX!',
    'echo [OK]   SPA route  = !SS_SPA!',
    'if "!SS_INDEX!"=="200" if "!SS_SPA!"=="200" set "SS_OK=1"',
    '',
    ':ss_stop',
    'echo [INFO] stopping test instance ...',
    'call "%~dp0stop.bat"',
    'echo.',
    'if "!SS_OK!"=="1" (',
    '    echo ============================================================',
    '    echo   SELF TEST PASSED',
    '    echo ============================================================',
    ') else (',
    '    echo ============================================================',
    '    echo   SELF TEST FAILED - see data\\logs\\selftest-stdout.log',
    '    echo ============================================================',
    ')',
    'pause',
    '',
  ];
  writeBat(path.join(pkg.dir, 'self-test.bat'), lines);
}

/** service-run.bat：后台运行器（Windows 服务 / 计划任务调用；先拉基础服务再前台跑后端） */
function writeServiceRunBat(pkg) {
  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal',
    'REM  Background runner for the Windows service / scheduled task (see install-service.bat)',
    'cd /d "%~dp0"',
    'set "NODE_ENV=production"',
    'set "UV_THREADPOOL_SIZE=8"',
    'if not exist "data\\logs" mkdir "data\\logs"',
    'set "SS_NODE=node"',
    'if exist "%~dp0node\\node.exe" set "SS_NODE=%~dp0node\\node.exe"',
  ];
  if (pkg.withServices) {
    lines.push('if exist "%~dp0_start-services.bat" call "%~dp0_start-services.bat"');
  }
  lines.push(
    'REM console output -> data\\logs\\service-stdout.log (winston keeps writing data\\logs too)',
    '"%SS_NODE%" "%~dp0dist\\main.js" >> "%~dp0data\\logs\\service-stdout.log" 2>&1',
    'exit /b %ERRORLEVEL%',
    '',
  );
  writeBat(path.join(pkg.dir, 'service-run.bat'), lines);
}

/**
 * install-service.bat / uninstall-service.bat：注册为开机自启。
 *
 * NSSM 优先（崩溃自动重启 + 日志重定向 + 轮转）；找不到 nssm.exe 时回退到
 * 「计划任务 ONSTART + SYSTEM」——两种方式都**不需要**目标机预装第三方程序。
 */
function writeServiceScripts(pkg) {
  const ssh = `SmartSite-${pkg.port}`;
  const nodeLine = pkg.withNode
    ? 'set "SS_NODE=%~dp0node\\node.exe"'
    : 'set "SS_NODE=node"';
  const install = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal enabledelayedexpansion',
    'REM ============================================================',
    'REM  Register Smart Site as an auto-start Windows service',
    `REM  Service name: ${ssh}   (NSSM preferred, Scheduled Task fallback)`,
    'REM ============================================================',
    'cd /d "%~dp0"',
    `set "SERVICE_NAME=${ssh}"`,
    'set "PKG_DIR=%~dp0"',
    nodeLine,
    'if not exist "%SS_NODE%" (',
    '    echo [ERROR] node not found: %SS_NODE%',
    '    pause',
    '    exit /b 1',
    ')',
    'if not exist "dist\\main.js" (',
    '    echo [ERROR] dist\\main.js not found - run this inside the released package',
    '    pause',
    '    exit /b 1',
    ')',
    '',
    'set "NSSM="',
    'if exist "%~dp0nssm.exe" set "NSSM=%~dp0nssm.exe"',
    'if not defined NSSM for %%I in (nssm.exe) do if not "%%~$PATH:I"=="" set "NSSM=%%~$PATH:I"',
    'if defined NSSM goto :use_nssm',
    '',
    'REM ---- fallback: Scheduled Task (no third-party tool needed) ----',
    'echo [INFO] nssm.exe not found - using a Scheduled Task instead (onstart, SYSTEM).',
    'schtasks /Create /TN "%SERVICE_NAME%" /TR "\\"%PKG_DIR%service-run.bat\\"" /SC ONSTART /RU SYSTEM /RL HIGHEST /F',
    'if errorlevel 1 ( echo [ERROR] schtasks failed & pause & exit /b 1 )',
    'echo [OK] Scheduled task "%SERVICE_NAME%" created (auto-start at boot).',
    'echo      start now : schtasks /Run /TN "%SERVICE_NAME%"',
    'echo      remove    : uninstall-service.bat',
    'echo      logs      : data\\logs\\service-stdout.log',
    'goto :done',
    '',
    ':use_nssm',
    'echo [INFO] using NSSM: %NSSM%',
    '"%NSSM%" install "%SERVICE_NAME%" "%SS_NODE%" "%PKG_DIR%dist\\main.js"',
    '"%NSSM%" set "%SERVICE_NAME%" AppDirectory "%PKG_DIR%"',
    '"%NSSM%" set "%SERVICE_NAME%" AppEnvironmentExtra NODE_ENV=production UV_THREADPOOL_SIZE=8',
    '"%NSSM%" set "%SERVICE_NAME%" AppStdout "%PKG_DIR%data\\logs\\service-stdout.log"',
    '"%NSSM%" set "%SERVICE_NAME%" AppStderr "%PKG_DIR%data\\logs\\service-stderr.log"',
    '"%NSSM%" set "%SERVICE_NAME%" AppRotateFiles 1',
    '"%NSSM%" set "%SERVICE_NAME%" Start SERVICE_AUTO_START',
    '"%NSSM%" start "%SERVICE_NAME%"',
    'echo [OK] Windows service "%SERVICE_NAME%" installed and started.',
    '',
    ':done',
    'REM NOTE: bundled redis/influxd are started by service-run.bat (and by start.bat).',
    'pause',
    '',
  ];
  writeBat(path.join(pkg.dir, 'install-service.bat'), install);

  const uninstall = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal',
    `REM  Remove the "${ssh}" service / scheduled task`,
    'cd /d "%~dp0"',
    `set "SERVICE_NAME=${ssh}"`,
    'set "NSSM="',
    'if exist "%~dp0nssm.exe" set "NSSM=%~dp0nssm.exe"',
    'if not defined NSSM for %%I in (nssm.exe) do if not "%%~$PATH:I"=="" set "NSSM=%%~$PATH:I"',
    'if defined NSSM goto :use_nssm',
    'schtasks /End /TN "%SERVICE_NAME%" 2>nul',
    'schtasks /Delete /TN "%SERVICE_NAME%" /F',
    'echo [INFO] scheduled task removed (if it existed).',
    'goto :done',
    '',
    ':use_nssm',
    '"%NSSM%" stop "%SERVICE_NAME%"',
    '"%NSSM%" remove "%SERVICE_NAME%" confirm',
    'echo [INFO] Windows service removed.',
    '',
    ':done',
    'echo [INFO] leftover processes (if any) can be stopped with stop.bat',
    'pause',
    '',
  ];
  writeBat(path.join(pkg.dir, 'uninstall-service.bat'), uninstall);
}

/** stop.bat：只停「本包」的 node/redis/influxd（按可执行文件所在目录匹配，避免误杀其它实例） */
function writeStopBat(pkg) {
  const names = pkg.withServices
    ? "@('node.exe','redis-server.exe','influxd.exe','nanomq.exe')"
    : "@('node.exe')";
  const psCmd = [
    "$root='%~dp0';",
    `$names=${names};`,
    '$p=Get-CimInstance Win32_Process | Where-Object { $names -contains $_.Name -and (($_.Name -eq \'node.exe\' -and $_.CommandLine -like (\'*\'+$root+\'*\')) -or ($_.Name -ne \'node.exe\' -and $_.ExecutablePath -like ($root+\'*\'))) };',
    "if ($p) { $p | ForEach-Object { Write-Host ('[OK] kill ' + $_.Name + ' PID ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force } } else { Write-Host '[INFO] no smart-site process found' }",
  ].join(' ');
  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal',
    'REM  Stop processes owned by THIS package only (matched by executable/image path)',
    'cd /d "%~dp0"',
    'echo [INFO] Stopping smart-site processes ...',
    `powershell -NoProfile -Command "${psCmd}"`,
    'echo [INFO] done.',
    'echo [INFO] NOTE: SQLite WAL is crash-safe; next start will replay/checkpoint it.',
    'endlocal',
    '',
  ];
  writeBat(path.join(pkg.dir, 'stop.bat'), lines);
}

function writeStatusBat(pkg) {
  const port = pkg.port;
  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal',
    `REM  Status of smart-site (port ${port})`,
    'cd /d "%~dp0"',
    'echo ============================================================',
    'echo   Smart Site status',
    'echo ============================================================',
    'echo [1] processes owned by this package:',
    `powershell -NoProfile -Command "$root='%~dp0'; $names=@('node.exe'${pkg.withServices ? ",'redis-server.exe','influxd.exe','nanomq.exe'" : ''}); Get-CimInstance Win32_Process | Where-Object { $names -contains $_.Name -and (($_.Name -eq 'node.exe' -and $_.CommandLine -like ('*'+$root+'*')) -or ($_.Name -ne 'node.exe' -and $_.ExecutablePath -like ($root+'*'))) } | ForEach-Object { Write-Host ('    PID ' + $_.ProcessId + '  ' + $_.Name) }"`,
    `echo [2] port ${port}:`,
    `netstat -ano | findstr ":${port} " | findstr LISTENING`,
  ];
  if (pkg.withServices) {
    lines.push(
      'echo [2b] base service ports 6379 / 8086 / 1883:',
      'netstat -ano | findstr ":6379 " | findstr LISTENING',
      'netstat -ano | findstr ":8086 " | findstr LISTENING',
      'netstat -ano | findstr ":1883 " | findstr LISTENING',
    );
  }
  lines.push(
    `echo [3] health http://localhost:${port}/api/v1/system/health :`,
    `powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 \'http://localhost:${port}/api/v1/system/health\'; Write-Host (\'    HTTP \' + $r.StatusCode + \' \' + $r.Content) } catch { Write-Host \'    unreachable\' }"`,
    `echo [3b] page http://localhost:${port}/ (SPA hosting) :`,
    `powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 \'http://localhost:${port}/\'; Write-Host (\'    HTTP \' + $r.StatusCode + \'  bytes=\' + $r.RawContentLength) } catch { Write-Host \'    unreachable\' }"`,
    `echo [3c] SPA fallback (deep route) :`,
    `powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 \'http://localhost:${port}/system/device\'; Write-Host (\'    HTTP \' + $r.StatusCode) } catch { Write-Host \'    unreachable\' }"`,
    'echo [4] version:',
    'if exist "VERSION.json" (type VERSION.json) else (echo     VERSION.json missing)',
    'echo.',
    'endlocal',
    '',
  );
  writeBat(path.join(pkg.dir, 'status.bat'), lines);
}

  return {
    writeStartBat,
    writeStartBatExeLauncher,
    writeLauncherExe,
    writeStartServicesBat,
    writeSelfTestBat,
    writeServiceRunBat,
    writeServiceScripts,
    writeStopBat,
    writeStatusBat,
  };
};
