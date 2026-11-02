// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * WeChat subscribe-message authorization-record entity (Module 10)
 *
 * WeChat one-time subscribe model: each user "allow" grants one send quota for that template,
 * the backend deducts one per successful send; when quota reaches 0, no more sends
 * (frontend must guide renewal).
 * Table lives in the system DB (not a project-isolated DB); dev environment auto-creates it via TypeORM synchronize.
 */
import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../entities/base.entity';

export type SubscribeAuthorizationStatus = 'accept' | 'reject' | 'ban';

@Entity('wx_subscribe_authorizations')
export class WechatSubscribeAuthorization extends BaseEntity {
  @Index()
  @Column({ name: 'user_id' })
  userId: string;

  /** Mini-program openid (send target; stored redundantly to avoid re-querying the user table when sending) */
  @Index()
  @Column({ name: 'mp_open_id' })
  mpOpenId: string;

  @Index()
  @Column({ name: 'template_id' })
  templateId: string;

  /** Latest authorization result */
  @Column({ name: 'authorization_status', type: 'varchar', length: 20, default: 'reject' })
  authorizationStatus: SubscribeAuthorizationStatus;

  /** Remaining send quota (+1 per accept, -1 per successful send) */
  @Column({ name: 'quota_remaining', default: 0 })
  quotaRemaining: number;

  /** Latest authorization time */
  @Column({ name: 'authorized_at', type: 'datetime', nullable: true })
  authorizedAt: Date;
}
