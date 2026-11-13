<template>
  <div class="login-page">
    <!-- Industrial-style background layer: precise grid + geometric lines + scan line -->
    <div class="login-background">
      <svg
        class="grid-pattern"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <defs>
          <pattern
            id="grid"
            width="8"
            height="8"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 8 0 L 0 0 0 8"
              fill="none"
              stroke="rgba(59,130,246,0.08)"
              stroke-width="0.3"
            />
          </pattern>
          <pattern
            id="grid-major"
            width="40"
            height="40"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="rgba(59,130,246,0.12)"
              stroke-width="0.4"
            />
          </pattern>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="url(#grid)"
        />
        <rect
          width="100%"
          height="100%"
          fill="url(#grid-major)"
        />
      </svg>

      <!-- Industrial-style decorative glow (restrained) -->
      <div class="glow-orb glow-orb-1" />
      <div class="glow-orb glow-orb-2" />

      <!-- Geometric decorative lines -->
      <div class="geo-line geo-line-top" />
      <div class="geo-line geo-line-bottom" />

      <!-- Scan-line animation -->
      <div class="scan-line" />
    </div>

    <!-- Login card: with four-corner positioning box -->
    <div class="login-container">
      <!-- Four-corner positioning box (industrial rigor) -->
      <span class="corner corner-tl" />
      <span class="corner corner-tr" />
      <span class="corner corner-bl" />
      <span class="corner corner-br" />

      <!-- Top technical status bar -->
      <div class="tech-status-bar">
        <span class="status-dot status-dot-online" />
        <span class="status-text">{{ $t('system.login.techStatus') || 'SYSTEM READY' }}</span>
        <span class="status-separator">·</span>
        <span class="status-version">v2.7</span>
      </div>

      <!-- Brand header: Logo + title (emphasize the visual focus) -->
      <div class="login-header">
        <div class="logo-icon">
          <!-- Outer rotating ring -->
          <div class="logo-rotating-ring" />
          <!-- Inner glow ring -->
          <div class="logo-ring" />
          <!-- Logo main body -->
          <img
            src="../assets/logo.svg"
            width="76"
            height="76"
            alt="Smart Site"
          >
        </div>
        <h1 class="login-title">
          Smart Site
        </h1>
        <p class="brand-tagline">
          {{ $t('system.login.tagline') }}
        </p>
        <div class="header-divider">
          <span class="divider-dot" />
        </div>
      </div>

      <!-- Error hint (enhanced) -->
      <transition name="error-fade">
        <div
          v-if="errorMsg"
          class="login-error"
        >
          <span class="error-icon">⚠</span>
          <span>{{ errorMsg }}</span>
        </div>
      </transition>

      <!-- Login method switch (account/password / WeChat scan-code) — shown only when WECHAT_LOGIN_ENABLED=true -->
      <div
        v-if="!isRegister && loginFeatures.wechatLoginEnabled"
        class="login-mode-switch"
      >
        <button
          type="button"
          class="mode-tab"
          :class="{ 'mode-tab-active': loginMode === 'password' }"
          @click="switchLoginMode('password')"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <rect
              x="3"
              y="11"
              width="18"
              height="11"
              rx="2"
              ry="2"
            />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          {{ $t('system.login.switchToPassword') }}
        </button>
        <button
          type="button"
          class="mode-tab"
          :class="{ 'mode-tab-active': loginMode === 'wechat' }"
          @click="switchLoginMode('wechat')"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M9.5 4C5.36 4 2 6.69 2 10c0 1.89 1.08 3.56 2.78 4.66L4 17l2.83-1.55c.53.13 1.08.2 1.67.2.2 0 .4-.01.6-.03-.06-.32-.1-.65-.1-.99 0-3.04 2.91-5.5 6.5-5.5.2 0 .4.01.6.03C15.65 6.49 12.88 4 9.5 4zM7 8.5a1 1 0 110 2 1 1 0 010-2zm5 0a1 1 0 110 2 1 1 0 010-2z" />
            <path d="M22 14.5C22 11.46 19.09 9 15.5 9S9 11.46 9 14.5s2.91 5.5 6.5 5.5c.5 0 .98-.05 1.45-.14L19.5 21l-.6-1.9c1.9-.95 3.1-2.7 3.1-4.6zM13 13a.75.75 0 110 1.5.75.75 0 010-1.5zm5 0a.75.75 0 110 1.5.75.75 0 010-1.5z" />
          </svg>
          {{ $t('system.login.switchToWechat') }}
        </button>
      </div>

      <!-- WeChat scan-code login panel -->
      <div
        v-if="loginMode === 'wechat' && !isRegister"
        class="wechat-panel"
      >
        <!-- QR code area -->
        <div class="qrcode-container">
          <!-- Loading -->
          <div
            v-if="wechatLoading"
            class="qrcode-loading"
          >
            <span class="qrcode-spinner" />
            <p>{{ $t('system.login.qrcodeLoading') }}</p>
          </div>

          <!-- Mock mode: show placeholder QR code + simulate buttons -->
          <div
            v-else-if="wechatMock"
            class="qrcode-mock"
          >
            <div class="mock-qrcode">
              <svg
                width="180"
                height="180"
                viewBox="0 0 180 180"
                class="mock-qr-svg"
              >
                <defs>
                  <pattern
                    id="qr-pattern"
                    x="0"
                    y="0"
                    width="10"
                    height="10"
                    patternUnits="userSpaceOnUse"
                  >
                    <rect
                      width="10"
                      height="10"
                      fill="none"
                    />
                    <rect
                      width="5"
                      height="5"
                      fill="#0f172a"
                    />
                    <rect
                      x="5"
                      y="5"
                      width="5"
                      height="5"
                      fill="#0f172a"
                    />
                  </pattern>
                </defs>
                <rect
                  width="180"
                  height="180"
                  fill="url(#qr-pattern)"
                />
                <!-- Three positioning corners -->
                <rect
                  x="10"
                  y="10"
                  width="40"
                  height="40"
                  fill="none"
                  stroke="#0f172a"
                  stroke-width="6"
                />
                <rect
                  x="20"
                  y="20"
                  width="20"
                  height="20"
                  fill="#0f172a"
                />
                <rect
                  x="130"
                  y="10"
                  width="40"
                  height="40"
                  fill="none"
                  stroke="#0f172a"
                  stroke-width="6"
                />
                <rect
                  x="140"
                  y="20"
                  width="20"
                  height="20"
                  fill="#0f172a"
                />
                <rect
                  x="10"
                  y="130"
                  width="40"
                  height="40"
                  fill="none"
                  stroke="#0f172a"
                  stroke-width="6"
                />
                <rect
                  x="20"
                  y="140"
                  width="20"
                  height="20"
                  fill="#0f172a"
                />
                <!-- Center WeChat icon -->
                <circle
                  cx="90"
                  cy="90"
                  r="22"
                  fill="#10b981"
                />
                <path
                  d="M82 86a2 2 0 110-4 2 2 0 010 4zm12 0a2 2 0 110-4 2 2 0 010 4zm-6-12c-6 0-11 4-11 9 0 2 1 4 3 5l-1 3 3-2c1 0 2 1 3 1h1c0-1 0-1 0-2 5 0 9-3 9-8 0-3-2-5-4-6-1 0-2-1-3-1zm0 2c4 0 7 3 7 6 0 4-3 6-7 6-1 0-2 0-3-1l-2 1 1-2c-1-1-2-2-2-4 0-3 3-6 7-6z"
                  fill="#fff"
                  transform="translate(-2 -2)"
                />
              </svg>
            </div>
            <!-- Expired/cancelled mask -->
            <div
              v-if="scanStatus === 'expired' || scanStatus === 'cancelled'"
              class="qrcode-overlay"
            >
              <span class="overlay-text">
                {{ scanStatus === 'expired' ? $t('system.login.qrcodeExpired') : $t('system.login.scanCancelled') }}
              </span>
              <button
                type="button"
                class="refresh-qrcode-btn"
                @click="refreshQrcode"
              >
                {{ $t('system.login.refreshQrcode') }}
              </button>
            </div>
          </div>

          <!-- Real mode: embed the official WeChat QR-code iframe -->
          <div
            v-else
            class="qrcode-real"
          >
            <iframe
              v-if="wechatUrl && scanStatus !== 'expired' && scanStatus !== 'cancelled'"
              :src="wechatUrl"
              class="wechat-iframe"
              frameborder="0"
              scrolling="no"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-top-navigation"
            />
            <div
              v-if="scanStatus === 'expired' || scanStatus === 'cancelled'"
              class="qrcode-overlay"
            >
              <span class="overlay-text">
                {{ scanStatus === 'expired' ? $t('system.login.qrcodeExpired') : $t('system.login.scanCancelled') }}
              </span>
              <button
                type="button"
                class="refresh-qrcode-btn"
                @click="refreshQrcode"
              >
                {{ $t('system.login.refreshQrcode') }}
              </button>
            </div>
          </div>
        </div>

        <!-- Scan-code status hint -->
        <div
          class="scan-status"
          :class="`scan-status-${scanStatus}`"
        >
          <span
            v-if="scanStatus === 'pending'"
            class="status-indicator status-indicator-pending"
          />
          <span
            v-if="scanStatus === 'scanned'"
            class="status-indicator status-indicator-scanned"
          />
          <span
            v-if="scanStatus === 'confirmed'"
            class="status-indicator status-indicator-confirmed"
          />
          <span class="status-text">{{ scanStatusText }}</span>
        </div>

        <!-- Mock mode action buttons (for dev debugging) -->
        <div
          v-if="wechatMock && scanStatus === 'pending'"
          class="mock-actions"
        >
          <button
            type="button"
            class="mock-btn mock-btn-confirm"
            @click="handleMockScan('confirm')"
          >
            {{ $t('system.login.mockConfirm') }}
          </button>
          <button
            type="button"
            class="mock-btn mock-btn-cancel"
            @click="handleMockScan('cancel')"
          >
            {{ $t('system.login.mockCancel') }}
          </button>
        </div>

        <!-- Mock mode hint banner -->
        <div
          v-if="wechatMock"
          class="mock-banner"
        >
          ⚠ MOCK MODE — 仅用于开发调试，生产环境需配置真实微信凭证
        </div>
      </div>

      <!-- Form area (account/password mode) -->
      <form
        v-if="loginMode === 'password' || isRegister"
        class="login-form"
        @submit.prevent="handleSubmit"
      >
        <!-- Username -->
        <div class="form-group">
          <label
            class="form-label"
            for="username"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class="label-icon"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle
                cx="12"
                cy="7"
                r="4"
              />
            </svg>
            {{ $t('system.login.username') }}
          </label>
          <input
            id="username"
            v-model="form.username"
            type="text"
            class="form-input"
            autocomplete="username"
            required
          >
        </div>

        <!-- Email (registration mode) -->
        <div
          v-if="isRegister"
          class="form-group"
        >
          <label
            class="form-label"
            for="email"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class="label-icon"
            >
              <rect
                x="2"
                y="4"
                width="20"
                height="16"
                rx="2"
              />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
            {{ $t('system.login.email') }}
          </label>
          <input
            id="email"
            v-model="form.email"
            type="email"
            class="form-input"
            autocomplete="email"
            required
          >
        </div>

        <!-- Display name (registration mode) -->
        <div
          v-if="isRegister"
          class="form-group"
        >
          <label
            class="form-label"
            for="displayName"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class="label-icon"
            >
              <circle
                cx="12"
                cy="12"
                r="10"
              />
              <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
              <line
                x1="12"
                y1="6"
                x2="12"
                y2="18"
              />
            </svg>
            {{ $t('system.login.displayName') }}
          </label>
          <input
            id="displayName"
            v-model="form.displayName"
            type="text"
            class="form-input"
          >
        </div>

        <!-- Password -->
        <div class="form-group">
          <label
            class="form-label"
            for="password"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class="label-icon"
            >
              <rect
                x="3"
                y="11"
                width="18"
                height="11"
                rx="2"
                ry="2"
              />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            {{ $t('system.login.password') }}
          </label>
          <div class="input-wrap">
            <input
              id="password"
              v-model="form.password"
              :type="showPassword ? 'text' : 'password'"
              class="form-input"
              autocomplete="current-password"
              required
            >
            <button
              type="button"
              class="toggle-password"
              tabindex="-1"
              :title="showPassword ? $t('system.login.hidePassword') : $t('system.login.showPassword')"
              @click="showPassword = !showPassword"
            >
              <svg
                v-if="showPassword"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line
                  x1="1"
                  y1="1"
                  x2="23"
                  y2="23"
                />
              </svg>
              <svg
                v-else
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle
                  cx="12"
                  cy="12"
                  r="3"
                />
              </svg>
            </button>
          </div>
        </div>

        <!-- Gradient login button -->
        <button
          type="submit"
          class="login-btn"
          :disabled="authStore.loading"
        >
          <span
            v-if="authStore.loading"
            class="btn-spinner"
          />
          <span
            v-else
            class="btn-text"
          >{{ isRegister ? $t('system.login.registerBtn') : $t('system.login.loginBtn') }}</span>
        </button>
      </form>

      <!-- Bottom switch link -->
      <div class="login-footer">
        <transition
          name="fade"
          mode="out-in"
        >
          <span
            v-if="!isRegister"
            key="login"
          >
            {{ $t('system.login.noAccount') }}
            <a
              href="#"
              @click.prevent="toggleMode"
            >{{ $t('system.login.register') }}</a>
          </span>
          <span
            v-else
            key="register"
          >
            {{ $t('system.login.hasAccount') }}
            <a
              href="#"
              @click.prevent="toggleMode"
            >{{ $t('system.login.backToLogin') }}</a>
          </span>
        </transition>
      </div>

      <!-- Client download entry -->
      <div class="login-client-download">
        <a
          href="/downloads/scada-editor-tauri_0.1.0_x64-portable.zip"
          download
          class="client-download-btn"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {{ $t('system.login.clientDownload') }}
        </a>
      </div>

      <!-- Bottom build info (industrial style) -->
      <div class="login-build-info">
        <span class="build-label">BUILD</span>
        <span class="build-value">2026.08.05</span>
        <span class="build-separator">|</span>
        <span class="build-label">CHANNEL</span>
        <span class="build-value">stable</span>
        <span class="build-separator">|</span>
        <span class="build-label">© 2026</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from '@scada-editor/core';
