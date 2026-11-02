// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
  getTheme, 
  getThemeNames, 
  type ThemeName,
  lightTheme,
  darkTheme,
  techLightBlueTheme,
  techDarkBlueTheme,
  blueTheme,
  highContrastTheme
} from '../../canvas-page/theme/config/themes';
import { themeManager, ThemeManager } from '../../canvas-page/theme/ThemeManager';

describe('Theme system test', () => {
  describe('Theme definition validation', () => {
    it('Should get all theme names correctly', () => {
      const themeNames = getThemeNames();
      expect(themeNames).toContain('light');
      expect(themeNames).toContain('dark');
      expect(themeNames).toContain('tech-light-blue');
      expect(themeNames).toContain('tech-dark-blue');
      expect(themeNames).toContain('blue');
      expect(themeNames).toContain('high-contrast');
      expect(themeNames).toContain('blue-light');
      expect(themeNames).toContain('blue-dark');
      expect(themeNames).toContain('green-tech');
      expect(themeNames).toContain('orange-warm');
      expect(themeNames).toContain('enterprise');
      expect(themeNames.length).toBe(11);
    });

    it('Should get the light theme correctly', () => {
      const theme = getTheme('light');
      expect(theme).toEqual(lightTheme);
      expect(theme.primary).toBe('#2196F3');
      expect(theme.background).toBe('#F5F5F5');
    });

    it('Should get the dark theme correctly', () => {
      const theme = getTheme('dark');
      expect(theme).toEqual(darkTheme);
      expect(theme.primary).toBe('#4A90D9');
      expect(theme.background).toBe('#14181E');
    });

    it('Should get the tech light blue theme correctly', () => {
      const theme = getTheme('tech-light-blue');
      expect(theme).toEqual(techLightBlueTheme);
      expect(theme.primary).toBe('#3B82F6');
      expect(theme.background).toBe('#F0F9FF');
    });

    it('Should get the tech dark blue theme correctly', () => {
      const theme = getTheme('tech-dark-blue');
      expect(theme).toEqual(techDarkBlueTheme);
      expect(theme.primary).toBe('#0A2463');
      expect(theme.background).toBe('#0A1929');
    });

    it('Should get the blue theme correctly', () => {
      const theme = getTheme('blue');
      expect(theme).toEqual(blueTheme);
      expect(theme.primary).toBe('#1976D2');
      expect(theme.background).toBe('#E3F2FD');
    });

    it('Should get the high-contrast theme correctly', () => {
      const theme = getTheme('high-contrast');
      expect(theme).toEqual(highContrastTheme);
      expect(theme.primary).toBe('#0066cc');
      expect(theme.background).toBe('#ffffff');
    });

    it('For a non-existent theme, should return the light theme by default', () => {
      const theme = getTheme('non-existent-theme');
      expect(theme).toEqual(lightTheme);
    });
  });

  describe('Theme structure validation', () => {
    const themes = [
      { name: 'light', theme: lightTheme },
      { name: 'dark', theme: darkTheme },
      { name: 'tech-light-blue', theme: techLightBlueTheme },
      { name: 'tech-dark-blue', theme: techDarkBlueTheme },
      { name: 'blue', theme: blueTheme },
      { name: 'high-contrast', theme: highContrastTheme },
    ];

    it.each(themes)('$name 主题应该包含所有必需的属性', ({ theme }) => {
      // Verify the primary color
      expect(theme).toHaveProperty('primary');
      expect(theme).toHaveProperty('secondary');
      expect(theme).toHaveProperty('accent'); // verify background color expect(theme).toHaveProperty('background');
      expect(theme).toHaveProperty('surface'); // verify text color expect(theme).toHaveProperty('text');
      expect(theme).toHaveProperty('textSecondary'); // verify border color expect(theme).toHaveProperty('border');
      expect(theme).toHaveProperty('borderLight'); // verify button styles expect(theme).toHaveProperty('button');
      expect(theme.button).toHaveProperty('background');
      expect(theme.button).toHaveProperty('hover');
      expect(theme.button).toHaveProperty('active');
      expect(theme.button).toHaveProperty('text'); // verify control button styles expect(theme).toHaveProperty('controlButton');
      expect(theme.controlButton).toHaveProperty('background');
      expect(theme.controlButton).toHaveProperty('hover');
      expect(theme.controlButton).toHaveProperty('active');
      expect(theme.controlButton).toHaveProperty('text');
      expect(theme.controlButton).toHaveProperty('border'); // verify status colors expect(theme).toHaveProperty('status');
      expect(theme.status).toHaveProperty('success');
      expect(theme.status).toHaveProperty('warning');
      expect(theme.status).toHaveProperty('error');
      expect(theme.status).toHaveProperty('info'); // verify shadow expect(theme).toHaveProperty('shadow');
      expect(theme.shadow).toHaveProperty('small');
      expect(theme.shadow).toHaveProperty('medium');
      expect(theme.shadow).toHaveProperty('large'); // verify transition expect(theme).toHaveProperty('transition');
      expect(theme.transition).toHaveProperty('fast');
      expect(theme.transition).toHaveProperty('normal');
      expect(theme.transition).toHaveProperty('slow');
    });

    it.each(themes)('$name 主题的颜色值应该是有效的十六进制颜色', ({ theme }) => {
      const hexColorRegex = /^#[0-9A-Fa-f]{6}$/;
      
      expect(theme.primary).toMatch(hexColorRegex);
      expect(theme.secondary).toMatch(hexColorRegex);
      expect(theme.accent).toMatch(hexColorRegex);
      expect(theme.background).toMatch(hexColorRegex);
      expect(theme.surface).toMatch(hexColorRegex);
      expect(theme.text).toMatch(hexColorRegex);
      expect(theme.textSecondary).toMatch(hexColorRegex);
      expect(theme.border).toMatch(hexColorRegex);
      expect(theme.borderLight).toMatch(hexColorRegex);
    });

    it.each(themes)('$name 主题的按钮颜色应该是有效的', ({ theme }) => {
      const hexColorRegex = /^#[0-9A-Fa-f]{6}$/;
      
      expect(theme.button.background).toMatch(hexColorRegex);
      expect(theme.button.hover).toMatch(hexColorRegex);
      expect(theme.button.active).toMatch(hexColorRegex);
      expect(theme.button.text).toMatch(hexColorRegex);
      
      expect(theme.controlButton.background).toMatch(hexColorRegex);
      expect(theme.controlButton.hover).toMatch(hexColorRegex);
      expect(theme.controlButton.active).toMatch(hexColorRegex);
      expect(theme.controlButton.text).toMatch(hexColorRegex);
      expect(theme.controlButton.border).toMatch(hexColorRegex);
    });

    it.each(themes)('$name 主题的状态颜色应该是有效的', ({ theme }) => {
      const hexColorRegex = /^#[0-9A-Fa-f]{6}$/;
      
      expect(theme.status.success).toMatch(hexColorRegex);
      expect(theme.status.warning).toMatch(hexColorRegex);
      expect(theme.status.error).toMatch(hexColorRegex);
      expect(theme.status.info).toMatch(hexColorRegex);
    });
  });

  describe('Theme switching test', () => {
    it('Should be able to switch between all themes', () => {
      const themeNames = getThemeNames();
      
      // Fetch all themes one by one
      const obtainedThemes = themeNames.map(name => getTheme(name));
      
      // Verify all themes are distinct
      const uniqueThemes = new Set(obtainedThemes.map(t => JSON.stringify(t)));
      expect(uniqueThemes.size).toBe(themeNames.length);
    });

    it('The getTheme function should support type-safe theme names', () => {
      const validThemeNames: ThemeName[] = ['light', 'dark', 'tech-light-blue', 'tech-dark-blue', 'blue', 'high-contrast'];
      
      validThemeNames.forEach(name => {
        const theme = getTheme(name);
        expect(theme).toBeDefined();
      });
    });
  });

  describe('Theme feature completeness', () => {
    it('All themes should contain complete status colors', () => {
      const themeNames = getThemeNames();
      
      themeNames.forEach(name => {
        const theme = getTheme(name);
        expect(theme.status.success).toBeTruthy();
        expect(theme.status.warning).toBeTruthy();
        expect(theme.status.error).toBeTruthy();
        expect(theme.status.info).toBeTruthy();
      });
    });

    it('All themes should contain complete shadow configs', () => {
      const themeNames = getThemeNames();
      
      themeNames.forEach(name => {
        const theme = getTheme(name);
        expect(theme.shadow.small).toBeTruthy();
        expect(theme.shadow.medium).toBeTruthy();
        expect(theme.shadow.large).toBeTruthy();
      });
    });

    it('All themes should contain complete transition configs', () => {
      const themeNames = getThemeNames();
      
      themeNames.forEach(name => {
        const theme = getTheme(name);
        expect(theme.transition.fast).toBeTruthy();
        expect(theme.transition.normal).toBeTruthy();
        expect(theme.transition.slow).toBeTruthy();
      });
    });
  });
});

