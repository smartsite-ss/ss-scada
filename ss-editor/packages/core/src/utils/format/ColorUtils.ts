// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Color management utility class
 */
export class ColorUtils {
  /**
   * RGB color interface
   */
  public static rgbToHex(r: number, g: number, b: number): string {
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase()}`;
  }

  /**
   * Convert HEX color to RGB
   * @param hex HEX color value
   * @returns RGB color object
   */
  public static hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  }

  /**
   * Convert RGB to HSL
   * @param r Red channel value (0-255)
   * @param g Green channel value (0-255)
   * @param b Blue channel value (0-255)
   * @returns HSL color object
   */
  public static rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
    r /= 255, g /= 255, b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }

    return { h, s, l };
  }

  /**
   * Convert HSL to RGB
   * @param h Hue (0-1)
   * @param s Saturation (0-1)
   * @param l Lightness (0-1)
   * @returns RGB color object
   */
  public static hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
    let r, g, b;

    if (s === 0) {
      r = g = b = l; // achromatic
    } else {
      const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };

      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }

    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
  }

  /**
   * Adjust color brightness
   * @param color HEX color value
   * @param amount Brightness adjustment amount (-1 to 1)
   * @returns Adjusted HEX color value
   */
  public static adjustBrightness(color: string, amount: number): string {
    const rgb = this.hexToRgb(color);
    if (!rgb) return color;

    const hsl = this.rgbToHsl(rgb.r, rgb.g, rgb.b);
    hsl.l = Math.max(0, Math.min(1, hsl.l + amount));

    const adjustedRgb = this.hslToRgb(hsl.h, hsl.s, hsl.l);
    return this.rgbToHex(adjustedRgb.r, adjustedRgb.g, adjustedRgb.b);
  }

  /**
   * Mix two colors
   * @param color1 First color (HEX)
   * @param color2 Second color (HEX)
   * @param ratio Mix ratio (0-1)
   * @returns Mixed HEX color value
   */
  public static mixColors(color1: string, color2: string, ratio: number): string {
    const rgb1 = this.hexToRgb(color1);
    const rgb2 = this.hexToRgb(color2);

    if (!rgb1 || !rgb2) return color1;

    const r = Math.round(rgb1.r * (1 - ratio) + rgb2.r * ratio);
    const g = Math.round(rgb1.g * (1 - ratio) + rgb2.g * ratio);
    const b = Math.round(rgb1.b * (1 - ratio) + rgb2.b * ratio);

    return this.rgbToHex(r, g, b);
  }

  /**
   * Generate a contrasting color
   * @param color HEX color value
   * @returns Contrasting color (HEX)
   */
  public static getContrastColor(color: string): string {
    const rgb = this.hexToRgb(color);
    if (!rgb) return '#000000';

    // Compute brightness
    const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
    return brightness > 128 ? '#000000' : '#FFFFFF';
  }

  /**
   * Parse a color string, supporting HEX, RGB, and RGBA formats
   * @param color Color string
   * @returns Color object
   */
  public static parseColor(color: string): { r: number; g: number; b: number; a: number } | null {
    // Handle HEX format
    if (color.startsWith('#')) {
      const rgb = this.hexToRgb(color);
      if (rgb) {
        return { ...rgb, a: 1 };
      }
    }

    // Handle RGB format
    const rgbMatch = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (rgbMatch) {
      return {
        r: parseInt(rgbMatch[1]),
        g: parseInt(rgbMatch[2]),
        b: parseInt(rgbMatch[3]),
        a: 1
      };
    }

    // Handle RGBA format
    const rgbaMatch = color.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\)$/);
    if (rgbaMatch) {
      return {
        r: parseInt(rgbaMatch[1]),
        g: parseInt(rgbaMatch[2]),
        b: parseInt(rgbaMatch[3]),
        a: parseFloat(rgbaMatch[4])
      };
    }

    return null;
  }

  /**
   * Convert a color object to an RGBA string
   * @param color Color object
   * @returns RGBA string
   */
  public static toRgbaString(color: { r: number; g: number; b: number; a: number }): string {
    return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`;
  }

  /**
   * Convert a color object to an RGB string
   * @param color Color object
   * @returns RGB string
   */
  public static toRgbString(color: { r: number; g: number; b: number }): string {
    return `rgb(${color.r}, ${color.g}, ${color.b})`;
  }

  /**
   * Parse a hex color to a numeric value (safe version)
   * Handles #RRGGBB and #RRGGBBAA formats, outputs an unsigned 32-bit integer
   */
  private static _parseHexForColorMath(hex: string): number {
    let h = hex.replace('#', '');
    if (h.length === 8) h = h.substring(0, 6);
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return 0;
    return parseInt(h, 16) >>> 0;
  }

  /**
   * Lighten a color (linear offset), amount range 0-1
   */
  public static lightenColor(hex: string, amount: number): string {
    const num = this._parseHexForColorMath(hex);
    const delta = Math.round(255 * amount);
    const r = Math.min(255, ((num >> 16) & 0xFF) + delta);
    const g = Math.min(255, ((num >> 8) & 0xFF) + delta);
    const b = Math.min(255, (num & 0xFF) + delta);
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }

  /**
   * Darken a color (linear offset), amount range 0-1
   */
  public static darkenColor(hex: string, amount: number): string {
    const num = this._parseHexForColorMath(hex);
    const delta = Math.round(255 * amount);
    const r = Math.max(0, ((num >> 16) & 0xFF) - delta);
    const g = Math.max(0, ((num >> 8) & 0xFF) - delta);
    const b = Math.max(0, (num & 0xFF) - delta);
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }

  /**
   * Interpolate toward white, percent range 0-100
   */
  public static lightenTowardsWhite(hex: string, percent: number): string {
    const rgb = this.parseColor(hex);
    if (!rgb) return hex;
    const factor = percent / 100;
    const r = Math.min(255, Math.floor(rgb.r + (255 - rgb.r) * factor));
    const g = Math.min(255, Math.floor(rgb.g + (255 - rgb.g) * factor));
    const b = Math.min(255, Math.floor(rgb.b + (255 - rgb.b) * factor));
    return `rgb(${r}, ${g}, ${b})`;
  }

  /**
   * Interpolate toward black, percent range 0-100
   */
  public static darkenTowardsBlack(hex: string, percent: number): string {
    const rgb = this.parseColor(hex);
    if (!rgb) return hex;
    const factor = percent / 100;
    const r = Math.max(0, Math.floor(rgb.r * (1 - factor)));
    const g = Math.max(0, Math.floor(rgb.g * (1 - factor)));
    const b = Math.max(0, Math.floor(rgb.b * (1 - factor)));
    return `rgb(${r}, ${g}, ${b})`;
  }

  /**
   * HEX color + alpha → RGBA string
   */
  public static hexToRgba(hex: string, alpha: number): string {
    const num = this._parseHexForColorMath(hex);
    const r = (num >> 16) & 0xFF;
    const g = (num >> 8) & 0xFF;
    const b = num & 0xFF;
    return `rgba(${r},${g},${b},${alpha})`;
  }
}
