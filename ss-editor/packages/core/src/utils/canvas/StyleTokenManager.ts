// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Style token management class
 */
export class StyleTokenManager {
  // Spacing tokens
  private static spacingTokens = {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '32px',
    xxl: '48px'
  };

  // Typography tokens
  private static typographyTokens = {
    fontFamily: {
      primary: 'Arial, sans-serif',
      secondary: 'Helvetica, sans-serif',
      monospace: 'Courier New, monospace'
    },
    fontSize: {
      xs: '12px',
      sm: '14px',
      md: '16px',
      lg: '18px',
      xl: '24px',
      xxl: '32px'
    },
    fontWeight: {
      normal: '400',
      medium: '500',
      semibold: '600',
      bold: '700'
    },
    lineHeight: {
      tight: '1.2',
      normal: '1.5',
      loose: '1.8'
    }
  };

  // Border tokens
  private static borderTokens = {
    width: {
      thin: '1px',
      medium: '2px',
      thick: '4px'
    },
    radius: {
      sm: '4px',
      md: '8px',
      lg: '12px',
      xl: '16px',
      full: '9999px'
    }
  };

  // Shadow tokens
  private static shadowTokens = {
    sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
    md: '0 4px 6px rgba(0, 0, 0, 0.1)',
    lg: '0 10px 15px rgba(0, 0, 0, 0.1)',
    xl: '0 20px 25px rgba(0, 0, 0, 0.15)'
  };

  /**
   * Get a spacing token
   * @param size Spacing size
   * @returns Spacing value
   */
  public static getSpacing(size: keyof typeof StyleTokenManager.spacingTokens): string {
    return this.spacingTokens[size];
  }

  /**
   * Get the font family
   * @param type Font type
   * @returns Font family
   */
  public static getFontFamily(type: keyof typeof StyleTokenManager.typographyTokens.fontFamily): string {
    return this.typographyTokens.fontFamily[type];
  }

  /**
   * Get the font size
   * @param size Font size
   * @returns Font size value
   */
  public static getFontSize(size: keyof typeof StyleTokenManager.typographyTokens.fontSize): string {
    return this.typographyTokens.fontSize[size];
  }

  /**
   * Get the font weight
   * @param weight Font weight
   * @returns Font weight value
   */
  public static getFontWeight(weight: keyof typeof StyleTokenManager.typographyTokens.fontWeight): string {
    return this.typographyTokens.fontWeight[weight];
  }

  /**
   * Get the line height
   * @param type Line height type
   * @returns Line height value
   */
  public static getLineHeight(type: keyof typeof StyleTokenManager.typographyTokens.lineHeight): string {
    return this.typographyTokens.lineHeight[type];
  }

  /**
   * Get the border width
   * @param width Border width
   * @returns Border width value
   */
  public static getBorderWidth(width: keyof typeof StyleTokenManager.borderTokens.width): string {
    return this.borderTokens.width[width];
  }

  /**
   * Get the border radius
   * @param size Border radius size
   * @returns Border radius value
   */
  public static getBorderRadius(size: keyof typeof StyleTokenManager.borderTokens.radius): string {
    return this.borderTokens.radius[size];
  }

  /**
   * Get the shadow
   * @param size Shadow size
   * @returns Shadow value
   */
  public static getShadow(size: keyof typeof StyleTokenManager.shadowTokens): string {
    return this.shadowTokens[size];
  }

  /**
   * Get all spacing tokens
   * @returns All spacing tokens
   */
  public static getAllSpacingTokens(): typeof StyleTokenManager.spacingTokens {
    return { ...this.spacingTokens };
  }

  /**
   * Get all typography tokens
   * @returns All typography tokens
   */
  public static getAllTypographyTokens(): typeof StyleTokenManager.typographyTokens {
    return { ...this.typographyTokens };
  }

  /**
   * Get all border tokens
   * @returns All border tokens
   */
  public static getAllBorderTokens(): typeof StyleTokenManager.borderTokens {
    return { ...this.borderTokens };
  }

  /**
   * Get all shadow tokens
   * @returns All shadow tokens
   */
  public static getAllShadowTokens(): typeof StyleTokenManager.shadowTokens {
    return { ...this.shadowTokens };
  }

  /**
   * Register custom tokens
   * @param type Token type
   * @param tokens Token object
   */
  public static registerTokens(type: 'spacing' | 'typography' | 'border' | 'shadow', tokens: any): void {
    switch (type) {
      case 'spacing':
        this.spacingTokens = { ...this.spacingTokens, ...tokens };
        break;
      case 'typography':
        this.typographyTokens = { ...this.typographyTokens, ...tokens };
        break;
      case 'border':
        this.borderTokens = { ...this.borderTokens, ...tokens };
        break;
      case 'shadow':
        this.shadowTokens = { ...this.shadowTokens, ...tokens };
        break;
    }
  }
}
