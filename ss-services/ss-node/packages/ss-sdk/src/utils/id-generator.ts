// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { randomUUID, randomBytes } from 'crypto';

/** base36 alphabet (0-9, a-z) */
const BASE36_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** URL-safe alphabet (A-Z, a-z, 0-9, _, -) */
const URL_SAFE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/**
 * ID generator
 *
 * Provides multiple ID generation strategies based on Node.js's built-in crypto module, with no extra dependencies.
 */
export class IdGenerator {
  /**
   * Generate a standard UUID v4
   * @returns a 36-character UUID string (e.g. `550e8400-e29b-41d4-a716-446655440000`)
   */
  static uuid(): string {
    return randomUUID();
  }

  /**
   * Generate a short ID (base36 encoded)
   * @param length length, default 8
   * @returns the short ID string (e.g. `a3f9k2x7`)
   */
  static shortId(length: number = 8): string {
    const safeLength = Math.max(1, length);
    const bytes = randomBytes(safeLength);
    let result = '';
    for (let i = 0; i < safeLength; i++) {
      result += BASE36_ALPHABET[bytes[i] % BASE36_ALPHABET.length];
    }
    return result;
  }

  /**
   * Generate a prefixed ID
   * @param prefix business prefix (e.g. `dev`, `tag`)
   * @param length length of the random part, default 8
   * @returns the prefixed ID (e.g. `dev-abc12345`)
   */
  static prefixedId(prefix: string, length: number = 8): string {
    return `${prefix}-${this.shortId(length)}`;
  }

  /**
   * Generate a nanoid-like URL-safe ID
   * @param length length, default 21 (same as nanoid's default)
   * @returns the URL-safe random ID (e.g. `V1StGXR8_Z5jdHi6B-myT`)
   */
  static nanoid(length: number = 21): string {
    const safeLength = Math.max(1, length);
    const bytes = randomBytes(safeLength);
    let result = '';
    for (let i = 0; i < safeLength; i++) {
      result += URL_SAFE_ALPHABET[bytes[i] % URL_SAFE_ALPHABET.length];
    }
    return result;
  }

  /**
   * Generate a sequential ID
   * @param prefix business prefix (e.g. `TMP`)
   * @param seq sequence number
   * @param padding padding digits, default 6
   * @returns the sequential ID (e.g. `TMP-000001`)
   */
  static sequentialId(prefix: string, seq: number, padding: number = 6): string {
    const safePadding = Math.max(1, padding);
    return `${prefix}-${String(seq).padStart(safePadding, '0')}`;
  }

  /**
   * Generate a time-based ID (timestamp + random suffix)
   * @param prefix optional prefix
   * @returns the time-based ID (e.g. `dev-lq2abc123456`)
   */
  static timeBasedId(prefix: string = ''): string {
    const timestamp = Date.now().toString(36);
    const suffix = this.shortId(6);
    return prefix ? `${prefix}-${timestamp}${suffix}` : `${timestamp}${suffix}`;
  }
}
