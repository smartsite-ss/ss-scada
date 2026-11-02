// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, BadRequestException, OnModuleInit } from '@nestjs/common';
import { spawn } from 'child_process';
import { PathResolverService } from '@ss-node/ss-core';
import * as fs from 'fs';
import * as path from 'path';

/** Restart status enum */
export type RestartStatus = 'idle' | 'pending' | 'restarting' | 'exited' | 'ready' | 'failed';

/** Restart status info */
export interface RestartState {
  status: RestartStatus;
  triggeredBy?: string;
  triggeredAt?: number;
  oldPid?: number;
  newPid?: number;
  errorMessage?: string;
  markerPath: string;
}

/** Runtime environment type */
export type RuntimeEnvironment = 'pm2' | 'docker' | 'standalone';

/**
 * System restart service
 *
 * Implements graceful restart via a spawn detached child process:
 * 1. Write a marker file recording the restart state
 * 2. Spawn an independent child process (restarter.js) that waits for the current process to exit and then starts the new service
 * 3. The current process exits gracefully
 * 4. When the new service starts, it detects the marker file and updates the status to ready
 */
@Injectable()
export class SystemRestartService implements OnModuleInit {
  private readonly logger = new Logger(SystemRestartService.name);
  private isRestarting = false;
  private lastRestartAt = 0;
  private readonly markerPath: string;
  private static readonly RESTART_COOLDOWN_MS = 30000;

  constructor(private readonly pathResolver: PathResolverService) {
    const dataDir = process.env.DATA_DIR || './data';
    this.markerPath = path.resolve(this.resolvePath(dataDir), '.restart-marker.json');
  }

  /**
   * Resolve a relative path to an absolute path
   *
   * Relative-path baselines:
   * - dev mode: go up 4 levels from __dirname = ss-services/ss-node (this file lives in packages/ss-system/dist/restart/)
   *   DATA_DIR in .env.dev resolves against ss-services/ss-node
   * - production mode: process.cwd() = ss-run/ss/services/ss-node
   *   DATA_DIR=../../data in .env resolves against that directory
   *
   * Kept consistent with app.module.ts getDatabaseConfig() and backup.service.ts getProjectRoot().
   */
  private resolvePath(p: string): string {
    return this.pathResolver.resolve(p);
  }

  /** Check the marker file at startup to determine whether this was triggered by a restart */
  async onModuleInit(): Promise<void> {
    if (fs.existsSync(this.markerPath)) {
      try {
        const state = this.readMarker();
        if (state && state.status === 'restarting') {
          // New process triggered by a restart
          state.status = 'ready';
          state.newPid = process.pid;
          this.writeMarker(state);
          this.logger.log(
            `Restart completed: triggeredBy=${state.triggeredBy}, ` +
              `oldPid=${state.oldPid}, newPid=${state.newPid}`,
          );
        } else if (state === null) {
          // readMarker returning null means the file is corrupt or unparseable; delete it directly
          this.logger.warn('Restart marker file is corrupted, deleting...');
          fs.unlinkSync(this.markerPath);
        }
      } catch (err) {
        this.logger.warn(`Failed to update restart marker: ${(err as Error).message}`);
        // Delete corrupt marker files directly
        try {
          fs.unlinkSync(this.markerPath);
        } catch {
          /* ignore */
        }
      }
    }
  }

