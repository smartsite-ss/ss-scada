/**
 * InfluxDB one-time initialization (idempotent).
 *  1) GET /api/v2/health; 2) GET /api/v2/setup -> skip if already initialized;
 *  3) POST /api/v2/setup to create org/bucket and fetch the operator token;
 *  4) write the token back to .env as INFLUXDB_TOKEN (backend restart applies it).
 * Usage: node init-influxdb.cjs [username] [password]  (default admin / admin123, password >= 8 chars)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '.env');
function parseEnv() {
  const map = {};
  if (fs.existsSync(ENV_FILE)) {
    for (const raw of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i > 0) map[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return map;
}
const env = parseEnv();
const username = process.argv[2] || 'admin';
const password = process.argv[3] || 'admin123';
const org = env.INFLUXDB_ORG || 'ss-org';
const bucket = env.INFLUXDB_BUCKET || 'ss_node_data';
const host = env.INFLUXDB_HOST || 'localhost';
const port = env.INFLUXDB_PORT || '8086';
const base = 'http://' + host + ':' + port;

function request(method, apiPath, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(base + apiPath, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      timeout: 8000,
    }, (res) => {
      let chunks = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = chunks ? JSON.parse(chunks) : null; } catch (e) { /* keep raw */ }
        resolve({ status: res.statusCode, body: parsed, raw: chunks });
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    if (token) req.setHeader('Authorization', 'Token ' + token);
    if (data) req.write(data);
    req.end();
  });
}

function writeEnvToken(token) {
  const lines = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/) : [];
  let found = false;
  const out = lines.map((l) => {
    if (/^INFLUXDB_TOKEN=/.test(l.trim())) { found = true; return 'INFLUXDB_TOKEN=' + token; }
    return l;
  });
  if (!found) out.push('INFLUXDB_TOKEN=' + token);
  fs.writeFileSync(ENV_FILE, out.join('\r\n'), 'utf8');
}

// ──────── 按项目建 bucket（与 ss-storage-influx influx-bucket.service.ts 同名规则）────────
// 历史数据按项目分桶：bucket 名 = {INFLUXDB_BUCKET}_{safeProjectId}。此处启动时预建，
// 避免首个写入周期 404；后端写入路径仍有兜底自动创建（influx-bucket.service）。
const PROJECTS_DB = path.join(__dirname, 'data', 'db', 'ss-node.db');

function listProjectIds() {
  if (!fs.existsSync(PROJECTS_DB)) return [];
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(PROJECTS_DB, { readOnly: true });
    try {
      const rows = db.prepare('SELECT id FROM projects').all();
      return rows.map((r) => String(r.id));
    } finally {
      db.close();
    }
  } catch (e) {
    console.warn('[WARN] cannot read projects from ' + PROJECTS_DB + ': ' + e.message);
    return [];
  }
}

