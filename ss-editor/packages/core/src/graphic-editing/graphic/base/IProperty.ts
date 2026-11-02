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
  // ==================== Graphic-related Properties ====================
  backgroundColor?: string; // Background color, supports hex/rgba format
  color?: string;           // Foreground color, supports hex/rgba format
  opacity?: number;         // Opacity, range 0-1

  // ==================== Text-related Properties ====================
  fontColor?: string;       // Font color, supports hex/rgba format
  fontSize?: number;        // Font size (pixels)
  fontFamily?: string;      // Font name, e.g. 'Arial', 'Microsoft YaHei'
  fontStyle?: string;       // Font style: normal | italic | oblique
  fontWeight?: string;      // Font weight: normal | bold | 100-900
  textAlign?: 'left' | 'center' | 'right'; // Text alignment
  letterSpacing?: number;   // Letter spacing (pixels)
  lineHeight?: number;      // Line height (pixels)

  // ==================== Border-related Properties ====================
  borderColor?: string;     // Border color, supports hex/rgba format
  borderWidth?: number;     // Border width (pixels)
  borderRadius?: number;    // Border radius (pixels)
  borderStyle?: string;     // Border style: solid | dashed | dotted

  // ==================== Shadow-related Properties ====================
  shadowBlur?: number;      // Shadow blur amount (pixels)
  shadowOffsetX?: number;   // Shadow horizontal offset (pixels)
  shadowOffsetY?: number;   // Shadow vertical offset (pixels)
  shadowColor?: string;     // Shadow color, supports hex/rgba format
  shadowSpread?: number;    // Shadow spread distance (pixels)

  // ==================== Layout-related Properties ====================
  padding?: string;         // Inner padding, supports CSS format e.g. '10px' or '10px 20px'
  margin?: string;          // Outer margin, supports CSS format e.g. '10px' or '10px 20px'

  [key: string]: any;       // Dynamically extensible properties
}

export interface IGraphicConfig {
  id: string;
  type: string;
  name: string;
  // Basic graphic configuration
  geometry: IGeometry;
  // Graphic style configuration
  style: IGraphicStyle;
  data?: any;

  locked: boolean;
  visible: boolean;
  disabled: boolean;

  zIndex: number;
  // Group-related properties
  isGroup: boolean;
  groupId: string | null;
  groupMembers: string[];
  // Child graphics
  children?: IGraphicConfig[];

  // Graphic-specific properties
  customProps: Record<string, any>;
  // Creation time
  createdAt: number;
  // Update time
  updatedAt: number;
}

// Events
export interface IEvent {
  id: string;
  eventType: string; // click, hover, focus, blur, etc.
  actions: Array<{
    id: string;
    actionType: string; // show, hide, change, navigate, etc.
    target: string;
    value: any;
    conditions: Array<{
      id: string;
      field: string;
      operator: string; // equal, notEqual, greaterThan, lessThan, etc.
      value: any;
    }>;
  }>;
}

export interface IGraphicEvent {
  type: string;
  target?: IGraphicConfig;
  payload: any;
  timestamp: number;
  eventHandlers: Record<string, IEvent>;
}

export type IGraphicProps = IGraphicConfig;

// Data validation rules
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
  // Loop animation
  loopEnabled?: boolean;
  loopType?: string; // LoopAnimationType
  loopDuration?: number;
  loopSpeed?: number;
}
