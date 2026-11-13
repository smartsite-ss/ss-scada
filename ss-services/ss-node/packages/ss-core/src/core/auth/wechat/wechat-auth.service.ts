// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { UserService } from '../../user/user.service';
import { AuthService } from '../auth.service';
import { AuditLoggerService } from '../../../logger/audit-logger.service';
import { I18nService } from '@ss-node/ss-i18n';
import { WechatApiService } from './wechat-api.service';
import { WechatStateService } from './wechat-state.service';
import {
  ScanState,
  QrcodeResponse,
  ScanStatusResponse,
  WechatUserProfile,
} from './wechat-auth.types';

/**
 * WeChat scan-login business service
 *
 * Responsibilities:
 *   1. Generate QR code (state + wechatUrl)
 *   2. Handle WeChat callback (real mode) / Mock scan (Mock mode)
 *   3. Find or create user, mark state=confirmed
 *   4. Issue Token when confirmed (one-time consume state)
 *
 * Token issuance timing note:
 *   Token is not issued at the /callback endpoint, because the WeChat callback is a server redirect
 *   and the frontend cannot directly get the response. Instead, when the /status poll detects confirmed,
 *   the Cookie is issued; the frontend jumps after getting user, and setCookie completes naturally.
 */
@Injectable()
export class WechatAuthService {
  private readonly logger = new Logger(WechatAuthService.name);
  private readonly redirectUri: string;
  private readonly stateTtlMs: number;

  constructor(
    private readonly userService: UserService,
    private readonly authService: AuthService,
    private readonly wechatApi: WechatApiService,
    private readonly stateService: WechatStateService,
    @Inject(I18nService) private readonly i18n: I18nService,
    private readonly auditLogger: AuditLoggerService,
  ) {
    this.redirectUri =
      process.env.WECHAT_REDIRECT_URI ||
      'http://localhost:5173/api/v1/auth/wechat/callback';
    this.stateTtlMs = 5 * 60 * 1000; // 5 minutes
  }

  /** Generate QR code (state + wechatUrl) */
  async generateQrcode(clientMeta: {
    ip?: string;
    userAgent?: string;
  }): Promise<QrcodeResponse> {
    const state = crypto.randomBytes(16).toString('hex');
    const now = Date.now();
    const scanState: ScanState = {
      state,
      status: 'pending',
      createdAt: now,
      expiresAt: now + this.stateTtlMs,
      clientIp: clientMeta.ip,
      userAgent: clientMeta.userAgent,
    };
    await this.stateService.create(scanState);

    const wechatUrl = this.wechatApi.buildQrcodeUrl(state, this.redirectUri);
    const mock = this.wechatApi.isMockMode();

    this.logger.log(
      `[GenerateQRCode] state=${state} mock=${mock} ip=${clientMeta.ip || 'unknown'}`,
    );

    return {
      state,
      wechatUrl,
      mock,
      expiresAt: scanState.expiresAt,
    };
  }

  /** Query scan status (frontend polls) */
  async getScanStatus(state: string): Promise<ScanStatusResponse> {
    const scanState = await this.stateService.get(state);
    if (!scanState) {
      throw new BadRequestException(this.i18n.tSync('auth.wechat.invalid_state'));
    }

    const now = Date.now();
    const remainingSeconds = Math.max(0, Math.floor((scanState.expiresAt - now) / 1000));

    // confirmed status: query user info and return to the frontend
    let user: ScanStatusResponse['user'];
    if (scanState.status === 'confirmed' && scanState.userId) {
      const userEntity = await this.userService.findById(scanState.userId);
      if (userEntity) {
        user = {
          id: userEntity.id,
          username: userEntity.username,
          displayName: userEntity.displayName || userEntity.username,
          role: userEntity.role,
          avatar: userEntity.avatar,
        };
      }
    }

    return { status: scanState.status, user, remainingSeconds };
  }

  /**
   * WeChat callback handling (real mode)
   *
   * GET /auth/wechat/callback?code=CODE&state=STATE
   * Flow:
   *   1. Validate state exists and status=pending
   *   2. Mark as scanned
   *   3. Exchange code for access_token + openid
   *   4. Pull user info
   *   5. loginOrCreateUser -> mark confirmed
   */
  async handleCallback(code: string, state: string): Promise<void> {
    const scanState = await this.stateService.get(state);
    if (!scanState) {
      throw new BadRequestException(this.i18n.tSync('auth.wechat.invalid_state'));
    }
    if (scanState.status !== 'pending') {
      throw new BadRequestException(
        this.i18n.tSync('auth.wechat.invalid_state_status'),
      );
    }

    // Mark as scanned (intermediate state before user confirmation)
    await this.stateService.update(state, { status: 'scanned' });

    const tokenResp = await this.wechatApi.getAccessToken(code);
    const userInfo = await this.wechatApi.getUserInfo(tokenResp.access_token, tokenResp.openid);

    await this.loginOrCreateUser(state, {
      wechatOpenId: tokenResp.openid,
      wechatUnionId: tokenResp.unionid,
      nickname: userInfo.nickname,
      avatarUrl: userInfo.headimgurl,
    });
  }