import { useAuthStore } from '../stores/auth.store';
import { authApi, type LoginFeatures } from '../api/modules/auth.api';

const router = useRouter();
const authStore = useAuthStore();
const { t } = useI18n();

const isRegister = ref(false);
const errorMsg = ref('');
const showPassword = ref(false);

// ── Login method: password (account) | wechat (scan-code) ──
const loginMode = ref<'password' | 'wechat'>('password');

// ── Login feature toggle (queried from backend at startup, decides whether to show the WeChat scan-code entry) ──
const loginFeatures = ref<LoginFeatures>({
  wechatLoginEnabled: false,
  smsLoginEnabled: false,
});

onMounted(async () => {
  try {
    loginFeatures.value = await authApi.getLoginFeatures();
  } catch {
    // Keep the default false when the interface is unavailable (safe default: do not show the third-party login entry)
  }
});

const form = reactive({
  username: 'test',
  password: 'test',
  email: '',
  displayName: '',
});

// ── WeChat scan-code status ──
const wechatState = ref('');
const wechatUrl = ref('');
const wechatMock = ref(false);
const wechatLoading = ref(false);
const scanStatus = ref<'pending' | 'scanned' | 'confirmed' | 'expired' | 'cancelled'>('pending');
let pollingTimer: ReturnType<typeof setInterval> | null = null;

