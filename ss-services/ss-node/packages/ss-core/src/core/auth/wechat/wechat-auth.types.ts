// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * WeChat scan-login type definitions
 *
 * Personal WeChat open-platform web-app OAuth2 flow:
 *   1. Frontend requests QR code -> backend generates state (CSRF protection) + wechatUrl
 *   2. User scans and confirms -> WeChat redirects backend to /callback?code=CODE&state=STATE
 *   3. Backend exchanges code for access_token + openid, pulls user info
 *   4. Look up/create user by openid, mark state=confirmed
 *   5. Frontend polls /status; on confirmed, backend issues Cookie + returns user
 */

/**
 * Scan-status enum
 * - pending: QR code generated, waiting for user to scan
 * - scanned: user scanned, waiting for phone confirmation (real-mode intermediate state)
 * - confirmed: user confirmed, login success, Token can be issued
 * - expired: QR code expired (5 minutes)
 * - cancelled: user cancelled the scan
 */
export type ScanStatus = 'pending' | 'scanned' | 'confirmed' | 'expired' | 'cancelled';

/**
 * Scan-session status (stored in Redis / in-memory Map)
 *
 * Lifecycle: generateQrcode creates -> user scan updates to scanned ->
 * after confirmation updates to confirmed -> /status issues Token then deletes (one-time consume)
 */
export interface ScanState {
  /** state param (CSRF protection + session id, 32-char random string) */
  state: string;
  /** Current status */
  status: ScanStatus;
  /** Creation timestamp (ms) */
  createdAt: number;
  /** Expiration timestamp (ms, 5 minutes after creation) */
  expiresAt: number;
  /** Filled after scan confirm: WeChat openid */
  wechatOpenId?: string;
  /** Filled after scan confirm: WeChat unionid (optional) */
  wechatUnionId?: string;
  /** Filled after scan confirm: WeChat nickname */
  nickname?: string;
  /** Filled after scan confirm: WeChat avatar URL */
  avatarUrl?: string;
  /** Filled after confirmed: this system's userId */
  userId?: string;
  /** Client IP (for audit) */
  clientIp?: string;
  /** User-Agent (for audit) */
  userAgent?: string;
}

/**
 * WeChat OAuth2 access_token response
 *
 * GET https://api.weixin.qq.com/sns/oauth2/access_token return structure
 */
export interface WechatAccessTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  openid: string;
  scope: string;
  unionid?: string;
  /** Field present on error */
  errcode?: number;
  errmsg?: string;
}

/**
 * WeChat OAuth2 userinfo response
 *
 * GET https://api.weixin.qq.com/sns/userinfo return structure
 */
export interface WechatUserInfoResponse {
  openid: string;
  nickname: string;
  sex: number;
  province: string;
  city: string;
  country: string;
  headimgurl: string;
  privilege: string[];
  unionid?: string;
  /** Field present on error */
  errcode?: number;
  errmsg?: string;
}

/**
 * QR-code generation response
 *
 * In Mock mode mock=true, the frontend shows a placeholder UI + "simulate scan" button
 * In real mode mock=false, the frontend loads wxLogin.js to render the embedded QR code
 */
export interface QrcodeResponse {
  /** state param (returned by the frontend when polling /status) */
  state: string;
  /** WeChat scan-authorization URL (rendered by the frontend WxLogin JS in real mode) */
  wechatUrl: string;
  /** Whether in Mock mode (frontend decides the rendering accordingly) */
  mock: boolean;
  /** Expiration timestamp (ms) */
  expiresAt: number;
}

/**
 * Scan-status query response
 *
 * When confirmed, the user field is non-null; the frontend jumps after receiving it
 */
export interface ScanStatusResponse {
  status: ScanStatus;
  /** Return user info when confirmed (frontend uses it for direct display and jump) */
  user?: {
    id: string;
    username: string;
    displayName: string;
    role: string;
    avatar?: string;
  };
  /** Remaining valid seconds (frontend uses for countdown display) */
  remainingSeconds: number;
}

/**
 * WeChat user profile (params received by loginOrCreateUser)
 */
export interface WechatUserProfile {
  wechatOpenId: string;
  wechatUnionId?: string;
  nickname?: string;
  avatarUrl?: string;
}

// -------- Mini-program login (01 - account & auth) --------

/**
 * Mini-program code2session response
 *
 * GET https://api.weixin.qq.com/sns/jscode2session return structure
 * session_key is held only by the backend (for decrypting sensitive user data); never issue to the frontend
 */
export interface WechatMpCode2SessionResponse {
  openid: string;
  session_key: string;
  unionid?: string;
  /** Field present on error */
  errcode?: number;
  errmsg?: string;
}

/** Dual token pair (reuses the ss-data mechanism: Access 15min + Refresh 7d) */
export interface WechatMpTokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Mini-program login user info (aligned with frontend LoginUserInfo) */
export interface WechatMpLoginUserInfo {
  userId: string;
  username: string;
  nickname: string;
  avatarUrl: string | null;
  roleNames: string[];
}

/** Authorized projects (data-permission snapshot: project-level read/write/admin) */
export interface WechatMpAuthorizedProject {
  projectId: string;
  projectName: string;
  permissionLevel: 'read' | 'write' | 'admin';
}

/** Mini-program login response (issue Token if bound; bindingRequired=true if not bound) */
export interface WechatMpLoginResponse {
  tokenPair: WechatMpTokenPair | null;
  userInformation: WechatMpLoginUserInfo | null;
  bindingRequired: boolean;
  authorizedProjects: WechatMpAuthorizedProject[];
}

/** Bind / rebind response */
export interface WechatMpBindResponse {
  tokenPair: WechatMpTokenPair;
  userInformation: WechatMpLoginUserInfo;
  authorizedProjects: WechatMpAuthorizedProject[];
}
