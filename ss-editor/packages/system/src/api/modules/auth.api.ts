// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import client from '../client';
import type { ApiResponse, LoginDto, RegisterDto, AuthResult } from '../types/api';

/**
 * WeChat QR code response
 */
export interface WechatQrcodeResult {
  /** state parameter (CSRF protection + session identifier) */
  state: string;
  /** WeChat scan authorization URL (real mode embedded in an iframe; Mock mode uses the mock:// protocol) */
  wechatUrl: string;
  /** Whether Mock mode (the frontend shows a simulated button or an iframe accordingly) */
  mock: boolean;
  /** Expiry timestamp (milliseconds) */
  expiresAt: number;
}

/**
 * WeChat scan status query response
 */
export interface WechatScanStatusResult {
  /** Scan status: pending/scanned/confirmed/expired/cancelled */
  status: 'pending' | 'scanned' | 'confirmed' | 'expired' | 'cancelled';
  /** Remaining valid seconds */
  remainingSeconds: number;
  /** User info filled when confirmed */
  user?: {
    id: string;
    username: string;
    displayName: string;
    role: string;
    avatar?: string;
  };
}

/**
 * Login feature switches (queried at login page initialization, deciding whether to show WeChat scan / SMS login entries)
 */
export interface LoginFeatures {
  /** Whether WeChat scan login is enabled (WECHAT_LOGIN_ENABLED) */
  wechatLoginEnabled: boolean;
  /** Whether SMS verification code login is enabled (SMS_LOGIN_ENABLED, reserved in §2.7) */
  smsLoginEnabled: boolean;
}

export const authApi = {
  login(dto: LoginDto): Promise<ApiResponse<AuthResult>> {
    return client.post('/auth/login', dto).then((res) => res.data);
  },

  register(dto: RegisterDto): Promise<ApiResponse<AuthResult>> {
    return client.post('/auth/register', dto).then((res) => res.data);
  },

  /**
     * S-C03: refreshToken is transported automatically via HttpOnly Cookie, no need to pass it in the body
     */
  refreshToken(): Promise<ApiResponse<{ message: string }>> {
    return client.post('/auth/refresh', {}).then((res) => res.data);
  },

  /**
     * S-C03: in Cookie mode refreshToken is transported automatically via HttpOnly Cookie;
     * in Bearer mode (desktop) it must be passed explicitly via the body to revoke the server-side refresh token.
     */
  logout(refreshToken?: string): Promise<void> {
    return client.post('/auth/logout', refreshToken ? { refreshToken } : {});
  },

  // ── WeChat scan login ──

  /**
     * Generate a WeChat scan QR code
     * The backend returns state + wechatUrl + a mock flag; the frontend renders an iframe or a Mock button accordingly
     */
  generateWechatQrcode(): Promise<WechatQrcodeResult> {
    return client
      .post('/auth/wechat/qrcode', {})
      .then((res) => (res.data as any)?.data ?? res.data);
  },

  /**
     * Query the scan status (frontend polls; on confirmed the backend delivers the HttpOnly Cookie once)
     */
  getWechatScanStatus(state: string): Promise<WechatScanStatusResult> {
    return client
      .get('/auth/wechat/status', { params: { state } })
      .then((res) => (res.data as any)?.data ?? res.data);
  },

  /**
     * Mock scan confirm/cancel (only available when WECHAT_MOCK=true, for development and debugging)
     */
  wechatMockScan(
    state: string,
    action: 'confirm' | 'cancel',
  ): Promise<{ message: string }> {
    return client
      .post('/auth/wechat/mock-scan', { state, action })
      .then((res) => (res.data as any)?.data ?? res.data);
  },

  /**
     * Get the login feature switches (public endpoint, called before login)
     * The backend GET /auth/features returns { wechatLoginEnabled, smsLoginEnabled }
     */
  getLoginFeatures(): Promise<LoginFeatures> {
    return client
      .get('/auth/features')
      .then((res) => (res.data as any)?.data ?? res.data);
  },
};