const scanStatusText = computed(() => {
  switch (scanStatus.value) {
    case 'pending':
      return t('system.login.scanPending');
    case 'scanned':
      return t('system.login.scanScanned');
    case 'confirmed':
      return t('system.login.scanConfirmed');
    case 'expired':
      return t('system.login.qrcodeExpired');
    case 'cancelled':
      return t('system.login.scanCancelled');
    default:
      return '';
  }
});

function toggleMode() {
  isRegister.value = !isRegister.value;
  errorMsg.value = '';
  showPassword.value = false;
  // Force back to password mode when switching to register (register does not support WeChat scan-code)
  if (isRegister.value) {
    switchLoginMode('password');
  }
}

/** Switch login method; switching to WeChat auto-starts the scan-code flow */
function switchLoginMode(mode: 'password' | 'wechat') {
  if (loginMode.value === mode) return;
  // Stop polling when leaving WeChat mode
  if (loginMode.value === 'wechat') {
    stopWechatPolling();
  }
  loginMode.value = mode;
  errorMsg.value = '';
  if (mode === 'wechat') {
    startWechatLogin();
  }
}

/** Initiate WeChat scan-code: generate QR code and start polling status */
async function startWechatLogin() {
  stopWechatPolling();
  wechatLoading.value = true;
  scanStatus.value = 'pending';
  wechatState.value = '';
  wechatUrl.value = '';
  wechatMock.value = false;

  try {
    const result = await authApi.generateWechatQrcode();
    wechatState.value = result.state;
    wechatUrl.value = result.wechatUrl;
    wechatMock.value = result.mock;
    wechatLoading.value = false;
    // Start polling the scan-code status (1.5s interval)
    pollingTimer = setInterval(pollScanStatus, 1500);
  } catch (err: any) {
    wechatLoading.value = false;
    const msg = err?.response?.data?.message || err?.message || t('system.login.scanFailed');
    errorMsg.value = typeof msg === 'string' ? msg : t('system.login.scanFailed');
  }
}

