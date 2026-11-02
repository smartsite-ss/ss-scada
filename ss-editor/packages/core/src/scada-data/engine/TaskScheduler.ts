// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type { ScheduledTask } from '../types/script.types';
import { ScriptEngine } from './ScriptEngine';

/**
 * Cron field parser
 * Supports the standard 5-field Cron format: minute hour day month weekday
 * Supported syntax: * (wildcard), step, list, range
 */
class CronParser {

  /**
   * Compute the next execution time of a Cron expression
   */
  static getNextRunTime(cron: string, fromDate: Date = new Date()): number {
    const parts = cron.trim().split(/\s+/);
    if (parts.length < 5) {
      return fromDate.getTime() + 60000; // default every minute
    }

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    const next = new Date(fromDate.getTime() + 60000); // at least 1 minute later
    next.setSeconds(0);
    next.setMilliseconds(0);

    // Search at most 366 days to avoid an infinite loop
    const maxIterations = 366 * 24 * 60;
    let iterations = 0;

    while (iterations < maxIterations) {
      iterations++;

      const currentMinute = next.getMinutes();
      const currentHour = next.getHours();
      const currentDayOfMonth = next.getDate();
      const currentMonth = next.getMonth() + 1;
      const currentDayOfWeek = next.getDay();

      if (
        this.matchesField(minute, currentMinute) &&
        this.matchesField(hour, currentHour) &&
        this.matchesField(dayOfMonth, currentDayOfMonth) &&
        this.matchesField(month, currentMonth) &&
        this.matchesField(dayOfWeek, currentDayOfWeek)
      ) {
        return next.getTime();
      }

      next.setMinutes(next.getMinutes() + 1);
    }

    // Fallback: 1 minute later
    return fromDate.getTime() + 60000;
  }

  /**
   * Check whether a field value matches a Cron expression fragment
   */
  private static matchesField(fieldExpr: string, value: number): boolean {
    if (fieldExpr === '*') return true;

    // Multiple values/expressions separated by commas
    const parts = fieldExpr.split(',');
    for (const part of parts) {
      if (this.matchesPart(part.trim(), value)) return true;
    }
    return false;
  }

  /**
   * Check whether a single expression fragment matches
   */
  private static matchesPart(part: string, value: number): boolean {
    // Step: */5 or 1-30/5
    if (part.includes('/')) {
      const [range, stepStr] = part.split('/');
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) return false;

      if (range === '*') {
        return value % step === 0;
      }

      if (range.includes('-')) {
        const [rangeStart, rangeEnd] = range.split('-').map(Number);
        return value >= rangeStart && value <= rangeEnd && (value - rangeStart) % step === 0;
      }

      const start = parseInt(range, 10);
      return value >= start && (value - start) % step === 0;
    }

    // Range: 1-5
    if (part.includes('-')) {
      const [rangeStart, rangeEnd] = part.split('-').map(Number);
      return value >= rangeStart && value <= rangeEnd;
    }

    // Exact value
    const exact = parseInt(part, 10);
    return value === exact;
  }

  /**
   * Validate whether a Cron expression is legal
   */
  static validate(cron: string): { valid: boolean; error?: string } {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) {
      return { valid: false, error: `Cron 表达式需要 5 个字段，当前 ${parts.length} 个` };
    }

    const fieldNames = ['分', '时', '日', '月', '星期'];

    for (let i = 0; i < 5; i++) {
      const field = parts[i];
      if (field === '*') continue;

      if (!/^[0-9,\-*/]+$/.test(field)) {
        return { valid: false, error: `${fieldNames[i]}字段包含非法字符: "${field}"` };
      }
    }

    return { valid: true };
  }

  /**
   * Get a readable description of a Cron expression
   */
  static describe(cron: string): string {
    const parts = cron.trim().split(/\s+/);
    if (parts.length < 5) return '无效表达式';

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    const descriptions: string[] = [];

    if (minute === '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
      return '每分钟执行';
    }

    if (minute === '0' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
      return '每小时执行';
    }

    if (hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
      if (minute.includes('/')) {
        const step = minute.split('/')[1];
        return `每 ${step} 分钟执行`;
      }
      return `在第 ${minute} 分钟执行`;
    }

    if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
      descriptions.push(`每天 ${hour}:${minute.padStart(2, '0')}`);
    } else if (dayOfMonth !== '*' && month === '*' && dayOfWeek === '*') {
      descriptions.push(`每月 ${dayOfMonth} 日 ${hour}:${minute.padStart(2, '0')}`);
    } else if (dayOfWeek !== '*' && dayOfMonth === '*' && month === '*') {
      const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      descriptions.push(`每${dayNames[parseInt(dayOfWeek, 10)] ?? '周'} ${hour}:${minute.padStart(2, '0')}`);
    }

    return descriptions.length > 0 ? descriptions.join('；') : cron;
  }
}

