// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * WeChat mini-program subscribe-message channel (Module 10)
 *
 * Config-driven + degrade when unconfigured:
 *   - Template ID: WECHAT_SUBSCRIBE_TEMPLATE_ALARM (externally applied in the WeChat console; skipped with warn log when unconfigured)
 *   - Field mapping: WECHAT_SUBSCRIBE_TEMPLATE_FIELDS (JSON, payload field -> template field name), default mapping when absent
 *   - Rate limit: WECHAT_SUBSCRIBE_RATE_LIMIT_PER_HOUR (per-user hourly cap, default 20)
 *
 * Quota model: one-time subscribe, authorization accept +1 / successful send -1; 43101 (user rejected) resets to 0.
 * Mock mode (WECHAT_MOCK=true): logs only, no actual WeChat API call.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { httpRequest } from '../../ai/http-client.util';
import {
  WechatSubscribeAuthorization,
} from './entities/wechat-subscribe-authorization.entity';
import {
  ALARM_LEVEL_SEVERITY,
  MinimumAlarmLevel,
  WechatNotificationPreference,
} from './entities/wechat-notification-preference.entity';

/** Subscribe-message payload (same shape as the ss-alarm channel payload; ss-core does not reverse-depend, declared independently) */
export interface SubscribeMessagePayload {
  title: string;
  message: string;
  level: string;
  deviceName?: string;
  /** Alarm-record ID (Phase2 10 #7: carried with the landing page so the mini-program cold-start jumps straight to alarm detail) */
  alarmRecordId?: string;
  timestamp: Date;
}

/** Device-status subscribe-message payload (Phase2 10 #6: offline/fault push only) */
export interface DeviceStatusSubscribePayload {
  deviceName: string;
  /** Device status (DeviceStatus enum value, e.g. offline/error) */
  status: string;
  projectId?: string;
  timestamp: Date;
}

/** Template field mapping: payload field -> WeChat template field name */
interface TemplateFieldMapping {
  title: string;
  message: string;
  level: string;
  time: string;
}

/** Device-status template field mapping */
interface DeviceStatusTemplateFieldMapping {
  device: string;
  status: string;
  time: string;
}

const DEFAULT_FIELD_MAPPING: TemplateFieldMapping = {
  title: 'thing1',
  message: 'thing2',
  level: 'phrase3',
  time: 'time4',
};

const DEFAULT_DEVICE_STATUS_FIELD_MAPPING: DeviceStatusTemplateFieldMapping = {
  device: 'thing1',
  status: 'phrase2',
  time: 'time3',
};

/** Device-status template placeholder ID in Mock mode (flow still works when no real template is configured) */
export const MOCK_DEVICE_STATUS_TEMPLATE_ID = 'mock-device-status-template';

/** WeChat field-length constraints (thing 20 chars / phrase 5 chars, truncated when exceeded) */
const THING_FIELD_MAX_LENGTH = 20;
const PHRASE_FIELD_MAX_LENGTH = 5;

/** Per-user send rate-limit sliding window (ms) */
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

@Injectable()
export class WechatSubscribeMessageChannel {
  readonly name = 'wechatSubscribe';

  private readonly logger = new Logger(WechatSubscribeMessageChannel.name);
  private readonly isMock: boolean;
  private readonly mpAppId: string;
  private readonly mpAppSecret: string;
  private readonly alarmTemplateId: string;
  private readonly deviceStatusTemplateId: string;
  private readonly fieldMapping: TemplateFieldMapping;
  private readonly deviceStatusFieldMapping: DeviceStatusTemplateFieldMapping;
  private readonly rateLimitPerHour: number;

  /** Mini-program global access_token cache (expires 60s early) */
  private cachedAccessToken: { token: string; expireAt: number } | null = null;
  /** Per-user send-timestamp window (for rate limiting) */
  private readonly sentTimestampsByOpenId = new Map<string, number[]>();