/** Stop polling the scan-code status */
function stopWechatPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

/** Poll the scan-code status; complete login when confirmed */
async function pollScanStatus() {
  if (!wechatState.value) return;
  // Stop polling once a terminal state (expired/cancelled/confirmed) is reached
  if (scanStatus.value === 'expired' || scanStatus.value === 'cancelled' || scanStatus.value === 'confirmed') {
    stopWechatPolling();
    return;
  }

  try {
    const result = await authApi.getWechatScanStatus(wechatState.value);
    scanStatus.value = result.status;

    if (result.status === 'confirmed' && result.user) {
      stopWechatPolling();
      try {
        const success = await authStore.loginWithWechat(result.user);
        if (success) {
          router.push('/system');
        }
      } catch (err: any) {
        const msg = err?.response?.data?.message || err?.message || t('system.login.scanFailed');
        errorMsg.value = typeof msg === 'string' ? msg : t('system.login.scanFailed');
      }
    }
  } catch (err: any) {
    // 401/400 and similar errors: state invalid, mark as expired
    if (err?.response?.status === 400 || err?.response?.status === 404) {
      scanStatus.value = 'expired';
      stopWechatPolling();
    }
    // Other network errors are silently ignored and retried next round
  }
}

/** Mock mode simulates scan-code confirmation/cancel */
async function handleMockScan(action: 'confirm' | 'cancel') {
  if (!wechatState.value) return;
  try {
    await authApi.wechatMockScan(wechatState.value, action);
    // Immediately trigger one status poll to speed up UI response
    await pollScanStatus();
  } catch (err: any) {
    const msg = err?.response?.data?.message || err?.message || t('system.login.scanFailed');
    errorMsg.value = typeof msg === 'string' ? msg : t('system.login.scanFailed');
  }
}

/** Refresh the QR code (regenerate after expiry/cancel) */
function refreshQrcode() {
  startWechatLogin();
}

// Clean up the polling timer on component unmount
onUnmounted(() => {
  stopWechatPolling();
});

