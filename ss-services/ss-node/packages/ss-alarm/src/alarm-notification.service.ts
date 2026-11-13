// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, Optional } from '@nestjs/common';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { EventBusService, WechatSubscribeMessageChannel } from '@ss-node/ss-core';
import { AlarmRecord } from './entities/alarm.entity';
import { SmsNotificationChannel } from './channels/sms-notification.channel';
import { TtsNotificationChannel } from './channels/tts-notification.channel';
import { NotificationPayload as ChannelNotificationPayload } from './channels/notification-channel.interface';

export interface NotificationChannel {
  type: 'email' | 'sound' | 'popup' | 'sms' | 'tts' | 'webhook' | 'wechatSubscribe';
  enabled: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: Record<string, any>;
}

export interface NotificationPayload {
  alarmId: string;
  ruleName: string;
  level: string;
  message: string;
  value: number;
  timestamp: Date;
  channels: string[];
}

@Injectable()
export class AlarmNotificationService {
  private readonly logger = new Logger(AlarmNotificationService.name);

  private channels: NotificationChannel[] = [
    { type: 'email', enabled: false, config: { smtpHost: '', smtpPort: 587, from: '', to: [] } },
    { type: 'sound', enabled: true, config: { volume: 0.8, repeat: 3 } },
    { type: 'popup', enabled: true, config: { duration: 10000, requireAck: true } },
    { type: 'sms', enabled: false, config: { provider: '', apiKey: '', phones: [] } },
    { type: 'tts', enabled: false, config: { provider: '', apiKey: '', phones: [] } },
    { type: 'webhook', enabled: false, config: { url: '', headers: {} } },
    // WeChat mini-program subscription messages: template-config driven; disabled when unconfigured (and not Mock); default alarm rules are pushed to subscribed users without explicit opt-in (the channel filters by quota/preference internally)
    {
      type: 'wechatSubscribe',
      enabled:
        process.env.WECHAT_MOCK === 'true' || Boolean(process.env.WECHAT_SUBSCRIBE_TEMPLATE_ALARM),
      config: {},
    },
  ];

  constructor(
    private readonly eventBusService: EventBusService,
    @Optional() private readonly smsChannel?: SmsNotificationChannel,
    @Optional() private readonly ttsChannel?: TtsNotificationChannel,
    @Optional() private readonly wechatSubscribeChannel?: WechatSubscribeMessageChannel,
  ) {}

  configureChannel(type: string, config: Partial<NotificationChannel>): void {
    const index = this.channels.findIndex((c) => c.type === type);
    if (index >= 0) {
      this.channels[index] = { ...this.channels[index], ...config };
      this.logger.log(`Notification channel ${type} configured`);
    }
  }

  getChannels(): NotificationChannel[] {
    return [...this.channels];
  }

  getEnabledChannels(): string[] {
    return this.channels.filter((c) => c.enabled).map((c) => c.type);
  }

  async sendNotification(payload: NotificationPayload): Promise<void> {
    const enabledChannels = this.channels.filter(
      (c) => c.enabled && payload.channels.includes(c.type),
    );

    for (const channel of enabledChannels) {
      try {
        await this.dispatchToChannel(channel.type, payload);
      } catch (error) {
        this.logger.error(`Failed to send ${channel.type} notification: ${error.message}`);
      }
    }

    this.eventBusService.emit('alarm.notification.sent', {
      alarmId: payload.alarmId,
      channels: enabledChannels.map((c) => c.type),
      timestamp: Date.now(),
    });
  }

  private async dispatchToChannel(
    channelType: string,
    payload: NotificationPayload,
  ): Promise<void> {
    switch (channelType) {
      case 'email':
        await this.sendEmail(payload);
        break;
      case 'sound':
        this.triggerSound(payload);
        break;
      case 'popup':
        this.triggerPopup(payload);
        break;
      case 'sms':
        await this.dispatchSmsNotification(payload);
        break;
      case 'tts':
        await this.dispatchTtsNotification(payload);
        break;
      case 'webhook':
        await this.callWebhook(payload);
        break;
      case 'wechatSubscribe':
        await this.dispatchWechatSubscribeNotification(payload);
        break;
    }
    this.logger.debug(`Dispatched ${channelType} notification for alarm ${payload.alarmId}`);
  }

  private async sendEmail(payload: NotificationPayload): Promise<void> {
    const channel = this.channels.find((c) => c.type === 'email');
    if (!channel?.enabled) return;

    const template = this.buildEmailTemplate(payload);

    this.logger.log(`[EMAIL] To: ${channel.config.to} | Subject: ${template.subject}`);
    this.logger.log(`[EMAIL] Body: ${template.body.substring(0, 200)}...`);

    // If SMTP is configured, send via nodemailer
    if (channel.config.smtpHost) {
      try {
        // Dynamically import nodemailer (avoid a hard dependency)
        const nodemailer = await this.loadNodemailer();
        if (nodemailer) {
          const transporter = nodemailer.createTransport({
            host: channel.config.smtpHost,
            port: channel.config.smtpPort || 587,
            secure: channel.config.smtpPort === 465,
            auth: channel.config.smtpUser
              ? { user: channel.config.smtpUser, pass: channel.config.smtpPass }
              : undefined,
          });

          await transporter.sendMail({
            from: channel.config.from || 'scada@localhost',
            to: Array.isArray(channel.config.to) ? channel.config.to.join(',') : channel.config.to,
            subject: template.subject,
            html: template.body,
          });
          this.logger.log(`[EMAIL] Sent successfully to ${channel.config.to}`);
        }
      } catch (error) {
        this.logger.error(`[EMAIL] Failed to send: ${(error as Error).message}`);
      }
    }
  }

