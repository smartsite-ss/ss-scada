// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { describe, it, expect } from 'vitest';
import {
  matchState,
  resolveStateImage,
  getAvailableOperators,
  generateRuleId,
  type StateRule,
} from '../../system/state-variable/stateVariableUtils';

function makeRule(partial: Partial<StateRule>): StateRule {
  return {
    id: 'rule-1',
    label: '状态',
    operator: 'equal',
    value: '',
    image: 'img.png',
    ...partial,
  };
}

describe('stateVariableUtils - matchState numeric comparison', () => {
  it('equal matches equal numbers', () => {
    expect(matchState(1, makeRule({ operator: 'equal', value: '1' }), 'float')).toBe(true);
  });

  it('equal does not match unequal numbers', () => {
    expect(matchState(2, makeRule({ operator: 'equal', value: '1' }), 'float')).toBe(false);
  });

  it('notEqual matches unequal numbers', () => {
    expect(matchState(2, makeRule({ operator: 'notEqual', value: '1' }), 'float')).toBe(true);
  });

  it('greaterThan / greaterOrEqual boundary handling is correct', () => {
    expect(matchState(5, makeRule({ operator: 'greaterThan', value: '3' }), 'int')).toBe(true);
    expect(matchState(3, makeRule({ operator: 'greaterThan', value: '3' }), 'int')).toBe(false);
    expect(matchState(3, makeRule({ operator: 'greaterOrEqual', value: '3' }), 'int')).toBe(true);
  });

  it('lessThan / lessOrEqual boundary handling is correct', () => {
    expect(matchState(1, makeRule({ operator: 'lessThan', value: '3' }), 'int')).toBe(true);
    expect(matchState(3, makeRule({ operator: 'lessThan', value: '3' }), 'int')).toBe(false);
    expect(matchState(3, makeRule({ operator: 'lessOrEqual', value: '3' }), 'int')).toBe(true);
  });

  it('between inclusive-boundary matching is correct', () => {
    const rule = makeRule({ operator: 'between', value: '0', value2: '30' });
    expect(matchState(0, rule, 'float')).toBe(true);
    expect(matchState(15, rule, 'float')).toBe(true);
    expect(matchState(30, rule, 'float')).toBe(true);
    expect(matchState(31, rule, 'float')).toBe(false);
  });
});

describe('stateVariableUtils - matchState string comparison', () => {
  it('equal / notEqual string comparison', () => {
    expect(matchState('running', makeRule({ operator: 'equal', value: 'running' }), 'string')).toBe(true);
    expect(matchState('running', makeRule({ operator: 'notEqual', value: 'fault' }), 'string')).toBe(true);
  });

  it('contains / startsWith / endsWith matching is correct', () => {
    expect(matchState('motor-running', makeRule({ operator: 'contains', value: 'running' }), 'string')).toBe(true);
    expect(matchState('running-01', makeRule({ operator: 'startsWith', value: 'running' }), 'string')).toBe(true);
    expect(matchState('pump-running', makeRule({ operator: 'endsWith', value: 'running' }), 'string')).toBe(true);
  });
});

describe('stateVariableUtils - matchState booleans and boundaries', () => {
  it('Boolean normalization "1"/"true" hits', () => {
    expect(matchState(1, makeRule({ operator: 'equal', value: '1' }), 'bool')).toBe(true);
    expect(matchState('true', makeRule({ operator: 'equal', value: 'true' }), 'boolean')).toBe(true);
    expect(matchState(false, makeRule({ operator: 'notEqual', value: '1' }), 'bool')).toBe(true);
  });

  it('null / undefined do not match', () => {
    expect(matchState(null, makeRule({ operator: 'equal', value: '1' }), 'float')).toBe(false);
    expect(matchState(undefined, makeRule({ operator: 'equal', value: '1' }), 'float')).toBe(false);
  });

  it('String type with greaterThan configured neither matches nor throws', () => {
    expect(matchState('abc', makeRule({ operator: 'greaterThan', value: '1' }), 'string')).toBe(false);
  });
});

describe('stateVariableUtils - resolveStateImage', () => {
  it('Stop after the first matching rule (first match wins)', () => {
    const states = [
      makeRule({ id: 'a', operator: 'equal', value: '1', image: 'first.png' }),
      makeRule({ id: 'b', operator: 'equal', value: '1', image: 'second.png' }),
    ];
    expect(resolveStateImage(1, states, 'int', '')).toBe('first.png');
  });

  it('Returns defaultImage on no match', () => {
    const states = [makeRule({ operator: 'equal', value: '1', image: 'hit.png' })];
    expect(resolveStateImage(2, states, 'int', 'default.png')).toBe('default.png');
  });

  it('Returns an empty string on no match and no default image', () => {
    const states = [makeRule({ operator: 'equal', value: '1', image: 'hit.png' })];
    expect(resolveStateImage(2, states, 'int', '')).toBe('');
  });

  it('Skip when the rule image is empty', () => {
    const states = [makeRule({ operator: 'equal', value: '1', image: '' })];
    expect(resolveStateImage(1, states, 'int', 'default.png')).toBe('default.png');
  });
});

describe('stateVariableUtils - getAvailableOperators / generateRuleId', () => {
  it('Numeric types return range operators', () => {
    expect(getAvailableOperators('float')).toContain('between');
    expect(getAvailableOperators('int')).toContain('greaterThan');
  });

  it('SCADA real numeric types (float32/float64/int16/uint16/int32/uint32) return the full numeric operator set', () => {
    for (const dataType of ['float32', 'float64', 'int16', 'uint16', 'int32', 'uint32']) {
      const ops = getAvailableOperators(dataType);
      expect(ops).toContain('greaterThan');
      expect(ops).toContain('greaterOrEqual');
      expect(ops).toContain('lessThan');
      expect(ops).toContain('lessOrEqual');
      expect(ops).toContain('between');
    }
  });

  it('Boolean type only returns equal / notEqual', () => {
    expect(getAvailableOperators('bool')).toEqual(['equal', 'notEqual']);
  });

  it('String types return string operators', () => {
    expect(getAvailableOperators('string')).toContain('contains');
    expect(getAvailableOperators('string')).toContain('startsWith');
    expect(getAvailableOperators('string')).toContain('endsWith');
  });

  it('generateRuleId returns a unique string with the rule- prefix', () => {
    const a = generateRuleId();
    const b = generateRuleId();
    expect(a.startsWith('rule-')).toBe(true);
    expect(a).not.toBe(b);
  });
});