  /** Trigger a system restart */
  async triggerRestart(username: string): Promise<RestartState> {
    // Concurrency guard
    if (this.isRestarting) {
      throw new BadRequestException('重启已在进行中');
    }

    // Cooldown check
    if (Date.now() - this.lastRestartAt < SystemRestartService.RESTART_COOLDOWN_MS) {
      throw new BadRequestException(
        `重启冷却期内，请等待 ${Math.ceil(
          (SystemRestartService.RESTART_COOLDOWN_MS - (Date.now() - this.lastRestartAt)) / 1000,
        )} 秒后重试`,
      );
    }

    // Runtime environment detection
    const env = this.detectRuntimeEnvironment();
    if (env === 'pm2') {
      throw new BadRequestException('检测到 PM2 环境，请使用命令 "pm2 restart ss-data" 重启服务');
    }
    if (env === 'docker') {
      throw new BadRequestException(
        '检测到 Docker 环境，请使用命令 "docker restart <container>" 重启服务',
      );
    }

    this.isRestarting = true;
    this.lastRestartAt = Date.now();

    const state: RestartState = {
      status: 'restarting',
      triggeredBy: username,
      triggeredAt: Date.now(),
      oldPid: process.pid,
      markerPath: this.markerPath,
    };

    // 1. Write the marker file
    this.writeMarker(state);

    // 2. Spawn a detached child process
    try {
      const restarterPath = this.getRestarterScriptPath();
      if (!fs.existsSync(restarterPath)) {
        throw new Error(`Restarter script not found: ${restarterPath}`);
      }

      const child = spawn('node', [restarterPath, String(process.pid)], {
        detached: true,
        stdio: 'ignore',
        env: process.env,
      });
      child.unref();

      this.logger.log(`Restart triggered by ${username}, restarter spawned (PID: ${child.pid})`);
    } catch (err) {
      this.isRestarting = false;
      state.status = 'failed';
      state.errorMessage = `Failed to spawn restarter: ${(err as Error).message}`;
      this.writeMarker(state);
      throw new BadRequestException(state.errorMessage);
    }

    // 3. Exit the current process after a 1-second delay (leaving time for the HTTP response)
    setTimeout(() => {
      this.logger.log('Gracefully exiting current process for restart...');
      process.exit(0);
    }, 1000);

    return state;
  }

  /** Get the restart status */
  getRestartStatus(): RestartState {
    if (this.isRestarting) {
      return {
        status: 'restarting',
        markerPath: this.markerPath,
      };
    }

    if (fs.existsSync(this.markerPath)) {
      try {
        const state = this.readMarker();
        if (state) return state;
      } catch {
        /* fall through */
      }
    }

    return { status: 'idle', markerPath: this.markerPath };
  }

  /** Clear the marker file (called by the frontend after confirming the restart is complete) */
  clearMarker(): void {
    try {
      if (fs.existsSync(this.markerPath)) {
        fs.unlinkSync(this.markerPath);
        this.logger.log('Restart marker cleared');
      }
    } catch (err) {
      this.logger.warn(`Failed to clear marker: ${(err as Error).message}`);
    }
  }

  /** Detect the current runtime environment */
  detectRuntimeEnvironment(): RuntimeEnvironment {
    // PM2 detection: PM2_HOME env var or pm_id marker
    if (process.env.PM2_HOME || process.env.pm_id !== undefined) {
      return 'pm2';
    }
    // Docker detection: the /.dockerenv file exists
    if (fs.existsSync('/.dockerenv')) {
      return 'docker';
    }
    return 'standalone';
  }

  /** Whether a restart is in progress */
  isCurrentlyRestarting(): boolean {
    return this.isRestarting;
  }

  // ==================== Private methods ====================

  private getRestarterScriptPath(): string {
    // Compiled: packages/ss-system/dist/restart/restarter.js
    // After compilation __dirname is dist/restart/ or dist/config/
    const candidates = [
      path.resolve(__dirname, 'restarter.js'), // same directory
      path.resolve(__dirname, '..', 'restart', 'restarter.js'), // sibling directory
      path.resolve(__dirname, '..', '..', 'restart', 'restarter.js'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    // Return the default; the caller handles the not-found case
    return candidates[0];
  }

  private readMarker(): RestartState | null {
    try {
      const content = fs.readFileSync(this.markerPath, 'utf-8');
      const parsed = JSON.parse(content);
      return {
        ...parsed,
        markerPath: this.markerPath,
      };
    } catch {
      return null;
    }
  }

  private writeMarker(state: Partial<RestartState>): void {
    const fullState: RestartState = {
      status: state.status || 'idle',
      triggeredBy: state.triggeredBy,
      triggeredAt: state.triggeredAt,
      oldPid: state.oldPid,
      newPid: state.newPid,
      errorMessage: state.errorMessage,
      markerPath: this.markerPath,
    };
    fs.writeFileSync(this.markerPath, JSON.stringify(fullState, null, 2), 'utf-8');
  }
}
