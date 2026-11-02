// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { describe, it, expect } from 'vitest';
import {
  extractTagIds,
  readTagSnapshot,
  readTagSnapshots,
  buildSourceSummary,
  type WsStoreLike,
} from '../DataSourceReader';

// ── Helper functions ────────────────────────────────────────────────────────

function makeWsStore(entries: Record<string, { value: unknown; quality?: string; timestamp?: number }>): WsStoreLike {
  return { tagValues: new Map(Object.entries(entries)) };
}

function emptyWsStore(): WsStoreLike {
  return { tagValues: new Map() };
}

// ── extractTagIds ────────────────────────────────────────────────────

describe('extractTagIds', () => {
  it('Extract from ds.properties.tagIds', () => {
    const ds = { properties: { tagIds: ['a', 'b'] } };
    expect(extractTagIds(ds)).toEqual(['a', 'b']);
  });

  it('Extract from ds.config.tagIds (fallback when ds.properties does not exist)', () => {
    const ds = { config: { tagIds: ['c', 'd'] } };
    expect(extractTagIds(ds)).toEqual(['c', 'd']);
  });

  it('When ds.properties is an empty object, props should not fall back to ds.config (fallback only when falsy)', () => {
    const ds = { properties: {}, config: { tagIds: ['x'] } };
    // properties as {} is truthy, so it does not fall back to config.tagIds
    expect(extractTagIds(ds)).toEqual([]);
  });

  it('Extract from ds.tags (fallback when neither properties nor config has tagIds)', () => {
    const ds = { properties: {}, config: {}, tags: ['e', 'f'] };
    expect(extractTagIds(ds)).toEqual(['e', 'f']);
  });

  it('Extract from ds.properties.tags (fallback when properties.tagIds does not exist)', () => {
    const ds = { properties: { tags: ['g'] } };
    expect(extractTagIds(ds)).toEqual(['g']);
  });

  it('Returns [] when all paths are empty', () => {
    const ds = {};
    expect(extractTagIds(ds)).toEqual([]);
  });

  it('Returns [] when tagIds is not an array', () => {
    const ds = { properties: { tagIds: 'not-an-array' } };
    expect(extractTagIds(ds)).toEqual([]);
  });

  it('Should safely return [] when ds is null', () => {
    expect(extractTagIds(null as unknown as Record<string, unknown>)).toEqual([]);
  });

  it('Should safely return [] when ds is undefined', () => {
    expect(extractTagIds(undefined as unknown as Record<string, unknown>)).toEqual([]);
  });

  it('Duplicate tagIds are not deduped (caller decides)', () => {
    const ds = { tags: ['a', 'a', 'b'] };
    expect(extractTagIds(ds)).toEqual(['a', 'a', 'b']);
  });
});

// ── readTagSnapshot ──────────────────────────────────────────────────

describe('readTagSnapshot', () => {
  it('Returns the correct snapshot when wsStore has data', () => {
    const store = makeWsStore({
      'tag-1': { value: 123.4, quality: 'good', timestamp: 1700000000000 },
    });
    const snap = readTagSnapshot('tag-1', '温度A', store);
    expect(snap).toEqual({
      tagId: 'tag-1',
      tagName: '温度A',
      currentValue: 123.4,
      quality: 'good',
      lastUpdate: 1700000000000,
    });
  });

  it('Returns undefined fields when wsStore has no matching tag', () => {
    const store = emptyWsStore();
    const snap = readTagSnapshot('tag-unknown', '未知', store);
    expect(snap).toEqual({
      tagId: 'tag-unknown',
      tagName: '未知',
      currentValue: undefined,
      quality: undefined,
      lastUpdate: undefined,
    });
  });

  it('When tagName is empty, falls back to tagId', () => {
    const store = emptyWsStore();
    const snap = readTagSnapshot('tag-x', '', store);
    expect(snap.tagName).toBe('tag-x');
  });

  it('Returns undefined when wsEntry lacks quality', () => {
    const store = makeWsStore({
      'tag-2': { value: 0 },
    });
    const snap = readTagSnapshot('tag-2', '开关', store);
    expect(snap.quality).toBeUndefined();
  });

  it('Returns undefined when wsEntry lacks timestamp', () => {
    const store = makeWsStore({
      'tag-3': { value: 'on' },
    });
    const snap = readTagSnapshot('tag-3', '状态', store);
    expect(snap.lastUpdate).toBeUndefined();
  });

  it('A wsEntry value of null passes through normally', () => {
    const store = makeWsStore({
      'tag-4': { value: null, quality: 'bad', timestamp: 1000 },
    });
    const snap = readTagSnapshot('tag-4', '空值', store);
    expect(snap.currentValue).toBeNull();
    expect(snap.quality).toBe('bad');
  });

  it('A wsEntry value of 0 passes through normally (not undefined)', () => {
    const store = makeWsStore({
      'tag-5': { value: 0, quality: 'good', timestamp: 2000 },
    });
    const snap = readTagSnapshot('tag-5', '零值', store);
    expect(snap.currentValue).toBe(0);
  });
});

// ── readTagSnapshots ─────────────────────────────────────────────────

