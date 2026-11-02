// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { type PluginPropertySchema } from '@scada-editor/plugin-sdk';

/**
 * Image rendering style schema of the state variable component.
 * Contains only image fit + opacity + scale/rotation + border/shadow; fields reuse the corresponding image component fields.
 * Variable binding fields, state rules (states) and the default image (defaultImage) are managed
 * by StateVariableConfig as a custom section and are not part of this schema.
 */
export const stateVariablePropertySchema: PluginPropertySchema = {
  name: '状态变量',
  layout: 'grid',
  columns: 2,
  propsPath: 'customProps',
  fields: [
    // ── Image display (reuses image) ──
    {
      name: 'imageFit',
      label: '适应模式',
      labelKey: 'image.properties.imageFit',
      type: 'select',
      options: [
        { value: 'contain', label: '包含', labelKey: 'image.options.imageFit.contain' },
        { value: 'cover', label: '覆盖', labelKey: 'image.options.imageFit.cover' },
        { value: 'fill', label: '填充', labelKey: 'image.options.imageFit.fill' },
        { value: 'none', label: '原始', labelKey: 'image.options.imageFit.none' },
        { value: 'scale-down', label: '缩小', labelKey: 'image.options.imageFit.scale-down' },
      ],
      defaultValue: 'contain',
      group: 'basic',
    },
    { name: 'decimalPlaces', label: '小数位数', labelKey: 'label.properties.decimalPlaces', type: 'number', min: 0, max: 6, step: 1, defaultValue: 2, group: 'basic' },
    { name: 'opacity', label: '不透明度', labelKey: 'image.properties.opacity', type: 'number', min: 0, max: 1, step: 0.05, defaultValue: 1, group: 'basic' },
    { name: 'imageScale', label: '缩放比例', labelKey: 'image.properties.imageScale', type: 'number', min: 0.01, max: 10, step: 0.1, defaultValue: 1, group: 'basic' },
    { name: 'imageRotation', label: '旋转角度', labelKey: 'image.properties.imageRotation', type: 'number', min: -360, max: 360, step: 1, defaultValue: 0, group: 'basic' },

    // ── Border ──
    { name: 'borderColor', label: '边框颜色', labelKey: 'image.properties.borderColor', type: 'color', defaultValue: '#00000000', group: 'style' },
    { name: 'borderWidth', label: '边框宽度', labelKey: 'image.properties.borderWidth', type: 'number', min: 0, step: 1, defaultValue: 0, group: 'style' },
    {
      name: 'borderStyle',
      label: '边框样式',
      labelKey: 'image.properties.borderStyle',
      type: 'select',
      options: [
        { value: 'solid', label: '实线', labelKey: 'image.options.borderStyle.solid' },
        { value: 'dashed', label: '虚线', labelKey: 'image.options.borderStyle.dashed' },
        { value: 'dotted', label: '点线', labelKey: 'image.options.borderStyle.dotted' },
      ],
      defaultValue: 'solid',
      group: 'style',
    },
    { name: 'borderRadius', label: '圆角', labelKey: 'image.properties.borderRadius', type: 'number', min: 0, step: 1, defaultValue: 0, group: 'style' },

    // ── Shadow ──
    { name: 'shadowColor', label: '阴影颜色', labelKey: 'image.properties.shadowColor', type: 'color', defaultValue: '#00000000', group: 'shadow' },
    { name: 'shadowOffsetX', label: '阴影偏移X', labelKey: 'image.properties.shadowOffsetX', type: 'number', step: 1, defaultValue: 0, group: 'shadow' },
    { name: 'shadowOffsetY', label: '阴影偏移Y', labelKey: 'image.properties.shadowOffsetY', type: 'number', step: 1, defaultValue: 0, group: 'shadow' },
    { name: 'shadowBlur', label: '阴影模糊', labelKey: 'image.properties.shadowBlur', type: 'number', min: 0, step: 1, defaultValue: 0, group: 'shadow' },
  ],
};