async function handleSubmit() {
  errorMsg.value = '';

  if (!form.username.trim()) {
    errorMsg.value = t('system.login.errorEmptyUsername');
    return;
  }
  if (!form.password) {
    errorMsg.value = t('system.login.errorEmptyPassword');
    return;
  }
  if (isRegister.value) {
    if (!form.email.trim()) {
      errorMsg.value = t('system.login.errorEmptyEmail');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(form.email)) {
      errorMsg.value = t('system.login.errorInvalidEmail');
      return;
    }
    if (form.password.length < 6) {
      errorMsg.value = t('system.login.errorPasswordShort');
      return;
    }
    if (form.username.length < 3) {
      errorMsg.value = t('system.login.errorUsernameShort');
      return;
    }
  }

  try {
    const success = isRegister.value
      ? await authStore.register({
        username: form.username,
        password: form.password,
        email: form.email,
        displayName: form.displayName || undefined,
      })
      : await authStore.login({
        username: form.username,
        password: form.password,
      });

    if (success) {
      const defaultHome = '/system';
      router.push(defaultHome);
    }
  } catch (err: any) {
    const msg = err?.response?.data?.message || err?.message || t('system.login.errorGeneric');
    errorMsg.value = typeof msg === 'string' ? msg : t('system.login.errorGeneric');
  }
}
</script>

<style scoped>
/* ==================== Industrial-style dark background ==================== */
.login-page {
  position: relative;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Background color steps consistent with the system dark theme */
  background:
    radial-gradient(ellipse at top, #0f172a 0%, transparent 60%),
    radial-gradient(ellipse at bottom, #1e293b 0%, transparent 60%),
    #0a0f1a;
  padding: 20px;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.login-background {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 1;
}

/* Precise grid (industrial rigor) */
.grid-pattern {
  position: absolute;
  inset: 0;
  opacity: 0.5;
  animation: gridMove 40s linear infinite;
}

/* Decorative glow (restrained, not overpowering) */
.glow-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(90px);
  animation: orbFloat 12s ease-in-out infinite alternate;
}

.glow-orb-1 {
  width: 400px;
  height: 400px;
  background: radial-gradient(circle, rgba(59,130,246,0.22), transparent 70%);
  top: -10%;
  right: -5%;
  animation-delay: 0s;
}

.glow-orb-2 {
  width: 300px;
  height: 300px;
  background: radial-gradient(circle, rgba(56,189,248,0.12), transparent 70%);
  bottom: -8%;
  left: -5%;
  animation-delay: -6s;
}

/* Geometric decorative line (industrial feel) */
.geo-line {
  position: absolute;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(59,130,246,0.3), transparent);
}

.geo-line-top {
  top: 15%;
  left: 0;
  right: 0;
}

.geo-line-bottom {
  bottom: 15%;
  left: 0;
  right: 0;
}

/* Scan-line animation (industrial rigor) */
.scan-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(59, 130, 246, 0.4) 50%,
    transparent 100%
  );
  animation: scanMove 8s linear infinite;
  opacity: 0.6;
  filter: blur(1px);
}

@keyframes gridMove {
  to {
    transform: translate(-8%, -8%);
  }
}

@keyframes orbFloat {
  0% {
    transform: translate(0, 0) scale(1);
    opacity: 0.5;
  }
  100% {
    transform: translate(20px, -15px) scale(1.05);
    opacity: 0.7;
  }
}

@keyframes scanMove {
  0% {
    top: 0;
    opacity: 0;
  }
  10% {
    opacity: 0.6;
  }
  90% {
    opacity: 0.6;
  }
  100% {
    top: 100%;
    opacity: 0;
  }
}

