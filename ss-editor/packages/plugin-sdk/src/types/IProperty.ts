// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

export interface IPosition {
  x: number;
  y: number;
}

export interface ISize {
  width: number;
  height: number;
}

export interface IGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scale: number;
  scaleX?: number;
  scaleY?: number;
  visible?: boolean;
}

export interface IGraphicStyle {
  // ==================== Graphic-related properties ====================
  backgroundColor?: string; // background color, supports hex/rgba formats
  color?: string;           // foreground color, supports hex/rgba formats
  opacity?: number;         // opacity, range 0-1

  // ==================== Text-related properties ====================
  fontColor?: string;       // font color, supports hex/rgba formats
  fontSize?: number;        // font size (pixels)
  fontFamily?: string;      // font name, e.g. 'Arial', 'Microsoft YaHei'
  fontStyle?: string;       // font style: normal | italic | oblique
  fontWeight?: string;      // font weight: normal | bold | 100-900
  textAlign?: 'left' | 'center' | 'right'; // text alignment
  letterSpacing?: number;   // letter spacing (pixels)
  lineHeight?: number;      // line height (pixels)

  // ==================== Border-related properties ====================
  borderColor?: string;     // border color, supports hex/rgba formats
  borderWidth?: number;     // border width (pixels)
  borderRadius?: number;    // border radius (pixels)
  borderStyle?: string;     // border style: solid | dashed | dotted

  // ==================== Shadow-related properties ====================
  shadowBlur?: number;      // shadow blur amount (pixels)
  shadowOffsetX?: number;   // shadow horizontal offset (pixels)
  shadowOffsetY?: number;   // shadow vertical offset (pixels)
  shadowColor?: string;     // shadow color, supports hex/rgba formats
  shadowSpread?: number;    // shadow spread distance (pixels)

  // ==================== Layout-related properties ====================
  padding?: string;         // inner padding, supports CSS formats like '10px' or '10px 20px'
  margin?: string;          // outer margin, supports CSS formats like '10px' or '10px 20px'

  [key: string]: any;       // dynamic extension properties
}

export interface IGraphicConfig {
  id: string;
  type: string;
  name: string;
  // Graphic basic configuration
  geometry: IGeometry;
  // Graphic style configuration
  style: IGraphicStyle;
  data?: any;

  locked: boolean;
  visible: boolean;
  disabled: boolean;

  zIndex: number;
  // Composite-related properties
  isGroup: boolean;
  groupId: string | null;
  groupMembers: string[];
  // Child graphics
  children?: IGraphicConfig[];

  // Graphic differential properties
  customProps: Record<string, any>;
  // Creation time
  createdAt: number;
  // Update time
  updatedAt: number;
}

export interface IGraphicJSON {
  id: string;
  type: string;
  config: IGraphicConfig & {
    events?: IEvent[];
    dataSource?: IDataSource;
    animation?: any;
    children?: IGraphicJSON[];
  };
  dataSource?: IDataSource;
  events?: IEvent[];
  animation?: any;
  children?: IGraphicJSON[];
}

// Event types
export type EventType = 'click' | 'dblclick' | 'mouseenter' | 'mouseleave' | 'vnodeMounted' | 'vnodeBeforeMount';

// Action types
export type ActionType = 'api' | 'script' | 'customScript' | 'show' | 'hide' | 'change' | 'navigate' | 'alert';

// Conditional operators
export type ConditionOperator = 'equal' | 'notEqual' | 'greaterThan' | 'lessThan' | 'greaterThanOrEqual' | 'lessThanOrEqual' | 'contains' | 'notContains';

// Event condition
export interface IEventCondition {
  id: string;
  field: string;
  operator: string; // ConditionOperator
  value: any;
}

// Event action
export interface IEventAction {
  id: string;
  actionType: string; // ActionType
  target: string;
  value: any;
  script?: string;
  conditions: IEventCondition[];
}

// Event
export interface IEvent {
  id: string;
  eventType: string; // EventType
  actions: IEventAction[];
}

// Event execution context
export interface EventContext {
  graphic: {
    id: string;
    type: string;
    config: IGraphicConfig;
    customProps: Record<string, any>;
  };
  event: {
    type: EventType;
    timestamp: number;
    payload: any;
  };
  graphics: IGraphicConfig[];
  dataSource?: any;
}

export interface IGraphicEvent {
  type: string;
  target?: IGraphicConfig;
  payload: any;
  timestamp: number;
  eventHandlers: Record<string, IEvent>;
}

export type IGraphicProps = IGraphicConfig;

// Data validation rule
export interface IDataValidation {
  required: boolean;
  min: any;
  max: any;
  pattern: string;
  script: string;
  message: string;
}

// Data source
export interface IDataSource {
  type: string;
  target: IGraphicConfig;
  payload: any;
  timestamp: number;
  validation: IDataValidation;
  enabled: boolean;
  dataSource: string;
  dataField: string;
  displayField: string;
  filterScript?: string;
  driverScript?: string;

  dataMapping: Array<{
    value: any;
    display: string;
  }>;
}

// Animation
export interface IAnimation {
  enabled: boolean;
  type: string; // AnimationType: fade-in, slide-right-in, rotate-in, etc.
  duration: number;
  delay: number;
  easing: string; // EasingType: linear, ease, ease-in, ease-out, bounce, etc.
  properties: Record<string, any>;
  loopEnabled?: boolean;
  loopType?: string;
  loopDuration?: number;
  loopSpeed?: number;
}