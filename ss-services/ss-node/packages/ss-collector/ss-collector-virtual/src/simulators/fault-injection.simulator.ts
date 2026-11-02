// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Logger } from '@nestjs/common';
import { VariableSimulator } from './variable-simulator.interface';
import { VariableSimulationConfig, FaultInjectionParams } from '../simulation-config.types';

/**
 * Fault-injection simulator
 *
 * Randomly returns errors or timeouts according to configured ratios, for testing alarm rules and circuit-breaker logic.
 * Supports four fault scenarios:
 * - error: randomly return NaN/Error (simulates communication failure)
 * - timeout: randomly delay beyond the timeout threshold (simulates timeout)
 * - slow_rise: value slowly rises (simulates sensor drift)
 * - spike: occasional spike jump (simulates sensor fault)
 */
export class FaultInjectionSimulator implements VariableSimulator {
  private readonly logger = new Logger(FaultInjectionSimulator.name);

  private currentValue: number;
  private startTime: number;
  private config: VariableSimulationConfig;

  constructor(
    private readonly params: FaultInjectionParams,
    simConfig: VariableSimulationConfig,
  ) {
    this.currentValue = params.initialValue ?? 50;
    this.startTime = Date.now();
    this.config = simConfig;
  }

  generate(): number | null {
    const elapsedSec = (Date.now() - this.startTime) / 1000;

    switch (this.params.scenario) {
      case 'error':
        return this.generateError();
      case 'timeout':
        return this.generateTimeout();
      case 'slow_rise':
        return this.generateSlowRise(elapsedSec);
      case 'spike':
        return this.generateSpike(elapsedSec);
      default:
        return this.currentValue;
    }
  }

  setValue(value: number): void {
    this.currentValue = value;
  }

  reset(): void {
    this.currentValue = this.params.initialValue ?? 50;
    this.startTime = Date.now();
  }

  getConfig(): VariableSimulationConfig {
    return this.config;
  }

  updateConfig(config: VariableSimulationConfig): void {
    const newParams = config.params as FaultInjectionParams;
    this.currentValue = newParams.initialValue ?? this.currentValue;
    this.startTime = Date.now();
    this.config = config;
  }

  /** Random error: return NaN with probability errorRate */
  private generateError(): number | null {
    const errorRate = this.params.errorRate ?? 0.1;
    if (Math.random() < errorRate) {
      this.logger.warn(`[FaultInjection] Error injected (scenario: ${this.params.scenario})`);
      return NaN;
    }
    return this.currentValue;
  }

  /** Random timeout: simulated by returning null, handled by the upper layer */
  private generateTimeout(): number | null {
    const timeoutRate = this.params.timeoutRate ?? 0.05;
    if (Math.random() < timeoutRate) {
      this.logger.warn(`[FaultInjection] Timeout injected (scenario: ${this.params.scenario})`);
      return null;
    }
    return this.currentValue;
  }

  /** Slow rise: simulates sensor drift */
  private generateSlowRise(elapsedSec: number): number {
    const riseRate = this.params.riseRatePerSec ?? 0.1;
    const noiseLevel = this.params.noiseLevel ?? 0.05;
    this.currentValue += riseRate + (Math.random() - 0.5) * noiseLevel;
    return this.currentValue;
  }

  /** Occasional spike: simulates sensor jump */
  private generateSpike(_elapsedSec: number): number {
    const spikeRate = this.params.spikeRate ?? 0.02;
    const spikeMagnitude = this.params.spikeMagnitude ?? 50;

    if (Math.random() < spikeRate) {
      const spikeValue = this.currentValue + spikeMagnitude * (Math.random() > 0.5 ? 1 : -1);
      this.logger.warn(`[FaultInjection] Spike injected: ${spikeValue}`);
      return spikeValue;
    }
    return this.currentValue;
  }
}
