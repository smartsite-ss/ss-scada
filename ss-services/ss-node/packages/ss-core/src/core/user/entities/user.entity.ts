// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../entities/base.entity';
import { Role } from './role.entity';
import { Position } from './position.entity';

export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
  VIEWER = 'viewer',
}

@Entity('sys_users')
export class User extends BaseEntity {
  @Column({ unique: true })
  username: string;

  @Column()
  password: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  displayName: string;

  /** Role snapshot (backward compatible), value is role.code */
  @Column({ type: 'varchar', length: 20, default: UserRole.USER })
  role: UserRole;

  /** Role foreign key (added in v6.0) */
  @Column({ name: 'role_id', nullable: true })
  roleId: string;

  @ManyToOne(() => Role, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'role_id' })
  roleEntity: Role;

  /** Position foreign key (added in v6.0) */
  @Column({ name: 'position_id', nullable: true })
  positionId: string;

  @ManyToOne(() => Position, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'position_id' })
  position: Position;

  /** Phone number (added in v6.0) */
  @Column({ default: '' })
  phone: string;

  /** Avatar URL (added in v6.0) */
  @Column({ default: '' })
  avatar: string;

  @Column({ default: true })
  isActive: boolean;

  /** WeChat open-platform OpenID (web scan login); unique + nullable keeps unbound users null and non-duplicated */
  @Column({ name: 'wechat_open_id', unique: true, nullable: true })
  wechatOpenId: string;

  /** WeChat mini-program OpenID (mini-program authorized login; a different system from the open-platform web-app openid), unique binding */
  @Column({ name: 'wechat_mp_open_id', unique: true, nullable: true })
  wechatMpOpenId: string;

  /** WeChat UnionID (present only when the official account/mini-program is bound to the open platform; nullable) */
  @Column({ name: 'wechat_union_id', nullable: true })
  wechatUnionId: string;

  /** Auth provider: local (account+password) | wechat (scan only) | mixed (both password and third-party login) */
  @Column({ name: 'auth_provider', type: 'varchar', length: 20, default: 'local' })
  authProvider: 'local' | 'wechat' | 'mixed';

  /** WeChat user nickname (synced on scan authorization) */
  @Column({ name: 'wechat_nickname', nullable: true })
  wechatNickname: string;

  /** WeChat avatar URL (synced on scan authorization) */
  @Column({ name: 'wechat_avatar_url', nullable: true })
  wechatAvatarUrl: string;
}
