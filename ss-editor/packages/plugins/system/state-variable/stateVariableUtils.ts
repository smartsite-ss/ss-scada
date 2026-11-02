// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * State variable component - state matching pure functions.
 * Depends only on input parameters, no side effects, easy to unit test.
 */

/** Comparison operators (fully semantic naming, no abbreviations) */
export type StateOperator =
  | 'equal'
  | 'notEqual'
  | 'greaterThan'
  | 'greaterOrEqual'
  | 'lessThan'
  | 'lessOrEqual'
  | 'between'
  | 'contains'
  | 'startsWith'
  | 'endsWith';

/** A state rule: comparison operator + comparison value + matched image */
export interface StateRule {
  /** Rule unique ID (used for Vue key / deletion / sorting) */
  id: string;
  /** State name (for display, e.g. Running, Fault) */
  label: string;
  /** Comparison operator */
  operator: StateOperator;
  /** Comparison value (stored as string, converted by dataType when matching) */
  value: string;
  /** Comparison value 2 (only used by the between range, may be empty) */
  value2?: string;
  /** Image URL / base64 / gallery address shown when matched */
  image: string;
}

/** Numeric data type set (includes the actual SCADA DataTag types) */
const NUMERIC_TYPES = new Set([
  'float',
  'double',
  'decimal',
  'int',
  'integer',
  'long',
  'short',
  'number',
  'real',
  'int8',
  'uint8',
  'int16',
  'uint16',
  'int32',
  'uint32',
  'int64',
  'uint64',
  'float32',
  'float64',
]);

/** Boolean data type set */
const BOOLEAN_TYPES = new Set(['bool', 'boolean']);

/** Operators effective only for numeric types */
const NUMERIC_ONLY_OPERATORS = new Set<StateOperator>([
  'greaterThan',
  'greaterOrEqual',
  'lessThan',
  'lessOrEqual',
  'between',
]);

/** Normalize the raw tag value into a comparable value */
function normalizeValue(value: unknown, dataType: string): unknown {
  if (value === null || value === undefined) return null;

  if (BOOLEAN_TYPES.has(dataType)) {
    if (typeof value === 'boolean') return value;
    const text = String(value).toLowerCase();
    if (text === 'true' || text === '1') return true;
    if (text === 'false' || text === '0') return false;
  }

  if (NUMERIC_TYPES.has(dataType)) {
    const number = Number(value);
    return Number.isFinite(number) ? number : String(value);
  }

  return String(value);
}

/** Whether a single rule matches the current value */
export function matchState(value: unknown, rule: StateRule, dataType: string): boolean {
  const current = normalizeValue(value, dataType);
  if (current === null) return false;

  const isNumeric = typeof current === 'number';

  // Size/range comparisons are effective only for numeric types; type mismatch means no match
  if (NUMERIC_ONLY_OPERATORS.has(rule.operator) && !isNumeric) return false;

  switch (rule.operator) {
    case 'equal':
      if (typeof current === 'boolean') {
        return current === normalizeValue(rule.value, dataType);
      }
      return isNumeric ? current === Number(rule.value) : String(current) === String(rule.value);
    case 'notEqual':
      if (typeof current === 'boolean') {
        return current !== normalizeValue(rule.value, dataType);
      }
      return isNumeric ? current !== Number(rule.value) : String(current) !== String(rule.value);
    case 'greaterThan':
      return (current as number) > Number(rule.value);
    case 'greaterOrEqual':
      return (current as number) >= Number(rule.value);
    case 'lessThan':
      return (current as number) < Number(rule.value);
    case 'lessOrEqual':
      return (current as number) <= Number(rule.value);
    case 'between': {
      const lowerBound = Number(rule.value);
      const upperBound = Number(rule.value2);
      if (Number.isNaN(lowerBound) || Number.isNaN(upperBound)) return false;
      return (current as number) >= lowerBound && (current as number) <= upperBound;
    }
    case 'contains':
      return String(current).includes(rule.value);
    case 'startsWith':
      return String(current).startsWith(rule.value);
    case 'endsWith':
      return String(current).endsWith(rule.value);
    default:
      return false;
  }
}

/**
 * Iterate the state rules and return the image of the first matching rule.
 * Returns defaultImage (possibly an empty string) when no rule matches.
 */
export function resolveStateImage(
  value: unknown,
  states: StateRule[],
  dataType: string,
  defaultImage: string,
): string {
  for (const rule of states) {
    if (rule.image && matchState(value, rule, dataType)) {
      return rule.image;
    }
  }
  return defaultImage || '';
}

/** Generate a unique rule ID (avoids direct dependency on the crypto environment, compatible with tests and legacy browsers) */
export function generateRuleId(): string {
  return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Return the available comparison operators for a data type (the config panel dynamically prunes options accordingly) */
export function getAvailableOperators(dataType: string): StateOperator[] {
  if (BOOLEAN_TYPES.has(dataType)) {
    return ['equal', 'notEqual'];
  }
  if (NUMERIC_TYPES.has(dataType)) {
    return [
      'equal',
      'notEqual',
      'greaterThan',
      'greaterOrEqual',
      'lessThan',
      'lessOrEqual',
      'between',
    ];
  }
  return ['equal', 'notEqual', 'contains', 'startsWith', 'endsWith'];
}
