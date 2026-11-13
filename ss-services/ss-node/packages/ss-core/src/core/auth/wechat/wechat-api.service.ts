// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { httpRequest, HttpError } from '../../../ai/http-client.util';
import {
  WechatAccessTokenResponse,
  WechatUserInfoResponse,
  WechatMpCode2SessionResponse,
} from './wechat-auth.types';

/**
 * WeChat API call wrapper - real + mock dual mode
 *
 * Switched via the WECHAT_MOCK env var:
 *   - true: returns a fixed fake openid, convenient for dev/debug (no real WeChat credentials needed)
 *   - false: calls the real WeChat API (requires WECHAT_APPID/SECRET configured)
 *
 * Credential config (mini-program and open-platform web app belong to different systems):
 *   - Mini-program: prefer WECHAT_MP_APPID/WECHAT_MP_SECRET, fall back to WECHAT_APPID/WECHAT_SECRET when unset
 *   - Web app (scan login): WECHAT_APPID/WECHAT_SECRET
 *
 * Reuses the project's own httpRequest util (ai/http-client.util.ts),
 * avoiding extra deps like axios (following the project's design philosophy).
 */
@Injectable()
export class WechatApiService {
  private readonly logger = new Logger(WechatApiService.name);
  private readonly isMock: boolean;
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly mpAppId: string;
  private readonly mpAppSecret: string;
  private readonly mockDefaultOpenId: string;

  constructor() {
    this.isMock = process.env.WECHAT_MOCK === 'true';
    this.appId = process.env.WECHAT_APPID || '';
    this.appSecret = process.env.WECHAT_SECRET || '';
    this.mpAppId = process.env.WECHAT_MP_APPID || this.appId;
    this.mpAppSecret = process.env.WECHAT_MP_SECRET || this.appSecret;
    this.mockDefaultOpenId = process.env.WECHAT_MOCK_DEFAULT_OPENID || 'mock_wechat_user_001';
    this.validateConfig();
  }

  /** Validate config at startup; real mode requires APPID/SECRET to be filled */
  private validateConfig(): void {
    if (!this.isMock) {
      if (!this.appId || !this.appSecret) {
        this.logger.error(
          'WECHAT_APPID / WECHAT_SECRET not configured; real mode cannot work. Set WECHAT_MOCK=true for mock mode',
        );
      } else {
        this.logger.log(
          `WeChat QR login running in real mode | appId=${this.appId.slice(0, 6)}...`,
        );
      }
      if (!this.mpAppId || !this.mpAppSecret) {
        this.logger.error(
          'Mini-program credentials not configured (WECHAT_MP_APPID / WECHAT_MP_SECRET, or fallback WECHAT_APPID / WECHAT_SECRET); mini-program login cannot work',
        );
      } else {
        this.logger.log(
          `WeChat mini-program login running in real mode | mpAppId=${this.mpAppId.slice(0, 6)}...`,
        );
      }
    } else {
      this.logger.warn(
        `⚠️ WeChat login running in Mock mode (QR + mini-program) | defaultOpenId=${this.mockDefaultOpenId} | forbidden in production`,
      );
    }
  }

  /** Whether in Mock mode (queried by Controller and Service) */
  isMockMode(): boolean {
    return this.isMock;
  }

  /** Get AppId (needed by the frontend WxLogin JS) */
  getAppId(): string {
    return this.appId;
  }

  /**
   * Build the WeChat scan-authorization URL
   *
   * Real mode: https://open.weixin.qq.com/connect/qrconnect?appid=...&redirect_uri=...&response_type=code&scope=snsapi_login&state=...#wechat_redirect
   * Mock mode: returns a placeholder URL (frontend will not actually redirect, only shows the Mock placeholder UI)
   */
  buildQrcodeUrl(state: string, redirectUri: string): string {
    if (this.isMock) {
      return `mock://wechat-login?state=${state}`;
    }
    const encoded = encodeURIComponent(redirectUri);
    // self_redirect=true: WeChat redirects inside the iframe to the callback URL
    // The callback endpoint only handles login (code->token->openid->create user->state=confirmed); it does not issue a Token or redirect
    // The frontend polls /status; once it detects confirmed, it issues the Cookie and redirects to the system home page
    return `https://open.weixin.qq.com/connect/qrconnect?appid=${this.appId}&redirect_uri=${encoded}&response_type=code&scope=snsapi_login&state=${state}&self_redirect=true#wechat_redirect`;
  }

