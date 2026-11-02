// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Trigger Matcher — P1-T06 trigger event matcher
 *
 * Infers trigger event types and parameters from natural-language descriptions using keywords + rules.
 * No LLM call needed; lightweight matcher (< 3KB).
 *
 * Supports 4 trigger types:
 *   - dataChange: data tag value change ("when temperature exceeds 80")
 *   - timer: scheduled trigger ("run every 5 seconds")
 *   - event: graphic event trigger ("when the button is clicked")
 *   - manual: manual trigger ("execute manually")
 *   - unknown: unrecognized
 *
 * Usage:
 *   const result = triggerMatcher.match('Trigger an alarm when the temperature exceeds 80');
 *   // { type: 'dataChange', tagId: 'temperature', condition: '>', threshold: 80, confidence: 0.8 }
 */

// ============================================================
// Type definitions
// ============================================================

export type TriggerType = 'dataChange' | 'timer' | 'event' | 'manual' | 'unknown';

export interface TriggerMatchResult {
  type: TriggerType;
  confidence: number;
  /** dataChange: tag ID */
  tagId?: string;
  /** dataChange: comparison condition */
  condition?: string;
  /** dataChange: threshold */
  threshold?: number;
  /** timer: interval (ms) */
  interval?: number;
  /** timer: Cron expression (optional) */
  cron?: string;
  /** event: graphic ID */
  graphicId?: string;
  /** event: event type */
  eventType?: 'click' | 'dblclick' | 'mousedown' | 'mouseup';
}

// ============================================================
// Constants: keyword → tag ID mapping
// ============================================================

const TAG_KEYWORD_MAP: Record<string, string> = {
  温度: 'temperature',
  湿度: 'humidity',
  压力: 'pressure',
  流量: 'flow',
  液位: 'level',
  电流: 'current',
  电压: 'voltage',
  功率: 'power',
  转速: 'speed',
  振动: 'vibration',
  频率: 'frequency',
  开度: 'opening',
};

const COMPARISON_KEYWORDS: Record<string, string> = {
  超过: '>',
  大于: '>',
  高于: '>',
  超出: '>',
  低于: '<',
  小于: '<',
  不足: '<',
  等于: '==',
  达到: '>=',
  不低于: '>=',
  不高于: '<=',
  不等于: '!=',
};

const EVENT_KEYWORDS: Record<string, string> = {
  点击: 'click',
  双击: 'dblclick',
  按下: 'mousedown',
  松开: 'mouseup',
};

// ============================================================
// TriggerMatcher
// ============================================================

export class TriggerMatcher {
  /**
   * Match a trigger event from natural language
   */
  match(input: string): TriggerMatchResult {
    // 1. Detect timer triggers
    const timerResult = this._matchTimer(input);
    if (timerResult) return timerResult;

    // 2. Detect event triggers
    const eventResult = this._matchEvent(input);
    if (eventResult) return eventResult;

    // 3. Detect dataChange triggers
    const dataChangeResult = this._matchDataChange(input);
    if (dataChangeResult) return dataChangeResult;

    // 4. Detect manual triggers
    if (/手动|菜单|按钮.*执行/.test(input)) {
      return { type: 'manual', confidence: 0.7 };
    }

    // 5. Default: unknown
    return { type: 'unknown', confidence: 0 };
  }

  // ─── Private match methods ───

  private _matchDataChange(input: string): TriggerMatchResult | null {
    // Pattern: "when/if X exceeds/greater than/below Y (unit) then..."
    const pattern = /(?:当|如果|一旦|若)\s*(.+?)\s*(超过|大于|高于|超出|低于|小于|不足|等于|达到|不低于|不高于|不等于)\s*(\d+(?:\.\d+)?)\s*(?:度|毫米|米|秒|分钟|小时|%|％)?/;
    const match = input.match(pattern);

    if (!match) {
      // Loose pattern: match only "when X changes"
      const looseMatch = input.match(/(?:当|如果)\s*(.+?)\s*(?:变化|改变|更新|变动)/);
      if (looseMatch) {
        const tagId = this._extractTagId(looseMatch[1]);
        return { type: 'dataChange', confidence: 0.5, tagId };
      }
      return null;
    }

    const tagName = match[1].trim();
    const conditionWord = match[2];
    const threshold = parseFloat(match[3]);

    const tagId = this._extractTagId(tagName);
    const condition = COMPARISON_KEYWORDS[conditionWord] || '>';

    return {
      type: 'dataChange',
      confidence: 0.8,
      tagId,
      condition,
      threshold,
    };
  }

  private _matchTimer(input: string): TriggerMatchResult | null {
    // Pattern: "every X seconds/minutes/hours/milliseconds run"
    const pattern = /每\s*(\d+(?:\.\d+)?)\s*(秒|分钟?|小时?|毫秒|ms|s|min|h)\s*(?:执行|运行|触发|检查|调用)?/;
    const match = input.match(pattern);

    if (match) {
      const value = parseFloat(match[1]);
      const unit = match[2];
      const interval = unitMultiplier[unit]
        ? value * unitMultiplier[unit]
        : value * 1000; // default seconds

      return { type: 'timer', confidence: 0.85, interval };
    }

    // Cron pattern
    if (/cron|定时|周期性/.test(input)) {
      return { type: 'timer', confidence: 0.6, interval: 60000 }; // default 1 minute
    }

    return null;
  }

  private _matchEvent(input: string): TriggerMatchResult | null {
    // Pattern: "when X button/graphic is clicked/double-clicked"
    const pattern = /(点击|双击|按下|松开)\s*(.+?)(?:按钮|图元|组件|图标)?\s*时/;
    const match = input.match(pattern);

    if (match) {
      const eventType = (EVENT_KEYWORDS[match[1]] || 'click') as TriggerMatchResult['eventType'];
      const targetName = match[2].trim();
      const graphicId = this._extractGraphicId(targetName);

      return { type: 'event', confidence: 0.75, graphicId, eventType };
    }

    return null;
  }

  // ─── Helper methods ───

  private _extractTagId(tagName: string): string {
    // Check the keyword mapping first
    for (const [kw, id] of Object.entries(TAG_KEYWORD_MAP)) {
      if (tagName.includes(kw)) return id;
    }
    // Fallback: keep CJK characters (\u4e00-\u9fff), convert other non-word characters to underscores
    return tagName
      .replace(/[^\w\u4e00-\u9fff]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .toLowerCase() || 'unknown_tag';
  }

  private _extractGraphicId(targetName: string): string {
    return targetName
      .replace(/[^\w\u4e00-\u9fff]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .toLowerCase() || 'unknown_graphic';
  }
}

// ============================================================
// Time unit multipliers
// ============================================================

const unitMultiplier: Record<string, number> = {
  毫秒: 1,
  ms: 1,
  秒: 1000,
  s: 1000,
  分: 60_000,
  分钟: 60_000,
  min: 60_000,
  小时: 3_600_000,
  h: 3_600_000,
};

/** Singleton */
export const triggerMatcher = new TriggerMatcher();
