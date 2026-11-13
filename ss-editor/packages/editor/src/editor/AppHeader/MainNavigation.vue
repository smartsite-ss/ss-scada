<template>
  <div
    class="main-navigation"
    :style="themeStyles"
  >
    <!-- Show the first 5 menu items -->
    <div 
      v-for="item in visibleItems" 
      :key="item.id"
      class="nav-item"
      :class="{ active: activeItem === item.id }"
    >
      <!-- Generic component menu -->
      <div
        v-if="item.id === 'general'"
        class="nav-item with-submenu"
      >
        <button
          class="nav-button"
          @click="selectItem(item.id)"
        >
          <span class="nav-icon">{{ item.icon }}</span>
          <span class="nav-text">{{ item.name }}</span>
        </button>
        <!-- Submenu -->
        <div
          v-if="showGeneralSubmenu"
          class="submenu"
        >
          <div class="submenu-header">
            <span>{{ t('menu.graphicCategories') }}</span>
          </div>
          <div class="submenu-content">
            <div class="submenu-categories">
              <button
                v-for="category in graphicCategories"
                :key="category.id"
                class="category-button"
                @click="selectGraphicCategory(category.id)"
              >
                {{ category.name }}
              </button>
            </div>
            <div class="submenu-items">
              <div
                v-for="graphic in selectedCategoryGraphics"
                :key="graphic.type"
                class="submenu-item"
                draggable="true"
                @dragstart="handleGraphicDragStart($event, graphic.type)"
              >
                <span class="submenu-item-icon">{{ getGraphicIcon(graphic.type) }}</span>
                <span class="submenu-item-name">{{ graphic.name }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <!-- Edit menu -->
      <div
        v-else-if="item.id === 'edit'"
        class="nav-item with-submenu"
      >
        <button
          class="nav-button"
          @click="selectItem(item.id)"
        >
          <span class="nav-icon">{{ item.icon }}</span>
          <span class="nav-text">{{ item.name }}</span>
        </button>
        <!-- Edit dropdown menu -->
        <div
          v-if="showEditSubmenu"
          class="submenu edit-submenu"
        >
          <div class="edit-menu-content">
            <button
              class="edit-menu-item"
              @click="handleUndo"
            >
              <span class="edit-menu-icon">↶</span>
              <span class="edit-menu-text">{{ t('menu.undo') }}</span>
              <span class="edit-menu-shortcut">Ctrl+Z</span>
            </button>
            <button
              class="edit-menu-item"
              @click="handleRedo"
            >
              <span class="edit-menu-icon">↷</span>
              <span class="edit-menu-text">{{ t('menu.redo') }}</span>
              <span class="edit-menu-shortcut">Ctrl+Y</span>
            </button>
            <div class="edit-menu-divider" />
            <button
              class="edit-menu-item"
              @click="handleHistory"
            >
              <span class="edit-menu-icon">📋</span>
              <span class="edit-menu-text">{{ t('menu.history') }}</span>
            </button>
            <div class="edit-menu-divider" />
            <button
              class="edit-menu-item"
              @click="handleSelect"
            >
              <span class="edit-menu-icon">📏</span>
              <span class="edit-menu-text">{{ t('menu.select') }}</span>
            </button>
            <div class="edit-menu-divider" />
            <button
              class="edit-menu-item"
              @click="handlePaste"
            >
              <span class="edit-menu-icon">📋</span>
              <span class="edit-menu-text">{{ t('menu.paste') }}</span>
              <span class="edit-menu-shortcut">Ctrl+V</span>
            </button>
          </div>
        </div>
      </div>
      <!-- Other menu items -->
      <button 
        v-else 
        class="nav-button"
        @click="selectItem(item.id)"
      >
        <span class="nav-icon">{{ item.icon }}</span>
        <span class="nav-text">{{ item.name }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { GraphicFactory, i18n } from '@scada-editor/core';
import { useTheme } from '@scada-editor/core';

// Internationalization translation function
const { t } = i18n.global;

// Use theme
const { themeStyles } = useTheme();

// Main navigation area component
// Top-level menu responsible for module switching

// Menu data
const menuItems = [
  { id: 'scene', name: t('menu.scene'), icon: '🎬' },
  { id: 'edit', name: t('menu.edit'), icon: '✏️' },
  { id: 'general', name: t('menu.general'), icon: '🧩', active: true },
  { id: 'components', name: t('menu.components'), icon: '📚' },
  { id: 'design', name: t('menu.design'), icon: '🎯' },
  { id: 'script', name: t('menu.script'), icon: '📜' },
];



// Currently active menu item
const activeItem = ref('general');

// Generic-component submenu state
const showGeneralSubmenu = ref(false);

// Edit-menu submenu state
const showEditSubmenu = ref(false);

// Graphic category
const graphicCategories = [
  { id: 'basic', name: t('menu.graphicCategory.basic') },
  { id: 'system', name: t('menu.graphicCategory.system') },
  { id: 'chart', name: t('menu.graphicCategory.chart') },
  { id: 'form', name: t('menu.graphicCategory.form') },
  { id: 'layout', name: t('menu.graphicCategory.layout') },
  { id: 'container', name: t('menu.graphicCategory.container') },
  { id: 'industrial', name: t('menu.graphicCategory.industrial') },
];


// Selected graphic category
const selectedGraphicCategory = ref('basic');

// Menu items shown (all)
const visibleItems = computed(() => {
  return menuItems;
});

// Compute graphics of the selected category
const selectedCategoryGraphics = computed(() => {
  const graphics = GraphicFactory.getGraphicTypes().filter(
    (graphic) => graphic.category === selectedGraphicCategory.value
  );

  // Add Naive Button
  if (selectedGraphicCategory.value === 'basic') {
    graphics.push({
      type: 'naive-button',
      name: 'Naive按钮',
      category: 'basic',
      version: '0.0.0',
      constructor: GraphicFactory.createGraphic as any,
    });
  }

  return graphics;
});

// Switch generic-component submenu
const toggleGeneralSubmenu = () => {
  showGeneralSubmenu.value = !showGeneralSubmenu.value;
  // Close other menus
  showEditSubmenu.value = false;
};

// Switch edit-menu submenu
const toggleEditSubmenu = () => {
  showEditSubmenu.value = !showEditSubmenu.value;
  // Close other menus
  showGeneralSubmenu.value = false;
};

// Select menu item
const selectItem = (id: string) => {
  activeItem.value = id;
  // If a generic component, switch submenu
  if (id === 'general') {
    toggleGeneralSubmenu();
  } 
  // If editing, switch submenu
  else if (id === 'edit') {
    toggleEditSubmenu();
  } 
  else {
    // Close all menus
    showGeneralSubmenu.value = false;
    showEditSubmenu.value = false;
  }
  // Here you can add route navigation or other logic
};

// Select graphic category
const selectGraphicCategory = (categoryId: string) => {
  selectedGraphicCategory.value = categoryId;
};

// Handle graphic drag start
const handleGraphicDragStart = (event: DragEvent, graphicType: string) => {
  if (event.dataTransfer) {
    event.dataTransfer.setData('text/plain', graphicType);
  }
};

// Get the graphic icon
const getGraphicIcon = (type: string) => {
  // Return the icon corresponding to the graphic type
  const iconMap: Record<string, string> = {
    button: '🔘',
    input: '📝',
    chart: '📊',
    shape: '🔲',
    label: '📄',
    image: '🖼️',
    'naive-button': '🔘',
    checkbox: '☑️',
  };
  return iconMap[type] || '📦';
};

// Handle undo operation
const handleUndo = () => {
  ('Undo operation');
  // Here you can add undo-operation logic
};

// Handle redo operation
const handleRedo = () => {
  ('Redo operation');
  // Here you can add redo-operation logic
};

// Handle history operations
const handleHistory = () => {
  ('History operation');
  // Here you can add history-operation logic
};

// Handle box-select operation
const handleSelect = () => {
  ('Select operation');
  // Here you can add box-select logic
};

// Handle paste operation
const handlePaste = () => {
  ('Paste operation');
  // Here you can add paste-operation logic
};

// Click outside to close the menu
const handleClickOutside = (event: MouseEvent) => {
  const submenus = document.querySelectorAll('.with-submenu');
  
  // Check whether the click is inside any submenu
  let clickInsideSubmenu = false;
  submenus.forEach(submenu => {
    if (submenu.contains(event.target as Node)) {
      clickInsideSubmenu = true;
    }
  });
  
  // Close all submenus
  if (!clickInsideSubmenu) {
    showGeneralSubmenu.value = false;
    showEditSubmenu.value = false;
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
.main-navigation {
  display: flex;
  align-items: center;
  background-color: transparent;
  border: none;
  padding: 0;
  margin: 0 20px;
  position: relative;
  z-index: 1;
}

.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 16px;
  border: none;
  background: none;
  color: var(--header-text);
  cursor: pointer;
  font-size: 12px;
  border-radius: 3px;
  transition: all 0.3s ease;
  white-space: nowrap;
  min-width: 70px;
  position: relative;
  height: 56px;
  box-sizing: border-box;
  justify-content: center;
}

.nav-button {
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
  transition: all 0.3s ease;
  justify-content: center;
}

.nav-item.with-submenu:hover {
  background-color: var(--control-button-hover);
}

.nav-item.with-submenu.active {
  background-color: var(--accent);
  font-weight: bold;
}

.nav-icon {
  font-size: 16px;
  line-height: 1;
}

.nav-text {
  font-size: 12px;
  line-height: 1;
  text-align: center;
}

.nav-item:hover {
  background-color: var(--control-button-hover);
}

.nav-item.active {
  background-color: var(--accent);
  font-weight: bold;
}

/* Collapsed menu style */
.dropdown {
  position: relative;
}

.dropdown-toggle {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 16px;
  border: none;
  background: none;
  color: var(--header-text);
  cursor: pointer;
  font-size: 14px;
  border-radius: 3px;
  transition: all 0.3s ease;
  white-space: nowrap;
  min-width: 80px;
}

.dropdown-toggle:hover {
  background-color: var(--control-button-hover);
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  background-color: var(--surface);
  border-radius: 4px;
  box-shadow: var(--shadow-medium);
  min-width: 120px;
  z-index: 1000;
  margin-top: 8px;
  border: 1px solid var(--border);
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 16px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--text);
  transition: all 0.3s ease;
  text-align: left;
}

.dropdown-item:hover {
  background-color: var(--control-button-hover);
}

.dropdown-item.active {
  background-color: var(--primary);
  color: white;
  font-weight: bold;
}

.dropdown-icon {
  font-size: 16px;
  line-height: 1;
}

.dropdown-text {
  line-height: 1;
}

/* Submenu style */
.submenu {
  position: absolute;
  top: 100%;
  left: 0;
  background-color: var(--surface);
  border-radius: 4px;
  box-shadow: var(--shadow-medium);
  min-width: 400px;
  z-index: 1000;
  margin-top: 8px;
  overflow: hidden;
  border: 1px solid var(--border);
}

.submenu-header {
  padding: 12px 16px;
  background-color: var(--control-button-hover);
  border-bottom: 1px solid var(--border);
  font-weight: bold;
  color: var(--text);
}

.submenu-content {
  padding: 16px;
}

.submenu-categories {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.submenu-categories .category-button {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background-color: var(--control-button-hover);
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
  color: var(--text);
}

.submenu-categories .category-button:hover {
  background-color: var(--primary);
  border-color: var(--primary);
  color: white;
}

.submenu-items {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  max-height: 300px;
  overflow-y: auto;
}

.submenu-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px;
  background-color: var(--control-button-hover);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: grab;
  transition: all 0.2s;
  color: var(--text);
  min-height: 80px;
  justify-content: center;
}

.submenu-item:hover {
  background-color: var(--primary);
  border-color: var(--primary);
  transform: translateY(-2px);
  box-shadow: var(--shadow-small);
  color: white;
}

.submenu-item:active {
  cursor: grabbing;
}

.submenu-item-icon {
  font-size: 24px;
  margin-bottom: 8px;
}

.submenu-item-name {
  font-size: 12px;
  text-align: center;
  color: var(--text);
}

.submenu-item:hover .submenu-item-name {
  color: white;
}

/* Scrollbar style */
.submenu-items::-webkit-scrollbar {
  width: 6px;
}

.submenu-items::-webkit-scrollbar-track {
  background: var(--control-button-hover);
  border-radius: 3px;
}

.submenu-items::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}

.submenu-items::-webkit-scrollbar-thumb:hover {
  background: var(--border-light);
}

/* Edit-menu dropdown style */
.edit-submenu {
  min-width: 200px;
}

.edit-menu-content {
  padding: 8px 0;
}

.edit-menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 8px 16px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--text);
  transition: all 0.2s ease;
  text-align: left;
}

.edit-menu-item:hover {
  background-color: var(--primary);
  color: white;
}

.edit-menu-icon {
  font-size: 16px;
  width: 20px;
  text-align: center;
}

.edit-menu-text {
  flex: 1;
}

.edit-menu-shortcut {
  font-size: 12px;
  color: var(--text-secondary);
  font-family: monospace;
}

.edit-menu-item:hover .edit-menu-shortcut {
  color: rgba(255, 255, 255, 0.8);
}

.edit-menu-divider {
  height: 1px;
  background-color: var(--border);
  margin: 8px 0;
}
</style>