/* ==================== Login card ==================== */
.login-container {
  position: relative;
  z-index: 10;
  width: 100%;
  max-width: 440px;

  /* Glassmorphism + industrial dark */
  background: rgba(15, 23, 42, 0.78);
  backdrop-filter: blur(28px);
  -webkit-backdrop-filter: blur(28px);

  /* Rigorous thin border */
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-top: 1px solid rgba(59, 130, 246, 0.3);

  box-shadow:
    0 32px 64px rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(255, 255, 255, 0.04) inset,
    0 1px 0 rgba(255, 255, 255, 0.06) inset;

  border-radius: 4px; /* Industrial feel: minimal border radius */
  padding: 40px 40px 28px;

  animation: cardEnter 0.7s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes cardEnter {
  from {
    opacity: 0;
    transform: translateY(24px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* ==================== Four-corner positioning box (industrial rigor) ==================== */
.corner {
  position: absolute;
  width: 14px;
  height: 14px;
  border-color: rgba(59, 130, 246, 0.6);
  border-style: solid;
  border-width: 0;
  z-index: 2;
}

.corner-tl {
  top: -1px;
  left: -1px;
  border-top-width: 2px;
  border-left-width: 2px;
}

.corner-tr {
  top: -1px;
  right: -1px;
  border-top-width: 2px;
  border-right-width: 2px;
}

.corner-bl {
  bottom: -1px;
  left: -1px;
  border-bottom-width: 2px;
  border-left-width: 2px;
}

.corner-br {
  bottom: -1px;
  right: -1px;
  border-bottom-width: 2px;
  border-right-width: 2px;
}

/* ==================== Top technical status bar ==================== */
.tech-status-bar {
  position: absolute;
  top: 14px;
  left: 24px;
  right: 24px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'Courier New', 'Consolas', monospace;
  font-size: 10px;
  font-weight: 600;
  color: rgba(148, 163, 184, 0.7);
  letter-spacing: 1px;
  text-transform: uppercase;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot-online {
  background: #10b981;
  box-shadow: 0 0 6px rgba(16, 185, 129, 0.8);
  animation: statusBlink 2s ease-in-out infinite;
}

@keyframes statusBlink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.status-text {
  color: rgba(16, 185, 129, 0.85);
}

.status-separator {
  color: rgba(148, 163, 184, 0.4);
}

.status-version {
  color: rgba(148, 163, 184, 0.6);
}

/* ==================== Brand header (highlights Logo + title) ==================== */
.login-header {
  text-align: center;
  margin-top: 28px;
  margin-bottom: 32px;
}

/* Logo container: enlarged + multi-layer glow */
.logo-icon {
  position: relative;
  width: 76px;
  height: 76px;
  margin: 0 auto 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.logo-icon img {
  width: 100%;
  height: 100%;
  border-radius: 16px;
  box-shadow:
    0 10px 32px rgba(59, 130, 246, 0.45),
    0 0 0 1px rgba(255, 255, 255, 0.12) inset,
    0 0 24px rgba(59, 130, 246, 0.3);
  position: relative;
  z-index: 3;
}

/* Logo inner glow ring (breathing animation) */
.logo-ring {
  position: absolute;
  inset: -8px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(59,130,246,0.3), transparent 70%);
  filter: blur(10px);
  animation: ringPulse 3s ease-in-out infinite;
  z-index: 1;
}

/* Logo outer rotating ring (industrial rigor) */
.logo-rotating-ring {
  position: absolute;
  inset: -14px;
  border-radius: 50%;
  border: 1px dashed rgba(59, 130, 246, 0.25);
  animation: ringRotate 18s linear infinite;
  z-index: 2;
}

.logo-rotating-ring::before,
.logo-rotating-ring::after {
  content: '';
  position: absolute;
  width: 4px;
  height: 4px;
  background: rgba(59, 130, 246, 0.8);
  border-radius: 50%;
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.8);
}

.logo-rotating-ring::before {
  top: -2px;
  left: 50%;
  transform: translateX(-50%);
}

.logo-rotating-ring::after {
  bottom: -2px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(16, 185, 129, 0.8);
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.8);
}

@keyframes ringPulse {
  0%, 100% {
    opacity: 0.6;
    transform: scale(1);
  }
  50% {
    opacity: 1;
    transform: scale(1.12);
  }
}

@keyframes ringRotate {
  to {
    transform: rotate(360deg);
  }
}

/* Title: prominent and eye-catching */
.login-title {
  font-size: 30px;
  font-weight: 700;
  margin: 0;
  line-height: 1.2;
  /* Brand gradient text (enhanced contrast) */
  background: linear-gradient(135deg, #f8fafc 0%, #93c5fd 60%, #60a5fa 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  letter-spacing: 1px;
  text-shadow: 0 0 40px rgba(59, 130, 246, 0.2);
}

/* Subtitle (tagline) */
.brand-tagline {
  font-size: 11px;
  color: rgba(148, 163, 184, 0.75);
  letter-spacing: 3px;
  text-transform: uppercase;
  margin: 10px 0 0 0;
  font-weight: 500;
  font-family: 'Courier New', 'Consolas', monospace;
}

/* Divider (industrial rigor) */
.header-divider {
  position: relative;
  width: 60px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(59, 130, 246, 0.6), transparent);
  margin: 22px auto 0;
}

.divider-dot {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 5px;
  height: 5px;
  background: rgba(59, 130, 246, 0.9);
  border-radius: 50%;
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.8);
}

/* ==================== Error hint ==================== */
.login-error {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-left: 3px solid rgba(239, 68, 68, 0.7);
  border-radius: 4px;
  color: var(--status-error);
  font-size: 13px;
  padding: 11px 14px;
  margin-bottom: 20px;
}

.error-icon {
  font-size: 15px;
  flex-shrink: 0;
}

.error-fade-enter-active {
  transition: all 0.3s ease;
}
.error-fade-leave-active {
  transition: all 0.2s ease;
}
.error-fade-enter-from,
.error-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* ==================== Form ==================== */
.login-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-label {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  font-weight: 600;
  color: rgba(148, 163, 184, 0.85);
  letter-spacing: 1.2px;
  text-transform: uppercase;
  transition: color 0.2s;
  font-family: 'Courier New', 'Consolas', monospace;
}

.label-icon {
  flex-shrink: 0;
  opacity: 0.7;
}

/* Input box: industrial dark */
.login-form .form-input {
  width: 100%;
  flex: none;
  min-width: auto;
  height: 46px;
  padding: 0 16px;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  font-size: 14px;
  color: var(--text);
  outline: none;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  box-sizing: border-box;
  font-family: inherit;
}

.login-form .form-input::placeholder {
  color: var(--text-secondary);
  opacity: 0.4;
  font-size: 13px;
}

.login-form .form-input:hover:not(:focus) {
  border-color: rgba(255, 255, 255, 0.15);
  background: rgba(15, 23, 42, 0.75);
}

.login-form .form-input:focus {
  border-color: var(--primary);
  background: rgba(15, 23, 42, 0.85);
  box-shadow:
    0 0 0 3px rgba(59, 130, 246, 0.15),
    0 0 12px rgba(59, 130, 246, 0.1),
    0 1px 0 rgba(255, 255, 255, 0.04) inset;
}

.form-group:focus-within .form-label {
  color: var(--primary);
}

.form-group:focus-within .label-icon {
  opacity: 1;
  color: var(--primary);
}

/* Password input container */
.input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.input-wrap .form-input {
  padding-right: 46px;
}

.toggle-password {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  z-index: 2;
  border-radius: 4px;
}

.toggle-password:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.08);
}

