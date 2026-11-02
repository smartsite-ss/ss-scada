// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Event-driven script examples
 *
 * === Scenario ===
 * Event-driven scripts run automatically when specific system events occur.
 * Suitable for device disconnection failover, alarm linkage, user interaction response, etc.
 *
 * === Trigger modes ===
 * - event: bound to a system event (device:disconnected, alarm:triggered, etc.)
 * - The event carries context.eventData containing event-related data
 *
 * === Common API combinations ===
 * readTag / writeTag              → state read/write
 * setGraphicProps / showGraphic / hideGraphic → graphic linkage
 * triggerAlarm / acknowledgeAlarm / clearAlarm → alarm handling
 * switchPage                      → page navigation
 * notify / log                    → notification records
 * fetch                           → external system notification
 */

import type { ScriptExample } from '../types';

export const eventDrivenExamples: ScriptExample[] = [
  // ═══════════════════════════════════════════════════════════
  // Example 1: automatic failover on device disconnection
  // ═══════════════════════════════════════════════════════════
  {
    id: 'event-device-failover',
    title: '设备断线自动切换',
    description: '主泵断线时自动切换备用泵，更新图元状态，触发告警并通知操作员。',
    category: 'event-driven',
    triggerType: 'event',
    eventName: 'device:disconnected',
    tags: ['入门', '设备切换', '告警'],
    difficulty: 'easy',
    code: `// 场景：设备断线自动切换
// 触发方式：event（绑定 device:disconnected 事件）
// context.eventData 包含事件携带的数据
// 涉及 API：setGraphicProps, writeTag, triggerAlarm, notify, log

const deviceId = context.eventData?.deviceId;

if (deviceId === 'pump_main') {
  // 1. 标记主泵为断线状态
  setGraphicProps('pump_main', {
    customProps: { status: 'disconnected', borderColor: '#FFA500' },
  });

  // 2. 自动启动备用泵
  setGraphicProps('pump_backup', {
    customProps: { status: 'running', borderColor: '#00FF00' },
  });

  // 3. 写入状态标签
  writeTag('pump_main_status', 'disconnected');
  writeTag('pump_backup_status', 'running');

  // 4. 触发告警
  triggerAlarm({
    tagId: 'pump_main',
    level: 'critical',
    message: \`主泵断线，已切换至备用泵 (\${new Date().toLocaleString()})\`,
  });

  // 5. 通知操作员
  notify('主泵断线，已自动切换至备用泵', 'error');

  // 6. 记录日志
  log('error', \`设备断线: pump_main，已切换至 pump_backup\`);
}
`,
  },

  // ═══════════════════════════════════════════════════════════
  // Example 2: alarm linkage handling
  // ═══════════════════════════════════════════════════════════
  {
    id: 'event-alarm-handler',
    title: '告警联动处理',
    description: '当告警触发时，根据告警级别执行不同处理策略：严重告警自动跳转页面、通知管理员。',
    category: 'event-driven',
    triggerType: 'event',
    eventName: 'alarm:triggered',
    tags: ['进阶', '告警联动', '页面跳转'],
    difficulty: 'medium',
    code: `// 场景：告警联动处理
// 触发方式：event（绑定 alarm:triggered 事件）
// 涉及 API：switchPage, setGraphicProps, fetch, acknowledgeAlarm, notify, log

const alarmData = context.eventData;
const { alarmId, tagId, level, message } = alarmData;

// 1. 根据告警级别处理
if (level === 'emergency') {
  // 紧急告警：自动跳转到告警详情页
  switchPage('page_alarm_detail');

  // 设置告警指示灯
  setGraphicProps('alarm_light', {
    customProps: { status: 'emergency', color: '#FF0000', blink: true },
  });

  // 发送紧急通知到外部系统
  try {
    await fetch('https://api.example.com/v1/emergency/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alarmId,
        tagId,
        level,
        message,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (err) {
    log('error', \`紧急通知发送失败: \${err.message}\`);
  }

  notify(\`紧急告警: \${message}\`, 'error');

} else if (level === 'critical') {
  // 严重告警：高亮显示告警图元
  setGraphicProps('alarm_light', {
    customProps: { status: 'critical', color: '#FF0000', blink: true },
  });

  notify(\`严重告警: \${message}\`, 'error');

} else if (level === 'warning') {
  // 警告：设置警告指示灯
  setGraphicProps('alarm_light', {
    customProps: { status: 'warning', color: '#FFA500', blink: false },
  });

  notify(\`警告: \${message}\`, 'warn');

} else {
  // 信息级别：仅记录日志
  setGraphicProps('alarm_light', {
    customProps: { status: 'info', color: '#00BFFF', blink: false },
  });
}

// 2. 自动确认（如果是已知的周期性告警）
const knownAlarms = ['temp_sensor_01', 'pressure_sensor'];
if (knownAlarms.includes(tagId) && level !== 'emergency') {
  acknowledgeAlarm(alarmId);
  log('info', \`已知告警自动确认: \${tagId}\`);
}

log(level === 'emergency' ? 'error' : 'warn', \`告警处理: [\${level}] \${message}\`);
`,
  },

  // ═══════════════════════════════════════════════════════════
  // Example 3: user interaction event response
  // ═══════════════════════════════════════════════════════════
  {
    id: 'event-user-interaction',
    title: '用户交互事件响应',
    description: '响应用户在图元上的交互操作（点击、悬停），执行相应的联动逻辑。',
    category: 'event-driven',
    triggerType: 'event',
    eventName: 'user:interaction',
    tags: ['进阶', '用户交互', 'UI联动'],
    difficulty: 'medium',
    code: `// 场景：用户交互事件响应
// 触发方式：event（绑定 user:interaction 事件）
// 涉及 API：setGraphicProps, showGraphic, hideGraphic, readTag, writeTag, log

const { graphicId, actionType, position } = context.eventData;

if (actionType === 'click') {
  // 点击图元：切换选中状态
  const currentStatus = readTag(\`\${graphicId}_selected\`) || false;

  if (!currentStatus) {
    // 选中
    writeTag(\`\${graphicId}_selected\`, true);
    setGraphicProps(graphicId, {
      borderColor: '#4A9EF8',
      borderWidth: 3,
    });

    // 显示详情面板
    setGraphicProps('detail_panel', {
      customProps: { graphicId, position },
      visible: true,
    });
    showGraphic('detail_panel');

    log('info', \`图元选中: \${graphicId}\`);
  } else {
    // 取消选中
    writeTag(\`\${graphicId}_selected\`, false);
    setGraphicProps(graphicId, {
      borderColor: '#334155',
      borderWidth: 1,
    });
    hideGraphic('detail_panel');

    log('info', \`图元取消选中: \${graphicId}\`);
  }

} else if (actionType === 'hover') {
  // 悬停：显示 tooltip
  const tagValue = readTag(\`\${graphicId}_value\`);
  const status = readTag(\`\${graphicId}_status\`);

  setGraphicProps('tooltip', {
    customProps: {
      text: \`\${graphicId}: \${tagValue} (\${status})\`,
      x: position.x + 10,
      y: position.y - 30,
    },
  });
  showGraphic('tooltip');

  // 3秒后自动隐藏 tooltip
  setTimeout(() => {
    hideGraphic('tooltip');
  }, 3000);
}
`,
  },
];