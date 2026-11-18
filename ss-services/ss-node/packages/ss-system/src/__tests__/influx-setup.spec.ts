// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BaseServicesService } from '../base-services/base-services.service';

// ============================================================
// Helpers
// ============================================================

/**
 * Build the service with a temporary project root, so writing the generated token
 * never touches the real .env files of the repository.
 */
function makeService(projectRoot: string = process.cwd()): BaseServicesService {
  const configService = { get: jest.fn().mockReturnValue(undefined), set: jest.fn() };
  const pathResolver = { getProjectRoot: jest.fn().mockReturnValue(projectRoot) };
  return new BaseServicesService(configService as any, {} as any, pathResolver as any);
}

function makeFetchMock(options: { initialized: boolean; token?: string }) {
  return jest.fn(async (url: string, init?: any) => {
    const method = (init?.method || 'GET').toUpperCase();
    if (url.includes('/api/v2/setup') && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ allowed: !options.initialized }) };
    }
    if (url.includes('/api/v2/setup') && method === 'POST') {
      return {
        ok: true,
        status: 201,
        json: async () => ({
          auth: { token: options.token || 'generated-token' },
          org: { name: 'ss-org' },
          bucket: { name: 'ss_node_data' },
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' };
  });
}

function setupRequestBody(fetchMock: jest.Mock): any | undefined {
  const call = fetchMock.mock.calls.find(([url, init]) => {
    return String(url).includes('/api/v2/setup') && init?.method === 'POST';
  });
  return call ? JSON.parse(call[1].body) : undefined;
}

// ============================================================
// Test suite
// ============================================================

describe('BaseServicesService InfluxDB setup', () => {
  let tempDir: string;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'influx-setup-test-'));
    process.env.INFLUXDB_URL = 'http://influx.test:8086';
    process.env.INFLUXDB_ORG = 'ss-org';
    process.env.INFLUXDB_BUCKET = 'ss_node_data';
    delete process.env.INFLUXDB_INIT_PASSWORD;
    delete process.env.INFLUXDB_INIT_USERNAME;
    delete process.env.INFLUXDB_TOKEN;
    delete process.env.APP_PRODUCT_MODE;
    delete process.env.APP_ENV;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.INFLUXDB_URL;
    delete process.env.INFLUXDB_ORG;
    delete process.env.INFLUXDB_BUCKET;
    delete process.env.INFLUXDB_INIT_PASSWORD;
    delete process.env.INFLUXDB_INIT_USERNAME;
    delete process.env.INFLUXDB_TOKEN;
    delete process.env.APP_PRODUCT_MODE;
    delete process.env.APP_ENV;
    global.fetch = undefined as any;
  });

  it('Should use a default password that satisfies the InfluxDB 8-72 char rule', async () => {
    const fetchMock = makeFetchMock({ initialized: false });
    global.fetch = fetchMock as any;

    const result = await makeService(tempDir).setupInfluxDB();

    const body = setupRequestBody(fetchMock);
    expect(result.success).toBe(true);
    expect(body.password.length).toBeGreaterThanOrEqual(8);
    expect(body.password.length).toBeLessThanOrEqual(72);
  });

  it('Should reject a too-short password before calling InfluxDB', async () => {
    process.env.INFLUXDB_INIT_PASSWORD = '123456';
    const fetchMock = makeFetchMock({ initialized: false });
    global.fetch = fetchMock as any;

    const result = await makeService(tempDir).setupInfluxDB();

    expect(result.success).toBe(false);
    expect(result.message).toContain('8-72');
    expect(setupRequestBody(fetchMock)).toBeUndefined();
  });

  it('Should accept an explicitly provided valid password', async () => {
    const fetchMock = makeFetchMock({ initialized: false });
    global.fetch = fetchMock as any;

    const result = await makeService(tempDir).setupInfluxDB({ password: 'CustomPass@2026' });

    expect(result.success).toBe(true);
    expect(setupRequestBody(fetchMock).password).toBe('CustomPass@2026');
  });

  it('Should apply the generated token to the running process immediately', async () => {
    const fetchMock = makeFetchMock({ initialized: false, token: 'fresh-token-abc' });
    global.fetch = fetchMock as any;

    await makeService(tempDir).setupInfluxDB();

    expect(process.env.INFLUXDB_TOKEN).toBe('fresh-token-abc');
  });

  it('Should skip setup when InfluxDB is already initialized', async () => {
    const fetchMock = makeFetchMock({ initialized: true });
    global.fetch = fetchMock as any;

    const result = await makeService(tempDir).setupInfluxDB();

    expect(result.success).toBe(true);
    expect(result.message).toContain('无需重复');
    expect(setupRequestBody(fetchMock)).toBeUndefined();
  });

  it('Should write the token to the env file that wins the load order', async () => {
    process.env.APP_PRODUCT_MODE = 'data';
    fs.writeFileSync(path.join(tempDir, '.env.data'), 'INFLUXDB_TOKEN=stale-token\n');
    fs.writeFileSync(path.join(tempDir, '.env.base'), 'INFLUXDB_TOKEN=base-token\n');
    const fetchMock = makeFetchMock({ initialized: false, token: 'fresh-token-abc' });
    global.fetch = fetchMock as any;

    const result = await makeService(tempDir).setupInfluxDB();

    expect(result.success).toBe(true);
    // .env.data has higher priority than .env.base, so it must carry the new token
    expect(fs.readFileSync(path.join(tempDir, '.env.data'), 'utf-8')).toContain(
      'INFLUXDB_TOKEN=fresh-token-abc',
    );
    // The lower-priority file is left untouched
    expect(fs.readFileSync(path.join(tempDir, '.env.base'), 'utf-8')).toContain(
      'INFLUXDB_TOKEN=base-token',
    );
  });

  it('Should create .env.local when no env file exists yet', async () => {
    const fetchMock = makeFetchMock({ initialized: false, token: 'fresh-token-abc' });
    global.fetch = fetchMock as any;

    await makeService(tempDir).setupInfluxDB();

    const localEnv = path.join(tempDir, '.env.local');
    expect(fs.existsSync(localEnv)).toBe(true);
    expect(fs.readFileSync(localEnv, 'utf-8')).toContain('INFLUXDB_TOKEN=fresh-token-abc');
  });
});