  /**
   * Mock mode simulates a user confirming a scan
   *
   * POST /auth/wechat/mock-scan { state, action: 'confirm' | 'cancel' }
   */
  async handleMockScan(state: string, action: 'confirm' | 'cancel'): Promise<void> {
    if (!this.wechatApi.isMockMode()) {
      throw new UnauthorizedException(this.i18n.tSync('auth.wechat.mock_disabled'));
    }

    const scanState = await this.stateService.get(state);
    if (!scanState) {
      throw new BadRequestException(this.i18n.tSync('auth.wechat.invalid_state'));
    }
    if (scanState.status !== 'pending') {
      throw new BadRequestException(
        this.i18n.tSync('auth.wechat.invalid_state_status'),
      );
    }

    if (action === 'cancel') {
      await this.stateService.update(state, { status: 'cancelled' });
      this.logger.log(`[Mock QRScan] state=${state} user cancelled`);
      return;
    }

    // action=confirm: first mark scanned, then go through loginOrCreateUser
    await this.stateService.update(state, { status: 'scanned' });

    // Mock mode uses the default openid configured via env var
    const mockOpenId =
      process.env.WECHAT_MOCK_DEFAULT_OPENID || 'mock_wechat_user_001';
    await this.loginOrCreateUser(state, {
      wechatOpenId: mockOpenId,
      wechatUnionId: `mock_unionid_${mockOpenId}`,
      nickname: '微信测试用户',
      avatarUrl: '',
    });
  }

  /**
   * Find or create user, and mark state=confirmed
   *
   * Lookup strategy:
   *   1. Look up by wechatOpenId
   *   2. If not found and unionid exists, fall back to unionid lookup (identify same user across apps)
   *   3. If still not found, create a new user (default viewer role)
   *
   * Token is not issued directly here (the service layer cannot touch the Response);
   * instead it is stored in the state (confirmed + userId), and the controller calls
   * issueTokenForConfirmedScan when /status detects confirmed to issue it
   */
  private async loginOrCreateUser(
    state: string,
    profile: WechatUserProfile,
  ): Promise<void> {
    const scanState = await this.stateService.get(state);
    if (!scanState) return;

    let user = await this.userService.findByWechatOpenId(profile.wechatOpenId);
    let isNewUser = false;

    // When not found by openid, try unionid fallback lookup
    if (!user && profile.wechatUnionId) {
      user = await this.userService.findByWechatUnionId(profile.wechatUnionId);
      if (user) {
        // Existing unionid user: fill in openid and refresh profile
        await this.userService.updateWechatProfile(user.id, {
          nickname: profile.nickname,
          avatarUrl: profile.avatarUrl,
        });
      }
    }

    if (!user) {
      // Create new user (default viewer)
      user = await this.userService.createWechatUser(profile);
      isNewUser = true;
      this.auditLogger.logSecurityEvent({
        type: 'user.created',
        severity: 'info',
        userId: user.id,
        username: user.username,
        ip: scanState.clientIp,
        userAgent: scanState.userAgent,
        details: {
          source: 'wechat_qrcode',
          role: 'viewer',
          isNewUser: true,
          wechatOpenId: profile.wechatOpenId,
        },
      });
      this.logger.log(
        `[CreateUser] userId=${user.id} username=${user.username} wechatOpenId=${profile.wechatOpenId}`,
      );
    } else {
      // Existing user: refresh nickname/avatar/unionId
      await this.userService.updateWechatProfile(user.id, {
        nickname: profile.nickname,
        avatarUrl: profile.avatarUrl,
        unionId: profile.wechatUnionId,
      });
      this.logger.log(
        `[ReuseUser] userId=${user.id} username=${user.username} wechatOpenId=${profile.wechatOpenId}`,
      );
    }

    this.auditLogger.logSecurityEvent({
      type: 'auth.wechat.login.success',
      severity: 'info',
      userId: user.id,
      username: user.username,
      ip: scanState.clientIp,
      userAgent: scanState.userAgent,
      details: { isNewUser, wechatOpenId: profile.wechatOpenId },
    });

    // Mark confirmed, store userId. Token issued by /status on confirmation
    await this.stateService.update(state, {
      status: 'confirmed',
      userId: user.id,
      wechatOpenId: profile.wechatOpenId,
      wechatUnionId: profile.wechatUnionId,
      nickname: profile.nickname,
      avatarUrl: profile.avatarUrl,
    });
  }

  /**
   * When /status detects status=confirmed, generate Token and return user
   *
   * The caller (controller) is responsible for setAuthCookies
   * One-time consume: after issuing the token, delete the state immediately to prevent duplicate token claims
   */
  async issueTokenForConfirmedScan(state: string): Promise<{
    accessToken: string;
    refreshToken: string;
    user: {
      id: string;
      username: string;
      displayName: string;
      role: string;
      avatar?: string;
    };
  } | null> {
    const scanState = await this.stateService.get(state);
    if (!scanState || scanState.status !== 'confirmed' || !scanState.userId) {
      return null;
    }
    const user = await this.userService.findById(scanState.userId);
    if (!user) return null;

    const tokens = await this.authService.generateTokensForUser({
      id: user.id,
      username: user.username,
      role: user.role,
    });

    // One-time: delete state after issuing token, preventing duplicate token claims
    await this.stateService.delete(state);

    this.logger.log(
      `[DeliverToken] userId=${user.id} username=${user.username} state=${state} removed`,
    );

    return {
      ...tokens,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName || user.username,
        role: user.role,
        avatar: user.avatar,
      },
    };
  }
}
