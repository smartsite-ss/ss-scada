// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Data-driven script examples
 *
 * === Scenario ===
 * Data-driven is the most common script use case. A script is bound to a tag's data change,
 * and when the tag value updates the script runs automatically, evaluating the value and performing the corresponding actions.
 *
 * === Trigger modes ===
 * - dataChange: bound to a specific tag, triggered on data change
 * - expression: triggered when an expression condition is met
 *
 * === Common API combinations ===
 * readTag / writeTag / getTagQuality    → data read/write
 * setGraphicProps / showGraphic / hideGraphic → graphic control
 * triggerAlarm / notify / log           → alarm notification
 * isAlarm / clamp / mapRange / colorForValue → evaluation and calculation
 */

import type { ScriptExample } from '../types';

export const dataDrivenExamples: ScriptExample[] = [
  // ═══════════════════════════════════════════════════════════
  // Example 1: temperature alarm + graphic color change
  // ═══════════════════════════════════════════════════════════
  {
    id: 'data-driven-temp-alarm',
    title: '温度告警 + 图元变色',
    description: '当温度标签值超过阈值时，改变图元颜色并触发告警。这是最经典的数据驱动场景。',
    category: 'data-driven',
    triggerType: 'dataChange',
    requiredTags: ['temp_sensor_01'],
    tags: ['入门', '告警', '图元控制'],
    difficulty: 'easy',
    code: `// 场景：温度告警 + 图元变色
// 触发方式：dataChange（绑定 temp_sensor_01 标签）
// 涉及 API：readTag, setGraphicProps, triggerAlarm, notify, log, round

// 1. 读取当前温度
const temp = readTag('temp_sensor_01');

// 2. 根据温度区间设置图元状态
if (temp > 100) {
  // 高温告警：图元变红 + 闪烁
  setGraphicProps('temp_gauge', {
    customProps: { value: temp, status: 'alarm' },
    borderColor: '#FF0000',
  });
  setGraphicProps('temp_indicator', {
    customProps: { text: \`超温: \${temp}°C\`, color: '#FF0000' },
  });
  triggerAlarm({
    tagId: 'temp_sensor_01',
    level: 'critical',
    message: \`温度超标: \${temp}°C (阈值: 100°C)\`,
  });
  notify(\`温度告警: \${temp}°C\`, 'error');

} else if (temp > 80) {
  // 预警：图元变黄
  setGraphicProps('temp_gauge', {
    customProps: { value: temp, status: 'warning' },
    borderColor: '#FFA500',
  });
  setGraphicProps('temp_indicator', {
    customProps: { text: \`偏高: \${temp}°C\`, color: '#FFA500' },
  });
  notify(\`温度偏高: \${temp}°C\`, 'warn');

} else {
  // 正常：图元变绿
  setGraphicProps('temp_gauge', {
    customProps: { value: temp, status: 'normal' },
    borderColor: '#00FF00',
  });
  setGraphicProps('temp_indicator', {
    customProps: { text: \`正常: \${temp}°C\`, color: '#00FF00' },
  });
}

log('info', \`温度检查完成: \${round(temp, 1)}°C\`);
`,
  },

  // ═══════════════════════════════════════════════════════════
  // Example 2: data quality check + safe read
  // ═══════════════════════════════════════════════════════════
  {
    id: 'data-driven-quality-check',
    title: '数据质量检查 + 安全读取',
    description: '在读取数据前先检查质量码，确保数据可靠性后再进行后续操作。',
    category: 'data-driven',
    triggerType: 'dataChange',
    requiredTags: ['sensor_01'],
    tags: ['入门', '数据质量', '安全'],
    difficulty: 'easy',
    code: `// 场景：数据质量检查 + 安全读取
// 触发方式：dataChange（绑定 sensor_01 标签）
// 涉及 API：getTagQuality, readTag, setGraphicProps, log

const tagId = 'sensor_01';

// 1. 先检查数据质量
const quality = getTagQuality(tagId);

if (quality === 'good') {
  // 数据正常，安全读取
  const value = readTag(tagId);

  // 使用 isAlarm 工具函数判断是否告警
  if (isAlarm(value, 100, 10)) {
    setGraphicProps('sensor_display', {
      customProps: { value, status: 'alarm', color: '#FF0000' },
    });
    log('warn', \`传感器异常: \${value}\`);
  } else {
    setGraphicProps('sensor_display', {
      customProps: { value, status: 'normal', color: '#00FF00' },
    });
  }
} else if (quality === 'bad') {
  // 数据质量差，显示异常状态
  setGraphicProps('sensor_display', {
    customProps: { value: '数据异常', status: 'error', color: '#FFA500' },
  });
  log('error', \`传感器 \${tagId} 数据质量异常: \${quality}\`);
  notify(\`传感器 \${tagId} 数据质量异常\`, 'warn');
} else {
  // 质量不确定，显示警告
  setGraphicProps('sensor_display', {
    customProps: { value: '数据不确定', status: 'uncertain', color: '#FFD700' },
  });
  log('info', \`传感器 \${tagId} 数据质量不确定\`);
}
`,
  },

  // ═══════════════════════════════════════════════════════════
  // Example 3: multi-threshold ranges + color mapping
  // ═══════════════════════════════════════════════════════════
  {
    id: 'data-driven-color-mapping',
    title: '多阈值区间 + 颜色映射',
    description: '使用 colorForValue 和 clamp 工具函数，将传感器数值映射为热力图颜色。',
    category: 'data-driven',
    triggerType: 'dataChange',
    requiredTags: ['pressure_sensor'],
    tags: ['进阶', '颜色映射', '可视化'],
    difficulty: 'medium',
    code: `// 场景：多阈值区间 + 颜色映射
// 触发方式：dataChange（绑定 pressure_sensor 标签）
// 涉及 API：readTag, setGraphicProps, colorForValue, clamp, round, log

const pressure = readTag('pressure_sensor');

// 1. 使用 clamp 将压力值约束在安全范围内
const safePressure = clamp(pressure, 0, 200);

// 2. 使用 colorForValue 生成热力图颜色（0=绿色, 100=黄色, 200=红色）
const color = colorForValue(safePressure, 0, 200);

// 3. 更新压力表图元
setGraphicProps('pressure_gauge', {
  customProps: {
    value: round(safePressure, 1),
    unit: 'kPa',
    color: color,
  },
  borderColor: color,
});

// 4. 更新压力文字标签
setGraphicProps('pressure_label', {
  customProps: {
    text: \`\${round(safePressure, 1)} kPa\`,
    color: color,
  },
});

log('info', \`压力读数: \${round(safePressure, 1)} kPa, 颜色: \${color}\`);
`,
  },

  // ═══════════════════════════════════════════════════════════
  // Example 4: data aggregation + multi-tag write
  // ═══════════════════════════════════════════════════════════
  {
    id: 'data-driven-aggregation',
    title: '数据聚合 + 多标签写入',
    description: '从多个标签读取数据，聚合计算后写入汇总标签。',
    category: 'data-driven',
    triggerType: 'dataChange',
    requiredTags: ['line_01_output', 'line_02_output', 'line_03_output'],
    tags: ['进阶', '数据聚合', '多标签'],
    difficulty: 'medium',
    code: `// 场景：多产线数据聚合
// 触发方式：dataChange（绑定任意产线标签）
// 涉及 API：readTag, writeTag, mapRange, round, log, notify

const lines = ['line_01', 'line_02', 'line_03'];
let totalOutput = 0;
let maxOutput = 0;
let minOutput = Infinity;

// 1. 遍历所有产线，读取产量
for (const lineId of lines) {
  const output = readTag(\`\${lineId}_output\`) || 0;
  totalOutput += output;
  maxOutput = Math.max(maxOutput, output);
  minOutput = Math.min(minOutput, output);
  log('info', \`\${lineId}: \${output}\`);
}

// 2. 写入汇总标签
writeTag('total_output', totalOutput);
writeTag('max_output', maxOutput);
writeTag('min_output', minOutput);

// 3. 计算平均产量
const avgOutput = round(totalOutput / lines.length, 1);
writeTag('avg_output', avgOutput);

// 4. 使用 mapRange 将产量映射为 0-100 的完成率
const target = 500;
const completionRate = round(mapRange(totalOutput, 0, target, 0, 100), 0);
writeTag('completion_rate', clamp(completionRate, 0, 100));

// 5. 产量不足时告警
if (totalOutput < target * 0.8) {
  notify(\`总产量偏低: \${totalOutput} / \${target}\`, 'warn');
  log('warn', \`产量不足，完成率: \${completionRate}%\`);
} else {
  log('info', \`总产量 \${totalOutput}, 完成率 \${completionRate}%\`);
}
`,
  },
];