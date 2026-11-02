// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * DataSourceReader — unified tool for reading data source values
 *
 * Provides unified data source tag value reading and summary building for both edit mode
 * (DataSourceConfigDialog) and runtime mode (PreviewCanvas / RuntimeDataPanel),
 * eliminating duplicated tagId extraction and wsStore reading patterns everywhere.
 */

export interface TagValueSnapshot {
  tagId: string;
  tagName: string;
  currentValue: unknown;
  quality: string | undefined;
  lastUpdate: number | undefined;
}

export interface SourceSummary {
  lastValue: string | null;
  updatedAt: number | null;
  quality: string | null;
}

export interface WsStoreLike {
  tagValues: Map<string, { value: unknown; quality?: string; timestamp?: number }>;
}

// ── tagId extraction: uniformly extract tag IDs from data source configs ────────────────────────

/**
 * Extract tag IDs from a data source config (unified fallback chain).
 * Priority: ds.properties.tagIds > ds.config.tagIds > ds.tags > ds.properties.tags
 */
export function extractTagIds(ds: Record<string, unknown> | null | undefined): string[] {
  if (!ds) return [];
  const props = (ds.properties || ds.config) as Record<string, unknown> | undefined;
  const tagIds =
    (props?.tagIds as string[] | undefined) ??
    (props?.tags as string[] | undefined) ??
    (ds.tags as string[] | undefined) ??
    [];
  return Array.isArray(tagIds) ? tagIds : [];
}

// ── Tag value reading ──────────────────────────────────────────────────────

/**
 * Read a single tag's live value snapshot from wsStore.
 * Returns a TagValueSnapshot (always present; value/quality/ts are undefined without WS data).
 */
export function readTagSnapshot(
  tagId: string,
  tagName: string,
  wsStore: WsStoreLike,
): TagValueSnapshot {
  const wsEntry = wsStore.tagValues.get(tagId);
  return {
    tagId,
    tagName: tagName || tagId,
    currentValue: wsEntry?.value,
    quality: wsEntry?.quality,
    lastUpdate: wsEntry?.timestamp,
  };
}

/**
 * Batch read tag value snapshots.
 * @param tagIds  - list of tag IDs
 * @param tagNames - tag name list (same length as tagIds; falls back to tagId when missing)
 */
export function readTagSnapshots(
  tagIds: string[],
  tagNames: string[],
  wsStore: WsStoreLike,
): TagValueSnapshot[] {
  return tagIds.map((tagId, i) => readTagSnapshot(tagId, tagNames[i] || tagId, wsStore));
}

// ── Data source summary building ──────────────────────────────────────────────────

/**
 * Build a summary for a single data source (latest value, update time, quality).
 * Generates different lastValue formats depending on the data source type.
 */
export function buildSourceSummary(
  ds: { type?: string; name?: string; url?: string; properties?: Record<string, unknown> },
  tagIds: string[],
  tagNames: string[],
  wsStore: WsStoreLike,
): SourceSummary {
  if (tagIds.length === 0) {
    return { lastValue: null, updatedAt: null, quality: null };
  }

  const snapshots = readTagSnapshots(tagIds, tagNames, wsStore);
  const maxLen = 60;

  // lastValue
  let lastValue: string | null = null;
  switch (ds.type) {
    case 'static': {
      lastValue = snapshots
        .map((t) => `${t.tagName}: ${t.currentValue ?? '—'}`)
        .join('; ');
      lastValue = lastValue.length > maxLen ? lastValue.substring(0, maxLen - 3) + '...' : lastValue;
      // Empty value fallback
      if (!lastValue || lastValue === '') lastValue = null;
      break;
    }
    case 'tag':
    case 'device': {
      const values = snapshots.map((t) => t.currentValue ?? '—').join(', ');
      lastValue = values.length > maxLen ? values.substring(0, maxLen - 3) + '...' : values;
      break;
    }
    case 'api': {
      const url = ds.url || ds.properties?.url;
      if (typeof url === 'string') {
        lastValue = url.length > 40 ? url.substring(0, 37) + '...' : url;
      }
      break;
    }
    default:
      lastValue = null;
  }

  // updatedAt: take the newest lastUpdate among all tags
  let updatedAt: number | null = null;
  for (const s of snapshots) {
    if (s.lastUpdate && (updatedAt === null || s.lastUpdate > updatedAt)) {
      updatedAt = s.lastUpdate;
    }
  }

  // quality: take the worst among all tags
  let quality: string | null = null;
  for (const s of snapshots) {
    if (!s.quality) continue;
    if (quality === null) {
      quality = s.quality;
    } else if (s.quality !== 'good') {
      break; // worst candidate already found, no need to continue
    }
  }

  return { lastValue, updatedAt, quality };
}
