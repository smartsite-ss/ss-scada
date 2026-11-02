// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { describe, it, expect } from 'vitest';
import {
  resolveDisplayName,
  formatTagValue,
  resolveBackgroundSize,
} from '../../system/tag-value/tagValueUtils';
import { tagValuePropertySchema } from '../../system/tag-value/tagValuePropertySchema';

describe('tagValueUtils - resolveDisplayName', () => {
  it('Alias takes priority when non-empty', () => {
    expect(resolveDisplayName('温度', 'T1', 'tag-1')).toBe('温度');
  });

  it('Falls back to tagName when alias is blank', () => {
    expect(resolveDisplayName('  ', 'T1', 'tag-1')).toBe('T1');
  });

  it('Falls back to tagId when both alias and tagName are empty', () => {
    expect(resolveDisplayName('', '', 'tag-1')).toBe('tag-1');
  });

  it('All empty returns an empty string', () => {
    expect(resolveDisplayName('', '', '')).toBe('');
  });
});

describe('tagValueUtils - formatTagValue', () => {
  it('Numeric values are formatted by decimal places', () => {
    expect(formatTagValue(23.5, 2)).toBe('23.50');
    expect(formatTagValue(1, 0)).toBe('1');
  });

  it('String numerics are still formatted by decimal places', () => {
    expect(formatTagValue('23.5', 2)).toBe('23.50');
  });

  it('Non-numeric strings are returned as-is', () => {
    expect(formatTagValue('running', 2)).toBe('running');
  });

  it('Boolean values are returned as strings as-is', () => {
    expect(formatTagValue(true, 2)).toBe('true');
    expect(formatTagValue(false, 2)).toBe('false');
  });

  it('Empty values return a placeholder', () => {
    expect(formatTagValue(null, 2)).toBe('--');
    expect(formatTagValue(undefined, 2)).toBe('--');
    expect(formatTagValue('', 2)).toBe('--');
  });
});

describe('tagValueUtils - resolveBackgroundSize', () => {
  it('fill stretches to fill', () => {
    expect(resolveBackgroundSize('fill')).toBe('100% 100%');
  });

  it('contain/cover map as-is', () => {
    expect(resolveBackgroundSize('contain')).toBe('contain');
    expect(resolveBackgroundSize('cover')).toBe('cover');
  });

  it('none maps to auto', () => {
    expect(resolveBackgroundSize('none')).toBe('auto');
  });

  it('scale-down is approximately mapped to contain', () => {
    expect(resolveBackgroundSize('scale-down')).toBe('contain');
  });

  it('Unknown values fall back to 100% 100%', () => {
    expect(resolveBackgroundSize('unknown')).toBe('100% 100%');
  });
});

describe('tagValuePropertySchema static validation', () => {
  it('All fields have name/type/defaultValue', () => {
    for (const field of tagValuePropertySchema.fields) {
      expect(field.name, 'field missing name').toBeTruthy();
      expect(field.type, `Field ${field.name} missing type`).toBeTruthy();
      expect(field.defaultValue, `Field ${field.name} missing defaultValue`).toBeDefined();
    }
  });

  it('All select fields have options', () => {
    for (const field of tagValuePropertySchema.fields.filter((f) => f.type === 'select')) {
      expect(field.options?.length, `Field ${field.name} missing options`).toBeGreaterThan(0);
    }
  });

  it('Contains shape/alias/showName/decorationImagePosition key fields', () => {
    const names = tagValuePropertySchema.fields.map((f) => f.name);
    expect(names).toContain('shape');
    expect(names).toContain('alias');
    expect(names).toContain('showName');
    expect(names).toContain('decorationImagePosition');
    expect(names).toContain('borderStyle');
    expect(names).toContain('backgroundRepeat');
    expect(names).toContain('backgroundImageFit');
  });

  it('Field names do not repeat', () => {
    const names = tagValuePropertySchema.fields.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
