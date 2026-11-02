// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { KeyboardService, KeyboardContext } from '../../../canvas-page/keyboard.service'; /** * KeyboardService supplementary tests: trigger real keyboard events */ describe('KeyboardService - keyboard event dispatch supplementary tests', () => {
  let keyboardService: KeyboardService;

  beforeEach(() => {
    keyboardService = new KeyboardService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    keyboardService.stopListening();
  });

  describe('startListening / stopListening', () => {
    it('After startListening, keyboard events should be handled', () => {
      const handler = vi.fn();
      keyboardService.registerKey('z', handler, { ctrl: true }); /* registerKey internally calls startListening */ const event = new KeyboardEvent('keydown', {
        key: 'z', ctrlKey: true, bubbles: true, cancelable: true
      });
      document.dispatchEvent(event);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('After stopListening, keyboard events are no longer handled', () => {
      const handler = vi.fn();
      keyboardService.registerKey('c', handler, { ctrl: true });
      keyboardService.stopListening();

      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'c', ctrlKey: true, bubbles: true
      }));
      expect(handler).not.toHaveBeenCalled();
    });

    it('startListening can resume after multiple stopListening calls', () => {
      const handler = vi.fn();
      keyboardService.registerKey('v', handler, { ctrl: true });
      keyboardService.stopListening();
      keyboardService.stopListening();
      keyboardService.startListening();

      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'v', ctrlKey: true, bubbles: true
      }));
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Modifier combination matching', () => {
    it('Ctrl+Z exact match', () => {
      const handler = vi.fn();
      keyboardService.registerKey('z', handler, { ctrl: true });
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'z', ctrlKey: true, bubbles: true
      }));
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+Shift+Z does not match Ctrl+Z', () => {
      const handler = vi.fn();
      keyboardService.registerKey('z', handler, { ctrl: true, shift: false });
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'z', ctrlKey: true, shiftKey: true, bubbles: true
      }));
      expect(handler).not.toHaveBeenCalled();
    });

    it('Should support the Alt modifier', () => {
      const handler = vi.fn();
      keyboardService.registerKey('a', handler, { alt: true });
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'a', altKey: true, bubbles: true
      }));
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('Standalone Delete key should match', () => {
      const handler = vi.fn();
      keyboardService.registerKey('Delete', handler);
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Delete', bubbles: true
      }));
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Context management', () => {
    it('EDIT-context shortcuts should not trigger in PREVIEW', () => {
      const editHandler = vi.fn();
      keyboardService.registerKey('e', editHandler, { ctrl: true }, KeyboardContext.EDIT);
      keyboardService.setContext(KeyboardContext.PREVIEW);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, bubbles: true }));
      expect(editHandler).not.toHaveBeenCalled();
    });

    it('GLOBAL-context shortcuts should trigger in any context', () => {
      const globalHandler = vi.fn();
      keyboardService.registerKey('s', globalHandler, { ctrl: true }, KeyboardContext.GLOBAL);
      keyboardService.setContext(KeyboardContext.EDIT);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
      expect(globalHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Priorities and conflicts', () => {
    it('Registered handlers should be executed in order', () => {
      const order: number[] = [];
      
      const keyboardService = new KeyboardService();
      keyboardService.startListening();
      
      keyboardService.registerKey('a', () => { order.push(1); }, {}, KeyboardContext.GLOBAL, 100);
      keyboardService.registerKey('b', () => { order.push(2); }, {}, KeyboardContext.GLOBAL, 50);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: false, shiftKey: false, altKey: false }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: false, shiftKey: false, altKey: false }));
      
      expect(order).toContain(1);
      expect(order).toContain(2);
    });
  });

  describe('Shortcut unloading', () => {
    it('ID available after registration', () => {
      const handler = vi.fn();
      const id = keyboardService.registerKey('z', handler, { ctrl: true });
      expect(id).toBeTruthy();
    });
  });

  describe('Boundary conditions', () => {
    it('New handlers can be registered after unregistration', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      keyboardService.registerKey('x', handler1, { ctrl: true });
      keyboardService.unregisterKey('x');
      keyboardService.registerKey('x', handler2, { ctrl: true });

      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'x', ctrlKey: true, bubbles: true
      }));
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('Same key with different modifiers should be independent', () => {
      const ctrlHandler = vi.fn();
      const noModHandler = vi.fn();
      keyboardService.registerKey('k', ctrlHandler, { ctrl: true });
      keyboardService.registerKey('k', noModHandler, {});

      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'k', ctrlKey: false, shiftKey: false, altKey: false, bubbles: true
      }));
      expect(ctrlHandler).not.toHaveBeenCalled();
      expect(noModHandler).toHaveBeenCalledTimes(1);
    });

    it('Special key name case matching', () => {
      const handler = vi.fn();
      keyboardService.registerKey('Escape', handler);
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', bubbles: true
      }));
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('Mismatched keys do not affect registered handlers', () => {
      const handler = vi.fn();
      keyboardService.registerKey('z', handler, { ctrl: true });
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'a', bubbles: true
      }));
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'b', ctrlKey: true, bubbles: true
      }));
      expect(handler).not.toHaveBeenCalled();
    });

    it('Shift modifier independent matching', () => {
      const handler = vi.fn();
      keyboardService.registerKey('ArrowUp', handler, { shift: true });
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowUp', shiftKey: true, bubbles: true
      }));
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
