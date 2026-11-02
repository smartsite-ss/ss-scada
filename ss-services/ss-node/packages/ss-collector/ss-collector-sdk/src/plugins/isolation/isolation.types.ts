// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { ExecutorHealth } from '../../events/plugin-events.types';
import { IDeviceContext, ITagContext } from '../../types';

/**
 * Connection shard reference - the reference handle to a connection kept inside the isolation unit
 * The main process does not hold the actual client object, only this reference
 */
export interface ShardRef {
  /** Connection ID maintained inside the isolation unit */
  connectionId: string;
  /** Owning protocol */
  protocol: string;
}

/** Isolation executor factory configuration */
export interface RequiredIsolationConfig {
  maxParallel: number;
  requestTimeoutMs: number;
  autoRestart: boolean;
  startupTimeoutMs: number;
  idleTimeoutMs: number;
  maxRestarts: number;
  entryScript?: string;
}

export const DEFAULT_ISOLATION_CONFIG: RequiredIsolationConfig = {
  maxParallel: 50,
  requestTimeoutMs: 10000,
  autoRestart: true,
  startupTimeoutMs: 30000,
  idleTimeoutMs: 300000,
  maxRestarts: 5,
};

/** Isolation executor interface */
export interface IIsolationExecutor {
  /** Executor name */
  readonly name: string;

  /** Initialize (start Worker/child process, etc.) */
  init(
    protocol: string,
    adapterClass: any,
    config: Partial<RequiredIsolationConfig>,
  ): Promise<void>;

  /** Connect to device, return the connection reference ID */
  connect(device: IDeviceContext): Promise<ShardRef>;

  /** Read tag */
  readTag(shard: ShardRef, tag: ITagContext): Promise<any>;

  /** Write tag */
  writeTag(shard: ShardRef, tag: ITagContext, value: any): Promise<void>;

  /** Disconnect */
  disconnect(shard: ShardRef): Promise<void>;

  /** Get health status */
  getHealth(): Promise<ExecutorHealth>;

  /** Destroy (stop Worker/child process, etc.) */
  destroy(): Promise<void>;
}
