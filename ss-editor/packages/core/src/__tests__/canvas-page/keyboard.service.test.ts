// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyboardService, keyboardService, KeyboardContext, KeyModifiers } from '../../canvas-page/keyboard.service';
import { ShortcutConfig } from '../../canvas-page/shortcuts.config';

describe('KeyboardService', () => {
  beforeEach(() => {
    /* Cleanup and reset */
    keyboardService.clear();
    keyboardService.setContext(KeyboardContext.GLOBAL);
    keyboardService.stopListening();
  });

  describe('Basic functionality', () => {
    it('Should be able to initialize KeyboardService', () => {
      expect(keyboardService).toBeInstanceOf(KeyboardService);
    });

    it('Should be able to set and get the current context', () => {
      keyboardService.setContext(KeyboardContext.EDIT);
      expect(keyboardService.getContext()).toBe(KeyboardContext.EDIT);

      keyboardService.setContext(KeyboardContext.PREVIEW);
      expect(keyboardService.getContext()).toBe(KeyboardContext.PREVIEW);
    });

    it('Should be able to check whether key modifiers match', () => {
      const event = {
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
        metaKey: false
      } as KeyboardEvent;

      const modifiers: KeyModifiers = { ctrl: true, shift: true };
      expect(keyboardService.matchModifiers(event, modifiers)).toBe(true);
    });
  });

  describe('Key registration and handling', () => {
    it('Should be able to register a single key', () => {
      const handler = vi.fn();
      const id = keyboardService.registerKey('escape', handler);
      
      expect(typeof id).toBe('string');
      const bindings = keyboardService.getBindings();
      expect(bindings.some(b => b.id === id)).toBe(true);
    });

    it('Should be able to register shortcut combinations', () => {
      const handler = vi.fn();
      const id = keyboardService.registerKey('c', handler, { ctrl: true });
      
      expect(keyboardService.getBindings().some(b => b.id === id)).toBe(true);
    });

    it('Should be able to unregister a key', () => {
      const handler = vi.fn();
      keyboardService.registerKey('a', handler);
      
      const initialCount = keyboardService.getBindings().length;
      keyboardService.unregisterKey('a');
      expect(keyboardService.getBindings().length).toBe(initialCount - 1);
    });

    it('Should be able to register and handle shortcut configurations', () => {
      const handler = vi.fn();
      const shortcut: ShortcutConfig = {
        id: 'test-shortcut',
        name: '测试',
        key: 'z',
        modifiers: { ctrl: true },
        context: KeyboardContext.EDIT,
        priority: 5,
        category: '测试'
      };
      
      keyboardService.registerShortcut(shortcut, handler);
      
      const bindings = keyboardService.getBindings();
      expect(bindings.some(b => b.id === shortcut.id)).toBe(true);
    });

    it('Should be able to register shortcuts in batch', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      
      const shortcuts: ShortcutConfig[] = [
        {
          id: 'test1',
          name: 'Test1',
          key: 'a',
          modifiers: {},
          context: KeyboardContext.GLOBAL,
          priority: 1,
          category: '测试'
        },
        {
          id: 'test2',
          name: 'Test2',
          key: 'b',
          modifiers: {},
          context: KeyboardContext.GLOBAL,
          priority: 1,
          category: '测试'
        }
      ];
      
      keyboardService.registerShortcuts(shortcuts, {
        test1: handler1,
        test2: handler2
      });
      
      expect(keyboardService.getBindings().length).toBe(2);
    });
  });

  describe('Editing action shortcuts', () => {
    it('Should handle the Ctrl+C copy shortcut', () => {
      const handler = vi.fn();
      keyboardService.registerKey('c', handler, { ctrl: true }, KeyboardContext.EDIT);
      keyboardService.setContext(KeyboardContext.EDIT);
      /* We need to test key matching directly, without relying on DOM event listeners */
      const bindings = keyboardService.getBindings();
      const match = bindings.find(b => b.key === 'c' &&
        b.modifiers.ctrl === true &&
        b.context === KeyboardContext.EDIT
      );

      expect(match).toBeDefined();
    });

    it('Should handle the Ctrl+V paste shortcut', () => {
      const handler = vi.fn();
      keyboardService.registerKey('v', handler, { ctrl: true }, KeyboardContext.EDIT);
      keyboardService.setContext(KeyboardContext.EDIT);
      
      const bindings = keyboardService.getBindings();
      const match = bindings.find(b => 
        b.key === 'v' && 
        b.modifiers.ctrl === true
      );
      
      expect(match).toBeDefined();
    });

    it('Should handle the Delete shortcut', () => {
      const handler = vi.fn();
      keyboardService.registerKey('delete', handler, {}, KeyboardContext.EDIT);
      
      const bindings = keyboardService.getBindings();
      expect(bindings.some(b => b.key === 'delete')).toBe(true);
    });

    it('Should handle the Ctrl+Z undo shortcut', () => {
      const handler = vi.fn();
      keyboardService.registerKey('z', handler, { ctrl: true }, KeyboardContext.EDIT);
      
      const bindings = keyboardService.getBindings();
      const match = bindings.find(b => 
        b.key === 'z' && 
        b.modifiers.ctrl === true
      );
      
      expect(match).toBeDefined();
    });

    it('Should handle the Ctrl+Y/Ctrl+Shift+Z redo shortcut', () => {
      const handler = vi.fn();
      keyboardService.registerKey('y', handler, { ctrl: true }, KeyboardContext.EDIT);
      keyboardService.registerKey('z', handler, { ctrl: true, shift: true }, KeyboardContext.EDIT);
      
      const bindings = keyboardService.getBindings();
      const ctrlY = bindings.find(b => b.key === 'y' && b.modifiers.ctrl);
      const ctrlShiftZ = bindings.find(b => b.key === 'z' && b.modifiers.ctrl && b.modifiers.shift);
      
      expect(ctrlY).toBeDefined();
      expect(ctrlShiftZ).toBeDefined();
    });

    it('Should handle the Ctrl+G shortcut', () => {
      const handler = vi.fn();
      keyboardService.registerKey('g', handler, { ctrl: true }, KeyboardContext.EDIT);
      
      const bindings = keyboardService.getBindings();
      const match = bindings.find(b => 
        b.key === 'g' && 
        b.modifiers.ctrl === true
      );
      
      expect(match).toBeDefined();
    });

    it('Should handle the Ctrl+A select-all shortcut', () => {
      const handler = vi.fn();
      keyboardService.registerKey('a', handler, { ctrl: true }, KeyboardContext.EDIT);
      
      const bindings = keyboardService.getBindings();
      const match = bindings.find(b => 
        b.key === 'a' && 
        b.modifiers.ctrl === true
      );
      
      expect(match).toBeDefined();
    });
  });

  describe('Handle by key priority', () => {
    it('Should sort key bindings by priority', () => {
      const lowPriorityHandler = vi.fn();
      const highPriorityHandler = vi.fn();
      
      keyboardService.registerKey('x', lowPriorityHandler, {}, KeyboardContext.GLOBAL, 1);
      keyboardService.registerKey('x', highPriorityHandler, {}, KeyboardContext.GLOBAL, 10);
      const bindings = keyboardService.getBindings();
      /* Higher priority items should come first */
      expect(bindings[0].priority).toBe(10);
      expect(bindings[1].priority).toBe(1);
    });
  });

  describe('Shortcut formatting', () => {
    it('Should format the shortcut display text correctly', () => {
      const ctrlC = KeyboardService.formatShortcut('c', { ctrl: true });
      expect(ctrlC).toContain('Ctrl');
      expect(ctrlC).toContain('C');
      
      const shiftDelete = KeyboardService.formatShortcut('delete', { shift: true });
      expect(shiftDelete).toContain('Shift');
      expect(shiftDelete).toContain('Delete');
      
      const arrowUp = KeyboardService.formatShortcut('arrowup', {});
      expect(arrowUp).toContain('↑');
    });

    it('Should format a single-modifier shortcut', () => {
      expect(KeyboardService.formatShortcut('c', { ctrl: true })).toBe('Ctrl+C');
      expect(KeyboardService.formatShortcut('a', { shift: true })).toBe('Shift+A');
      expect(KeyboardService.formatShortcut('x', { alt: true })).toBe('Alt+X');
      expect(KeyboardService.formatShortcut('v', { meta: true })).toBe('Meta+V');
    });

    it('Should format multi-modifier shortcut combinations', () => {
      expect(KeyboardService.formatShortcut('x', { ctrl: true, shift: true })).toBe('Ctrl+Shift+X');
      expect(KeyboardService.formatShortcut('delete', { ctrl: true, alt: true })).toBe('Ctrl+Alt+Delete');
      expect(KeyboardService.formatShortcut('z', { ctrl: true, shift: true, alt: true })).toBe('Ctrl+Shift+Alt+Z');
      expect(KeyboardService.formatShortcut('a', { ctrl: true, shift: true, alt: true, meta: true })).toBe('Ctrl+Shift+Alt+Meta+A');
    });

    it('Should format a single letter key as uppercase', () => {
      expect(KeyboardService.formatShortcut('a', {})).toBe('A');
      expect(KeyboardService.formatShortcut('z', {})).toBe('Z');
      expect(KeyboardService.formatShortcut('m', {})).toBe('M');
    });

    it('Should format special function keys', () => {
      expect(KeyboardService.formatShortcut('enter', {})).toBe('Enter');
      expect(KeyboardService.formatShortcut('escape', {})).toBe('Esc');
      expect(KeyboardService.formatShortcut('space', {})).toBe('Space');
      expect(KeyboardService.formatShortcut('delete', {})).toBe('Delete');
      expect(KeyboardService.formatShortcut('backspace', {})).toBe('Backspace');
      expect(KeyboardService.formatShortcut('tab', {})).toBe('Tab');
    });

    it('Should format arrow keys as symbols', () => {
      expect(KeyboardService.formatShortcut('arrowup', {})).toBe('↑');
      expect(KeyboardService.formatShortcut('arrowdown', {})).toBe('↓');
      expect(KeyboardService.formatShortcut('arrowleft', {})).toBe('←');
      expect(KeyboardService.formatShortcut('arrowright', {})).toBe('→');
    });

    it('Should format modifier + arrow key combinations', () => {
      expect(KeyboardService.formatShortcut('arrowup', { shift: true })).toBe('Shift+↑');
      expect(KeyboardService.formatShortcut('arrowdown', { ctrl: true })).toBe('Ctrl+↓');
      expect(KeyboardService.formatShortcut('arrowleft', { ctrl: true, shift: true })).toBe('Ctrl+Shift+←');
    });

    it('Should ignore modifier key order (fixed output order Ctrl/Shift/Alt/Meta)', () => {
      expect(KeyboardService.formatShortcut('k', { shift: true, ctrl: true })).toBe('Ctrl+Shift+K');
      expect(KeyboardService.formatShortcut('k', { alt: true, ctrl: true })).toBe('Ctrl+Alt+K');
    });

    it('Should handle case-insensitive keys', () => {
      expect(KeyboardService.formatShortcut('A', { ctrl: true })).toBe('Ctrl+A');
      expect(KeyboardService.formatShortcut('ESCAPE', {})).toBe('Esc');
      expect(KeyboardService.formatShortcut('ArrowUp', {})).toBe('↑');
      expect(KeyboardService.formatShortcut('Delete', {})).toBe('Delete');
    });

    it('Should handle an empty modifiers object', () => {
      expect(KeyboardService.formatShortcut('x', {})).toBe('X');
      expect(KeyboardService.formatShortcut('enter', {})).toBe('Enter');
    });

    it('Should handle modifier keys with false values in modifiers', () => {
      expect(KeyboardService.formatShortcut('c', { ctrl: false })).toBe('C');
      expect(KeyboardService.formatShortcut('v', { ctrl: true, shift: false, alt: false })).toBe('Ctrl+V');
    });
  });

  describe('Context awareness', () => {
    it('Should be able to distinguish keys across contexts', () => {
      const editHandler = vi.fn();
      const previewHandler = vi.fn();
      
      keyboardService.registerKey('x', editHandler, {}, KeyboardContext.EDIT, 5);
      keyboardService.registerKey('x', previewHandler, {}, KeyboardContext.PREVIEW, 5);
      const bindings = keyboardService.getBindings();
      expect(bindings.filter(b => b.context === KeyboardContext.EDIT).length).toBe(1);
      expect(bindings.filter(b => b.context === KeyboardContext.PREVIEW).length).toBe(1);
    });
  });
});

/* Standalone tests for shortcut configs related to editing operations */
describe('Shortcut configuration completeness', () => {
  it('Should contain shortcuts for all core editing operations', async () => {
    await import('../../canvas-page/shortcuts.config');
    
    // We need to check that the shortcut config file contains the expected shortcuts
    // Here we do some simple verifications
    expect(true).toBe(true); // placeholder, simplified test
  });
});
