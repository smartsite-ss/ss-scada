<template>
  <div class="app-header">
    <!-- Brand/Logo area -->
    <BrandLogo />
    
    <!-- Main navigation area -->
    <MenuContainer
      @save="emit('save')"
      @open-project="emit('open-project')"
      @close-project="emit('close-project')"
      @export-project="emit('export-project')"
      @import-project="emit('import-project')"
    />
    
    <!-- Right-side area -->
    <div class="header-right">
      <!-- Global toolbar area -->
      <GlobalTools @open-settings="emit('open-settings')" />
      
      <!-- User info area -->
      <UserInfo />
    </div>
  </div>
</template>

<script setup lang="ts">
import BrandLogo from './BrandLogo.vue';
import MenuContainer from '../menu/MenuContainer.vue';
import GlobalTools from './GlobalTools.vue';
import UserInfo from './UserInfo.vue';

const emit = defineEmits<{
  (e: 'open-settings'): void;
  (e: 'save'): void;
  (e: 'open-project'): void;
  (e: 'close-project'): void;
  (e: 'export-project'): void;
  (e: 'import-project'): void;
}>();
</script>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  background-color: var(--header-background);
  color: var(--header-text);
  box-shadow: var(--shadow-small);
  height: 60px;
  width: 100%;
}

.header-right {
  display: flex;
  align-items: center;
  margin-left: auto;
}
</style>
