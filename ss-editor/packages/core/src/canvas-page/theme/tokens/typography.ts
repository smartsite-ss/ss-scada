// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

// Typography design tokens

// Font families
export const fonts = {
  // Primary font
  primary: 'Arial, sans-serif',
  // Monospace font
  mono: 'Consolas, Monaco, monospace',
  // Heading font
  heading: 'Arial, sans-serif',
};

// Font sizes
export const fontSizes = {
  // Small font
  xs: '10px',
  sm: '12px',
  md: '14px',
  lg: '16px',
  xl: '18px',
  xxl: '24px',
  xxxl: '32px',

  // Heading font sizes
  heading: {
    h1: '28px',
    h2: '24px',
    h3: '20px',
    h4: '18px',
    h5: '16px',
    h6: '14px',
  },
};

// Font weights
export const fontWeights = {
  light: 300,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

// Line heights
export const lineHeights = {
  tight: 1.2,
  normal: 1.5,
  relaxed: 1.8,

  // Heading line height
  heading: 1.3,
  // Body line height
  body: 1.6,
};

// Letter spacings
export const letterSpacings = {
  tight: '-0.025em',
  normal: '0em',
  wide: '0.025em',
  wider: '0.05em',
  widest: '0.1em',
};

// Typography utility functions
export const typographyUtils = {
  // Get font style
  getFontStyle: (variant: 'body' | 'heading' | 'caption' | 'button') => {
    switch (variant) {
      case 'body':
        return {
          fontFamily: fonts.primary,
          fontSize: fontSizes.md,
          fontWeight: fontWeights.regular,
          lineHeight: lineHeights.body,
          letterSpacing: letterSpacings.normal,
        };
      case 'heading':
        return {
          fontFamily: fonts.heading,
          fontSize: fontSizes.xxl,
          fontWeight: fontWeights.bold,
          lineHeight: lineHeights.heading,
          letterSpacing: letterSpacings.tight,
        };
      case 'caption':
        return {
          fontFamily: fonts.primary,
          fontSize: fontSizes.sm,
          fontWeight: fontWeights.regular,
          lineHeight: lineHeights.normal,
          letterSpacing: letterSpacings.normal,
        };
      case 'button':
        return {
          fontFamily: fonts.primary,
          fontSize: fontSizes.md,
          fontWeight: fontWeights.medium,
          lineHeight: lineHeights.tight,
          letterSpacing: letterSpacings.wide,
        };
      default:
        return {
          fontFamily: fonts.primary,
          fontSize: fontSizes.md,
          fontWeight: fontWeights.regular,
          lineHeight: lineHeights.normal,
          letterSpacing: letterSpacings.normal,
        };
    }
  },

  // Get heading style
  getHeadingStyle: (level: 1 | 2 | 3 | 4 | 5 | 6) => {
    return {
      fontFamily: fonts.heading,
      fontSize: fontSizes.heading[`h${level}` as keyof typeof fontSizes.heading],
      fontWeight: fontWeights.bold,
      lineHeight: lineHeights.heading,
      letterSpacing: letterSpacings.tight,
    };
  },
};