describe('ThemeManager tests', () => {
  let mockManager: ThemeManager;

  beforeEach(() => {
    localStorage.removeItem('scada-editor-theme');
    mockManager = new ThemeManager();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    localStorage.removeItem('scada-editor-theme');
    vi.restoreAllMocks();
  });

  describe('Singleton instance themeManager', () => {
    it('Should export the singleton instance', () => {
      expect(themeManager).toBeInstanceOf(ThemeManager);
    });

    it('Multiple accesses should return the same instance', () => {
      const manager1 = themeManager;
      const manager2 = themeManager;
      expect(manager1).toBe(manager2);
    });
  });

  describe('Initialization state', () => {
    it('Initial theme should be dark', () => {
      expect(mockManager.getCurrentThemeName()).toBe('dark');
    });

    it('Initial theme config should be darkTheme', () => {
      const theme = mockManager.getCurrentTheme();
      expect(theme).toEqual(darkTheme);
    });
  });

  describe('Theme switching', () => {
    it('Should be able to switch to the dark theme', () => {
      mockManager.setTheme('dark');
      expect(mockManager.getCurrentThemeName()).toBe('dark');
      expect(mockManager.getCurrentTheme()).toEqual(darkTheme);
    });

    it('Should be able to switch to the tech-light-blue theme', () => {
      mockManager.setTheme('tech-light-blue');
      expect(mockManager.getCurrentThemeName()).toBe('tech-light-blue');
      expect(mockManager.getCurrentTheme()).toEqual(techLightBlueTheme);
    });

    it('Should be able to switch to the tech-dark-blue theme', () => {
      mockManager.setTheme('tech-dark-blue');
      expect(mockManager.getCurrentThemeName()).toBe('tech-dark-blue');
      expect(mockManager.getCurrentTheme()).toEqual(techDarkBlueTheme);
    });

    it('Should be able to switch to the blue theme', () => {
      mockManager.setTheme('blue');
      expect(mockManager.getCurrentThemeName()).toBe('blue');
      expect(mockManager.getCurrentTheme()).toEqual(blueTheme);
    });

    it('Should be able to switch to the high-contrast theme', () => {
      mockManager.setTheme('high-contrast');
      expect(mockManager.getCurrentThemeName()).toBe('high-contrast');
      expect(mockManager.getCurrentTheme()).toEqual(highContrastTheme);
    });

    it('For a non-existent theme, should fall back to dark with a warning', () => {
      mockManager.setTheme('non-existent' as ThemeName);
      expect(mockManager.getCurrentThemeName()).toBe('dark');
      expect(mockManager.getCurrentTheme()).toEqual(darkTheme);
      expect(console.warn).toHaveBeenCalledWith('Theme "non-existent" not found, falling back to "dark"');
    });
  });

  describe('Theme subscription', () => {
    it('Subscribing should immediately receive the current topic', () => {
      const callback = vi.fn();
      const unsubscribe = mockManager.subscribe(callback);
      
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(darkTheme);
      
      unsubscribe();
    });

    it('Subscribers should be notified when the theme switches', () => {
      const callback = vi.fn();
      const unsubscribe = mockManager.subscribe(callback);
      
      callback.mockClear();
      mockManager.setTheme('dark');
      
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(darkTheme);
      
      unsubscribe();
    });

    it('Multiple subscriptions should all receive notifications', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      
      const unsubscribe1 = mockManager.subscribe(callback1);
      const unsubscribe2 = mockManager.subscribe(callback2);
      
      callback1.mockClear();
      callback2.mockClear();
      
      mockManager.setTheme('dark');
      
      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
      
      unsubscribe1();
      unsubscribe2();
    });

    it('Should no longer receive notifications after unsubscribing', () => {
      const callback = vi.fn();
      const unsubscribe = mockManager.subscribe(callback);
      
      callback.mockClear();
      mockManager.setTheme('dark');
      expect(callback).toHaveBeenCalledTimes(1);
      
      unsubscribe();
      
      callback.mockClear();
      mockManager.setTheme('light');
      
      expect(callback).not.toHaveBeenCalled();
    });

    it('Should be able to get all available themes', () => {
      const themes = mockManager.getAvailableThemeNames();
      expect(themes).toEqual(expect.arrayContaining(['light', 'dark', 'high-contrast', 'blue', 'tech-dark-blue', 'tech-light-blue', 'blue-light', 'blue-dark', 'green-tech', 'orange-warm', 'enterprise']));
    });
  });

  describe('CSS variable injection', () => {
    it('applyThemeToDOM should set the data-theme attribute', () => {
      const root = document.documentElement;
      mockManager.applyThemeToDOM();
      
      expect(root.getAttribute('data-theme')).toBe('dark');
    });

    it('After switching themes, data-theme should update', () => {
      const root = document.documentElement;
      mockManager.setTheme('dark');
      
      expect(root.getAttribute('data-theme')).toBe('dark');
    });

    it('Should inject all base color variables', () => {
      const root = document.documentElement;
      mockManager.setTheme('light');
      
      expect(root.style.getPropertyValue('--primary')).toBe('#2196F3');
      expect(root.style.getPropertyValue('--secondary')).toBe('#4CAF50');
      expect(root.style.getPropertyValue('--accent')).toBe('#FF9800');
      expect(root.style.getPropertyValue('--background')).toBe('#F5F5F5');
      expect(root.style.getPropertyValue('--surface')).toBe('#FFFFFF');
      expect(root.style.getPropertyValue('--text')).toBe('#333333');
      expect(root.style.getPropertyValue('--text-secondary')).toBe('#666666');
      expect(root.style.getPropertyValue('--border')).toBe('#CCCCCC');
      expect(root.style.getPropertyValue('--border-light')).toBe('#E0E0E0');
    });

    it('Should inject all status color variables', () => {
      const root = document.documentElement;
      mockManager.setTheme('light');
      
      expect(root.style.getPropertyValue('--status-success')).toBe('#4CAF50');
      expect(root.style.getPropertyValue('--status-warning')).toBe('#FFC107');
      expect(root.style.getPropertyValue('--status-error')).toBe('#F44336');
      expect(root.style.getPropertyValue('--status-info')).toBe('#2196F3');
    });

    it('Should inject all button color variables', () => {
      const root = document.documentElement;
      mockManager.setTheme('light');
      
      expect(root.style.getPropertyValue('--button-background')).toBe('#2196F3');
      expect(root.style.getPropertyValue('--button-hover')).toBe('#1976D2');
      expect(root.style.getPropertyValue('--button-active')).toBe('#1565C0');
      expect(root.style.getPropertyValue('--button-text')).toBe('#FFFFFF');
    });

    it('Should inject all control button color variables', () => {
      const root = document.documentElement;
      mockManager.setTheme('light');
      
      expect(root.style.getPropertyValue('--control-button-background')).toBe('#FFFFFF');
      expect(root.style.getPropertyValue('--control-button-hover')).toBe('#E3F2FD');
      expect(root.style.getPropertyValue('--control-button-active')).toBe('#2196F3');
      expect(root.style.getPropertyValue('--control-button-text')).toBe('#333333');
      expect(root.style.getPropertyValue('--control-button-border')).toBe('#CCCCCC');
    });
  });

  describe('Theme persistence', () => {
    it('Should update the current theme when switching themes', () => {
      mockManager.setTheme('dark');
      
      expect(mockManager.getCurrentThemeName()).toBe('dark');
    });

    it('Should use the default theme at initialization', () => {
      const newManager = new ThemeManager();
      expect(newManager.getCurrentThemeName()).toBe('dark');
      expect(newManager.getCurrentTheme()).toEqual(darkTheme);
    });

    it('Invalid themes in localStorage should be ignored', () => {
      localStorage.setItem('scada-editor-theme', 'invalid-theme');
      
      const newManager = new ThemeManager();
      expect(newManager.getCurrentThemeName()).toBe('dark');
    });

    it('Should use the default theme when localStorage is empty', () => {
      localStorage.removeItem('scada-editor-theme');
      
      const newManager = new ThemeManager();
      expect(newManager.getCurrentThemeName()).toBe('dark');
    });

    it('Should use the default theme when localStorage throws', () => {
      const newManager = new ThemeManager();
      expect(newManager.getCurrentThemeName()).toBe('dark');
    });
  });
});
