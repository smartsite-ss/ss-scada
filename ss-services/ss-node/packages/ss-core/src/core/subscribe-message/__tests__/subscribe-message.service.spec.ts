// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * SubscribeMessageService unit tests (Module 10)
 *
 * Covers: config query / authorization report (accept accumulation, ban reset,
 * unbound rejection, param validation) /
 *       quota query / preference defaults and upsert validation
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SubscribeMessageService } from '../subscribe-message.service';
import { WechatSubscribeAuthorization } from '../entities/wechat-subscribe-authorization.entity';
import { WechatNotificationPreference } from '../entities/wechat-notification-preference.entity';

function createService(options: {
  user?: { id: string; wechatMpOpenId: string | null } | null;
  existingAuthorization?: WechatSubscribeAuthorization | null;
  existingPreference?: WechatNotificationPreference | null;
  templateId?: string;
  deviceStatusTemplateId?: string;
  configured?: boolean;
}) {
  const userRepo = {
    findOne: jest.fn().mockResolvedValue(options.user ?? null),
  };
  const authorizationRepo = {
    findOne: jest.fn().mockResolvedValue(options.existingAuthorization ?? null),
    create: jest.fn().mockImplementation((data: Partial<WechatSubscribeAuthorization>) => ({
      quotaRemaining: 0,
      ...data,
    })),
    save: jest.fn().mockImplementation(async (entity: WechatSubscribeAuthorization) => entity),
  };
  const preferenceRepo = {
    findOne: jest.fn().mockResolvedValue(options.existingPreference ?? null),
    create: jest.fn().mockImplementation((data: Partial<WechatNotificationPreference>) => data),
    save: jest.fn().mockImplementation(async (entity: WechatNotificationPreference) => entity),
  };
  const channel = {
    getAlarmTemplateId: jest.fn().mockReturnValue(options.templateId ?? 'tpl-alarm'),
    getDeviceStatusTemplateId: jest.fn().mockReturnValue(options.deviceStatusTemplateId ?? ''),
    isConfigured: jest.fn().mockReturnValue(options.configured ?? true),
  };
  const service = new SubscribeMessageService(
    userRepo as any,
    authorizationRepo as any,
    preferenceRepo as any,
    channel as any,
  );
  return { service, userRepo, authorizationRepo, preferenceRepo, channel };
}

describe('SubscribeMessageService', () => {
  it('TC-SVC-001 getSubscribeConfig passes through the channel template config', () => {
    const { service, channel } = createService({
      templateId: 'tpl-x',
      deviceStatusTemplateId: 'tpl-device',
      configured: false,
    });

    expect(service.getSubscribeConfig()).toEqual({
      alarmTemplateId: 'tpl-x',
      deviceStatusTemplateId: 'tpl-device',
      configured: false,
    });
    expect(channel.getAlarmTemplateId).toHaveBeenCalled();
    expect(channel.getDeviceStatusTemplateId).toHaveBeenCalled();
  });

  it('TC-SVC-002 authorization report accept (no history) creates a record and accumulates the quota', async () => {
    const { service, authorizationRepo } = createService({
      user: { id: 'user-1', wechatMpOpenId: 'openid-1' },
    });

    const result = await service.reportAuthorization('user-1', {
      templateId: 'tpl-alarm',
      result: 'accept',
    });

    expect(result.quotaRemaining).toBe(1);
    expect(authorizationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        mpOpenId: 'openid-1',
        templateId: 'tpl-alarm',
      }),
    );
    expect(authorizationRepo.save).toHaveBeenCalledTimes(1);
  });

  it('TC-SVC-003 authorization report accept (existing quota 2) accumulates to 3', async () => {
    const existing = {
      id: 'auth-1',
      userId: 'user-1',
      mpOpenId: 'openid-1',
      templateId: 'tpl-alarm',
      authorizationStatus: 'accept',
      quotaRemaining: 2,
    } as WechatSubscribeAuthorization;
    const { service } = createService({
      user: { id: 'user-1', wechatMpOpenId: 'openid-1' },
      existingAuthorization: existing,
    });

    const result = await service.reportAuthorization('user-1', {
      templateId: 'tpl-alarm',
      result: 'accept',
    });

    expect(result.quotaRemaining).toBe(3);
  });

  it('TC-SVC-004 authorization report ban (turned off in settings) clears the quota', async () => {
    const existing = {
      id: 'auth-1',
      userId: 'user-1',
      mpOpenId: 'openid-1',
      templateId: 'tpl-alarm',
      authorizationStatus: 'accept',
      quotaRemaining: 4,
    } as WechatSubscribeAuthorization;
    const { service } = createService({
      user: { id: 'user-1', wechatMpOpenId: 'openid-1' },
      existingAuthorization: existing,
    });

    const result = await service.reportAuthorization('user-1', {
      templateId: 'tpl-alarm',
      result: 'ban',
    });

    expect(result.quotaRemaining).toBe(0);
    expect(existing.authorizationStatus).toBe('ban');
  });

  it('TC-SVC-005 reject the report when the user is not bound to the mini-program WeChat identity', async () => {
    const { service } = createService({ user: { id: 'user-1', wechatMpOpenId: null } });

    await expect(
      service.reportAuthorization('user-1', { templateId: 'tpl-alarm', result: 'accept' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('TC-SVC-006 invalid report parameters throw BadRequest', async () => {
    const { service } = createService({ user: { id: 'user-1', wechatMpOpenId: 'openid-1' } });

    await expect(
      service.reportAuthorization('user-1', { templateId: '', result: 'accept' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.reportAuthorization('user-1', { templateId: 'tpl-alarm', result: 'unknown' as never }),
    ).rejects.toThrow(BadRequestException);
  });

  it('TC-SVC-007 quota query: returns 0 with no authorization record', async () => {
    const { service } = createService({});

    await expect(service.getQuota('user-1', 'tpl-alarm')).resolves.toEqual({ quotaRemaining: 0 });
  });

  it('TC-SVC-008 preference query: returns defaults (enabled + info) with no record', async () => {
    const { service, preferenceRepo } = createService({});

    const preference = await service.getPreferences('user-1');

    expect(preference.alarmNotificationEnabled).toBe(true);
    expect(preference.minimumAlarmLevel).toBe('info');
    expect(preferenceRepo.create).toHaveBeenCalled();
    expect(preferenceRepo.save).not.toHaveBeenCalled();
  });

  it('TC-SVC-009 preference update: creates a record and writes the fields', async () => {
    const { service, preferenceRepo } = createService({});

    const updated = await service.updatePreferences('user-1', {
      alarmNotificationEnabled: false,
      minimumAlarmLevel: 'error',
    });

    expect(updated.alarmNotificationEnabled).toBe(false);
    expect(updated.minimumAlarmLevel).toBe('error');
    expect(preferenceRepo.save).toHaveBeenCalledTimes(1);
  });

  it('TC-SVC-010 preference update: an invalid level throws BadRequest', async () => {
    const { service } = createService({});

    await expect(
      service.updatePreferences('user-1', { minimumAlarmLevel: 'fatal' as never }),
    ).rejects.toThrow(BadRequestException);
  });
});