/**
 * Cron scheduler
 * Parses Cron expressions and schedules script execution
 */
export class TaskScheduler {
  private static instance: TaskScheduler;
  private tasks: Map<string, ScheduledTask> = new Map();
  private runningTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private engine: ScriptEngine;

  constructor() {
    this.engine = ScriptEngine.getInstance();
  }

  static getInstance(): TaskScheduler {
    if (!TaskScheduler.instance) {
      TaskScheduler.instance = new TaskScheduler();
    }
    return TaskScheduler.instance;
  }

  /**
   * Schedule a script to run on a Cron expression
   */
  schedule(scriptId: string, cron: string, params?: Record<string, any>): ScheduledTask {
    // Validate the Cron expression
    const validation = CronParser.validate(cron);
    if (!validation.valid) {
      throw new Error(`Invalid cron expression: ${validation.error}`);
    }

    const taskId = `task_${scriptId}_${Date.now()}`;
    const nextRun = CronParser.getNextRunTime(cron);

    const task: ScheduledTask = {
      taskId,
      scriptId,
      cron,
      params,
      enabled: true,
      nextRunTime: nextRun,
      runCount: 0,
    };

    this.tasks.set(taskId, task);
    this.startCronTimer(taskId);
    return task;
  }

  /** Cancel a scheduled task */
  cancel(taskId: string): void {
    this.stopCronTimer(taskId);
    this.tasks.delete(taskId);
  }

  /** Pause a task */
  pause(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.enabled = false;
      this.stopCronTimer(taskId);
    }
  }

  /** Resume a task */
  resume(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.enabled = true;
      task.nextRunTime = CronParser.getNextRunTime(task.cron);
      this.startCronTimer(taskId);
    }
  }

  /** Get all tasks */
  getAll(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }

  /** Get scheduled tasks of a given script */
  getByScriptId(scriptId: string): ScheduledTask[] {
    return Array.from(this.tasks.values()).filter((t) => t.scriptId === scriptId);
  }

  /**
   * Validate a Cron expression
   */
  static validateCron(cron: string): { valid: boolean; error?: string } {
    return CronParser.validate(cron);
  }

  /**
   * Get a readable description of a Cron expression
   */
  static describeCron(cron: string): string {
    return CronParser.describe(cron);
  }

  /**
   * Compute the next execution time of a Cron expression (public method)
   */
  static getNextRunTime(cron: string, fromDate: Date = new Date()): number {
    return CronParser.getNextRunTime(cron, fromDate);
  }

  /** Start the Cron timer */
  private startCronTimer(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task || !task.enabled) return;

    this.stopCronTimer(taskId);

    const checkAndRun = () => {
      const task = this.tasks.get(taskId);
      if (!task || !task.enabled) return;

      const now = Date.now();
      if (now >= task.nextRunTime) {
        task.runCount++;
        task.lastRunTime = now;
        task.nextRunTime = CronParser.getNextRunTime(task.cron, new Date());

        // Execute the script
        this.engine.executeAsync(task.scriptId, 'cron').catch((err) => {
          console.error(`TaskScheduler: script ${task.scriptId} execution failed:`, err);
        });
      }
    };

    // Check once per second
    const timerId = setInterval(checkAndRun, 1000);
    this.runningTimers.set(taskId, timerId);
  }

  /** Stop the Cron timer */
  private stopCronTimer(taskId: string): void {
    const timerId = this.runningTimers.get(taskId);
    if (timerId !== undefined) {
      clearInterval(timerId);
      this.runningTimers.delete(taskId);
    }
  }

  /** Clean up all timers */
  destroy(): void {
    for (const timerId of this.runningTimers.values()) {
      clearInterval(timerId);
    }
    this.runningTimers.clear();
    this.tasks.clear();
  }
}