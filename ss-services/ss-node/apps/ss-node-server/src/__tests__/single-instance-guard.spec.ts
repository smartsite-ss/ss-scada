import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { acquireInstanceLock } from '../utils/single-instance-guard';

describe('acquireInstanceLock', () => {
  let dataDirectory: string;

  beforeEach(() => {
    dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-instance-lock-'));
  });

  afterEach(() => {
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  });

  it('creates a lock file for the current process', () => {
    acquireInstanceLock(dataDirectory);

    const lockPath = path.join(dataDirectory, '.ss-instance.lock');
    expect(fs.existsSync(lockPath)).toBe(true);
    const lockInfo = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    expect(lockInfo.processId).toBe(process.pid);
  });

  it('resolves a relative data directory against the given base directory', () => {
    acquireInstanceLock('nested/data', dataDirectory);

    expect(fs.existsSync(path.join(dataDirectory, 'nested', 'data', '.ss-instance.lock'))).toBe(
      true,
    );
  });

  it('rejects a data directory owned by a live process', () => {
    const lockPath = path.join(dataDirectory, '.ss-instance.lock');
    // The parent process is guaranteed to be alive and is never the current process
    // (hard-coded PIDs such as 1 do not exist on Windows and would look stale).
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        processId: process.ppid,
        startedAt: new Date().toISOString(),
        workingDirectory: 'other-instance',
        entry: 'dist/main.js',
      }),
      'utf8',
    );

    expect(() => acquireInstanceLock(dataDirectory)).toThrow(/数据目录已被另一个实例占用/);
  });

  it('takes over a stale lock left by a dead process', () => {
    const lockPath = path.join(dataDirectory, '.ss-instance.lock');
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        processId: 2147483646,
        startedAt: new Date().toISOString(),
        workingDirectory: 'dead-instance',
        entry: 'dist/main.js',
      }),
      'utf8',
    );

    expect(() => acquireInstanceLock(dataDirectory)).not.toThrow();
    const lockInfo = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    expect(lockInfo.processId).toBe(process.pid);
  });

  it('replaces an unreadable lock file', () => {
    const lockPath = path.join(dataDirectory, '.ss-instance.lock');
    fs.writeFileSync(lockPath, 'not-json', 'utf8');

    expect(() => acquireInstanceLock(dataDirectory)).not.toThrow();
    const lockInfo = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    expect(lockInfo.processId).toBe(process.pid);
  });
});