  /**
   * Exchange code for access_token
   *
   * GET https://api.weixin.qq.com/sns/oauth2/access_token?appid=APPID&secret=SECRET&code=CODE&grant_type=authorization_code
   */
  async getAccessToken(code: string): Promise<WechatAccessTokenResponse> {
    if (this.isMock) {
      this.logger.log(`[Mock] getAccessToken | code=${code} → openid=${this.mockDefaultOpenId}`);
      return {
        access_token: `mock_access_token_${Date.now()}`,
        expires_in: 7200,
        refresh_token: `mock_refresh_token_${Date.now()}`,
        openid: this.mockDefaultOpenId,
        scope: 'snsapi_login',
        unionid: `mock_unionid_${this.mockDefaultOpenId}`,
      };
    }

    const url = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${this.appId}&secret=${this.appSecret}&code=${code}&grant_type=authorization_code`;
    try {
      const resp = await httpRequest({ method: 'GET', url, timeoutMs: 10000 });
      const data = JSON.parse(resp.body) as WechatAccessTokenResponse;
      if (data.errcode) {
        throw new BadRequestException(`微信换 token 失败：[${data.errcode}] ${data.errmsg}`);
      }
      return data;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      if (err instanceof HttpError) {
        this.logger.error(`WeChat getAccessToken HTTP error: ${err.statusCode} ${err.body.slice(0, 200)}`);
        throw new BadRequestException(`微信 API 调用失败：HTTP ${err.statusCode}`);
      }
      throw new BadRequestException(`微信 API 调用异常：${(err as Error).message}`);
    }
  }

  /**
   * Mini-program wx.login code -> code2session to exchange openid (session_key held only by the backend, not issued)
   *
   * GET https://api.weixin.qq.com/sns/jscode2session?appid=APPID&secret=SECRET&js_code=JSCODE&grant_type=authorization_code
   *
   * Error-code handling (official WeChat):
   *   - 40029 code invalid/expired (5-min validity) -> WECHAT_CODE_INVALID (frontend re-fetches code and retries once)
   *   - 45011 API rate-limited (100/min) -> WECHAT_API_RATE_LIMITED
   *   - 40226 high-risk user -> WECHAT_USER_BLOCKED
   */
  async getCode2Session(loginCode: string): Promise<WechatMpCode2SessionResponse> {
    if (this.isMock) {
      this.logger.log(`[Mock] getCode2Session | code=${loginCode.slice(0, 8)}... → openid=${this.mockDefaultOpenId}`);
      return {
        openid: this.mockDefaultOpenId,
        session_key: `mock_session_key_${Date.now()}`,
        unionid: `mock_unionid_${this.mockDefaultOpenId}`,
      };
    }
    if (!this.mpAppId || !this.mpAppSecret) {
      throw new BadRequestException('小程序微信凭证未配置（WECHAT_MP_APPID / WECHAT_MP_SECRET）');
    }

    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${this.mpAppId}&secret=${this.mpAppSecret}&js_code=${encodeURIComponent(loginCode)}&grant_type=authorization_code`;
    try {
      const resp = await httpRequest({ method: 'GET', url, timeoutMs: 10000 });
      const data = JSON.parse(resp.body) as WechatMpCode2SessionResponse;
      if (data.errcode) {
        switch (data.errcode) {
          case 40029:
            throw new BadRequestException({
              code: 'WECHAT_CODE_INVALID',
              message: `微信登录凭证无效或已过期：[${data.errcode}] ${data.errmsg}`,
            });
          case 45011:
            throw new BadRequestException({
              code: 'WECHAT_API_RATE_LIMITED',
              message: `微信接口限频，请稍后重试：[${data.errcode}] ${data.errmsg}`,
            });
          case 40226:
            throw new BadRequestException({
              code: 'WECHAT_USER_BLOCKED',
              message: `高风险用户，小程序登录被拦截：[${data.errcode}] ${data.errmsg}`,
            });
          default:
            throw new BadRequestException(`微信 code2session 失败：[${data.errcode}] ${data.errmsg}`);
        }
      }
      return data;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      if (err instanceof HttpError) {
        this.logger.error(`WeChat code2session HTTP error: ${err.statusCode} ${err.body.slice(0, 200)}`);
        throw new BadRequestException(`微信 API 调用失败：HTTP ${err.statusCode}`);
      }
      throw new BadRequestException(`微信 API 调用异常：${(err as Error).message}`);
    }
  }

  /**
   * Pull user info with access_token
   *
   * GET https://api.weixin.qq.com/sns/userinfo?access_token=ACCESS_TOKEN&openid=OPENID
   */
  async getUserInfo(accessToken: string, openid: string): Promise<WechatUserInfoResponse> {
    if (this.isMock) {
      return {
        openid: this.mockDefaultOpenId,
        nickname: '微信测试用户',
        sex: 0,
        province: '',
        city: '',
        country: '',
        headimgurl: '',
        privilege: [],
        unionid: `mock_unionid_${this.mockDefaultOpenId}`,
      };
    }

    const url = `https://api.weixin.qq.com/sns/userinfo?access_token=${accessToken}&openid=${openid}`;
    try {
      const resp = await httpRequest({ method: 'GET', url, timeoutMs: 10000 });
      const data = JSON.parse(resp.body) as WechatUserInfoResponse;
      if (data.errcode) {
        throw new BadRequestException(`微信拉取用户信息失败：[${data.errcode}] ${data.errmsg}`);
      }
      return data;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      if (err instanceof HttpError) {
        this.logger.error(`WeChat getUserInfo HTTP error: ${err.statusCode} ${err.body.slice(0, 200)}`);
        throw new BadRequestException(`微信 API 调用失败：HTTP ${err.statusCode}`);
      }
      throw new BadRequestException(`微信 API 调用异常：${(err as Error).message}`);
    }
  }
}
