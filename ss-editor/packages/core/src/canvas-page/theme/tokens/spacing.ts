// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

// Spacing design tokens

// Base spacing unit
export const spacingBase = 4;

// Spacing sizes
export const spacing = {
  // Small spacing
  xs: spacingBase * 1, // 4px
  sm: spacingBase * 2, // 8px
  md: spacingBase * 4, // 16px
  lg: spacingBase * 6, // 24px
  xl: spacingBase * 8, // 32px
  xxl: spacingBase * 12, // 48px
  xxxl: spacingBase * 16, // 64px

  // Common combinations
  padding: {
    small: spacingBase * 2, // 8px
    medium: spacingBase * 4, // 16px
    large: spacingBase * 6, // 24px
  },

  margin: {
    small: spacingBase * 2, // 8px
    medium: spacingBase * 4, // 16px
    large: spacingBase * 6, // 24px
  },

  // Layout spacing
  layout: {
    container: spacingBase * 8, // 32px
    section: spacingBase * 6, // 24px
    card: spacingBase * 4, // 16px
    item: spacingBase * 2, // 8px
  },
};

// Spacing utility functions
export const spacingUtils = {
  // Generate spacing class name
  getSpacingClass: (type: 'm' | 'p', direction: 't' | 'r' | 'b' | 'l' | 'x' | 'y' | '', size: keyof typeof spacing) => {
    if (typeof spacing[size] !== 'number') {
      return '';
    }

    if (direction === 'x' || direction === 'y') {
      return `${type}${direction}-${size}`;
    } else if (direction) {
      return `${type}${direction}-${size}`;
    } else {
      return `${type}-${size}`;
    }
  },

  // Get spacing value
  getSpacingValue: (size: keyof typeof spacing) => {
    if (typeof spacing[size] === 'number') {
      return spacing[size];
    }
    return spacing.md;
  },
};
