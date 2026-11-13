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
 * SMS service provider type
 */
export type SmsProvider = 'aliyun' | 'tencent';

/**
 * SMS notification channel
 *
 * Supports Aliyun SMS and Tencent Cloud SMS, switched via the SMS_PROVIDER system config.
 * Required system config:
 * - SMS_PROVIDER: 'aliyun' | 'tencent'
 * - SMS_API_KEY: AccessKeyId / SecretId
 * - SMS_API_SECRET: AccessKeySecret / SecretKey
 * - SMS_SIGN_NAME: SMS signature
 * - SMS_TEMPLATE_CODE: SMS template code
 *
 * Degrades gracefully when unavailable (logs only), without affecting the main alarm flow.
 */
@Injectable()
export class SmsNotificationChannel implements INotificationChannel {
  readonly name = 'sms';

  /** Default SDK AppID (Tencent Cloud) */
  private static readonly TENCENT_SMS_DEFAULT_SDK_APPID = '1400000000';

  private readonly logger = new StructuredLogger();

  constructor(
    @Optional()
    @Inject('SystemConfigService')
    private readonly configService?: SystemConfigServiceLike,
  ) {
    this.logger.setContext('context', 'SmsNotificationChannel');
  }

  /**
   * Send an SMS notification (interface implementation)
   */
  async send(targets: string[], payload: NotificationPayload): Promise<boolean> {
    const content = this.buildSmsContent(payload);
    return this.sendMessage(targets, content, payload);
  }

  /**
   * Send SMS content directly
   * @param to phone number list
   * @param content SMS content (passed through as template parameters)
   */
  async sendSms(to: string[], content: string): Promise<boolean> {
    return this.sendMessage(to, content, undefined);
  }

