// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { InfluxBucketService } from '../influx-bucket.service';

// ============================================================
// Helpers
// ============================================================

function makeService(): InfluxBucketService {
  const eventBus = { on: jest.fn(), emit: jest.fn() };
  const pathResolver = { resolve: jest.fn((p: string) => p) };
  return new InfluxBucketService(eventBus as any, undefined, pathResolver as any);
}

function makeProjectDirs(root: string, names: string[]): void {
  for (const name of names) {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'projectinfo.json'), JSON.stringify({ projectId: name }));
  }
}

/** Build a fetch mock: `existingBuckets` are reported as present by GET /api/v2/buckets */
function makeFetchMock(existingBuckets: string[], failure?: { status: number }) {
  return jest.fn(async (url: string, init?: any) => {
    const method = (init?.method || 'GET').toUpperCase();
    if (failure) {
      return { ok: false, status: failure.status, json: async () => ({}), text: async () => 'boom' };
    }
    if (url.includes('/api/v2/buckets?')) {
      const name = new URL(url).searchParams.get('name') || '';
      return {
        ok: true,
        status: 200,
        json: async () => ({ buckets: existingBuckets.includes(name) ? [{ name }] : [] }),
      };
    }
    if (url.includes('/api/v2/orgs')) {
      return { ok: true, status: 200, json: async () => ({ orgs: [{ id: 'org-1' }] }) };
    }
    if (url.includes('/api/v2/buckets') && method === 'POST') {
      return { ok: true, status: 201, json: async () => ({}), text: async () => '' };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' };
  });
}

function createdBucketNames(fetchMock: jest.Mock): string[] {
  return fetchMock.mock.calls
    .filter(([url, init]) => String(url).includes('/api/v2/buckets') && init?.method === 'POST')
    .map(([, init]) => JSON.parse(init.body).name);
}

// ============================================================
// Test suite
// ============================================================

describe('InfluxBucketService startup provisioning', () => {
  let tempDir: string;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'influx-bucket-test-'));
    process.env.INFLUXDB_TOKEN = 'test-token';
    process.env.INFLUXDB_URL = 'http://influx.test:8086';
    process.env.INFLUXDB_ORG = 'ss-org';
    process.env.INFLUXDB_BUCKET = 'ss_node_data';
    process.env.PROJECTS_DIR = tempDir;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.INFLUXDB_TOKEN;
    delete process.env.INFLUXDB_URL;
    delete process.env.INFLUXDB_ORG;
    delete process.env.INFLUXDB_BUCKET;
    delete process.env.PROJECTS_DIR;
    global.fetch = undefined as any;
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('Should create a bucket only for projects whose bucket is missing', async () => {
    makeProjectDirs(tempDir, ['proj-a', 'proj-b']);
    fs.mkdirSync(path.join(tempDir, 'not-a-project'), { recursive: true });
    const fetchMock = makeFetchMock(['ss_node_data_proj-a']);
    global.fetch = fetchMock as any;

    const summary = await makeService().ensureBucketsForAllProjects();

    expect(summary.total).toBe(2);
    expect(summary.ready).toBe(2);
    expect(summary.failed).toBe(0);
    // Existing bucket must not be created again
    expect(createdBucketNames(fetchMock)).toEqual(['ss_node_data_proj-b']);
  });

  it('Should be idempotent: a second startup pass performs no HTTP requests', async () => {
    makeProjectDirs(tempDir, ['proj-a']);
    const fetchMock = makeFetchMock([]);
    global.fetch = fetchMock as any;

    const service = makeService();
    await service.ensureBucketsForAllProjects();
    const callsAfterFirstRun = fetchMock.mock.calls.length;

    const summary = await service.ensureBucketsForAllProjects();

    expect(summary.ready).toBe(1);
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirstRun);
    expect(createdBucketNames(fetchMock)).toEqual(['ss_node_data_proj-a']);
  });

  it('Should skip provisioning entirely when INFLUXDB_TOKEN is missing', async () => {
    makeProjectDirs(tempDir, ['proj-a']);
    delete process.env.INFLUXDB_TOKEN;
    const fetchMock = makeFetchMock([]);
    global.fetch = fetchMock as any;

    const summary = await makeService().ensureBucketsForAllProjects();

    expect(summary).toEqual({ total: 0, ready: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Should tolerate a missing projects directory', async () => {
    process.env.PROJECTS_DIR = path.join(tempDir, 'does-not-exist');
    const fetchMock = makeFetchMock([]);
    global.fetch = fetchMock as any;

    const summary = await makeService().ensureBucketsForAllProjects();

    expect(summary).toEqual({ total: 0, ready: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Should count failures and stop calling a dead backend', async () => {
    makeProjectDirs(tempDir, ['proj-a', 'proj-b']);
    const fetchMock = makeFetchMock([], { status: 503 });
    global.fetch = fetchMock as any;

    const summary = await makeService().ensureBucketsForAllProjects();

    expect(summary.ready).toBe(0);
    expect(summary.failed).toBe(2);
    // After the first failure influxAvailable=false stops further attempts
    const bucketLookups = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/api/v2/buckets?'),
    );
    expect(bucketLookups).toHaveLength(1);
  });

  it('Should not throw when the startup hook runs (errors are swallowed)', async () => {
    makeProjectDirs(tempDir, ['proj-a']);
    global.fetch = makeFetchMock([]) as any;
    const service = makeService();

    expect(() => service.onApplicationBootstrap()).not.toThrow();
    await Promise.resolve();
  });
});
