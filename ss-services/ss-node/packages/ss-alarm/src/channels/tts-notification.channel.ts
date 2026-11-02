// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Inject, Injectable, Optional } from '@nestjs/common';
import * as crypto from 'crypto';
import { StructuredLogger } from '@ss-node/ss-core';
import { INotificationChannel, NotificationPayload } from './notification-channel.interface';

/**
 * Structured types for the system-config service (avoid a direct ss-system import that would cause circular deps and test-load issues)
 */
export interface SystemConfigServiceLike {
  get(key: string): Promise<string | null>;
}

/**
 * Voice-broadcast (TTS) service provider type
 */
export type TtsProvider = 'aliyun';

/**
 * TTS voice-broadcast notification channel
 *
 * Supports Aliyun voice notification (SingleCallByTts).
 * Required system config:
 * - TTS_PROVIDER: 'aliyun'
 * - TTS_API_KEY: AccessKeyId
 * - TTS_API_SECRET: AccessKeySecret
 * - TTS_CALLED_NUMBER: caller number (optional, defaults to the target number)
 *
 * Degrades gracefully when unavailable (logs only), without affecting the main alarm flow.
 */
@Injectable()
export class TtsNotificationChannel implements INotificationChannel {
  readonly name = 'tts';

  private readonly logger = new StructuredLogger();

  constructor(
    @Optional()
    @Inject('SystemConfigService')
    private readonly configService?: SystemConfigServiceLike,
  ) {
    this.logger.setContext('context', 'TtsNotificationChannel');
  }

  /**
   * Send a voice notification (interface implementation)
   */
  async send(targets: string[], payload: NotificationPayload): Promise<boolean> {
    const message = this.buildTtsMessage(payload);
    return this.callInternal(targets, message, payload);
  }

  /**
   * Place a voice call and broadcast the message
   * @param to called-number list
   * @param message broadcast content
   */
  async call(to: string[], message: string): Promise<boolean> {
    return this.callInternal(to, message, undefined);
  }

  /**
   * Build the TTS broadcast message
   */
  private buildTtsMessage(payload: NotificationPayload): string {
    const levelLabel = this.getLevelLabel(payload.level);
    const devicePart = payload.deviceName ? `${payload.deviceName}，` : '';
    return `SCADA报警，${levelLabel}级别。${devicePart}${payload.message}。`;
  }

  /**
   * Get the alarm severity label
   */
  private getLevelLabel(level: string): string {
    const labels: Record<string, string> = {
      info: '信息',
      warning: '警告',
      error: '错误',
      critical: '紧急',
    };
    return labels[level] || level;
  }

  /**
   * Actual call logic
   */
  private async callInternal(
    phones: string[],
    message: string,
    payload?: NotificationPayload,
  ): Promise<boolean> {
    if (!this.configService) {
      this.logger.warn('SystemConfigService 不可用，语音通道未启用');
      return false;
    }

    if (!phones.length) {
      this.logger.warn('未提供被叫号码，跳过语音拨打');
      return false;
    }

    try {
      const provider = (await this.configService.get('TTS_PROVIDER')) || '';
      const apiKey = await this.configService.get('TTS_API_KEY');
      const apiSecret = await this.configService.get('TTS_API_SECRET');
      const calledNumber = await this.configService.get('TTS_CALLED_NUMBER');

      if (!apiKey || !apiSecret) {
        this.logger.warn('语音通道未配置 API 密钥，跳过拨打');
        return false;
      }

      switch (provider.toLowerCase()) {
        case 'aliyun':
          return await this.callViaAliyun({
            apiKey,
            apiSecret,
            calledNumber: calledNumber || '',
            phones,
            message,
            payload,
          });

        default:
          this.logger.warn(`未知的语音提供商: ${provider}（支持: aliyun）`);
          return false;
      }
    } catch (error) {
      this.logger.error(`语音拨打失败: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Aliyun voice TTS call (RPC style, HMAC-SHA1 signature)
   * Uses the SingleCallByTts API to call each number
   */
  private async callViaAliyun(params: {
    apiKey: string;
    apiSecret: string;
    calledNumber: string;
    phones: string[];
    message: string;
    payload?: NotificationPayload;
  }): Promise<boolean> {
    const endpoint = 'https://dyvmsapi.aliyuncs.com';
    const ttsCode = 'TTS_SCADA_ALARM';

    const templateParam = params.payload
      ? JSON.stringify({
          level: params.payload.level,
          device: params.payload.deviceName || '',
          message: params.payload.message,
        })
      : JSON.stringify({ content: params.message });

    let allSuccess = true;

    for (const phone of params.phones) {
      const requestParams: Record<string, string> = {
        Action: 'SingleCallByTts',
        Version: '2017-05-25',
        Format: 'JSON',
        AccessKeyId: params.apiKey,
        SignatureMethod: 'HMAC-SHA1',
        SignatureVersion: '1.0',
        SignatureNonce: crypto.randomUUID(),
        Timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
        CalledNumber: phone,
        TtsCode: ttsCode,
        TtsParam: templateParam,
      };

      if (params.calledNumber) {
        requestParams.CalledShowNumber = params.calledNumber;
      }

      const signature = this.signAliyunRpc(requestParams, params.apiSecret);
      requestParams.Signature = signature;

      const query = this.buildQueryString(requestParams);
      const url = `${endpoint}/?${query}`;

      try {
        const response = await fetch(url, { method: 'GET' });
        const data = (await response.json()) as { Code?: string; Message?: string };

        if (data.Code === 'OK') {
          this.logger.log(`[TTS-阿里云] 语音拨打成功 -> ${phone}`);
        } else {
          this.logger.error(
            `[TTS-阿里云] 拨打失败: ${data.Code || 'Unknown'} - ${data.Message || ''} -> ${phone}`,
          );
          allSuccess = false;
        }
      } catch (error) {
        this.logger.error(`[TTS-阿里云] 拨打异常: ${(error as Error).message} -> ${phone}`);
        allSuccess = false;
      }
    }

    return allSuccess;
  }

  /**
   * Aliyun RPC signature algorithm (HMAC-SHA1 + Base64)
   */
  private signAliyunRpc(params: Record<string, string>, secret: string): string {
    const sortedKeys = Object.keys(params).sort();
    const canonicalized = sortedKeys
      .map((k) => `${this.percentEncode(k)}=${this.percentEncode(params[k])}`)
      .join('&');

    const stringToSign = `GET&${this.percentEncode('/')}&${this.percentEncode(canonicalized)}`;
    const hmac = crypto.createHmac('sha1', `${secret}&`);
    hmac.update(stringToSign);
    return hmac.digest('base64');
  }

  /**
   * Aliyun RFC 3986 percent-encoding
   */
  private percentEncode(value: string): string {
    return encodeURIComponent(value)
      .replace(/\+/g, '%20')
      .replace(/\*/g, '%2A')
      .replace(/%7E/g, '~');
  }

  /**
   * Build the query string (for Aliyun GET requests)
   */
  private buildQueryString(params: Record<string, string>): string {
    return Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
  }
}