  /**
   * Build the SMS content
   */
  private buildSmsContent(payload: NotificationPayload): string {
    const levelLabel = this.getLevelLabel(payload.level);
    const devicePart = payload.deviceName ? `设备:${payload.deviceName} ` : '';
    const time = payload.timestamp.toLocaleString('zh-CN');
    return `[SCADA报警-${levelLabel}] ${devicePart}${payload.message} ${time}`;
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
   * Actual send logic
   */
  private async sendMessage(
    phones: string[],
    content: string,
    payload?: NotificationPayload,
  ): Promise<boolean> {
    if (!this.configService) {
      this.logger.warn('SystemConfigService unavailable, SMS channel disabled');
      return false;
    }

    if (!phones.length) {
      this.logger.warn('No phone numbers provided, skipping SMS send');
      return false;
    }

    try {
      const provider = (await this.configService.get('SMS_PROVIDER')) || '';
      const apiKey = await this.configService.get('SMS_API_KEY');
      const apiSecret = await this.configService.get('SMS_API_SECRET');
      const signName = await this.configService.get('SMS_SIGN_NAME');
      const templateCode = await this.configService.get('SMS_TEMPLATE_CODE');

      if (!apiKey || !apiSecret) {
        this.logger.warn('SMS channel has no API key configured, skipping send');
        return false;
      }

      const phoneNumbers = phones.join(',');

      switch (provider.toLowerCase()) {
        case 'aliyun':
          return await this.sendViaAliyun({
            apiKey,
            apiSecret,
            signName: signName || '',
            templateCode: templateCode || '',
            phoneNumbers,
            content,
            payload,
          });

        case 'tencent':
          return await this.sendViaTencent({
            apiKey,
            apiSecret,
            signName: signName || '',
            templateCode: templateCode || '',
            phoneNumbers,
            content,
            payload,
          });

        default:
          this.logger.warn(`Unknown SMS provider: ${provider} (supported: aliyun, tencent)`);
          return false;
      }
    } catch (error) {
      this.logger.error(`SMS send failed: ${(error as Error).message}`);
      return false;
    }
  }

  // ==================== Aliyun SMS ====================

  /**
   * Aliyun SMS send (RPC style, HMAC-SHA1 signature)
   */
  private async sendViaAliyun(params: {
    apiKey: string;
    apiSecret: string;
    signName: string;
    templateCode: string;
    phoneNumbers: string;
    content: string;
    payload?: NotificationPayload;
  }): Promise<boolean> {
    const endpoint = 'https://dysmsapi.aliyuncs.com';

    const templateParam = params.payload
      ? JSON.stringify({
          level: params.payload.level,
          device: params.payload.deviceName || '',
          message: params.payload.message,
          time: params.payload.timestamp.toISOString(),
        })
      : JSON.stringify({ content: params.content });

    const requestParams: Record<string, string> = {
      Action: 'SendSms',
      Version: '2017-05-25',
      Format: 'JSON',
      AccessKeyId: params.apiKey,
      SignatureMethod: 'HMAC-SHA1',
      SignatureVersion: '1.0',
      SignatureNonce: crypto.randomUUID(),
      Timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      PhoneNumbers: params.phoneNumbers,
      SignName: params.signName,
      TemplateCode: params.templateCode,
      TemplateParam: templateParam,
    };

    const signature = this.signAliyunRpc(requestParams, params.apiSecret);
    requestParams.Signature = signature;

    const query = this.buildQueryString(requestParams);
    const url = `${endpoint}/?${query}`;

    const response = await fetch(url, { method: 'GET' });
    const data = (await response.json()) as { Code?: string; Message?: string };

    if (data.Code === 'OK') {
      this.logger.log(`[SMS-Aliyun] SMS sent -> ${params.phoneNumbers}`);
      return true;
    }

    this.logger.error(`[SMS-Aliyun] Send failed: ${data.Code || 'Unknown'} - ${data.Message || ''}`);
    return false;
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

  // ==================== Tencent Cloud SMS ====================

  /**
   * Tencent Cloud SMS send (TC3-HMAC-SHA256 signature)
   */
  private async sendViaTencent(params: {
    apiKey: string;
    apiSecret: string;
    signName: string;
    templateCode: string;
    phoneNumbers: string;
    content: string;
    payload?: NotificationPayload;
  }): Promise<boolean> {
    const endpoint = 'sms.tencentcloudapi.com';
    const action = 'SendSms';
    const version = '2021-01-11';

    const phoneNumberSet = params.phoneNumbers.split(',').map((p) => `+86${p}`);
    const templateParams = params.payload
      ? [
          params.payload.level,
          params.payload.deviceName || '',
          params.payload.message,
          params.payload.timestamp.toLocaleString('zh-CN'),
        ]
      : [params.content];

    const requestBody = JSON.stringify({
      SmsSdkAppId: SmsNotificationChannel.TENCENT_SMS_DEFAULT_SDK_APPID,
      SignName: params.signName,
      TemplateId: params.templateCode,
      PhoneNumberSet: phoneNumberSet,
      TemplateParamSet: templateParams,
    });

    const result = await this.callTencentCloudApi({
      endpoint,
      action,
      version,
      secretId: params.apiKey,
      secretKey: params.apiSecret,
      payload: requestBody,
    });

    if (result.success) {
      this.logger.log(`[SMS-TencentCloud] SMS sent -> ${params.phoneNumbers}`);
      return true;
    }

    this.logger.error(`[SMS-TencentCloud] Send failed: ${result.error}`);
    return false;
  }

  /**
   * Tencent Cloud API call (TC3-HMAC-SHA256 signature)
   */
  private async callTencentCloudApi(params: {
    endpoint: string;
    action: string;
    version: string;
    secretId: string;
    secretKey: string;
    payload: string;
  }): Promise<{ success: boolean; error?: string }> {
    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const service = 'sms';

    // 1. Assemble the canonical request string
    const hashedPayload = crypto.createHash('sha256').update(params.payload).digest('hex');
    const canonicalRequest = [
      'POST',
      '/',
      '',
      'content-type:application/json; charset=utf-8',
      `host:${params.endpoint}`,
      `x-tc-action:${params.action.toLowerCase()}`,
      '',
      'content-type;host;x-tc-action',
      hashedPayload,
    ].join('\n');

    // 2. Assemble the signing string
    const credentialScope = `${date}/${service}/tc3_request`;
    const hashedCanonicalRequest = crypto
      .createHash('sha256')
      .update(canonicalRequest)
      .digest('hex');
    const stringToSign = [
      'TC3-HMAC-SHA256',
      String(timestamp),
      credentialScope,
      hashedCanonicalRequest,
    ].join('\n');

    // 3. Compute the signature
    const secretDate = crypto.createHmac('sha256', `TC3${params.secretKey}`).update(date).digest();
    const secretService = crypto.createHmac('sha256', secretDate).update(service).digest();
    const secretSigning = crypto.createHmac('sha256', secretService).update('tc3_request').digest();
    const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex');

    // 4. Build the Authorization header
    const authorization = `TC3-HMAC-SHA256 Credential=${params.secretId}/${credentialScope}, SignedHeaders=content-type;host;x-tc-action, Signature=${signature}`;

    // 5. Send the request
    const url = `https://${params.endpoint}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: authorization,
        'X-TC-Action': params.action,
        'X-TC-Version': params.version,
        'X-TC-Timestamp': String(timestamp),
      },
      body: params.payload,
    });

    const data = (await response.json()) as {
      Response?: {
        Error?: { Code?: string; Message?: string };
        SendStatusSet?: Array<{ Code?: string }>;
      };
    };

    const resp = data.Response;
    if (!resp) {
      return { success: false, error: 'Empty response from Tencent Cloud' };
    }

    if (resp.Error) {
      return { success: false, error: `${resp.Error.Code || ''} ${resp.Error.Message || ''}` };
    }

    const allOk = resp.SendStatusSet?.every((s) => s.Code === 'Ok') ?? false;
    return { success: allOk, error: allOk ? undefined : 'Some messages failed' };
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
