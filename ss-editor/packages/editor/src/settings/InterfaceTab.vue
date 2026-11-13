<template>
  <div class="interface-tab">
    <!-- Cache management (pinned top) -->
    <div class="setting-group">
      <div class="group-title">
        <span class="group-icon">🗑️</span>
        <span class="group-text">{{ $t('settings.clearCache') }}</span>
      </div>

      <div class="cache-desc">
        {{ $t('settings.clearCacheDesc') }}
      </div>

      <button
        class="clear-cache-btn"
        @click="handleClearCache"
      >
        {{ $t('settings.clearCacheBtn') }}
      </button>
    </div>

    <!-- Theme settings -->
    <div class="setting-group">
      <div class="group-title">
        <span class="group-icon">🎨</span>
        <span class="group-text">{{ $t('settings.theme') }}</span>
      </div>
      
      <div class="setting-row">
        <label class="setting-label">{{ $t('settings.themeLabel') }}</label>
        <select
          v-model="selectedTheme"
          class="setting-select"
          @change="handleThemeChange"
        >
          <option value="light">
            {{ $t('settings.themeOptions.light') }}
          </option>
          <option value="dark">
            {{ $t('settings.themeOptions.dark') }}
          </option>
          <option value="tech-light-blue">
            {{ $t('settings.themeOptions.techLightBlue') }}
          </option>
          <option value="tech-dark-blue">
            {{ $t('settings.themeOptions.techDarkBlue') }}
          </option>
        </select>
      </div>
    </div>

    <!-- Language settings -->
    <div class="setting-group">
      <div class="group-title">
        <span class="group-icon">🌐</span>
        <span class="group-text">{{ $t('settings.language') }}</span>
      </div>
      
      <div class="setting-row">
        <label class="setting-label">{{ $t('settings.languageLabel') }}</label>
        <select
          v-model="selectedLanguage"
          class="setting-select"
          @change="handleLanguageChange"
        >
          <option value="zh-CN">
            {{ $t('settings.languageOptions.zhCN') }}
          </option>
          <option value="en-US">
            {{ $t('settings.languageOptions.enUS') }}
          </option>
        </select>
      </div>
    </div>

    <!-- Display settings -->
    <div class="setting-group">
      <div class="group-title">
        <span class="group-icon">👁️</span>
        <span class="group-text">{{ $t('settings.display') }}</span>
      </div>
      
      <div class="setting-row">
        <label class="setting-label">{{ $t('settings.showRulers') }}</label>
        <label class="toggle-switch">
          <input
            v-model="showRulers"
            type="checkbox"
            @change="handleShowRulersChange"
          >
          <span class="toggle-slider" />
        </label>
      </div>

      <div class="setting-row">
        <label class="setting-label">{{ $t('settings.showToolbar') }}</label>
        <label class="toggle-switch">
          <input
            v-model="showToolbar"
            type="checkbox"
            @change="handleShowToolbarChange"
          >
          <span class="toggle-slider" />
        </label>
      </div>

      <div class="setting-row">
        <label class="setting-label">{{ $t('settings.showPropertyPanel') }}</label>
        <label class="toggle-switch">
          <input
            v-model="showPropertyPanel"
            type="checkbox"
            @change="handleShowPropertyPanelChange"
          >
          <span class="toggle-slider" />
        </label>
      </div>

      <div class="setting-row">
        <label class="setting-label">{{ $t('settings.showLayerPanel') }}</label>
        <label class="toggle-switch">
          <input
            v-model="showLayerPanel"
            type="checkbox"
            @change="handleShowLayerPanelChange"
          >
          <span class="toggle-slider" />
        </label>
      </div>
    </div>
    <!-- Periodic save settings -->
    <div class="setting-group">
      <div class="group-title">
        <span class="group-icon">💾</span>
        <span class="group-text">{{ $t('autoSave.title') }}</span>
      </div>

      <div class="tips-content">
        <p>{{ $t('autoSave.tipAutoSave') }}</p>
        <p>{{ $t('autoSave.tipInterval') }}</p>
      </div>

      <div class="setting-row">
        <label class="setting-label">{{ $t('autoSave.enabled') }}</label>
        <label class="toggle-switch">
          <input
            v-model="autoSaveEnabled"
            type="checkbox"
            @change="handleAutoSaveEnabledChange"
          >
          <span class="toggle-slider" />
        </label>
      </div>

      <div class="setting-row">
        <label class="setting-label">{{ $t('autoSave.interval') }}</label>
        <div class="input-group">
          <input
            v-model.number="autoSaveInterval"
            type="number"
            class="interval-input"
            :min="60"
            :max="600"
            :disabled="!autoSaveEnabled"
            @change="handleAutoSaveIntervalChange"
          >
          <span class="input-unit">{{ $t('autoSave.intervalSeconds') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useConfigStore, useTheme, getLocale, setLocale, i18n, clearStorage } from '@scada-editor/core';
import { showConfirm } from '../utils/messageBox';

const configStore = useConfigStore();
const { switchTheme: useThemeSwitch } = useTheme();
const { t } = i18n.global;

// Theme
const selectedTheme = ref('dark');

// Language
type LocaleType = 'zh-CN' | 'en-US';
const selectedLanguage = ref<LocaleType>('zh-CN');

// Display settings
const showRulers = ref(true);
const showToolbar = ref(true);
const showPropertyPanel = ref(true);
const showLayerPanel = ref(true);

// Auto-save settings
const autoSaveEnabled = ref(true);
const autoSaveInterval = ref(300);

// Initialization
onMounted(() => {
  // Restore the saved theme
  if (configStore.ui?.theme) {
    selectedTheme.value = configStore.ui.theme;
  }
  // Restore the saved language and apply it to the i18n instance
  if (configStore.ui?.language) {
    selectedLanguage.value = configStore.ui.language as LocaleType;
    setLocale(configStore.ui.language as LocaleType);
  }
  // Restore canvas settings
  if (configStore.canvas?.showRulers) {
    showRulers.value = configStore.canvas.showRulers;
  }
  if (configStore.ui?.showToolbar) {
    showToolbar.value = configStore.ui.showToolbar;
  }
  if (configStore.ui?.showPropertyPanel) {
    showPropertyPanel.value = configStore.ui.showPropertyPanel;
  }
  if (configStore.ui?.showLayerPanel) {
    showLayerPanel.value = configStore.ui.showLayerPanel;
  }
  // Restore auto-save config
  if (configStore.autoSave?.enabled !== undefined) {
    autoSaveEnabled.value = configStore.autoSave.enabled;
  }
  if (configStore.autoSave?.interval) {
    autoSaveInterval.value = configStore.autoSave.interval;
  }
});

// Watch the language change in configStore (to avoid missing it due to async loading)
watch(() => configStore.ui?.language, (newLang) => {
  if (newLang && newLang !== getLocale()) {
    selectedLanguage.value = newLang as LocaleType;
    setLocale(newLang as LocaleType);
  }
});

// Theme change
const handleThemeChange = () => {
  useThemeSwitch(selectedTheme.value as any);
  configStore.updateUIConfig({ theme: selectedTheme.value });
};

// Language change
const handleLanguageChange = () => {
  setLocale(selectedLanguage.value);
  configStore.updateUIConfig({ language: selectedLanguage.value });
};

// Show ruler changes
const handleShowRulersChange = () => {
  configStore.updateCanvasConfig({ showRulers: showRulers.value });
};

// Show toolbar changes
const handleShowToolbarChange = () => {
  configStore.updateUIConfig({ showToolbar: showToolbar.value });
};

// Show property-panel changes
const handleShowPropertyPanelChange = () => {
  configStore.updateUIConfig({ showPropertyPanel: showPropertyPanel.value });
};

// Show layer-panel changes
const handleShowLayerPanelChange = () => {
  configStore.updateUIConfig({ showLayerPanel: showLayerPanel.value });
};

// Auto-save enable change
const handleAutoSaveEnabledChange = () => {
  configStore.updateAutoSaveConfig({ enabled: autoSaveEnabled.value });
};

// Auto-save interval change
const handleAutoSaveIntervalChange = () => {
  const val = Math.max(60, Math.min(600, autoSaveInterval.value));
  autoSaveInterval.value = val;
  configStore.updateAutoSaveConfig({ interval: val });
};

// Clear browser cache
const handleClearCache = async () => {
  const confirmed = await showConfirm(t('settings.clearCacheConfirm'), t('settings.clearCache'));
  if (confirmed) {
    clearStorage();
    window.location.reload();
  }
};
</script>

<style scoped>
.interface-tab {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.setting-group {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.group-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

.group-icon {
  font-size: 16px;
}

.group-text {
  font-size: 15px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
}

.setting-label {
  font-size: 14px;
  color: var(--text);
  flex: 1;
}

.setting-select {
  width: 200px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background-color: var(--surface);
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.setting-select:hover {
  border-color: var(--primary);
}

.setting-select:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.2);
}

/* Toggle Switch */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--border);
  transition: 0.3s;
  border-radius: 24px;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.3s;
  border-radius: 50%;
}

input:checked + .toggle-slider {
  background-color: var(--primary);
}

input:checked + .toggle-slider:before {
  transform: translateX(20px);
}

.cache-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  padding: 8px 0;
}

.clear-cache-btn {
  align-self: flex-start;
  padding: 8px 20px;
  border: 1px solid var(--danger, #e74c3c);
  border-radius: 4px;
  background-color: transparent;
  color: var(--danger, #e74c3c);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.clear-cache-btn:hover {
  background-color: var(--danger, #e74c3c);
  color: white;
}

.input-unit {
  font-size: 12px;
  color: var(--text-secondary);
}

.interval-input {
  width: 80px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background-color: var(--surface);
  color: var(--text);
  font-size: 14px;
  text-align: right;
}

.interval-input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.2);
}

.interval-input:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.input-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.tips-content {
  padding: 12px 16px;
  background-color: var(--surface);
  border-radius: 4px;
  border-left: 3px solid var(--primary);
}

.tips-content p {
  margin: 4px 0;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
}
</style>