  constructor(
    @InjectRepository(WechatSubscribeAuthorization)
    private readonly authorizationRepo: Repository<WechatSubscribeAuthorization>,
    @InjectRepository(WechatNotificationPreference)
    private readonly preferenceRepo: Repository<WechatNotificationPreference>,
  ) {
    this.isMock = process.env.WECHAT_MOCK === 'true';
    this.mpAppId = process.env.WECHAT_MP_APPID || process.env.WECHAT_APPID || '';
    this.mpAppSecret = process.env.WECHAT_MP_SECRET || process.env.WECHAT_SECRET || '';
    this.alarmTemplateId = process.env.WECHAT_SUBSCRIBE_TEMPLATE_ALARM || '';
    this.deviceStatusTemplateId = process.env.WECHAT_SUBSCRIBE_TEMPLATE_DEVICE_STATUS || '';
    this.fieldMapping = this.resolveFieldMapping();
    this.deviceStatusFieldMapping = this.resolveDeviceStatusFieldMapping();
    this.rateLimitPerHour = Number(process.env.WECHAT_SUBSCRIBE_RATE_LIMIT_PER_HOUR) || 20;

    if (!this.isConfigured()) {
      this.logger.warn(
        '订阅消息通道未完整配置（模板 ID / 小程序凭证缺失），报警订阅消息将跳过发送',
      );
    }
  }

  /** Alarm template ID (used by the frontend authorization flow; empty string when unconfigured) */
  getAlarmTemplateId(): string {
    return this.alarmTemplateId;
  }

  /** Device-status template ID (used by the frontend authorization flow; empty string when unconfigured) */
  getDeviceStatusTemplateId(): string {
    return this.deviceStatusTemplateId;
  }

  /** Template config complete (or in Mock mode) */
  isConfigured(): boolean {
    if (this.isMock) return true;
    return Boolean(this.alarmTemplateId && this.mpAppId && this.mpAppSecret);
  }

  /**
   * Send alarm notifications to all subscribed users (called by the alarm dispatcher)
   * Filters: authorization quota > 0 + notification preference enabled + level reaches preference threshold + user rate limit not exceeded
   */
  async notifySubscribedUsers(payload: SubscribeMessagePayload): Promise<boolean> {
    if (!this.isConfigured()) {
      this.logger.warn('[SUBSCRIBE] 模板未配置，跳过报警订阅消息发送');
      return false;
    }

    const authorizations = await this.authorizationRepo.find({
      where: {
        templateId: this.alarmTemplateId,
        authorizationStatus: 'accept',
        quotaRemaining: MoreThan(0),
      },
    });
    if (authorizations.length === 0) {
      this.logger.debug('[SUBSCRIBE] 无可用订阅授权（配额为 0 或未授权），跳过发送');
      return false;
    }

    const preferences = await this.preferenceRepo.find({
      where: { alarmNotificationEnabled: true },
    });
    const preferenceByUserId = new Map(preferences.map((p) => [p.userId, p]));

    let sentCount = 0;
    for (const authorization of authorizations) {
      const preference = preferenceByUserId.get(authorization.userId);
      // No preference record counts as default receive (entity default enabled), but the level threshold must still be met
      if (preference) {
        if (!preference.alarmNotificationEnabled) {
          continue;
        }
        if (!this.levelMeetsThreshold(payload.level, preference.minimumAlarmLevel)) {
          continue;
        }
      }
      if (this.isRateLimited(authorization.mpOpenId)) {
        this.logger.warn(`[SUBSCRIBE] 用户限频跳过：openid=${authorization.mpOpenId.slice(0, 6)}...`);
        continue;
      }
      const sent = await this.sendToOpenId(
        authorization,
        this.alarmTemplateId,
        this.resolveAlarmNavigationPage(payload),
        this.buildTemplateData(payload),
      );
      if (sent) {
        sentCount += 1;
      }
    }

    this.logger.log(`[SUBSCRIBE] 报警订阅消息下发完成：成功 ${sentCount}/${authorizations.length}`);
    return sentCount > 0;
  }

  /**
   * Send device-status notifications to all subscribed users (Phase2 10 #6, called by the ss-device event subscriber)
   * Reuses the quota model and per-user rate limit; skipped with warn log when the device-status template is unconfigured (Mock mode uses the placeholder template).
   * Note: device-status notifications are not constrained by alarm preferences (switch/level threshold); they are an independent notification category.
   */
  async notifyDeviceStatus(payload: DeviceStatusSubscribePayload): Promise<boolean> {
    if (!this.isDeviceStatusConfigured()) {
      this.logger.warn('[SUBSCRIBE] 设备状态模板未配置，跳过设备状态订阅消息发送');
      return false;
    }

    const templateId = this.deviceStatusTemplateId || MOCK_DEVICE_STATUS_TEMPLATE_ID;
    const authorizations = await this.authorizationRepo.find({
      where: {
        templateId,
        authorizationStatus: 'accept',
        quotaRemaining: MoreThan(0),
      },
    });
    if (authorizations.length === 0) {
      this.logger.debug('[SUBSCRIBE] 设备状态模板无可用订阅授权，跳过发送');
      return false;
    }

    let sentCount = 0;
    for (const authorization of authorizations) {
      if (this.isRateLimited(authorization.mpOpenId)) {
        this.logger.warn(`[SUBSCRIBE] 用户限频跳过：openid=${authorization.mpOpenId.slice(0, 6)}...`);
        continue;
      }
      const sent = await this.sendToOpenId(
        authorization,
        templateId,
        'pages/device/list',
        this.buildDeviceStatusTemplateData(payload),
      );
      if (sent) {
        sentCount += 1;
      }
    }

    this.logger.log(
      `[SUBSCRIBE] 设备状态订阅消息下发完成：成功 ${sentCount}/${authorizations.length} | ${payload.deviceName} → ${payload.status}`,
    );
    return sentCount > 0;
  }

