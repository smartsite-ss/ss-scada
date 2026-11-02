// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

// Border and radius design tokens

// Border widths
export const borderWidths = {
  none: '0px',
  thin: '1px',
  medium: '2px',
  thick: '3px',
};

// Border styles
export const borderStyles = {
  none: 'none',
  solid: 'solid',
  dashed: 'dashed',
  dotted: 'dotted',
};

// Border radius
export const borderRadius = {
  none: '0px',
  sm: '2px',
  md: '4px',
  lg: '8px',
  xl: '12px',
  full: '9999px',

  // Common component radius
  button: '4px',
  card: '8px',
  input: '4px',
  modal: '8px',
};

// Border utility functions
export const borderUtils = {
  // Get border style
  getBorderStyle: (width: keyof typeof borderWidths, style: keyof typeof borderStyles, color: string) => {
    return `${borderWidths[width]} ${borderStyles[style]} ${color}`;
  },

  // Get border radius style
  getBorderRadius: (size: keyof typeof borderRadius) => {
    return borderRadius[size];
  },
};
