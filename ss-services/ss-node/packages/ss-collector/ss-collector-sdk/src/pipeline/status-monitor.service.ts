// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface DeviceStatus {
  deviceId: string;
  deviceName: string;
  protocol: string;
  connected: boolean;
  lastConnectionTime?: Date;
  lastDisconnectionTime?: Date;
  totalConnections: number;
  totalDisconnections: number;
  uptimeSeconds: number;
}

export interface AcquisitionMetrics {
  deviceId: string;
  tagId: string;
  timestamp: Date;
  durationMs: number;
  success: boolean;
  error?: string;
  value?: any;
}

export interface SystemPerformance {
  totalDevices: number;
  connectedDevices: number;
  disconnectedDevices: number;
  totalTags: number;
  activeTags: number;
  tagsPerSecond: number;
  avgLatencyMs: number;
  successRate: number;
  errorRate: number;
  memoryUsageMb: number;
  cpuUsagePercent: number;
  timestamp: Date;
}

export interface AlertRule {
  id: string;
  name: string;
  metric: 'latency' | 'error_rate' | 'disconnection' | 'memory' | 'cpu';
  condition: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  threshold: number;
  durationMs: number;
  enabled: boolean;
  severity: 'info' | 'warning' | 'critical';
}

export interface Alert {
  id: string;
  ruleId: string;
  ruleName: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  deviceId?: string;
  value: number;
  threshold: number;
  triggeredAt: Date;
  resolvedAt?: Date;
  status: 'active' | 'resolved';
}

export interface MonitorConfig {
  metricsRetentionMs: number;
  maxMetricsPerDevice: number;
  alertCheckIntervalMs: number;
  performanceUpdateIntervalMs: number;
  enableWebSocketPush: boolean;
  enablePersistence: boolean;
}

const DEFAULT_CONFIG: MonitorConfig = {
  metricsRetentionMs: 3600000, // 1 hour
  maxMetricsPerDevice: 10000,
  alertCheckIntervalMs: 5000,
  performanceUpdateIntervalMs: 1000,
  enableWebSocketPush: true,
  enablePersistence: false,
};

