// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { SetMetadata } from '@nestjs/common';
import { CollectorPluginMeta } from './plugin.types';

export const COLLECTOR_PLUGIN_META = 'COLLECTOR_PLUGIN_META';

/**
 * Collection plugin decorator
 *
 * Applied to a protocol adapter class; auto-registers it with the PluginRegistry.
 *
 * @example
 * @CollectorPlugin({
 *   protocol: 'modbus_tcp',
 *   displayName: 'Modbus TCP',
 *   version: '1.0.0',
 *   description: 'Modbus TCP/IP protocol collection plugin',
 *   category: PluginCategory.INDUSTRIAL_BUS,
 *   transport: 'tcp',
 *   connectionSchema: { ... },
 *   defaultConnection: { host: '127.0.0.1', port: 502 },
 *   supportedDataTypes: ['uint16', 'int16', 'float32', 'bool'],
 *   enabledByDefault: true,
 * })
 * @Injectable()
 * export class ModbusService implements IProtocolAdapter { ... }
 */
export function CollectorPlugin(meta: CollectorPluginMeta): ClassDecorator {
  return SetMetadata(COLLECTOR_PLUGIN_META, meta);
}
