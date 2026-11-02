// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * useFeatureFlag — P1-T07 frontend AI Feature Flag Composable
 *
 * Reactively checks whether AI feature flags are enabled.
 * The frontend fetches flag status via the /api/v1/ai/status endpoint.
 *
 * Usage:
 *   const { isCodegenEnabled, flags, loading } = useFeatureFlag();
 *   <PluginGenButton v-if="isCodegenEnabled" />
 *
 * Related decision: D-012 (Feature Flag gating)
 */

import { ref, computed, onMounted, type Ref } from 'vue';

const API_BASE = '/api/v1/ai';
const TOKEN_KEY = 'scada_access_token';

// S-C03: the Token is transmitted via HttpOnly Cookie; authHeaders is only for compatibility fallback
function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** AI Feature Flag status */
interface FeatureFlagState {
  'ai.assistant.enabled': boolean;
  'ai.codegen.enabled': boolean;
  'ai.script.enabled': boolean;
  'ai.scene.enabled': boolean;
  'ai.kb.enabled': boolean;
  'ai.alarm.enabled': boolean;
  'ai.cli.enabled': boolean;
}

/** Cached flag status */
const cachedFlags = ref<FeatureFlagState>({
  'ai.assistant.enabled': false,
  'ai.codegen.enabled': false,
  'ai.script.enabled': false,
  'ai.scene.enabled': false,
  'ai.kb.enabled': false,
  'ai.alarm.enabled': false,
  'ai.cli.enabled': false,
});
const loading = ref(false);
let fetched = false;

export function useFeatureFlag(): {
  flags: Ref<FeatureFlagState>;
  isAssistantEnabled: Ref<boolean>;
  isCodegenEnabled: Ref<boolean>;
  isScriptEnabled: Ref<boolean>;
  isSceneEnabled: Ref<boolean>;
  isKbEnabled: Ref<boolean>;
  isAlarmEnabled: Ref<boolean>;
  isCliEnabled: Ref<boolean>;
  loading: Ref<boolean>;
  refresh: () => Promise<void>;
} {
  async function refresh(): Promise<void> {
    loading.value = true;
    try {
      const resp = await fetch(`${API_BASE}/status`, { credentials: 'include', headers: authHeaders() });
      if (!resp.ok) return;
      const data = await resp.json();
      // Unwrap the TransformInterceptor wrapper { code, data, message, timestamp }
      const unwrapped = data?.data ?? data;
      if (unwrapped?.features) {
        cachedFlags.value = { ...unwrapped.features };
      }
    } catch {
      // Keep the defaults (all false)
    } finally {
      loading.value = false;
    }
  }

  if (!fetched) {
    fetched = true;
    onMounted(() => {
      refresh();
    });
  }

  return {
    flags: cachedFlags,
    isAssistantEnabled: computed(() => cachedFlags.value['ai.assistant.enabled']),
    isCodegenEnabled: computed(() => cachedFlags.value['ai.codegen.enabled']),
    isScriptEnabled: computed(() => cachedFlags.value['ai.script.enabled']),
    isSceneEnabled: computed(() => cachedFlags.value['ai.scene.enabled']),
    isKbEnabled: computed(() => cachedFlags.value['ai.kb.enabled']),
    isAlarmEnabled: computed(() => cachedFlags.value['ai.alarm.enabled']),
    isCliEnabled: computed(() => cachedFlags.value['ai.cli.enabled']),
    loading,
    refresh,
  };
}
