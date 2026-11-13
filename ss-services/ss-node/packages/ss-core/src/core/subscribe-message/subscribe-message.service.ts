// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Subscribe-message service (Module 10)
 *
 * Responsibilities: authorization-result reporting (quota maintenance) / notification-preference read-write / quota query.
 * Authorization reporting needs to resolve the current user's mini-program openid (sys_users.wechat_mp_open_id).
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../user/entities/user.entity';
import {
  SubscribeAuthorizationStatus,
  WechatSubscribeAuthorization,
} from './entities/wechat-subscribe-authorization.entity';
import {
  MinimumAlarmLevel,
  WechatNotificationPreference,
} from './entities/wechat-notification-preference.entity';
import { WechatSubscribeMessageChannel } from './wechat-subscribe-message.channel';

/** Authorization-report result (uni.requestSubscribeMessage single-template result) */
export interface AuthorizationReportDto {
  templateId: string;
  result: SubscribeAuthorizationStatus;
}

/** Notification-preference update payload */
export interface NotificationPreferenceDto {
  alarmNotificationEnabled?: boolean;
  minimumAlarmLevel?: MinimumAlarmLevel;
}

const VALID_AUTHORIZATION_RESULTS: SubscribeAuthorizationStatus[] = ['accept', 'reject', 'ban'];
const VALID_ALARM_LEVELS: MinimumAlarmLevel[] = ['info', 'warning', 'error', 'critical'];

@Injectable()
export class SubscribeMessageService {
  private readonly logger = new Logger(SubscribeMessageService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(WechatSubscribeAuthorization)
    private readonly authorizationRepo: Repository<WechatSubscribeAuthorization>,
    @InjectRepository(WechatNotificationPreference)
    private readonly preferenceRepo: Repository<WechatNotificationPreference>,
    private readonly subscribeChannel: WechatSubscribeMessageChannel,
  ) {}

  /** Subscribe config (used by the frontend authorization flow: template-ID driven, empty when unconfigured) */
  getSubscribeConfig(): {
    alarmTemplateId: string;
    deviceStatusTemplateId: string;
    configured: boolean;
  } {
    return {
      alarmTemplateId: this.subscribeChannel.getAlarmTemplateId(),
      deviceStatusTemplateId: this.subscribeChannel.getDeviceStatusTemplateId(),
      configured: this.subscribeChannel.isConfigured(),
    };
  }

  /**
   * Report subscribe-authorization result: accept accumulates quota, others only record status
   * @returns latest remaining quota
   */
  async reportAuthorization(userId: string, dto: AuthorizationReportDto): Promise<{ quotaRemaining: number }> {
    if (!dto.templateId || !VALID_AUTHORIZATION_RESULTS.includes(dto.result)) {
      throw new BadRequestException('无效的订阅授权上报参数');
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user || !user.wechatMpOpenId) {
      throw new NotFoundException('当前账号未绑定小程序微信身份，无法订阅');
    }

    let authorization = await this.authorizationRepo.findOne({
      where: { userId, templateId: dto.templateId },
    });
    if (!authorization) {
      authorization = this.authorizationRepo.create({
        userId,
        mpOpenId: user.wechatMpOpenId,
        templateId: dto.templateId,
        authorizationStatus: dto.result,
        quotaRemaining: 0,
        authorizedAt: new Date(),
      });
    }
    authorization.authorizationStatus = dto.result;
    authorization.authorizedAt = new Date();
    if (dto.result === 'accept') {
      authorization.quotaRemaining += 1;
    } else if (dto.result === 'ban') {
      // User disabled subscription in settings -> quota invalidated
      authorization.quotaRemaining = 0;
    }
    await this.authorizationRepo.save(authorization);

    this.logger.log(
      `Subscription authorization reported: userId=${userId} template=${dto.templateId} result=${dto.result} quota=${authorization.quotaRemaining}`,
    );
    return { quotaRemaining: authorization.quotaRemaining };
  }

  /** Query remaining quota for a template (no record counts as 0) */
  async getQuota(userId: string, templateId: string): Promise<{ quotaRemaining: number }> {
    const authorization = await this.authorizationRepo.findOne({
      where: { userId, templateId },
    });
    return { quotaRemaining: authorization?.quotaRemaining ?? 0 };
  }

  /** Get notification preference (returns default when no record: enabled + all levels) */
  async getPreferences(userId: string): Promise<WechatNotificationPreference> {
    const preference = await this.preferenceRepo.findOne({ where: { userId } });
    if (preference) {
      return preference;
    }
    return this.preferenceRepo.create({
      userId,
      alarmNotificationEnabled: true,
      minimumAlarmLevel: 'info',
    });
  }

  /** Update notification preference (upsert) */
  async updatePreferences(
    userId: string,
    dto: NotificationPreferenceDto,
  ): Promise<WechatNotificationPreference> {
    if (dto.minimumAlarmLevel && !VALID_ALARM_LEVELS.includes(dto.minimumAlarmLevel)) {
      throw new BadRequestException('无效的报警级别');
    }

    let preference = await this.preferenceRepo.findOne({ where: { userId } });
    if (!preference) {
      preference = this.preferenceRepo.create({
        userId,
        alarmNotificationEnabled: true,
        minimumAlarmLevel: 'info',
      });
    }
    if (dto.alarmNotificationEnabled !== undefined) {
      preference.alarmNotificationEnabled = dto.alarmNotificationEnabled;
    }
    if (dto.minimumAlarmLevel !== undefined) {
      preference.minimumAlarmLevel = dto.minimumAlarmLevel;
    }
    return this.preferenceRepo.save(preference);
  }
}
