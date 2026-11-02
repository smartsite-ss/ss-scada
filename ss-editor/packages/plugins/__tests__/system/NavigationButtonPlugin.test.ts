// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { describe, it, expect } from 'vitest';
import { NavigationButtonPlugin, navigationButtonPropertySchema } from '../../system/navigation-button';

describe('NavigationButtonPlugin — Schema static validation (Layer 1)', () => {
  it('schema.fields should be a non-empty array', () => {
    expect(navigationButtonPropertySchema.fields.length).toBeGreaterThan(0);
  });

  it('each field should have name and type', () => {
    for (const field of navigationButtonPropertySchema.fields) {
      expect(field.name).toBeTruthy();
      expect(field.type).toBeTruthy();
    }
  });

  it('select type should have options or optionsProvider', () => {
    const selectFields = navigationButtonPropertySchema.fields.filter(f => f.type === 'select');
    for (const field of selectFields) {
      const hasStaticOptions = !!field.options && field.options.length > 0;
      const hasDynamicOptions = typeof field.optionsProvider === 'string' && field.optionsProvider.length > 0;
      expect(hasStaticOptions || hasDynamicOptions, `${field.name} should have options or optionsProvider`).toBe(true);
    }
  });

  it('all fields should have defaultValue', () => {
    for (const field of navigationButtonPropertySchema.fields) {
      expect(field.defaultValue, `${field.name} is missing defaultValue`).toBeDefined();
    }
  });

  it('Every field should have labelKey', () => {
    for (const field of navigationButtonPropertySchema.fields) {
      expect(field.labelKey, `${field.name} missing labelKey`).toBeTruthy();
    }
  });

  it('The type field should have 5 options', () => {
    const typeField = navigationButtonPropertySchema.fields.find(f => f.name === 'type');
    expect(typeField?.options).toHaveLength(5);
  });

  it('The size field should have 3 options', () => {
    const sizeField = navigationButtonPropertySchema.fields.find(f => f.name === 'size');
    expect(sizeField?.options).toHaveLength(3);
  });
});

describe('NavigationButtonPlugin — Construction and basic functionality', () => {
  it('should create instance correctly', () => {
    const plugin = new NavigationButtonPlugin();
    expect(plugin.type).toBeTruthy();
    expect(plugin.type).toBe('navigation-button');
  });

  it('Should accept position and size arguments', () => {
    const plugin = new NavigationButtonPlugin(50, 100, 150, 50);
    const size = plugin.getSize();
    expect(size.width).toBe(150);
    expect(size.height).toBe(50);
  });

  it('getSize should return the correct size', () => {
    const plugin = new NavigationButtonPlugin(0, 0, 150, 50);
    const size = plugin.getSize();
    expect(size.width).toBe(150);
    expect(size.height).toBe(50);
  });

  it('Default text should be Navigation Button', () => {
    const plugin = new NavigationButtonPlugin();
    expect(plugin.pluginProps.text).toBe('导航按钮');
  });

  it('Default type should be primary', () => {
    const plugin = new NavigationButtonPlugin();
    expect(plugin.pluginProps.type).toBe('primary');
  });
});

describe('NavigationButtonPlugin — property read/write consistency', () => {
  it('setDefaultProps should write into the config', () => {
    const plugin = new NavigationButtonPlugin();
    plugin.setDefaultProps({ text: '测试', type: 'danger' } as any);
    expect(plugin.pluginProps.text).toBe('测试');
    expect(plugin.pluginProps.type).toBe('danger');
  });

  it('setPluginProps should update properties', () => {
    const plugin = new NavigationButtonPlugin();
    (plugin as any).setPluginProps({ text: '新文本' });
    expect(plugin.pluginProps.text).toBe('新文本');
  });
});

describe('NavigationButtonPlugin — features', () => {
  it('dataBindable should be true (edit-mode data binding support)', () => {
    const meta = (NavigationButtonPlugin as any).graphicMeta;
    expect(meta).toBeDefined();
    expect(meta.features).toBeDefined();
    expect(meta.features.dataBindable).toBe(true);
  });

  it('Should keep other feature flags', () => {
    const meta = (NavigationButtonPlugin as any).graphicMeta;
    expect(meta.features.resizable).toBe(true);
    expect(meta.features.cloneable).toBe(true);
    expect(meta.features.groupable).toBe(true);
  });
});
