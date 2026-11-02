// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { StorageError, errorService } from '../utils/core/errors';

// Storage keys
const STORAGE_KEYS = {
  PROJECT: 'scada-editor-project',
  AUTO_SAVE: 'scada-editor-auto-save',
  SETTINGS: 'scada-editor-settings',
  PROJECTS: 'scada-editor-projects',
  TEMPLATES: 'scada-editor-templates',
};

// Save data to local storage
export const saveToStorage = (key: string, data: any, throwOnError: boolean = false): void => {
  try {
    const serializedData = JSON.stringify(data);
    localStorage.setItem(key, serializedData);
  } catch (error) {
    const err = new StorageError('save', error instanceof Error ? error.message : 'Unknown error');
    errorService.record(err, `Storage save key: ${key}`);

    if (throwOnError) {
      throw err;
    }
    console.error('Error saving to storage:', error);
  }
};

// Read data from local storage
export const loadFromStorage = (key: string, throwOnError: boolean = false): any => {
  try {
    const serializedData = localStorage.getItem(key);
    if (serializedData === null) {
      return null;
    }
    return JSON.parse(serializedData);
  } catch (error) {
    const err = new StorageError('load', error instanceof Error ? error.message : 'Unknown error');
    errorService.record(err, `Storage load key: ${key}`);

    if (throwOnError) {
      throw err;
    }
    console.error('Error loading from storage:', error);
    return null;
  }
};

// Remove data from local storage
export const removeFromStorage = (key: string, throwOnError: boolean = false): void => {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    const err = new StorageError('remove', error instanceof Error ? error.message : 'Unknown error');
    errorService.record(err, `Storage remove key: ${key}`);

    if (throwOnError) {
      throw err;
    }
    console.error('Error removing from storage:', error);
  }
};

// Clear all storage data
export const clearStorage = (throwOnError: boolean = false): void => {
  try {
    localStorage.clear();
  } catch (error) {
    const err = new StorageError('clear', error instanceof Error ? error.message : 'Unknown error');
    errorService.record(err, 'Storage clear');

    if (throwOnError) {
      throw err;
    }
    console.error('Error clearing storage:', error);
  }
};

// Save project data
export const saveProject = (project: any, throwOnError: boolean = false): void => {
  saveToStorage(STORAGE_KEYS.PROJECT, project, throwOnError);
};

// Load project data
export const loadProject = (throwOnError: boolean = false): any => {
  return loadFromStorage(STORAGE_KEYS.PROJECT, throwOnError);
};

// Save auto-save data
export const saveAutoSave = (data: any, throwOnError: boolean = false): void => {
  saveToStorage(STORAGE_KEYS.AUTO_SAVE, data, throwOnError);
};

// Load auto-save data
export const loadAutoSave = (throwOnError: boolean = false): any => {
  return loadFromStorage(STORAGE_KEYS.AUTO_SAVE, throwOnError);
};

// Save settings data
export const saveSettings = (settings: any, throwOnError: boolean = false): void => {
  saveToStorage(STORAGE_KEYS.SETTINGS, settings, throwOnError);
};

// Load settings data
export const loadSettings = (throwOnError: boolean = false): any => {
  const defaultSettings = {
    autoSave: true,
    autoSaveInterval: 30000,
  };
  const loaded = loadFromStorage(STORAGE_KEYS.SETTINGS, throwOnError);
  return loaded || defaultSettings;
};

// Save project list
export const saveProjects = (projects: any[], throwOnError: boolean = false): void => {
  saveToStorage(STORAGE_KEYS.PROJECTS, projects, throwOnError);
};

// Load project list
export const loadProjects = (throwOnError: boolean = false): any[] => {
  return loadFromStorage(STORAGE_KEYS.PROJECTS, throwOnError) || [];
};

// Save template list
export const saveTemplates = (templates: any[], throwOnError: boolean = false): void => {
  saveToStorage(STORAGE_KEYS.TEMPLATES, templates, throwOnError);
};

// Load template list
export const loadTemplates = (throwOnError: boolean = false): any[] => {
  return loadFromStorage(STORAGE_KEYS.TEMPLATES, throwOnError) || [];
};

// Clear auto-save data
export const clearAutoSave = (throwOnError: boolean = false): void => {
  removeFromStorage(STORAGE_KEYS.AUTO_SAVE, throwOnError);
};

export default {
  saveToStorage,
  loadFromStorage,
  removeFromStorage,
  clearStorage,
  saveProject,
  loadProject,
  saveAutoSave,
  loadAutoSave,
  saveSettings,
  loadSettings,
  saveProjects,
  loadProjects,
  saveTemplates,
  loadTemplates,
  clearAutoSave,
};
