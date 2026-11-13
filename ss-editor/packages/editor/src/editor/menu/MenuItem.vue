<template>
  <div 
    class="menu-item"
    :class="{ active: isActive, 'with-submenu': hasChildren }"
  >
    <button 
      v-if="item.type === 'normal'"
      class="menu-button"
      @click="handleClick"
    >
      <span class="menu-icon">
        <component v-if="isVNodeIcon" :is="iconComponent" />
        <template v-else>{{ iconComponent }}</template>
      </span>
      <span class="menu-text">{{ $t('menu.' + item.id) }}</span>
    </button>
    
    <div
      v-else-if="item.type === 'dropdown'"
      class="menu-dropdown-container"
    >
      <button
        class="menu-button"
        @click="toggleDropdown"
      >
        <span class="menu-icon">
          <component v-if="isVNodeIcon" :is="iconComponent" />
          <template v-else>{{ iconComponent }}</template>
        </span>
        <span class="menu-text">{{ $t('menu.' + item.id) }}</span>
      </button>
      <MenuDropdown 
        v-if="showDropdown" 
        :items="item.children || []"
        @menu-item-click="handleMenuItemClick"
      />
    </div>
    
    <div
      v-else-if="item.type === 'submenu'"
      class="menu-submenu-container"
    >
      <button
        class="menu-button"
        @click="toggleSubmenu"
      >
        <span class="menu-icon">
          <component v-if="isVNodeIcon" :is="iconComponent" />
          <template v-else>{{ iconComponent }}</template>
        </span>
        <span class="menu-text">{{ $t('menu.' + item.id) }}</span>
      </button>
      <MenuSubmenu 
        v-if="showSubmenu" 
        :menu-id="item.id"
        @menu-item-click="handleMenuItemClick"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { MenuItem as MenuItemType } from '../../config/menu.config';
import MenuDropdown from './MenuDropdown.vue';
import MenuSubmenu from './MenuSubmenu.vue';

interface Props {
  item: MenuItemType;
  activeId: string;
}

const props = defineProps<Props>();
const emit = defineEmits(['menu-item-click', 'menu-activate']);

// Dropdown menu state
const showDropdown = ref(false);
// Submenu state
const showSubmenu = ref(false);

// Whether there is a submenu
const hasChildren = computed(() => {
  return props.item.children && props.item.children.length > 0;
});

// Whether active
const isActive = computed(() => {
  return props.activeId === props.item.id;
});

// Get the icon component
const iconComponent = computed(() => {
  return props.item.icon;
});

// Determine whether an icon is a VNode function (SVG icon)
const isVNodeIcon = computed(() => {
  return typeof props.item.icon === 'function';
});

// Handle menu item click
const handleClick = () => {
  emit('menu-activate', props.item.id);
  emit('menu-item-click', props.item);
};

// Switch dropdown menu
const toggleDropdown = () => {
  showDropdown.value = !showDropdown.value;
  showSubmenu.value = false;
  emit('menu-activate', props.item.id);
};

// Switch submenu
const toggleSubmenu = () => {
  showSubmenu.value = !showSubmenu.value;
  showDropdown.value = false;
  emit('menu-activate', props.item.id);
};

// Handle submenu item click
const handleMenuItemClick = (menuItem: MenuItemType) => {
  emit('menu-item-click', menuItem);
};

// Close the submenu
const closeSubmenu = () => {
  showDropdown.value = false;
  showSubmenu.value = false;
};

// Expose the method to close submenus
defineExpose({
  closeSubmenu
});
</script>

<style scoped>
.menu-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px 12px;
  border: none;
  background: none;
  color: var(--header-text);
  cursor: pointer;
  font-size: 12px;
  border-radius: 3px;
  transition: all 0.2s ease;
  white-space: nowrap;
  min-width: 60px;
  position: relative;
  height: 100%;
  box-sizing: border-box;
  justify-content: center;
}

.menu-button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 0;
  border: none;
  background: none;
  color: var(--header-text);
  cursor: pointer;
  font-size: 12px;
  width: 100%;
  height: 100%;
  transition: all 0.2s ease;
  justify-content: center;
}

.menu-item:hover {
  background-color: rgba(255, 255, 255, 0.2);
}

.menu-item.active {
  background-color: rgba(255, 255, 255, 0.3);
  color: var(--header-text);
  font-weight: 600;
}

.menu-icon {
  font-size: 16px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.menu-icon :deep(svg) {
  width: 16px;
  height: 16px;
}

.menu-text {
  font-size: 12px;
  line-height: 1;
  text-align: center;
}

.menu-dropdown-container,
.menu-submenu-container {
  position: relative;
  width: 100%;
  height: 100%;
}
</style>
