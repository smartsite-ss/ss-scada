<template>
  <div class="global-tools">
    <!-- Search box -->
    <div class="search-box">
      <input 
        type="text" 
        :placeholder="$t('globalTools.search')"
        class="search-input"
      >
    </div>
    
    <!-- Fullscreen toggle -->
    <button
      class="tool-button"
      @click="toggleFullscreen"
    >
      <Icon
        :icon="{ type: 'vicon', value: ExpandOutline }"
        :size="18"
      />
    </button>
    
    <!-- Language switch -->
    <div class="language-switcher">
      <div class="language-dropdown">
        <button 
          class="language-dropdown-button" 
          :title="$t('globalTools.switchLanguage')"
          @click="toggleLanguageDropdown"
        >
          <Icon
            :icon="{ type: 'vicon', value: LanguageOutline }"
            :size="18"
          />
        </button>
        <div
          v-if="showLanguageDropdown"
          class="language-dropdown-menu"
        >
          <button
            v-for="locale in localeOptions"
            :key="locale.code"
            class="language-dropdown-item"
            :class="{ active: currentLanguage === locale.code }"
            @click="switchLanguage(locale.code)"
          >
            <span class="language-icon">{{ locale.flag }}</span>
            <span>{{ locale.label }}</span>
          </button>
        </div>
      </div>
    </div>
    
    <!-- Theme switch -->
    <div class="theme-switcher">
      <div class="theme-dropdown">
        <button 
          class="theme-dropdown-button" 
          :title="$t('globalTools.switchTheme')"
          @click="toggleThemeDropdown"
        >
          <Icon
            :icon="{ type: 'vicon', value: ColorPaletteOutline }"
            :size="18"
          />
        </button>
        <div
          v-if="showThemeDropdown"
          class="theme-dropdown-menu"
        >
          <button
            v-for="theme in allThemes"
            :key="theme.name"
            class="theme-dropdown-item"
            :class="{ active: currentTheme === theme.name }"
            @click="switchTheme(theme.name)"
          >
            <span class="theme-icon">{{ theme.icon }}</span>
            <span>{{ $t(theme.i18nKey) }}</span>
          </button>
        </div>
      </div>
    </div>
    
    <!-- Data platform -->
    <button 
      class="nav-button" 
      :title="$t('globalTools.dataCenter')"
      @click="navigateToSystem"
    >
      <Icon
        :icon="{ type: 'vicon', value: GridOutline }"
        :size="18"
      />
      <span class="nav-label">{{ $t('globalTools.dataCenter') }}</span>
    </button>

    <!-- Settings button -->
    <button 
      class="tool-button" 
      :title="$t('globalTools.settings')"
      @click="openSettings"
    >
      <Icon
        :icon="{ type: 'vicon', value: SettingsOutline }"
        :size="18"
      />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useConfigStore, useTheme, setLocale, getLocale, LOCALE_OPTIONS } from '@scada-editor/core';
import type { SupportedLocale } from '@scada-editor/core';
import Icon from '../../common/Icon.vue';
import {
  ExpandOutline,
  LanguageOutline,
  ColorPaletteOutline,
  SettingsOutline,
  GridOutline
} from '@vicons/ionicons5';

const localeOptions = LOCALE_OPTIONS;

// Global toolbar area component
// Responsible for auxiliary functions such as search, message notifications, fullscreen toggle, theme switch, language switch, etc.

const emit = defineEmits<{
  (e: 'open-settings'): void;
}>();

const router = useRouter();
const configStore = useConfigStore();
const { switchTheme: useThemeSwitch } = useTheme();
const { t: _t } = useI18n(); // Use only the t function for translation
const currentTheme = computed(() => configStore.ui?.theme ?? 'dark');
const showThemeDropdown = ref(false);

const themeIconMap: Record<string, string> = {
  light: '🌞',
  dark: '🌙',
  'high-contrast': '⬜',
  blue: '🔵',
  'tech-light-blue': '🔷',
  'tech-dark-blue': '🔵',
  'blue-light': '💎',
  'blue-dark': '🌌',
  'green-tech': '💚',
  'orange-warm': '🔥',
  enterprise: '🏢',
};

const themeI18nKeyMap: Record<string, string> = {
  light: 'globalTools.lightTheme',
  dark: 'globalTools.darkTheme',
  'high-contrast': 'globalTools.highContrast',
  blue: 'globalTools.blue',
  'tech-light-blue': 'globalTools.techLightBlue',
  'tech-dark-blue': 'globalTools.techDarkBlue',
  'blue-light': 'globalTools.blueLight',
  'blue-dark': 'globalTools.blueDark',
  'green-tech': 'globalTools.greenTech',
  'orange-warm': 'globalTools.orangeWarm',
  enterprise: 'globalTools.enterprise',
};

const allThemes = computed(() => {
  return Object.keys(themeIconMap).map((name) => ({
    name,
    icon: themeIconMap[name],
    i18nKey: themeI18nKeyMap[name],
  }));
});

