<template>
  <div class="menu-container">
    <!-- Show all menu items -->
    <MenuItem 
      v-for="item in menuConfig" 
      :key="item.id"
      ref="menuItems"
      :item="item"
      :active-id="activeItem"
      @menu-item-click="handleMenuItemClick"
      @menu-activate="handleMenuActivate"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { menuConfig, MenuItem as MenuItemType } from '../../config/menu.config';
import { useGraphic } from '../../composables/useGraphic';
import MenuItem from './MenuItem.vue';

// Get the unified graphic operation methods
const {
  undo,
  redo,
  pasteGraphics
} = useGraphic();

// Define the event emitter
const emit = defineEmits<{
  (e: 'undo'): void;
  (e: 'redo'): void;
  (e: 'paste'): void;
  (e: 'history'): void;
  (e: 'select'): void;
  (e: 'save'): void;
  (e: 'open-project'): void;
  (e: 'close-project'): void;
  (e: 'export-project'): void;
  (e: 'import-project'): void;
}>();

// Currently active menu item
const activeItem = ref('general');

// Menu item reference
const menuItems = ref<InstanceType<typeof MenuItem>[]>([]);

// Handle menu item click
const handleMenuItemClick = (menuItem: MenuItemType) => {
  
  
  // Handle menu item action
  if (menuItem.action) {
    handleAction(menuItem.action);
  }
};

// Handle menu activation
const handleMenuActivate = (menuId: string) => {
  activeItem.value = menuId;
};

// Handle menu item action
const handleAction = (action: string) => {
  switch (action) {
    case 'undo':
      undo();
      emit('undo');
      break;
    case 'redo':
      redo();
      emit('redo');
      break;
    case 'history':
      emit('history');
      break;
    case 'select':
      emit('select');
      break;
    case 'paste':
      pasteGraphics();
      emit('paste');
      break;
    case 'save':
      emit('save');
      break;
    case 'open-project':
      emit('open-project');
      break;
    case 'close-project':
      emit('close-project');
      break;
    case 'export-project':
      emit('export-project');
      break;
    case 'import-project':
      emit('import-project');
      break;
    default:
    
  }
};

// Click outside to close the menu
const handleClickOutside = (event: MouseEvent) => {
  const menuItemsElements = document.querySelectorAll('.menu-item');
  
  // Check whether the click is inside a menu item
  let clickInsideMenuItem = false;
  menuItemsElements.forEach(item => {
    if (item.contains(event.target as Node)) {
      clickInsideMenuItem = true;
    }
  });
  
  // If the click is outside a menu item, close all submenus
  if (!clickInsideMenuItem) {
    // Close all submenus
    menuItems.value.forEach(item => {
      if (item.closeSubmenu) {
        item.closeSubmenu();
      }
    });
  }
};

// Add the click-outside-to-close-menu event listener
onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

// Remove event listeners
onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>

<style scoped>
.menu-container {
  display: flex;
  align-items: center;
  background-color: transparent;
  border: none;
  padding: 0;
  margin: 0 20px;
  position: relative;
  height: 44px;
  box-sizing: border-box;
}
</style>
