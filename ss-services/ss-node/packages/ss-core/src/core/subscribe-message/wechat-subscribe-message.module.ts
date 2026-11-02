// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../user/entities/user.entity';
import { WechatSubscribeAuthorization } from './entities/wechat-subscribe-authorization.entity';
import { WechatNotificationPreference } from './entities/wechat-notification-preference.entity';
import { WechatSubscribeMessageChannel } from './wechat-subscribe-message.channel';
import { SubscribeMessageService } from './subscribe-message.service';
import { SubscribeMessageController } from './subscribe-message.controller';

/**
 * WeChat mini-program subscribe-message module (Module 10)
 *
 * Registration: registered in app.module.ts sharedModules (@Global).
 * @Global lets ss-alarm's AlarmNotificationService inject WechatSubscribeMessageChannel via @Optional()
 * without explicitly importing it in AlarmModule (safely degrades when not injected).
 *
 * Dependencies:
 *   - imports: TypeOrmModule.forFeature -- User (resolve wechatMpOpenId),
 *             subscribe-authorization records, notification preferences (entities auto-created via DatabaseModule synchronize)
 *   - providers: WechatSubscribeMessageChannel (send channel), SubscribeMessageService
 *   - controllers: SubscribeMessageController (/wechat/subscribe/*)
 *   - exports: channel and service (for cross-module injection)
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([User, WechatSubscribeAuthorization, WechatNotificationPreference]),
  ],
  controllers: [SubscribeMessageController],
  providers: [WechatSubscribeMessageChannel, SubscribeMessageService],
  exports: [WechatSubscribeMessageChannel, SubscribeMessageService],
})
export class WechatSubscribeMessageModule {}
