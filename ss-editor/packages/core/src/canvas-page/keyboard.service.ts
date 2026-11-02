// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { ref, computed } from 'vue';
import { ShortcutConfig } from './shortcuts.config';

// Key modifier types
export interface KeyModifiers {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

// Key handler function type
export type KeyHandler = (event: KeyboardEvent) => void;

// Key binding type
export interface KeyBinding {
  id?: string;
  key: string;
  modifiers: KeyModifiers;
  handler: KeyHandler;
  context?: string;
  priority: number;
}

// Keyboard context
export enum KeyboardContext {
  GLOBAL = 'global',
  PREVIEW = 'preview',
  EDIT = 'edit'
}

// Key state type
export interface KeyState {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

/**
 * Keyboard event management service
 * Centralizes keyboard event handling across the application, resolves key
 * conflicts, and provides key registration/unregistration capabilities
 */
export class KeyboardService {
  private bindings: KeyBinding[] = [];
  private currentContext = ref<KeyboardContext>(KeyboardContext.GLOBAL);
  private isListening = false;

  // Key state
  private keyState = ref<KeyState>({
    ctrl: false,
    shift: false,
    alt: false,
    meta: false
  });

  // Bound event handlers (for proper removal)
  private boundHandleKeyDown: (event: KeyboardEvent) => void;
  private boundHandleKeyUp: (event: KeyboardEvent) => void;

  constructor() {
    this.boundHandleKeyDown = this.handleKeyDown.bind(this);
    this.boundHandleKeyUp = this.handleKeyUp.bind(this);
  }

  private static TEXT_EDITING_KEYS = new Set(['backspace', 'delete', 'escape']);

  private static MODAL_CLASS_PATTERNS = [
    'modal-overlay', 'modal', 'n-modal', 'n-drawer',
    'dialog-overlay', 'overlay', 'popup',
  ];

  // Computed exposing key state
  private inputLikeTags = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

  private isInputLikeElement(el: Element | null): boolean {
    if (!el) return false;
    if (!('getAttribute' in el)) return false;
    if (this.inputLikeTags.has(el.tagName)) return true;
    if ((el as HTMLElement).isContentEditable) return true;
    const role = el.getAttribute('role');
    if (role === 'textbox' || role === 'searchbox' || role === 'combobox') return true;
    return false;
  }

  private isEventFromInputLike(event: KeyboardEvent): boolean {
    const target = event.target as Element | null;
    if (!target) return false;
    if (this.isInputLikeElement(target)) return true;
    let parent: Element | null = target.parentElement;
    while (parent) {
      if (this.isInputLikeElement(parent)) return true;
      for (const cls of KeyboardService.MODAL_CLASS_PATTERNS) {
        if (parent.classList.contains(cls)) return true;
      }
      parent = parent.parentElement;
    }
    return false;
  }

  get isShiftPressed() { return computed(() => this.keyState.value.shift); }
  get isCtrlPressed() { return computed(() => this.keyState.value.ctrl); }
  get isAltPressed() { return computed(() => this.keyState.value.alt); }
  get isMetaPressed() { return computed(() => this.keyState.value.meta); }

  // Get the current key state
  getCurrentKeyState(): Readonly<KeyState> {
    return { ...this.keyState.value };
  }

  /**
   * Check whether the event was triggered by the specified key
   */
  isKey(event: KeyboardEvent, key: string): boolean {
    return event.key.toLowerCase() === key.toLowerCase();
  }

  /**
   * Check whether the event was triggered by the specified key combination
   */
  isKeyCombo(event: KeyboardEvent, keys: string[]): boolean {
    return keys.every(key => {
      switch (key.toLowerCase()) {
        case 'ctrl':
        case 'control':
          return event.ctrlKey;
        case 'shift':
          return event.shiftKey;
        case 'alt':
          return event.altKey;
        case 'meta':
          return event.metaKey;
        default:
          return event.key.toLowerCase() === key.toLowerCase();
      }
    });
  }