  /** Build the email template (supports variable substitution) */
  private buildEmailTemplate(payload: NotificationPayload): { subject: string; body: string } {
    const levelLabels: Record<string, string> = {
      info: '信息',
      warning: '警告',
      error: '错误',
      critical: '紧急',
    };
    const levelLabel = levelLabels[payload.level] || payload.level;

    const subject = `[SCADA报警-${levelLabel}] ${payload.ruleName}`;

    const body = `
      <div style="font-family: Arial, sans-serif; padding: 20px; border-left: 4px solid #e74c3c;">
        <h2 style="color: #e74c3c;">SCADA 报警通知</h2>
        <table style="border-collapse: collapse; width: 100%;">
          <tr><td style="padding: 8px; font-weight: bold;">报警规则</td><td>${payload.ruleName}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold;">报警级别</td><td style="color: #e74c3c; font-weight: bold;">${levelLabel}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold;">报警值</td><td>${payload.value}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold;">报警时间</td><td>${payload.timestamp.toLocaleString()}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold;">报警详情</td><td>${payload.message}</td></tr>
        </table>
        <p style="color: #666; margin-top: 20px;">此邮件由 SCADA 系统自动发送，请勿回复。</p>
      </div>
    `;

    return { subject, body };
  }

  /** Load nodemailer dynamically */
  private async loadNodemailer(): Promise<{
    createTransport(config: Record<string, unknown>): {
      sendMail(options: Record<string, unknown>): Promise<unknown>;
    };
  } | null> {
    try {
      // @ts-expect-error - nodemailer is an optional dependency, dynamically imported
      return await import('nodemailer');
    } catch {
      this.logger.warn('nodemailer not installed, email will be logged only');
      return null;
    }
  }

  private triggerSound(payload: NotificationPayload): void {
    const channel = this.channels.find((c) => c.type === 'sound');
    if (!channel?.enabled) return;

    this.eventBusService.emit('alarm.sound.trigger', {
      alarmId: payload.alarmId,
      level: payload.level,
      config: channel.config,
    });
  }

  private triggerPopup(payload: NotificationPayload): void {
    const channel = this.channels.find((c) => c.type === 'popup');
    if (!channel?.enabled) return;

    this.eventBusService.emit('alarm.popup.show', {
      alarmId: payload.alarmId,
      ruleName: payload.ruleName,
      level: payload.level,
      message: payload.message,
      value: payload.value,
      timestamp: payload.timestamp,
      config: channel.config,
    });
  }

  /**
   * Dispatch alarm notifications via the SMS channel (internal scheduling)
   */
  private async dispatchSmsNotification(payload: NotificationPayload): Promise<void> {
    const channel = this.channels.find((c) => c.type === 'sms');
    if (!channel?.enabled) return;

    const phones: string[] = Array.isArray(channel.config.phones) ? channel.config.phones : [];
    if (!phones.length) {
      this.logger.warn('[SMS] No recipient phone number configured, skipping send');
      return;
    }

    if (this.smsChannel) {
      const channelPayload = this.toChannelPayload(payload);
      const ok = await this.smsChannel.send(phones, channelPayload);
      if (!ok) {
        this.logger.warn(`[SMS] Send failed -> ${phones.join(',')}`);
      }
    } else {
      this.logger.log(
        `[SMS] Alarm: ${payload.ruleName} | Level: ${payload.level} (channel not injected, log only)`,
      );
    }
  }

  /**
   * Dispatch alarm notifications via the TTS voice channel (internal scheduling)
   */
  private async dispatchTtsNotification(payload: NotificationPayload): Promise<void> {
    const channel = this.channels.find((c) => c.type === 'tts');
    if (!channel?.enabled) return;

    const phones: string[] = Array.isArray(channel.config.phones) ? channel.config.phones : [];
    if (!phones.length) {
      this.logger.warn('[TTS] No callee number configured, skipping call');
      return;
    }

    if (this.ttsChannel) {
      const channelPayload = this.toChannelPayload(payload);
      const ok = await this.ttsChannel.send(phones, channelPayload);
      if (!ok) {
        this.logger.warn(`[TTS] Call failed -> ${phones.join(',')}`);
      }
    } else {
      this.logger.log(
        `[TTS] Alarm: ${payload.ruleName} | Level: ${payload.level} (channel not injected, log only)`,
      );
    }
  }

