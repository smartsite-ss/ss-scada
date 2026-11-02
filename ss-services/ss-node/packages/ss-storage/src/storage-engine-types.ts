// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Storage engine type registry (string constant table, replacing the former fixed enum).
 *
 * To add a new time-series / data-source engine you only need to:
 * 1. add the engine type to this table;
 * 2. implement StorageAdapter and register it at module assembly;
 * 3. route via STORAGE_DEFAULT_ENGINE / project-level overrides.
 *
 * Naming rule: config names use full names (influxdb2 / influxdb3), not abbreviations like i2/i3.
 */
export const STORAGE_ENGINE_TYPES = {
  INFLUXDB2: 'influxdb2',
  INFLUXDB3: 'influxdb3',
  TDENGINE: 'tdengine',
  SQLITE: 'sqlite',
  MYSQL: 'mysql',
  // Future extensions: IOTDB / VICTORIAMETRICS / FILE etc.
} as const;

export type StorageEngineType = (typeof STORAGE_ENGINE_TYPES)[keyof typeof STORAGE_ENGINE_TYPES];

/**
 * Legacy alias compatibility table: 'influxdb' in historical configs is normalized to 'influxdb2' to keep legacy configs working.
 */
const STORAGE_ENGINE_TYPE_ALIASES: Readonly<Record<string, StorageEngineType>> = {
  influxdb: STORAGE_ENGINE_TYPES.INFLUXDB2,
};

/**
 * Validate whether a string is a registered engine type (alias normalization applied first).
 * @returns the normalized valid engine type; null if not registered.
 */
export function resolveStorageEngineType(candidate: string): StorageEngineType | null {
  const normalized = candidate.trim().toLowerCase();
  const aliased = STORAGE_ENGINE_TYPE_ALIASES[normalized] ?? normalized;
  const registeredTypes = Object.values(STORAGE_ENGINE_TYPES) as readonly string[];
  return registeredTypes.includes(aliased) ? (aliased as StorageEngineType) : null;
}