  /**
   * Check whether the modifier keys match
   */
  matchModifiers(event: KeyboardEvent, modifiers: KeyModifiers): boolean {
    return this.isModifiersMatch(event, modifiers);
  }

  /**
   * Start listening for keyboard events
   */
  startListening() {
    if (!this.isListening && typeof document !== 'undefined') {
      document.addEventListener('keydown', this.boundHandleKeyDown);
      document.addEventListener('keyup', this.boundHandleKeyUp);
      this.isListening = true;
    }
  }

  /**
   * Stop listening for keyboard events
   */
  stopListening() {
    if (this.isListening && typeof document !== 'undefined') {
      document.removeEventListener('keydown', this.boundHandleKeyDown);
      document.removeEventListener('keyup', this.boundHandleKeyUp);
      this.isListening = false;
    }
  }

  /**
   * Set the current context
   * @param context Keyboard context
   */
  setContext(context: KeyboardContext) {
    this.currentContext.value = context;
  }

  /**
   * Get the current context
   */
  getContext() {
    return this.currentContext.value;
  }

  /**
   * Register a key binding
   * @param key Key
   * @param handler Handler function
   * @param modifiers Modifiers
   * @param context Context
   * @param priority Priority (higher value means higher priority)
   * @returns Binding ID
   */
  registerKey(
    key: string,
    handler: KeyHandler,
    modifiers: KeyModifiers = {},
    context: KeyboardContext = KeyboardContext.GLOBAL,
    priority: number = 0
  ): string {
    const id = `${key}-${Date.now()}`;
    const binding: KeyBinding = {
      id,
      key: key.toLowerCase(),
      modifiers,
      handler,
      context,
      priority
    };

    this.bindings.push(binding);
    // Sort by priority, higher priority first
    this.bindings.sort((a, b) => b.priority - a.priority);

    // Start listening (if not already)
    this.startListening();

    return id;
  }

  /**
   * Register a key from a shortcut configuration
   * @param shortcut Shortcut configuration
   * @param handler Handler function
   */
  registerShortcut(shortcut: ShortcutConfig, handler: KeyHandler): string {
    const binding: KeyBinding = {
      id: shortcut.id,
      key: shortcut.key.toLowerCase(),
      modifiers: shortcut.modifiers,
      handler,
      context: shortcut.context,
      priority: shortcut.priority
    };

    this.bindings.push(binding);
    this.bindings.sort((a, b) => b.priority - a.priority);
    this.startListening();

    return shortcut.id;
  }

  /**
   * Batch-register from shortcut configurations
   * @param shortcuts Array of shortcut configurations
   * @param handlerMap Handler mapping table
   */
  registerShortcuts(
    shortcuts: ShortcutConfig[],
    handlerMap: Record<string, KeyHandler>
  ) {
    shortcuts.forEach(shortcut => {
      const handler = handlerMap[shortcut.id];
      if (handler) {
        this.registerShortcut(shortcut, handler);
      }
    });
  }

  /**
   * Update a registered shortcut
   * @param shortcut Updated shortcut configuration
   */
  updateShortcut(shortcut: ShortcutConfig) {
    const index = this.bindings.findIndex(b => b.id === shortcut.id);
    if (index !== -1) {
      const existingBinding = this.bindings[index];
      this.bindings[index] = {
        ...existingBinding,
        key: shortcut.key.toLowerCase(),
        modifiers: shortcut.modifiers,
        context: shortcut.context,
        priority: shortcut.priority
      };
      this.bindings.sort((a, b) => b.priority - a.priority);
    }
  }

  /**
   * Batch-update shortcuts
   */
  updateShortcuts(shortcuts: ShortcutConfig[]) {
    shortcuts.forEach(shortcut => this.updateShortcut(shortcut));
  }

