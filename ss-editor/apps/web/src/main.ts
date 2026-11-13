// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { i18n, themeManager, BindingManager, useGraphicStore, ScadaDataManager, SqlQueryDriver } from '@scada-editor/core';
import '@scada-editor/core/canvas-page/theme/styles/theme.css';
import '@scada-editor/system/theme/system.css';
import App from './App.vue';
import router from './router';

import { registerBundledPlugins, registerDirectoryPlugins, markPluginsReady } from './plugins';


import { setDebugSkipAuth, useWsStore, useAuthStore, vPermission, WebSocketDriver } from '@scada-editor/system';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
//The i18n exported by core narrows the type to avoid TS2589 (see locales facade). It is still a real vue-i18n instance at runtime.
app.use(i18n as unknown as Parameters<typeof app.use>[0]);
app.directive('permission', vPermission);

//── Unified Scheduling of Data Sources: Registering the Driver Factory with DataSourceManager ──
//tag/websocket → WebSocketDriver; sql → SqlQueryDriver; api/polling/static/expression has been registered internally in DriverRegistry
ScadaDataManager.init({
  tag: () => new WebSocketDriver(),
  websocket: () => new WebSocketDriver(),
  sql: () => new SqlQueryDriver(),
});

//── Unified Scheduling of Data Sources: BindingManager Integration with EventBus ──
BindingManager.setEventBus(ScadaDataManager.eventBus);

//Inject tag subscription handler to decouple the circular dependency between core and system
const wsStore = useWsStore();
BindingManager.setTagHandler({
  subscribeTags: (tagIds: string[]) => wsStore.subscribeTags(tagIds),
  unsubscribeTags: (tagIds: string[]) => wsStore.unsubscribeTags(tagIds),
});

//Inject the GraphicStore accessor to decouple the circular dependency between BindingManager and graphic.store
const graphicStore = useGraphicStore();
BindingManager.setGraphicStore({
  applyProperty: (graphicId: string, propertyPath: string, value: any) =>
    graphicStore.applyProperty(graphicId, propertyPath, value),
  applyQualityIndicator: (graphicId: string, quality: string) =>
    graphicStore.applyQualityIndicator(graphicId, quality),
  bindData: (graphicId: string, dataSource: string, dataField: string) =>
    graphicStore.bindData(graphicId, dataSource, dataField),
  unbindData: (graphicId: string) =>
    graphicStore.unbindData(graphicId),
  getGraphicInstance: (graphicId: string) => {
    const graphic = graphicStore.getGraphicById(graphicId) as any;
    if (graphic && typeof graphic.onDataInput === 'function') {
      return graphic;
    }
    return undefined;
  },
});

registerBundledPlugins(app, i18n);

// Lazy load directory plugins only when navigating to editor or preview routes,
// avoiding 99+ unnecessary network requests on /login and /system pages.
// The auth guard (registered in router/index.ts) runs first and may redirect to
// /login if unauthenticated — this guard only executes after auth passes.
let dirPluginsLoaded = false;
router.beforeEach(async (to, _from, next) => {
  if (!dirPluginsLoaded && (to.path.startsWith('/editor') || to.name === 'preview')) {
    dirPluginsLoaded = true;
    const preloadCategories = import.meta.env.VITE_PLUGIN_PRELOAD_CATEGORIES?.split(',').filter(Boolean) || [];
    if (preloadCategories.length > 0) {
      try {
        await registerDirectoryPlugins(app, i18n, preloadCategories);
        markPluginsReady();
      } catch (err) {
        console.error('❌ Directory plugin load failed:', err);
        markPluginsReady();
      }
    } else {
      markPluginsReady();
    }
  }
  next();
});

//Debug Mode: Skip authentication only when VITE_DEBUG_SKIP_AUTH=true
//⚠️  debug-mock-token is only recognized in the backend NODE_ENV !== 'production' (see jwt-auth.guard.ts isDevMode())
//The production build must never set VITE_DEBUG_SKIP_AUTH to true, otherwise the front end will skip login but the back end will reject the mock token → all APIs will return 401.
//In development mode, this environment variable is defined in .env.development (--mode development loaded)
const debugSkipAuth = import.meta.env.VITE_DEBUG_SKIP_AUTH === 'true';
if (debugSkipAuth) {
  setDebugSkipAuth(true);

  //S-C03: In debug mode, the token is only stored in memory (consistent with the HttpOnly Cookie mode)
  //No longer writes to localStorage to avoid XSS risks and state inconsistencies
  //initDebugSession internally calls setToken(debugToken) to write to memory and populate user to enable menu filtering.
  const authStore = useAuthStore();
  authStore.initDebugSession();
}

//Use Editor Routing
app.use(router);

//Ensure that the theme is applied to the DOM
themeManager.applyThemeToDOM();

app.mount('#app');