describe('readTagSnapshots', () => {
  it('Batch read multiple tags', () => {
    const store = makeWsStore({
      'a': { value: 1, quality: 'good', timestamp: 100 },
      'b': { value: 2, quality: 'bad', timestamp: 200 },
    });
    const snaps = readTagSnapshots(['a', 'b'], ['标签A', '标签B'], store);
    expect(snaps).toHaveLength(2);
    expect(snaps[0].currentValue).toBe(1);
    expect(snaps[1].currentValue).toBe(2);
  });

  it('Returns normally when some tags do not exist in wsStore', () => {
    const store = makeWsStore({
      'a': { value: 1 },
    });
    const snaps = readTagSnapshots(['a', 'missing'], ['A', 'MISSING'], store);
    expect(snaps).toHaveLength(2);
    expect(snaps[0].currentValue).toBe(1);
    expect(snaps[1].currentValue).toBeUndefined();
  });

  it('Empty array input returns an empty array', () => {
    const store = makeWsStore({});
    const snaps = readTagSnapshots([], [], store);
    expect(snaps).toEqual([]);
  });

  it('When tagNames is too short, falls back to tagId', () => {
    const store = makeWsStore({
      'tag-1': { value: 42 },
      'tag-2': { value: 99 },
    });
    const snaps = readTagSnapshots(['tag-1', 'tag-2'], ['仅第一个'], store);
    expect(snaps[0].tagName).toBe('仅第一个');
    expect(snaps[1].tagName).toBe('tag-2');
  });
});

// ── buildSourceSummary ───────────────────────────────────────────────

