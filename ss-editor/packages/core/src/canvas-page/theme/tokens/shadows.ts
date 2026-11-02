// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

// Shadow design tokens

// Shadow types
export const shadows = {
  // Small shadow
  small: '0 2px 4px rgba(0, 0, 0, 0.1)',
  // Medium shadow
  medium: '0 4px 8px rgba(0, 0, 0, 0.15)',
  // Large shadow
  large: '0 8px 16px rgba(0, 0, 0, 0.2)',
  // Extra-large shadow
  xlarge: '0 16px 32px rgba(0, 0, 0, 0.25)',

  // Special shadows
  inner: 'inset 0 2px 4px rgba(0, 0, 0, 0.1)',
  hover: '0 4px 12px rgba(0, 0, 0, 0.15)',
  focus: '0 0 0 3px rgba(33, 150, 243, 0.3)',

  // Common component shadows
  card: '0 4px 8px rgba(0, 0, 0, 0.1)',
  modal: '0 10px 25px rgba(0, 0, 0, 0.25)',
  dropdown: '0 4px 12px rgba(0, 0, 0, 0.15)',
};

// Shadow utility functions
export const shadowUtils = {
  // Get shadow style
  getShadow: (type: keyof typeof shadows) => {
    return shadows[type];
  },

  // Get theme shadow
  getThemeShadow: (theme: 'light' | 'dark', type: keyof typeof shadows) => {
    if (theme === 'dark') {
      // Shadows for dark theme
      switch (type) {
        case 'small':
          return '0 2px 4px rgba(0, 0, 0, 0.3)';
        case 'medium':
          return '0 4px 8px rgba(0, 0, 0, 0.4)';
        case 'large':
          return '0 8px 16px rgba(0, 0, 0, 0.5)';
        default:
          return shadows[type];
      }
    }
    return shadows[type];
  },
};