// Language-switch-related
const showLanguageDropdown = ref(false);
const currentLanguage = computed(() => getLocale());

// Initialization: apply the saved language setting
onMounted(() => {
  const savedLang = configStore.ui?.language;
  if (savedLang && savedLang !== getLocale()) {
    setLocale(savedLang as SupportedLocale);
  }
});

// Watch the language change in configStore
watch(() => configStore.ui?.language, (newLang) => {
  if (newLang && newLang !== getLocale()) {
    setLocale(newLang as SupportedLocale);
  }
});

// Switch theme
const switchTheme = (theme: string) => {
  useThemeSwitch(theme as any);
  showThemeDropdown.value = false;
};

// Switch language
const switchLanguage = (language: SupportedLocale) => {
  setLocale(language);
  configStore.updateUIConfig({ language });
  showLanguageDropdown.value = false;
};

// Switch-theme dropdown menu
const toggleThemeDropdown = () => {
  showThemeDropdown.value = !showThemeDropdown.value;
  showLanguageDropdown.value = false;
};

// Switch-language dropdown menu
const toggleLanguageDropdown = () => {
  showLanguageDropdown.value = !showLanguageDropdown.value;
  showThemeDropdown.value = false;
};

// Click outside to close the dropdown
const handleClickOutside = (event: MouseEvent) => {
  const themeDropdown = document.querySelector('.theme-dropdown');
  const languageDropdown = document.querySelector('.language-dropdown');
  
  if (themeDropdown && !themeDropdown.contains(event.target as Node)) {
    showThemeDropdown.value = false;
  }
  
  if (languageDropdown && !languageDropdown.contains(event.target as Node)) {
    showLanguageDropdown.value = false;
  }
};

// Watch click event
onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

// Remove event listeners
onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});

// Toggle fullscreen
const toggleFullscreen = () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => {
      console.error(`Error attempting to enable full-screen mode: ${err.message}`);
    });
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
};

// Open settings
const openSettings = () => {
  emit('open-settings');
};

// Navigate to the data platform
const navigateToSystem = () => {
  router.push('/system');
};
</script>

<style scoped>
.global-tools {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 20px;
  border-left: 1px solid rgba(255, 255, 255, 0.2);
}

.search-box {
  position: relative;
}

.search-input {
  padding: 6px 12px;
  border: none;
  border-radius: 16px;
  font-size: 14px;
  width: 200px;
  background-color: rgba(255, 255, 255, 0.1);
  color: var(--header-text);
}

.search-input::placeholder {
  color: rgba(255, 255, 255, 0.7);
}

.tool-button {
  position: relative;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 4px;
  background-color: rgba(255, 255, 255, 0.1);
  color: var(--header-text);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
}

.tool-button:hover {
  background-color: rgba(255, 255, 255, 0.2);
}

.nav-button {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border: none;
  border-radius: 4px;
  background-color: rgba(255, 255, 255, 0.1);
  color: var(--header-text);
  cursor: pointer;
  transition: all 0.3s ease;
  white-space: nowrap;
}

.nav-button:hover {
  background-color: rgba(255, 255, 255, 0.2);
}

.nav-label {
  font-size: 13px;
  font-weight: 500;
}

.icon {
  font-size: 16px;
}

.badge {
  position: absolute;
  top: -4px;
  right: -4px;
  background-color: var(--status-error);
  color: white;
  font-size: 12px;
  font-weight: bold;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.theme-switcher {
  position: relative;
  display: flex;
  align-items: center;
}

.theme-dropdown {
  position: relative;
}

.theme-dropdown-button {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 4px;
  background-color: rgba(255, 255, 255, 0.1);
  color: var(--header-text);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
}

.theme-dropdown-button:hover {
  background-color: rgba(255, 255, 255, 0.2);
}

.theme-dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 8px;
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: var(--shadow-medium);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 1000;
  min-width: 120px;
}

.theme-dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--text);
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 13px;
}

.theme-dropdown-item:hover {
  background-color: var(--control-button-hover);
}

.theme-dropdown-item.active {
  background-color: var(--primary);
  color: white;
}

.theme-icon {
  font-size: 16px;
  width: 20px;
  text-align: center;
}

.language-switcher {
  position: relative;
  display: flex;
  align-items: center;
}

.language-dropdown {
  position: relative;
}

.language-dropdown-button {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 4px;
  background-color: rgba(255, 255, 255, 0.1);
  color: var(--header-text);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
}

.language-dropdown-button:hover {
  background-color: rgba(255, 255, 255, 0.2);
}

.language-dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 8px;
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: var(--shadow-medium);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 1000;
  min-width: 120px;
  max-height: 70vh;
  overflow-y: auto;
}

.language-dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--text);
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 13px;
}

.language-dropdown-item:hover {
  background-color: var(--control-button-hover);
}

.language-dropdown-item.active {
  background-color: var(--primary);
  color: white;
}

.language-icon {
  font-size: 16px;
  width: 20px;
  text-align: center;
}
</style>