describe('buildSourceSummary', () => {
  // — tag/device types —
  it('tag type: single-tag summary value', () => {
    const store = makeWsStore({
      'tag1': { value: 42.5, quality: 'good', timestamp: 1700000000000 },
    });
    const summary = buildSourceSummary(
      { type: 'tag', name: 'ds1' },
      ['tag1'],
      ['温度'],
      store,
    );
    expect(summary).toEqual({
      lastValue: '42.5',
      updatedAt: 1700000000000,
      quality: 'good',
    });
  });

  it('tag type: multi-tag values joined by commas', () => {
    const store = makeWsStore({
      't1': { value: 1, quality: 'good', timestamp: 100 },
      't2': { value: 2, quality: 'good', timestamp: 200 },
      't3': { value: 3, quality: 'good', timestamp: 300 },
    });
    const summary = buildSourceSummary(
      { type: 'tag' },
      ['t1', 't2', 't3'],
      ['a', 'b', 'c'],
      store,
    );
    expect(summary.lastValue).toBe('1, 2, 3');
  });

  it('tag type: shows — when wsStore has no data', () => {
    const store = emptyWsStore();
    const summary = buildSourceSummary(
      { type: 'tag' },
      ['tag-no-data'],
      ['无数据标签'],
      store,
    );
    expect(summary.lastValue).toBe('—');
    expect(summary.updatedAt).toBeNull();
    expect(summary.quality).toBeNull();
  });

  it('device type: behaves the same as the tag type', () => {
    const store = makeWsStore({
      'd1': { value: 100, quality: 'good', timestamp: 500 },
    });
    const summary = buildSourceSummary(
      { type: 'device' },
      ['d1'],
      ['设备值'],
      store,
    );
    expect(summary.lastValue).toBe('100');
  });

  // — static type —
  it('static type: key:value format', () => {
    const store = makeWsStore({
      's1': { value: 'hello', quality: 'good', timestamp: 100 },
    });
    const summary = buildSourceSummary(
      { type: 'static' },
      ['s1'],
      ['keyA'],
      store,
    );
    expect(summary.lastValue).toBe('keyA: hello');
  });

  it('static type: key: — when there is no data', () => {
    const store = emptyWsStore();
    const summary = buildSourceSummary(
      { type: 'static' },
      ['s1'],
      ['keyB'],
      store,
    );
    expect(summary.lastValue).toBe('keyB: —');
  });

  // — api type —
  it('api type: displays the URL', () => {
    const store = emptyWsStore();
    const summary = buildSourceSummary(
      { type: 'api', url: 'https://example.com/api/data' },
      ['tag-no-care'],  // API type does not depend on tagIds values, but at least one is needed to enter the branch
      ['t'],
      store,
    );
    expect(summary.lastValue).toBe('https://example.com/api/data');
  });

  it('api type: truncates overly long URLs', () => {
    const store = emptyWsStore();
    const longUrl = 'https://example.com/very/long/path/that/exceeds/forty/characters';
    const summary = buildSourceSummary(
      { type: 'api', url: longUrl },
      ['t'],
      ['t'],
      store,
    );
    expect(summary.lastValue!.length).toBeLessThanOrEqual(40);
    expect(summary.lastValue).toMatch(/\.\.\.$/);
  });

  it('api type: url comes from properties', () => {
    const store = emptyWsStore();
    const summary = buildSourceSummary(
      { type: 'api', properties: { url: 'https://props.url.com' } },
      ['t'],
      ['t'],
      store,
    );
    expect(summary.lastValue).toBe('https://props.url.com');
  });

  // — Edge cases —
  it('Returns null when tagIds is empty', () => {
    const store = makeWsStore({
      'tag1': { value: 42 },
    });
    const summary = buildSourceSummary(
      { type: 'tag' },
      [],
      [],
      store,
    );
    expect(summary).toEqual({ lastValue: null, updatedAt: null, quality: null });
  });

  it('tag type: long list truncation (exceeding maxLen=60)', () => {
    const store = makeWsStore({
      't1': { value: 'very-long-value-that-takes-many-characters-together' },
      't2': { value: 'another-long-value-here' },
    });
    const summary = buildSourceSummary(
      { type: 'tag' },
      ['t1', 't2'],
      ['name1', 'name2'],
      store,
    );
    expect(summary.lastValue!.length).toBeLessThanOrEqual(60);
    expect(summary.lastValue).toMatch(/\.\.\.$/);
  });

  // — updatedAt takes the newest —
  it('updatedAt takes the latest timestamp across all tags', () => {
    const store = makeWsStore({
      'old': { value: 1, quality: 'good', timestamp: 1000 },
      'mid': { value: 2, quality: 'good', timestamp: 2000 },
      'new': { value: 3, quality: 'good', timestamp: 3000 },
    });
    const summary = buildSourceSummary(
      { type: 'tag' },
      ['old', 'mid', 'new'],
      ['o', 'm', 'n'],
      store,
    );
    expect(summary.updatedAt).toBe(3000);
  });

  // — quality takes the worst —
  it('quality takes the worst (bad takes priority over good)', () => {
    const store = makeWsStore({
      'g1': { value: 1, quality: 'good', timestamp: 100 },
      'g2': { value: 2, quality: 'bad', timestamp: 200 },
    });
    const summary = buildSourceSummary(
      { type: 'tag' },
      ['g1', 'g2'],
      ['a', 'b'],
      store,
    );
    expect(summary.quality).toBe('bad');
  });

  it('When all are good, quality is good', () => {
    const store = makeWsStore({
      'a': { value: 1, quality: 'good' },
      'b': { value: 2, quality: 'good' },
    });
    const summary = buildSourceSummary(
      { type: 'tag' },
      ['a', 'b'],
      ['A', 'B'],
      store,
    );
    expect(summary.quality).toBe('good');
  });

  it('Returns null when all have no quality', () => {
    const store = makeWsStore({
      'a': { value: 1 },
      'b': { value: 2 },
    });
    const summary = buildSourceSummary(
      { type: 'tag' },
      ['a', 'b'],
      ['A', 'B'],
      store,
    );
    expect(summary.quality).toBeNull();
  });

  it('When some tags have quality and some do not, take the ones with values', () => {
    const store = makeWsStore({
      'a': { value: 1, quality: 'good' },
      'b': { value: 2 },
    });
    const summary = buildSourceSummary(
      { type: 'tag' },
      ['a', 'b'],
      ['A', 'B'],
      store,
    );
    expect(summary.quality).toBe('good');
  });

  // — Unknown type —
  it('Unknown type (neither tag/device/static/api) → lastValue is null', () => {
    const store = makeWsStore({
      'x': { value: 99 },
    });
    const summary = buildSourceSummary(
      { type: 'database' },
      ['x'],
      ['X'],
      store,
    );
    expect(summary.lastValue).toBeNull();
    expect(summary.updatedAt).toBeNull(); // no timestamp in entry above? No, x has value: 99 but no timestamp, so updatedAt stays null
  });
});

// ── End-to-end: simulate the linkage of each function after wsStore data arrives ──────────────────────────

describe('DataSourceReader — end-to-end flow', () => {
  it('Empty wsStore → populate data → readTagSnapshot reads', () => {
    const store = emptyWsStore();

    // Phase 1: no data
    const snap1 = readTagSnapshot('tag-1', '温度', store);
    expect(snap1.currentValue).toBeUndefined();

    // Phase 2: simulate WS pushing data
    store.tagValues.set('tag-1', { value: 25.5, quality: 'good', timestamp: 1700000000000 });
    const snap2 = readTagSnapshot('tag-1', '温度', store);
    expect(snap2.currentValue).toBe(25.5);
  });

  it('buildSourceSummary correctly reflects wsStore data changes', () => {
    const store = emptyWsStore();

    // Initially no data
    const s1 = buildSourceSummary(
      { type: 'tag', name: 'test' },
      ['t1', 't2'],
      ['温度', '湿度'],
      store,
    );
    expect(s1.lastValue).toBe('—, —');

    // Push the first batch
    store.tagValues.set('t1', { value: 30, quality: 'good', timestamp: 1000 });
    store.tagValues.set('t2', { value: 60, quality: 'good', timestamp: 2000 });
    const s2 = buildSourceSummary(
      { type: 'tag', name: 'test' },
      ['t1', 't2'],
      ['温度', '湿度'],
      store,
    );
    expect(s2.lastValue).toBe('30, 60');
    expect(s2.updatedAt).toBe(2000);
    expect(s2.quality).toBe('good');
  });
});
