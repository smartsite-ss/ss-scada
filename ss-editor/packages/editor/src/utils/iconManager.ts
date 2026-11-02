// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import {
  Add,
  Remove,
  ArrowUndo,
  ArrowRedo,
  Copy,
  Clipboard,
  Trash,
  Save,
  FolderOpen,
  Download,
  Print,
  Search,
  Settings,
  HelpCircle,
  InformationCircle,
  Warning,
  CheckmarkCircle,
  CloseCircle,
  TimeOutline,
  LocationOutline,
  BarChart,
  PieChart,
  TrendingUp,
  Grid,
  List,
  Layers,
  Eye,
  EyeOff,
  LockOpen,
  LockClosed,
  ColorPalette,
  Text,
  Image,
  Document,
  Square,
  Ellipse,
  Star
} from '@vicons/ionicons5';

// Icon name enum (semantic naming)
export enum IconName {
  // ===== Basic operations =====
  add = 'add',
  remove = 'remove',
  undo = 'undo',
  redo = 'redo',
  copy = 'copy',
  paste = 'paste',
  delete = 'delete',

  // ===== File operations =====
  save = 'save',
  open = 'open',
  download = 'download',
  print = 'print',

  // ===== Search and filter =====
  search = 'search',

  // ===== System settings =====
  settings = 'settings',
  help = 'help',
  info = 'info',
  warning = 'warning',
  success = 'success',
  error = 'error',

  // ===== Data visualization =====
  time = 'time',
  location = 'location',
  chartBar = 'chart-bar',
  chartPie = 'chart-pie',
  trending = 'trending',

  // ===== Layout and view =====
  grid = 'grid',
  list = 'list',
  layers = 'layers',
  visible = 'visible',
  hidden = 'hidden',
  unlock = 'unlock',
  lock = 'lock',

  // ===== Content editing =====
  color = 'color',
  text = 'text',
  image = 'image',

  // ===== Geometric shapes =====
  document = 'document',
  square = 'square',
  ellipse = 'ellipse',
  star = 'star'
}

// Icon mapping table (IconName → ionicons5 components)
const iconMap: Record<IconName, any> = {
  // Basic operations
  [IconName.add]: Add,
  [IconName.remove]: Remove,
  [IconName.undo]: ArrowUndo,
  [IconName.redo]: ArrowRedo,
  [IconName.copy]: Copy,
  [IconName.paste]: Clipboard,
  [IconName.delete]: Trash,

  // File operations
  [IconName.save]: Save,
  [IconName.open]: FolderOpen,
  [IconName.download]: Download,
  [IconName.print]: Print,

  // Search and filter
  [IconName.search]: Search,

  // System settings
  [IconName.settings]: Settings,
  [IconName.help]: HelpCircle,
  [IconName.info]: InformationCircle,
  [IconName.warning]: Warning,
  [IconName.success]: CheckmarkCircle,
  [IconName.error]: CloseCircle,

  // Data visualization
  [IconName.time]: TimeOutline,
  [IconName.location]: LocationOutline,
  [IconName.chartBar]: BarChart,
  [IconName.chartPie]: PieChart,
  [IconName.trending]: TrendingUp,

  // Layout and view
  [IconName.grid]: Grid,
  [IconName.list]: List,
  [IconName.layers]: Layers,
  [IconName.visible]: Eye,
  [IconName.hidden]: EyeOff,
  [IconName.unlock]: LockOpen,
  [IconName.lock]: LockClosed,

  // Content editing
  [IconName.color]: ColorPalette,
  [IconName.text]: Text,
  [IconName.image]: Image,

  // Geometric shapes
  [IconName.document]: Document,
  [IconName.square]: Square,
  [IconName.ellipse]: Ellipse,
  [IconName.star]: Star
};

/**
 * Get an icon component
 * @param iconName Icon name
 * @returns Icon component or null
 */
export function getIcon(iconName: IconName): any | null {
  return iconMap[iconName] || null;
}

/**
 * Get the list of all available icon names
 */
export function getAvailableIcons(): IconName[] {
  return Object.values(IconName);
}

export default {
  IconName,
  getIcon,
  getAvailableIcons
};
