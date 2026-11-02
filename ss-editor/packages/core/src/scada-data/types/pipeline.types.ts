// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type { QualityCode } from './quality.types';

export type FilterType =
  | 'fieldExtract'
  | 'typeConvert'
  | 'scaleTransform'
  | 'deadband'
  | 'format'
  | 'custom'

export interface FilterConfigBase {
  enabled: boolean
}

export interface FieldExtractConfig extends FilterConfigBase {
  jsonPath: string
}

export interface TypeConvertConfig extends FilterConfigBase {
  targetType: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'date'
}

export interface ScaleTransformConfig extends FilterConfigBase {
  scale: number
  offset: number
}

export interface DeadbandConfig extends FilterConfigBase {
  threshold: number
}

export interface FormatConfig extends FilterConfigBase {
  precision: number
  formatType: 'decimal' | 'scientific' | 'hex' | 'binary' | 'percentage'
}

export interface CustomConfig extends FilterConfigBase {
  script: string
}

export type FilterConfig =
  | FieldExtractConfig
  | TypeConvertConfig
  | ScaleTransformConfig
  | DeadbandConfig
  | FormatConfig
  | CustomConfig

export interface DataFilter {
  id: string
  name: string
  type: FilterType
  config: FilterConfig
  enabled: boolean
  order: number
}

export interface FilterExecutionResult {
  filterId: string
  input: unknown
  output: unknown
  duration: number
  success: boolean
  error?: string
}

export interface PipelineResult {
  input: unknown
  output: unknown
  success: boolean
  error?: string
  filters: FilterExecutionResult[]
}

export type PipelineErrorStrategy = 'skip' | 'stop' | 'defaultValue'

export interface PipelineErrorConfig {
  strategy: PipelineErrorStrategy
  defaultValue?: unknown
}

export type DataActionType = 'setProperty' | 'setStyle' | 'setAnimation' | 'triggerAction'

export interface DataActionSetProperty {
  type: 'setProperty'
  target: string
  value: unknown
}

export interface DataActionSetStyle {
  type: 'setStyle'
  target: string
  value: unknown
}

export interface DataActionSetAnimation {
  type: 'setAnimation'
  target: string
  value: unknown
}

export interface DataActionTriggerAction {
  type: 'triggerAction'
  target: string
  value: unknown
}

export type DataAction =
  | DataActionSetProperty
  | DataActionSetStyle
  | DataActionSetAnimation
  | DataActionTriggerAction

/**
 * Simplified data-pipeline alarm event.
 *
 * Unlike AlarmRecord in alarm.types.ts (the full alarm record):
 * - This interface is used for DataDriverEngine pipeline output and only carries basic
 *   alarm info triggered by driver scripts
 * - AlarmRecord in alarm.types.ts is the complete record used by the alarm system
 *   (definitionId / state / escalationLevel, etc.)
 *
 * The two are kept separate to avoid the data pipeline depending on the alarm
 * system's full field definitions.
 */
export interface AlarmRecord {
  id: string
  message: string
  severity: 'info' | 'warning' | 'critical'
  timestamp: number
  acknowledged: boolean
}

export interface DataInputPayload {
  source: string
  value: unknown
  actions: DataAction[]
  alarm?: AlarmRecord
  quality?: QualityCode
  pipelineLog?: PipelineResult
}
