// Single-instance guard for the shared data directory.
//
// Why: the dev backend (`pnpm start:dev`, port 4000) and a packaged instance
// (e.g. ss-run/ss-win/04-win-node, port 4200) both point DATA_DIR at the same
// folder by design. Two processes running TypeORM migrations / CREATE TABLE on the
// same SQLite file leave duplicated `sqlite_master` entries, and the next open fails
// with "SQLITE_CORRUPT: malformed database schema (<table>) - table already exists".
// Refusing to start a second instance turns that silent data damage into an
// explicit, actionable error.

import * as fs from 'fs';
import * as path from 'path';

const LOCK_FILE_NAME = '.ss-instance.lock';

interface InstanceLockInfo {
  processId: number;
  startedAt: string;
  workingDirectory: string;
  entry: string;
}

function isProcessAlive(processId: number): boolean {
  if (!Number.isInteger(processId) || processId <= 0) return false;
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readLockInfo(lockPath: string): InstanceLockInfo | null {
  try {
    const raw = fs.readFileSync(lockPath, 'utf8');
    const parsed = JSON.parse(raw) as InstanceLockInfo;
    return typeof parsed.processId === 'number' ? parsed : null;
  } catch (error) {
    return null;
  }
}

/**
 * Claims the data directory for the current process.
 * Throws when another live process already owns it.
 *
 * @param dataDirectory - DATA_DIR value; relative paths are resolved against
 *   `baseDirectory` (the workspace/package root) exactly like TypeORM resolves
 *   DATABASE_PATH, so the lock always lands on the directory actually in use.
 * @param baseDirectory - defaults to process.cwd()
 */
export function acquireInstanceLock(dataDirectory: string, baseDirectory?: string): void {
  const resolvedDirectory = path.resolve(baseDirectory || process.cwd(), dataDirectory);
  const lockPath = path.join(resolvedDirectory, LOCK_FILE_NAME);

  if (!fs.existsSync(resolvedDirectory)) {
    fs.mkdirSync(resolvedDirectory, { recursive: true });
  }

  const existing = fs.existsSync(lockPath) ? readLockInfo(lockPath) : null;
  if (existing && existing.processId !== process.pid && isProcessAlive(existing.processId)) {
    throw new Error(
      `数据目录已被另一个实例占用：\n` +
        `  目录    : ${resolvedDirectory}\n` +
        `  进程    : PID ${existing.processId}（启动于 ${existing.startedAt}）\n` +
        `  入口    : ${existing.entry}\n` +
        `  工作目录: ${existing.workingDirectory}\n` +
        `同一数据目录只允许一个后端实例运行（并发建表会损坏 SQLite 库）。\n` +
        `请先停止该实例（bin 目录下的 stop / kill 脚本）后重试。`,
    );
  }

  const lockInfo: InstanceLockInfo = {
    processId: process.pid,
    startedAt: new Date().toISOString(),
    workingDirectory: process.cwd(),
    entry: process.argv.slice(1).join(' ') || 'unknown',
  };
  fs.writeFileSync(lockPath, JSON.stringify(lockInfo, null, 2), 'utf8');

  const release = (): void => {
    try {
      const current = readLockInfo(lockPath);
      if (current && current.processId === process.pid) {
        fs.rmSync(lockPath, { force: true });
      }
    } catch (error) {
      // Releasing the lock must never break shutdown.
    }
  };

  process.once('exit', release);
  process.once('SIGINT', () => {
    release();
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    release();
    process.exit(0);
  });
}