  /**
   * Unregister the shortcut with the specified ID
   */
  unregisterShortcut(id: string) {
    this.bindings = this.bindings.filter(b => b.id !== id);
  }

  /**
   * Format shortcut display text
   */
  static formatShortcut(key: string, modifiers: KeyModifiers): string {
    const parts: string[] = [];
    if (modifiers.ctrl) parts.push('Ctrl');
    if (modifiers.shift) parts.push('Shift');
    if (modifiers.alt) parts.push('Alt');
    if (modifiers.meta) parts.push('Meta');

    // Format key display
    let keyDisplay = key;
    const keyMap: Record<string, string> = {
      'escape': 'Esc',
      'delete': 'Delete',
      'backspace': 'Backspace',
      'enter': 'Enter',
      'space': 'Space',
      'tab': 'Tab',
      'f5': 'F5',
      'arrowup': '↑',
      'arrowdown': '↓',
      'arrowleft': '←',
      'arrowright': '→'
    };
    if (keyMap[key.toLowerCase()]) {
      keyDisplay = keyMap[key.toLowerCase()];
    } else if (key.length === 1) {
      keyDisplay = key.toUpperCase();
    }

    parts.push(keyDisplay);
    return parts.join('+');
  }

  /**
   * Unregister a key binding
   * @param key Key
   * @param context Context
   */
  unregisterKey(key: string, context?: KeyboardContext) {
    this.bindings = this.bindings.filter(binding => {
      if (binding.key !== key.toLowerCase()) return true;
      if (context && binding.context !== context) return true;
      return false;
    });
  }

  /**
   * Unregister all key bindings of a given context
   * @param context Context
   */
  unregisterContext(context: KeyboardContext) {
    this.bindings = this.bindings.filter(binding => binding.context !== context);
  }

  /**
   * Check whether key modifiers match
   * @param event Keyboard event
   * @param modifiers Modifiers
   */
  private isModifiersMatch(event: KeyboardEvent, modifiers: KeyModifiers): boolean {
    return (
      (modifiers.ctrl === undefined || event.ctrlKey === modifiers.ctrl) &&
      (modifiers.shift === undefined || event.shiftKey === modifiers.shift) &&
      (modifiers.alt === undefined || event.altKey === modifiers.alt) &&
      (modifiers.meta === undefined || event.metaKey === modifiers.meta)
    );
  }

  /**
   * Handle key down events
   * @param event Keyboard event
   */
  private handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Shift') this.keyState.value.shift = true;
    if (event.key === 'Control') this.keyState.value.ctrl = true;
    if (event.key === 'Alt') this.keyState.value.alt = true;
    if (event.key === 'Meta') this.keyState.value.meta = true;

    const key = event.key.toLowerCase();
    const context = this.currentContext.value;

    const isTextKey = KeyboardService.TEXT_EDITING_KEYS.has(key);
    if (isTextKey && this.isEventFromInputLike(event)) {
      return;
    }

    for (const binding of this.bindings) {
      if (binding.context !== KeyboardContext.GLOBAL && binding.context !== context) {
        continue;
      }

      if (binding.key === key && this.isModifiersMatch(event, binding.modifiers)) {
        binding.handler(event);

        if (!event.defaultPrevented) {
          event.preventDefault();
        }
        break;
      }
    }
  }

  /**
   * Handle key up events
   * @param event Keyboard event
   */
  private handleKeyUp(event: KeyboardEvent) {
    // Update key state
    if (event.key === 'Shift') this.keyState.value.shift = false;
    if (event.key === 'Control') this.keyState.value.ctrl = false;
    if (event.key === 'Alt') this.keyState.value.alt = false;
    if (event.key === 'Meta') this.keyState.value.meta = false;
  }

  /**
   * Clear all key bindings
   */
  clear() {
    this.bindings = [];
  }

  /**
   * Get all key bindings
   */
  getBindings() {
    return this.bindings;
  }
}

// Export singleton instance
export const keyboardService = new KeyboardService();
