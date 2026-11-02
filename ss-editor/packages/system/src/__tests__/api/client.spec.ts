// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getToken,
  setToken,
  getRefreshToken,
  setRefreshToken,
  clearTokens,
} from '../../api/client';

/**
 * S-C03: Token storage changed to in-memory (no longer using localStorage)
 *
 * Tokens are managed by the backend via HttpOnly Cookie; the frontend only maintains a flag in memory.
 * These tests verify the correctness of the in-memory read/write.
 */
describe('token management', () => {
  beforeEach(() => {
    // Reset the in-memory state via clearTokens between tests
    clearTokens();
  });

  describe('getToken / setToken', () => {
    it('should return null when no token is set', () => {
      expect(getToken()).toBeNull();
    });

    it('should set and get token in memory', () => {
      setToken('test-access-token');
      expect(getToken()).toBe('test-access-token');
    });

    it('should overwrite previous token', () => {
      setToken('first');
      setToken('second');
      expect(getToken()).toBe('second');
    });
  });

  describe('getRefreshToken / setRefreshToken', () => {
    it('should return null when no refresh token is set', () => {
      expect(getRefreshToken()).toBeNull();
    });

    it('should set and get refresh token in memory', () => {
      setRefreshToken('test-refresh-token');
      expect(getRefreshToken()).toBe('test-refresh-token');
    });
  });

  describe('clearTokens', () => {
    it('should clear both tokens from memory', () => {
      setToken('access');
      setRefreshToken('refresh');
      clearTokens();

      expect(getToken()).toBeNull();
      expect(getRefreshToken()).toBeNull();
    });

    it('should not throw when no tokens exist', () => {
      expect(() => clearTokens()).not.toThrow();
    });
  });
});