@Injectable()
export class StatusMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StatusMonitorService.name);

  private config: MonitorConfig = DEFAULT_CONFIG;

  // Device status storage
  private deviceStatuses = new Map<string, DeviceStatus>();

  // Collection-metric storage (ring buffer)
  private metricsBuffer = new Map<string, AcquisitionMetrics[]>();

  // System performance history
  private performanceHistory: SystemPerformance[] = [];

  // Alarm rules and active alarms
  private alertRules = new Map<string, AlertRule>();
  private activeAlerts = new Map<string, Alert>();
  private alertHistory: Alert[] = [];

  // Timers
  private alertCheckInterval: NodeJS.Timeout | null = null;
  private performanceInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(private eventEmitter: EventEmitter2) {}

  onModuleInit(): void {
    this.logger.log('StatusMonitorService initialized');

    // Start the alarm-check timer
    if (this.config.alertCheckIntervalMs > 0) {
      this.alertCheckInterval = setInterval(
        () => this.checkAlerts(),
        this.config.alertCheckIntervalMs,
      );
    }

    // Start the performance-update timer
    if (this.config.performanceUpdateIntervalMs > 0) {
      this.performanceInterval = setInterval(
        () => this.updateSystemPerformance(),
        this.config.performanceUpdateIntervalMs,
      );
    }

    // Start the cleanup timer
    this.cleanupInterval = setInterval(
      () => this.cleanupOldMetrics(),
      60000, // cleanup once per minute
    );

    // Initialize default alarm rules
    this.initializeDefaultAlertRules();
  }

  onModuleDestroy(): void {
    this.logger.log('StatusMonitorService destroyed');

    if (this.alertCheckInterval) clearInterval(this.alertCheckInterval);
    if (this.performanceInterval) clearInterval(this.performanceInterval);
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
  }

  setConfig(config: Partial<MonitorConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.debug(`Monitor config updated`);
  }

  async updateDeviceStatus(deviceId: string, updates: Partial<DeviceStatus>): Promise<void> {
    let status = this.deviceStatuses.get(deviceId);

    if (!status) {
      status = {
        deviceId,
        deviceName: updates.deviceName || deviceId,
        protocol: updates.protocol || 'unknown',
        connected: false,
        totalConnections: 0,
        totalDisconnections: 0,
        uptimeSeconds: 0,
      };
      this.deviceStatuses.set(deviceId, status);
    }

    // Update fields
    Object.assign(status, updates);

    // Handle connection-status changes
    if (updates.connected !== undefined && updates.connected !== status.connected) {
      if (updates.connected) {
        status.lastConnectionTime = new Date();
        status.totalConnections++;
        this.eventEmitter.emit('device.connected', { deviceId, timestamp: new Date() });
        this.logger.log(`Device ${deviceId} connected (${status.protocol})`);
      } else {
        status.lastDisconnectionTime = new Date();
        status.totalDisconnections++;
        this.eventEmitter.emit('device.disconnected', { deviceId, timestamp: new Date() });
        this.logger.warn(`Device ${deviceId} disconnected`);
      }
    }
  }

  recordAcquisitionMetric(metric: AcquisitionMetrics): void {
    const key = `${metric.deviceId}:${metric.tagId}`;

    let buffer = this.metricsBuffer.get(key);
    if (!buffer) {
      buffer = [];
      this.metricsBuffer.set(key, buffer);
    }

    // Add to the buffer
    buffer.push(metric);

    // Limit buffer size
    if (buffer.length > this.config.maxMetricsPerDevice) {
      buffer.shift(); // remove the oldest record
    }

    // Emit event
    this.eventEmitter.emit('acquisition.metric', metric);
  }

  getDeviceStatus(deviceId?: string): DeviceStatus | Map<string, DeviceStatus> {
    if (deviceId) {
      return this.deviceStatuses.get(deviceId) || this.createEmptyDeviceStatus(deviceId);
    }

    return new Map(this.deviceStatuses);
  }

  getAcquisitionMetrics(
    deviceId: string,
    tagId?: string,
    options?: { limit?: number; since?: Date; until?: Date },
  ): AcquisitionMetrics[] {
    const key = tagId ? `${deviceId}:${tagId}` : undefined;

    let metrics: AcquisitionMetrics[] = [];

    if (key) {
      metrics = this.metricsBuffer.get(key) || [];
    } else {
      // Get all tag metrics for the device
      for (const [k, buffer] of this.metricsBuffer) {
        if (k.startsWith(`${deviceId}:`)) {
          metrics = metrics.concat(buffer);
        }
      }

      // Sort by time
      metrics.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    }

    // Apply filter conditions
    if (options?.since) {
      metrics = metrics.filter((m) => m.timestamp >= options.since!);
    }

    if (options?.until) {
      metrics = metrics.filter((m) => m.timestamp <= options.until!);
    }

    if (options?.limit) {
      metrics = metrics.slice(-options.limit);
    }

    return metrics;
  }

  getSystemPerformance(options?: { lastN?: number }): SystemPerformance[] {
    if (options?.lastN) {
      return this.performanceHistory.slice(-options.lastN);
    }
    return [...this.performanceHistory];
  }

  getCurrentPerformance(): SystemPerformance {
    return this.calculateCurrentPerformance();
  }

  addAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.id, rule);
    this.logger.log(`Alert rule added: ${rule.name}`);
  }

  removeAlertRule(ruleId: string): boolean {
    return this.alertRules.delete(ruleId);
  }

  getAlertRules(): AlertRule[] {
    return Array.from(this.alertRules.values());
  }

  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values());
  }

  getAlertHistory(options?: { limit?: number; severity?: string }): Alert[] {
    let history = [...this.alertHistory];

    if (options?.severity) {
      history = history.filter((a) => a.severity === options.severity);
    }

    if (options?.limit) {
      history = history.slice(-options.limit);
    }

    return history.reverse(); // newest first
  }

  resolveAlert(alertId: string): void {
    const alert = this.activeAlerts.get(alertId);
    if (alert) {
      alert.resolvedAt = new Date();
      alert.status = 'resolved';
      this.activeAlerts.delete(alertId);
      this.alertHistory.push(alert);

      this.eventEmitter.emit('alert.resolved', alert);
      this.logger.log(`Alert resolved: ${alert.message}`);
    }
  }

  generateReport(options?: { periodMs?: number }): {
    summary: SystemPerformance;
    devices: DeviceStatus[];
    alerts: Alert[];
    topSlowDevices: Array<{ deviceId: string; avgLatency: number }>;
    topErrorDevices: Array<{ deviceId: string; errorCount: number; errorRate: number }>;
  } {
    const now = new Date();
    const since = options?.periodMs ? new Date(now.getTime() - options.periodMs) : undefined;

    const summary = this.getCurrentPerformance();
    const devices = Array.from(this.deviceStatuses.values());
    const alerts = this.getAlertHistory({ limit: 100 });

    // Compute the slowest device
    const deviceLatencies = new Map<string, number[]>();
    for (const [, buffer] of this.metricsBuffer) {
      for (const metric of buffer) {
        if (!since || metric.timestamp >= since) {
          const latencies = deviceLatencies.get(metric.deviceId) || [];
          latencies.push(metric.durationMs);
          deviceLatencies.set(metric.deviceId, latencies);
        }
      }
    }

    const topSlowDevices = Array.from(deviceLatencies.entries())
      .map(([deviceId, latencies]) => ({
        deviceId,
        avgLatency: latencies.reduce((a, b) => a + b, 0) / latencies.length,
      }))
      .sort((a, b) => b.avgLatency - a.avgLatency)
      .slice(0, 10);

    // Compute the device with the most errors
    const deviceErrors = new Map<string, { count: number; total: number }>();
    for (const [, buffer] of this.metricsBuffer) {
      for (const metric of buffer) {
        if (!since || metric.timestamp >= since) {
          const errors = deviceErrors.get(metric.deviceId) || { count: 0, total: 0 };
          errors.total++;
          if (!metric.success) errors.count++;
          deviceErrors.set(metric.deviceId, errors);
        }
      }
    }

    const topErrorDevices = Array.from(deviceErrors.entries())
      .map(([deviceId, stats]) => ({
        deviceId,
        errorCount: stats.count,
        errorRate: stats.total > 0 ? (stats.count / stats.total) * 100 : 0,
      }))
      .sort((a, b) => b.errorRate - a.errorRate)
      .slice(0, 10);

    return {
      summary,
      devices,
      alerts,
      topSlowDevices,
      topErrorDevices,
    };
  }

  private initializeDefaultAlertRules(): void {
    const defaultRules: AlertRule[] = [
      {
        id: 'high-latency',
        name: 'High Latency Warning',
        metric: 'latency',
        condition: 'gt',
        threshold: 5000,
        durationMs: 30000,
        enabled: true,
        severity: 'warning',
      },
      {
        id: 'high-error-rate',
        name: 'High Error Rate',
        metric: 'error_rate',
        condition: 'gt',
        threshold: 10,
        durationMs: 60000,
        enabled: true,
        severity: 'critical',
      },
      {
        id: 'device-disconnection',
        name: 'Device Disconnected',
        metric: 'disconnection',
        condition: 'eq',
        threshold: 1,
        durationMs: 0,
        enabled: true,
        severity: 'warning',
      },
      {
        id: 'high-memory-usage',
        name: 'High Memory Usage',
        metric: 'memory',
        condition: 'gt',
        threshold: 80,
        durationMs: 60000,
        enabled: true,
        severity: 'warning',
      },
    ];

    for (const rule of defaultRules) {
      this.alertRules.set(rule.id, rule);
    }

    this.logger.log(`Initialized ${defaultRules.length} default alert rules`);
  }

  private async checkAlerts(): Promise<void> {
    const performance = this.calculateCurrentPerformance();

    for (const [ruleId, rule] of this.alertRules) {
      if (!rule.enabled) continue;

      try {
        const shouldTrigger = this.evaluateRule(rule, performance);

        if (shouldTrigger && !this.activeAlerts.has(ruleId)) {
          await this.triggerAlert(rule, performance);
        }
      } catch (error) {
        this.logger.error(`Error checking alert rule ${rule.name}: ${error.message}`);
      }
    }
  }

  private evaluateRule(rule: AlertRule, performance: SystemPerformance): boolean {
    let currentValue: number;

    switch (rule.metric) {
      case 'latency':
        currentValue = performance.avgLatencyMs;
        break;
      case 'error_rate':
        currentValue = performance.errorRate;
        break;
      case 'disconnection':
        currentValue = performance.disconnectedDevices;
        break;
      case 'memory':
        currentValue = performance.memoryUsageMb;
        break;
      case 'cpu':
        currentValue = performance.cpuUsagePercent;
        break;
      default:
        return false;
    }

    switch (rule.condition) {
      case 'gt':
        return currentValue > rule.threshold;
      case 'gte':
        return currentValue >= rule.threshold;
      case 'lt':
        return currentValue < rule.threshold;
      case 'lte':
        return currentValue <= rule.threshold;
      case 'eq':
        return currentValue === rule.threshold;
      default:
        return false;
    }
  }

  private async triggerAlert(rule: AlertRule, performance: SystemPerformance): Promise<void> {
    const alert: Alert = {
      id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      ruleId: rule.id,
      ruleName: rule.name,
      message: `${rule.name}: Current value exceeds threshold (${rule.threshold})`,
      severity: rule.severity,
      value: this.getMetricValue(rule.metric, performance),
      threshold: rule.threshold,
      triggeredAt: new Date(),
      status: 'active',
    };

    this.activeAlerts.set(alert.id, alert);

    // Emit event
    this.eventEmitter.emit('alert.triggered', alert);

    this.logger.warn(`Alert triggered: ${alert.message} [${rule.severity.toUpperCase()}]`);
  }

  private getMetricValue(metric: string, performance: SystemPerformance): number {
    switch (metric) {
      case 'latency':
        return performance.avgLatencyMs;
      case 'error_rate':
        return performance.errorRate;
      case 'disconnection':
        return performance.disconnectedDevices;
      case 'memory':
        return performance.memoryUsageMb;
      case 'cpu':
        return performance.cpuUsagePercent;
      default:
        return 0;
    }
  }

  private updateSystemPerformance(): void {
    const performance = this.calculateCurrentPerformance();
    this.performanceHistory.push(performance);

    // Limit history size
    if (this.performanceHistory.length > 1440) {
      // Keep 24 hours of data (one point per minute)
      this.performanceHistory.shift();
    }

    // Push performance-update event
    if (this.config.enableWebSocketPush) {
      this.eventEmitter.emit('performance.update', performance);
    }
  }

  private calculateCurrentPerformance(): SystemPerformance {
    const now = Date.now();
    const devices = Array.from(this.deviceStatuses.values());

    let totalMetrics = 0;
    let successCount = 0;
    let totalLatency = 0;
    let recentMetrics = 0;

    // Aggregate metrics for the last 1 minute
    const oneMinuteAgo = new Date(now - 60000);

    for (const [, buffer] of this.metricsBuffer) {
      for (const metric of buffer) {
        if (metric.timestamp >= oneMinuteAgo) {
          totalMetrics++;
          totalLatency += metric.durationMs;

          if (metric.success) {
            successCount++;
          }

          recentMetrics++;
        }
      }
    }

    const connectedDevices = devices.filter((d) => d.connected).length;

    // Get memory usage
    const memoryUsage = process.memoryUsage();

    return {
      totalDevices: devices.length,
      connectedDevices,
      disconnectedDevices: devices.length - connectedDevices,
      totalTags: this.metricsBuffer.size,
      activeTags: recentMetrics,
      tagsPerSecond: recentMetrics / 60, // approximation
      avgLatencyMs: totalMetrics > 0 ? totalLatency / totalMetrics : 0,
      successRate: totalMetrics > 0 ? (successCount / totalMetrics) * 100 : 100,
      errorRate: totalMetrics > 0 ? ((totalMetrics - successCount) / totalMetrics) * 100 : 0,
      memoryUsageMb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      cpuUsagePercent: 0, // requires an extra library; set to 0 for now
      timestamp: new Date(),
    };
  }

  private cleanupOldMetrics(): void {
    const cutoff = new Date(Date.now() - this.config.metricsRetentionMs);
    let cleaned = 0;

    for (const [key, buffer] of this.metricsBuffer) {
      const beforeLength = buffer.length;

      // Filter out old records
      const filtered = buffer.filter((m) => m.timestamp > cutoff);
      this.metricsBuffer.set(key, filtered);

      cleaned += beforeLength - filtered.length;
    }

    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} old metrics entries`);
    }
  }

  private createEmptyDeviceStatus(deviceId: string): DeviceStatus {
    return {
      deviceId,
      deviceName: deviceId,
      protocol: 'unknown',
      connected: false,
      totalConnections: 0,
      totalDisconnections: 0,
      uptimeSeconds: 0,
    };
  }
}