  /**
   * Dispatch alarm notifications via the WeChat mini-program subscription-message channel (internal scheduling)
   * Safely degrades to logging when the channel is not injected (module not registered);
   * recipients are filtered internally by the channel via authorization quota + notification preference + rate limiting, so no external spec is needed.
   */
  private async dispatchWechatSubscribeNotification(payload: NotificationPayload): Promise<void> {
    const channel = this.channels.find((c) => c.type === 'wechatSubscribe');
    if (!channel?.enabled) return;

    if (this.wechatSubscribeChannel) {
      await this.wechatSubscribeChannel.notifySubscribedUsers({
        title: payload.ruleName,
        message: payload.message,
        level: payload.level,
        // Carry the alarm record ID with the jump page (phase 2, 10 #7: mini-program cold-start deep-links to alarm details)
        alarmRecordId: payload.alarmId,
        timestamp: payload.timestamp,
      });
    } else {
      this.logger.log(
        `[WECHAT_SUBSCRIBE] Alarm: ${payload.ruleName} | Level: ${payload.level} (channel not injected, log only)`,
      );
    }
  }

  /**
   * Send an SMS notification (direct call)
   * @param phoneNumbers phone number list
   * @param alarm the alarm record
   */
  async sendSms(phoneNumbers: string[], alarm: AlarmRecord): Promise<void> {
    if (!phoneNumbers.length) {
      this.logger.warn('[SMS] No phone numbers provided, skipping send');
      return;
    }

    if (!this.smsChannel) {
      this.logger.warn('[SMS] SMS channel not injected, cannot send');
      return;
    }

    const payload = this.alarmToChannelPayload(alarm);
    const ok = await this.smsChannel.send(phoneNumbers, payload);
    if (!ok) {
      this.logger.warn(`[SMS] Send failed -> ${phoneNumbers.join(',')}`);
    }
  }

  /**
   * Send a TTS voice notification (direct call)
   * @param phoneNumbers called-number list
   * @param alarm the alarm record
   */
  async sendTts(phoneNumbers: string[], alarm: AlarmRecord): Promise<void> {
    if (!phoneNumbers.length) {
      this.logger.warn('[TTS] No callee number provided, skipping call');
      return;
    }

    if (!this.ttsChannel) {
      this.logger.warn('[TTS] Voice channel not injected, cannot call');
      return;
    }

    const payload = this.alarmToChannelPayload(alarm);
    const ok = await this.ttsChannel.send(phoneNumbers, payload);
    if (!ok) {
      this.logger.warn(`[TTS] Call failed -> ${phoneNumbers.join(',')}`);
    }
  }

  /**
   * Convert the internal NotificationPayload into the channel NotificationPayload
   */
  private toChannelPayload(payload: NotificationPayload): ChannelNotificationPayload {
    return {
      title: payload.ruleName,
      message: payload.message,
      level: payload.level,
      timestamp: payload.timestamp,
    };
  }

  /**
   * Convert the AlarmRecord into the channel NotificationPayload
   */
  private alarmToChannelPayload(alarm: AlarmRecord): ChannelNotificationPayload {
    const ruleName = alarm.rule?.name || '报警通知';
    const deviceName = alarm.rule?.tag?.name;
    return {
      title: ruleName,
      message: alarm.message,
      level: alarm.level,
      deviceName,
      timestamp: alarm.createdAt,
    };
  }

  private async callWebhook(payload: NotificationPayload): Promise<void> {
    const channel = this.channels.find((c) => c.type === 'webhook');
    if (!channel?.enabled || !channel.config.url) return;

    const url = channel.config.url;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(channel.config.headers || {}),
    };

    const body = JSON.stringify({
      alarmId: payload.alarmId,
      ruleName: payload.ruleName,
      level: payload.level,
      message: payload.message,
      value: payload.value,
      timestamp: payload.timestamp.toISOString(),
    });

    await this.sendHttpPost(url, body, headers);
  }

  /** Send an HTTP POST request (supports both http and https) */
  private sendHttpPost(
    urlString: string,
    body: string,
    headers: Record<string, string>,
  ): Promise<void> {
    return new Promise((resolve, _reject) => {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(urlString);
      } catch {
        this.logger.error(`[WEBHOOK] Invalid URL: ${urlString}`);
        return resolve();
      }

      const isHttps = parsedUrl.protocol === 'https:';
      const transport = isHttps ? https : http;

      const options: http.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(body).toString(),
        },
        timeout: 10000,
      };

      const req = transport.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            this.logger.log(`[WEBHOOK] Sent successfully to ${urlString}: ${res.statusCode}`);
          } else {
            this.logger.warn(
              `[WEBHOOK] Response ${res.statusCode} from ${urlString}: ${data.substring(0, 200)}`,
            );
          }
          resolve();
        });
      });

      req.on('timeout', () => {
        req.destroy();
        this.logger.error(`[WEBHOOK] Request timeout (10s) to ${urlString}`);
        resolve();
      });

      req.on('error', (err) => {
        this.logger.error(`[WEBHOOK] Request failed to ${urlString}: ${err.message}`);
        resolve();
      });

      req.write(body);
      req.end();
    });
  }
}