function bucketNameFor(projectId) {
  const base = env.INFLUXDB_BUCKET || 'ss_node_data';
  return base + '_' + String(projectId).replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function ensureProjectBuckets(token, orgID) {
  const ids = listProjectIds();
  if (!ids.length) {
    console.log('[OK] no projects in global DB yet — per-project buckets will be auto-created on first write');
    return;
  }
  let existing = new Set();
  try {
    const list = await request('GET', '/api/v2/buckets?limit=500', null, token);
    if (list.status === 200 && list.body && Array.isArray(list.body.buckets)) {
      existing = new Set(list.body.buckets.map((b) => b.name));
    }
  } catch (e) { /* 列举失败不阻断，逐个创建时仍会幂等 */ }
  let created = 0;
  let skipped = 0;
  let failed = 0;
  for (const id of ids) {
    const name = bucketNameFor(id);
    if (existing.has(name)) { skipped++; continue; }
    const resp = await request('POST', '/api/v2/buckets', { name: name, orgID: orgID, retentionRules: [] }, token);
    if (resp.status === 201) { created++; console.log('[OK] bucket created: ' + name); }
    else if (resp.status === 422) { skipped++; } // 已存在（并发/重复启动）
    else { failed++; console.warn('[WARN] bucket create failed (' + resp.status + '): ' + name + ' — ' + resp.raw); }
  }
  console.log('[OK] per-project buckets: total=' + ids.length + ' created=' + created + ' skipped=' + skipped + (failed ? ' failed=' + failed : ''));
}

async function resolveOrgID(token) {
  const orgName = env.INFLUXDB_ORG || 'ss-org';
  const r = await request('GET', '/api/v2/orgs', null, token);
  const found = r.body && r.body.orgs && r.body.orgs.find((o) => o.name === orgName);
  return found ? found.id : null;
}

(async () => {
  // NOTE: /api/v2/health may return 401 on some deployments; /api/v2/setup is public and authoritative.
  let health = null;
  try {
    health = await request('GET', '/api/v2/health');
    if (health.body && health.body.status === 'pass') {
      console.log('[OK] InfluxDB health: pass (' + base + ')');
    } else {
      console.warn('[WARN] InfluxDB health not "pass" (HTTP ' + health.status + ') - continuing with /api/v2/setup');
    }
  } catch (e) {
    console.error('[FAIL] InfluxDB not reachable at ' + base + ' (' + e.message + '). Start it first (start.bat).');
    process.exit(1);
  }
  let setup;
  try {
    setup = await request('GET', '/api/v2/setup');
  } catch (e) {
    console.error('[FAIL] cannot query ' + base + '/api/v2/setup: ' + e.message);
    process.exit(1);
  }
  if (setup.body && setup.body.allowed === false) {
    const existingToken = env.INFLUXDB_TOKEN;
    if (existingToken) {
      let probe = null;
      try { probe = await request('GET', '/api/v2/orgs', null, existingToken); } catch (e) { probe = null; }
      if (probe && probe.status === 200) {
      console.log('[OK] InfluxDB already initialized and INFLUXDB_TOKEN is valid.');
      // 已初始化：仍按项目补建 bucket（幂等，覆盖打包后新创建的项目）
      try {
        const orgID = await resolveOrgID(existingToken);
        if (orgID) await ensureProjectBuckets(existingToken, orgID);
        else console.warn('[WARN] org "' + (env.INFLUXDB_ORG || 'ss-org') + '" not found — skip per-project buckets');
      } catch (e) {
        console.warn('[WARN] per-project bucket check failed: ' + (e && e.message ? e.message : e));
      }
      } else {
      console.warn('[WARN] InfluxDB already initialized but INFLUXDB_TOKEN in .env is NOT valid for this instance (HTTP ' + (probe ? probe.status : 'error') + ').');
      console.warn('       Likely cause: another InfluxDB is answering on this port, or the token came from a different machine.');
      console.warn('       Fix A: stop the process occupying the port, clear rtdb\\influxdb2 data, start InfluxDB again and rerun this script.');
      console.warn('       Fix B: create org/bucket/token in the InfluxDB UI and set INFLUXDB_TOKEN in .env manually.');
      }
    } else {
      console.warn('[WARN] InfluxDB already initialized (setup locked) but .env has no INFLUXDB_TOKEN.');
      console.warn('       If org/bucket were not created, clear rtdb\\influxdb2 data and rerun this script,');
      console.warn('       or create org/bucket/token in the InfluxDB UI and fill INFLUXDB_TOKEN in .env manually.');
    }
    return;
  }
  const resp = await request('POST', '/api/v2/setup', { username: username, password: password, org: org, bucket: bucket, retentionPeriodHrs: 0 });
  if (resp.status !== 201) {
    console.error('[FAIL] setup failed (HTTP ' + resp.status + '): ' + resp.raw);
    process.exit(1);
  }
  const token = resp.body && resp.body.auth && resp.body.auth.token;
  if (!token) {
    console.error('[FAIL] setup succeeded but no token in response: ' + resp.raw);
    process.exit(1);
  }
  writeEnvToken(token);
  console.log('[OK] org=' + org + '  bucket=' + bucket + '  user=' + username);
  console.log('[OK] INFLUXDB_TOKEN written to .env');
  console.log('[NOTE] If the backend is already running, restart it to load the token (stop.bat -> start.bat).');
  // 新初始化：按包内现有项目预建 per-project bucket
  try {
    const orgID = resp.body && resp.body.org && resp.body.org.id;
    if (orgID) await ensureProjectBuckets(token, orgID);
  } catch (e) {
    console.warn('[WARN] per-project bucket creation failed: ' + (e && e.message ? e.message : e));
  }
})().catch((e) => {
  console.error('[FAIL] ' + (e && e.message ? e.message : e));
  process.exit(1);
});
