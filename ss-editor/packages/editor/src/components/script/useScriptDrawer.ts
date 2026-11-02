// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { reactive } from 'vue';

/** Script tabs opened in the drawer */
export interface ScriptDrawerTab {
  /** Unique identifier */
  id: string;
  /** Tab title */
  title: string;
  /** Script content */
  script: string;
  /** Script mode */
  mode: 'timer' | 'driver' | 'filter' | 'interaction' | 'expression';
  /** Source info (used for write-back) */
  source: {
    type: 'timer' | 'datasource' | 'interaction' | 'filter';
    /** Source component identifier, e.g. timerId */
    sourceId: string;
  };
  /** Whether modified */
  dirty: boolean;
}

/** Script drawer shared state */
const drawerState = reactive({
  /** Whether the drawer is visible */
  visible: false,
  /** Drawer height (px) */
  height: 280,
  /** List of opened tabs */
  tabs: [] as ScriptDrawerTab[],
  /** Currently active tab ID */
  activeTabId: null as string | null,
  /** Minimum height */
  minHeight: 100,
  /** Maximum height */
  maxHeight: 600,
});

/** Callback: notify the source component when script content is updated */
type ScriptUpdateCallback = (script: string) => void;

const updateCallbacks = new Map<string, ScriptUpdateCallback>();

/**
 * Script drawer composable
 * Used to open/close the script editing drawer at the bottom of the editor
 */
export function useScriptDrawer() {
  /**
   * Open or switch to the specified script tab
   */
  function openScript(tab: Omit<ScriptDrawerTab, 'dirty'>, onUpdate?: ScriptUpdateCallback): void {
    const existing = drawerState.tabs.find((t) => t.id === tab.id);
    if (existing) {
      // Already exists, switch to that tab
      drawerState.activeTabId = tab.id;
      // Update content (the source component may have modified it)
      if (existing.script !== tab.script) {
        existing.script = tab.script;
      }
    } else {
      // Create a new tab
      const newTab: ScriptDrawerTab = { ...tab, dirty: false };
      drawerState.tabs.push(newTab);
      drawerState.activeTabId = tab.id;
    }

    if (onUpdate) {
      updateCallbacks.set(tab.id, onUpdate);
    }

    drawerState.visible = true;
  }

  /**
   * Close the specified tab
   */
  function closeTab(tabId: string): void {
    const idx = drawerState.tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;

    drawerState.tabs.splice(idx, 1);
    updateCallbacks.delete(tabId);

    if (drawerState.tabs.length === 0) {
      drawerState.visible = false;
      drawerState.activeTabId = null;
    } else if (drawerState.activeTabId === tabId) {
      drawerState.activeTabId = drawerState.tabs[Math.min(idx, drawerState.tabs.length - 1)].id;
    }
  }

  /**
   * Close all tabs
   */
  function closeAll(): void {
    drawerState.tabs = [];
    drawerState.activeTabId = null;
    drawerState.visible = false;
    updateCallbacks.clear();
  }

  /**
   * Toggle drawer visibility
   */
  function toggle(): void {
    drawerState.visible = !drawerState.visible;
  }

  /**
   * Update script content (triggered by ScriptEditor)
   */
  function updateScript(tabId: string, script: string): void {
    const tab = drawerState.tabs.find((t) => t.id === tabId);
    if (tab) {
      tab.script = script;
      tab.dirty = true;
    }

    // Notify the source component
    const cb = updateCallbacks.get(tabId);
    if (cb) {
      cb(script);
    }
  }

  /**
   * Save the script (triggered by the save button)
   * Persists the script content and marks the tab as saved
   */
  function saveScript(tabId: string, script: string): void {
    const tab = drawerState.tabs.find((t) => t.id === tabId);
    if (tab) {
      tab.script = script;
      tab.dirty = false;
    }

    // Notify the source component to save
    const cb = updateCallbacks.get(tabId);
    if (cb) {
      cb(script);
    }
  }

  /**
   * Set the drawer height
   */
  function setHeight(h: number): void {
    drawerState.height = Math.max(drawerState.minHeight, Math.min(drawerState.maxHeight, h));
  }

  return {
    drawerState,
    openScript,
    closeTab,
    closeAll,
    toggle,
    updateScript,
    saveScript,
    setHeight,
  };
}