.toggle-password:active {
  transform: translateY(-50%) scale(0.92);
}

/* ==================== Login button ==================== */
.login-btn {
  height: 46px;
  margin-top: 6px;
  background: linear-gradient(135deg, var(--primary) 0%, #2563eb 50%, #1d4ed8 100%);
  color: #fff;
  border: none;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 2px;
  text-transform: uppercase;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-family: 'Courier New', 'Consolas', monospace;
}

.login-btn::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    120deg,
    transparent 0%,
    rgba(255, 255, 255, 0.2) 50%,
    transparent 100%
  );
  transform: translateX(-100%);
  transition: transform 0.6s ease;
}

.login-btn::after {
  content: '';
  position: absolute;
  inset: 0;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  pointer-events: none;
}

.login-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow:
    0 8px 24px rgba(59, 130, 246, 0.4),
    0 0 0 1px rgba(255, 255, 255, 0.1) inset;

  &::before {
    transform: translateX(100%);
  }
}

.login-btn:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25);
  transition-duration: 0.1s;
}

.login-btn:disabled {
  background: linear-gradient(135deg, #475569 0%, #334155 100%);
  cursor: not-allowed;
  opacity: 0.6;
  letter-spacing: normal;
}

.btn-text {
  position: relative;
  z-index: 1;
}

.btn-spinner {
  width: 22px;
  height: 22px;
  border: 2.5px solid rgba(255, 255, 255, 0.25);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.65s linear infinite;
  position: relative;
  z-index: 1;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ==================== Bottom ==================== */
.login-footer {
  text-align: center;
  margin-top: 24px;
  font-size: 13px;
  color: var(--text-secondary);
}

.login-footer a {
  color: var(--primary);
  text-decoration: none;
  font-weight: 600;
  transition: all 0.2s;
  display: inline-block;
}

.login-footer a:hover {
  color: #93c5fd;
  transform: translateX(3px);
}

.fade-enter-active,
.fade-leave-active {
  transition: all 0.25s ease;
}
.fade-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* Bottom build info (industrial style) */
.login-build-info {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  font-family: 'Courier New', 'Consolas', monospace;
  font-size: 10px;
  letter-spacing: 0.5px;
  color: rgba(148, 163, 184, 0.4);
}

.build-label {
  color: rgba(148, 163, 184, 0.5);
  font-weight: 600;
}

.build-value {
  color: rgba(148, 163, 184, 0.7);
}

.build-separator {
  color: rgba(148, 163, 184, 0.25);
}

/* ==================== Login method switch ==================== */
.login-mode-switch {
  display: flex;
  gap: 4px;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  padding: 4px;
  margin-bottom: 24px;
}

.mode-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 9px 12px;
  background: transparent;
  border: none;
  border-radius: 3px;
  color: rgba(148, 163, 184, 0.7);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.8px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  font-family: 'Courier New', 'Consolas', monospace;
}

.mode-tab:hover:not(.mode-tab-active) {
  color: rgba(203, 213, 225, 0.9);
  background: rgba(255, 255, 255, 0.04);
}

.mode-tab-active {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.18) 0%, rgba(37, 99, 235, 0.12) 100%);
  color: #93c5fd;
  box-shadow:
    0 0 0 1px rgba(59, 130, 246, 0.3),
    0 1px 0 rgba(255, 255, 255, 0.06) inset;
}

.mode-tab svg {
  flex-shrink: 0;
}

/* ==================== WeChat scan-code panel ==================== */
.wechat-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  margin-bottom: 8px;
}

.qrcode-container {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 280px;
  height: 280px;
  background: #fff;
  border-radius: 6px;
  padding: 12px;
  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.3),
    0 0 0 1px rgba(59, 130, 246, 0.2);
}

/* Loading state */
.qrcode-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  color: rgba(148, 163, 184, 0.8);
  font-size: 13px;
}

.qrcode-loading p {
  margin: 0;
  font-family: 'Courier New', 'Consolas', monospace;
  letter-spacing: 0.5px;
}

.qrcode-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(59, 130, 246, 0.15);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

