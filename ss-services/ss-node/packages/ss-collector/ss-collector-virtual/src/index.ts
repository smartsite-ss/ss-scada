// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

export { VirtualCollectorModule } from './virtual.module';
export { VirtualProtocolAdapter } from './virtual-adapter';
export { VirtualReadStep } from './virtual-read.step';
export { SimulatorFactory } from './simulator-factory';

// Simulators
export { VariableSimulator, CachedSimulator } from './simulators/variable-simulator.interface';
export { FixedValueSimulator } from './simulators/fixed-value.simulator';
export { RangeValueSimulator } from './simulators/range-value.simulator';
export { EnumValueSimulator } from './simulators/enum-value.simulator';
export { BoolSimulator } from './simulators/bool.simulator';
export { StringSimulator } from './simulators/string.simulator';

// Type definitions
export {
  SimulationMode,
  VariableSimulationConfig,
  FixedValueParams,
  RangeValueParams,
  EnumValueParams,
  BoolParams,
  StringParams,
} from './simulation-config.types';