  /** Device-status template config complete (or in Mock mode) */
  private isDeviceStatusConfigured(): boolean {
    if (this.isMock) return true;
    return Boolean(this.deviceStatusTemplateId && this.mpAppId && this.mpAppSecret);
  }

  /** Whether the level reaches the user's preference threshold */
  private levelMeetsThreshold(level: string, minimumLevel: MinimumAlarmLevel): boolean {
    const severity = ALARM_LEVEL_SEVERITY[level as MinimumAlarmLevel];
    if (severity === undefined) return true;
    return severity >= ALARM_LEVEL_SEVERITY[minimumLevel];
  }

  /** Alarm subscribe-message landing page (Phase2 10 #7: params attached when a record ID exists; parsed on mini-program cold start to jump straight to detail) */
  private resolveAlarmNavigationPage(payload: SubscribeMessagePayload): string {
    if (!payload.alarmRecordId) {
      return 'pages/alarm/list';
    }
    return `pages/alarm/list?alarmRecordId=${encodeURIComponent(payload.alarmRecordId)}`;
  }

  /** Per-user rate-limit check (sliding-window counting) */
  private isRateLimited(openId: string): boolean {
    const now = Date.now();
    const timestamps = (this.sentTimestampsByOpenId.get(openId) || []).filter(
      (sentAt) => now - sentAt < RATE_LIMIT_WINDOW_MS,
    );
    this.sentTimestampsByOpenId.set(openId, timestamps);
    return timestamps.length >= this.rateLimitPerHour;
  }

  /** Send to a single authorization record and maintain quota (template/landing page/data specified by caller; shared by alarm and device status) */
  private async sendToOpenId(
    authorization: WechatSubscribeAuthorization,
    templateId: string,
    page: string,
    templateData: Record<string, { value: string }>,
  ): Promise<boolean> {
    if (this.isMock) {
      this.logger.log(
        `[Mock] 订阅消息下发：openid=${authorization.mpOpenId} | template=${templateId}`,
      );
      authorization.quotaRemaining = Math.max(0, authorization.quotaRemaining - 1);
      await this.authorizationRepo.save(authorization);
      this.recordSent(authorization.mpOpenId);
      return true;
    }

    try {
      const accessToken = await this.getMpAccessToken();
      const url = `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${accessToken}`;
      const body = {
        touser: authorization.mpOpenId,
        template_id: templateId,
        page,
        data: templateData,
      };
      const resp = await httpRequest({
        method: 'POST',
        url,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        timeoutMs: 10000,
      });
      const data = JSON.parse(resp.body) as { errcode?: number; errmsg?: string };
      if (data.errcode === 0) {
        authorization.quotaRemaining = Math.max(0, authorization.quotaRemaining - 1);
        await this.authorizationRepo.save(authorization);
        this.recordSent(authorization.mpOpenId);
        return true;
      }
      // 43101: user rejected messages (authorization expired) -> quota reset to 0, waiting for frontend renewal
      if (data.errcode === 43101) {
        authorization.quotaRemaining = 0;
        await this.authorizationRepo.save(authorization);
      }
      this.logger.warn(
        `[SUBSCRIBE] 下发失败：[${data.errcode}] ${data.errmsg} | openid=${authorization.mpOpenId.slice(0, 6)}...`,
      );
      return false;
    } catch (error) {
      // Send failure degrades to a log, not blocking the main alarm flow
      this.logger.error(`[SUBSCRIBE] 下发异常：${(error as Error).message}`);
      return false;
    }
  }

  private recordSent(openId: string): void {
    const timestamps = this.sentTimestampsByOpenId.get(openId) || [];
    timestamps.push(Date.now());
    this.sentTimestampsByOpenId.set(openId, timestamps);
  }

