// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

// Design tokens entry

// Colors
import * as colorsModule from './colors';
export * from './colors';

// Spacing
import * as spacingModule from './spacing';
export * from './spacing';

// Typography
import * as typographyModule from './typography';
export * from './typography';

// Borders and radius
import * as bordersModule from './borders';
export * from './borders';

// Shadows
import * as shadowsModule from './shadows';
export * from './shadows';

// Transitions and animations
import * as transitionsModule from './transitions';
export * from './transitions';

// Design tokens version
export const tokensVersion = '1.0.0';

// Design tokens configuration
export const designTokens = {
  version: tokensVersion,
  colors: colorsModule.colors,
  spacing: spacingModule.spacing,
  fonts: typographyModule.fonts,
  fontSizes: typographyModule.fontSizes,
  fontWeights: typographyModule.fontWeights,
  lineHeights: typographyModule.lineHeights,
  letterSpacings: typographyModule.letterSpacings,
  borderWidths: bordersModule.borderWidths,
  borderStyles: bordersModule.borderStyles,
  borderRadius: bordersModule.borderRadius,
  shadows: shadowsModule.shadows,
  transitionDurations: transitionsModule.transitionDurations,
  transitionEasings: transitionsModule.transitionEasings,
  transitionProperties: transitionsModule.transitionProperties,
};

// Utility functions
export const tokenUtils = {
  color: colorsModule.colorUtils,
  spacing: spacingModule.spacingUtils,
  typography: typographyModule.typographyUtils,
  border: bordersModule.borderUtils,
  shadow: shadowsModule.shadowUtils,
  transition: transitionsModule.transitionUtils,
};