/* Mock mode placeholder QR code */
.qrcode-mock {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mock-qrcode {
  width: 256px;
  height: 256px;
  background: #fff;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mock-qr-svg {
  border-radius: 4px;
}

/* Real-mode iframe */
.qrcode-real {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.wechat-iframe {
  width: 100%;
  height: 100%;
  border: none;
  border-radius: 4px;
  background: #fff;
}

/* Expired/cancelled mask */
.qrcode-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 6px;
  backdrop-filter: blur(4px);
}

.overlay-text {
  font-size: 14px;
  color: #475569;
  font-weight: 600;
  text-align: center;
}

.refresh-qrcode-btn {
  padding: 8px 20px;
  background: linear-gradient(135deg, var(--primary) 0%, #2563eb 100%);
  color: #fff;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.25s;
  font-family: 'Courier New', 'Consolas', monospace;
  letter-spacing: 0.5px;
}

.refresh-qrcode-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(59, 130, 246, 0.4);
}

/* Scan-code status hint */
.scan-status {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  font-weight: 500;
  padding: 8px 16px;
  border-radius: 4px;
  transition: all 0.3s;
}

.scan-status-pending {
  color: rgba(148, 163, 184, 0.9);
  background: rgba(15, 23, 42, 0.4);
}

.scan-status-scanned {
  color: #fbbf24;
  background: rgba(251, 191, 36, 0.08);
}

.scan-status-confirmed {
  color: #10b981;
  background: rgba(16, 185, 129, 0.08);
}

.scan-status-expired,
.scan-status-cancelled {
  color: #f87171;
  background: rgba(239, 68, 68, 0.08);
}

.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-indicator-pending {
  background: rgba(148, 163, 184, 0.6);
  animation: statusBlink 1.5s ease-in-out infinite;
}

.status-indicator-scanned {
  background: #fbbf24;
  box-shadow: 0 0 6px rgba(251, 191, 36, 0.6);
  animation: statusBlink 1s ease-in-out infinite;
}

.status-indicator-confirmed {
  background: #10b981;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.8);
}

.status-text {
  font-family: 'Courier New', 'Consolas', monospace;
  letter-spacing: 0.3px;
}

/* Mock mode action buttons */
.mock-actions {
  display: flex;
  gap: 10px;
  width: 100%;
}

.mock-btn {
  flex: 1;
  padding: 10px 16px;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.25s;
  font-family: 'Courier New', 'Consolas', monospace;
  letter-spacing: 0.5px;
}

.mock-btn-confirm {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: #fff;
}

.mock-btn-confirm:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(16, 185, 129, 0.4);
}

.mock-btn-cancel {
  background: rgba(15, 23, 42, 0.6);
  color: rgba(148, 163, 184, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.mock-btn-cancel:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #f87171;
  border-color: rgba(239, 68, 68, 0.3);
}

/* Mock mode hint banner */
.mock-banner {
  width: 100%;
  padding: 8px 12px;
  background: rgba(251, 191, 36, 0.08);
  border: 1px solid rgba(251, 191, 36, 0.25);
  border-radius: 4px;
  font-size: 11px;
  color: #fbbf24;
  text-align: center;
  font-family: 'Courier New', 'Consolas', monospace;
  letter-spacing: 0.3px;
  line-height: 1.5;
}

/* ==================== Client download entry ==================== */
.login-client-download {
  display: flex;
  justify-content: center;
  margin-top: 16px;
}

.client-download-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  font-size: 12px;
  font-weight: 500;
  font-family: 'Courier New', 'Consolas', monospace;
  letter-spacing: 0.5px;
  color: rgba(148, 163, 184, 0.7);
  background: rgba(15, 23, 42, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  text-decoration: none;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  cursor: pointer;
}

.client-download-btn:hover {
  color: var(--primary);
  border-color: rgba(59, 130, 246, 0.4);
  background: rgba(59, 130, 246, 0.08);
  box-shadow: 0 0 12px rgba(59, 130, 246, 0.1);
}

.client-download-btn svg {
  flex-shrink: 0;
}

/* ==================== Responsive ==================== */
@media (max-width: 480px) {
  .login-container {
    padding: 32px 24px 24px;
  }

  .login-title {
    font-size: 26px;
  }

  .brand-tagline {
    font-size: 10px;
    letter-spacing: 2px;
  }

  .login-form .form-input {
    height: 44px;
    font-size: 14px;
  }

  .login-btn {
    height: 44px;
    font-size: 13px;
  }

  .logo-icon {
    width: 64px;
    height: 64px;
  }

  .login-build-info {
    flex-wrap: wrap;
    gap: 6px;
    font-size: 9px;
  }

  .wechat-iframe {
    width: 240px;
    height: 240px;
  }

  .mock-qrcode {
    width: 160px;
    height: 160px;
  }
}

/* ==================== Accessibility ==================== */
.login-form .form-input:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.login-btn:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 3px;
}

.login-footer a:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
  border-radius: 2px;
}

/* Reduced-motion preference */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }

  .login-container {
    animation: none;
  }

  .scan-line,
  .logo-rotating-ring,
  .logo-ring,
  .status-dot-online {
    display: none;
  }
}
</style>