  /** Build template data by field mapping (type-prefix constraints: thing 20 chars / phrase 5 chars) */
  private buildTemplateData(payload: SubscribeMessagePayload): Record<string, { value: string }> {
    const levelLabels: Record<string, string> = {
      info: '提示',
      warning: '警告',
      error: '严重',
      critical: '紧急',
    };
    const timeText = payload.timestamp.toLocaleString('zh-CN', { hour12: false });
    return {
      [this.fieldMapping.title]: { value: this.truncate(payload.title, THING_FIELD_MAX_LENGTH) },
      [this.fieldMapping.message]: {
        value: this.truncate(payload.message, THING_FIELD_MAX_LENGTH),
      },
      [this.fieldMapping.level]: {
        value: this.truncate(levelLabels[payload.level] || payload.level, PHRASE_FIELD_MAX_LENGTH),
      },
      [this.fieldMapping.time]: { value: timeText },
    };
  }

  private truncate(text: string, maxLength: number): string {
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
  }

  /** Device-status template data (device name thing 20 chars / status text phrase 5 chars / time) */
  private buildDeviceStatusTemplateData(
    payload: DeviceStatusSubscribePayload,
  ): Record<string, { value: string }> {
    const statusLabels: Record<string, string> = {
      offline: '离线',
      error: '故障',
      degraded: '异常',
    };
    const timeText = payload.timestamp.toLocaleString('zh-CN', { hour12: false });
    return {
      [this.deviceStatusFieldMapping.device]: {
        value: this.truncate(payload.deviceName, THING_FIELD_MAX_LENGTH),
      },
      [this.deviceStatusFieldMapping.status]: {
        value: this.truncate(statusLabels[payload.status] || payload.status, PHRASE_FIELD_MAX_LENGTH),
      },
      [this.deviceStatusFieldMapping.time]: { value: timeText },
    };
  }

  /** Mini-program global access_token (7200s validity, refreshed 60s early) */
  private async getMpAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedAccessToken && this.cachedAccessToken.expireAt > now) {
      return this.cachedAccessToken.token;
    }
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${this.mpAppId}&secret=${this.mpAppSecret}`;
    const resp = await httpRequest({ method: 'GET', url, timeoutMs: 10000 });
    const data = JSON.parse(resp.body) as {
      access_token?: string;
      expires_in?: number;
      errcode?: number;
      errmsg?: string;
    };
    if (!data.access_token) {
      throw new Error(`获取小程序 access_token 失败：[${data.errcode}] ${data.errmsg}`);
    }
    this.cachedAccessToken = {
      token: data.access_token,
      expireAt: now + (data.expires_in || 7200) * 1000 - 60_000,
    };
    return data.access_token;
  }

  /** Field-mapping resolution: WECHAT_SUBSCRIBE_TEMPLATE_FIELDS JSON overrides the default mapping */
  private resolveFieldMapping(): TemplateFieldMapping {
    const rawMapping = process.env.WECHAT_SUBSCRIBE_TEMPLATE_FIELDS;
    if (!rawMapping) {
      return DEFAULT_FIELD_MAPPING;
    }
    try {
      const parsed = JSON.parse(rawMapping) as Partial<TemplateFieldMapping>;
      return { ...DEFAULT_FIELD_MAPPING, ...parsed };
    } catch {
      this.logger.warn('WECHAT_SUBSCRIBE_TEMPLATE_FIELDS JSON 解析失败，使用默认字段映射');
      return DEFAULT_FIELD_MAPPING;
    }
  }

  /** Device-status field-mapping resolution: WECHAT_SUBSCRIBE_TEMPLATE_DEVICE_FIELDS JSON overrides the default mapping */
  private resolveDeviceStatusFieldMapping(): DeviceStatusTemplateFieldMapping {
    const rawMapping = process.env.WECHAT_SUBSCRIBE_TEMPLATE_DEVICE_FIELDS;
    if (!rawMapping) {
      return DEFAULT_DEVICE_STATUS_FIELD_MAPPING;
    }
    try {
      const parsed = JSON.parse(rawMapping) as Partial<DeviceStatusTemplateFieldMapping>;
      return { ...DEFAULT_DEVICE_STATUS_FIELD_MAPPING, ...parsed };
    } catch {
      this.logger.warn('WECHAT_SUBSCRIBE_TEMPLATE_DEVICE_FIELDS JSON 解析失败，使用默认字段映射');
      return DEFAULT_DEVICE_STATUS_FIELD_MAPPING;
    }
  }
}
