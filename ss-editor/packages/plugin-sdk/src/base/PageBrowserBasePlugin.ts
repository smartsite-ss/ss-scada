// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type { Component, App } from 'vue';
// @ts-expect-error - uuid is a peer dependency
import { v4 as uuidv4 } from 'uuid';

/**
 * PageBrowserBasePlugin - Page browser graphic base class
 *
 * Follows the mount() pattern of VueComponentPlugin, mounting the PageBrowser control by creating a Vue App.
 * The plugin only passes in geometry (position/size) and configuration (pageName, displayMode, etc.);
 * the control internally handles page data loading and multi-backend rendering on its own.
 *
 * Architecture layers:
 *   plugin-sdk (base class) → editor (PageBrowser.vue control) → plugins (concrete implementations)
 */
export abstract class PageBrowserBasePlugin<TProps extends Record<string, any> = Record<string, any>> {
  readonly type: string;
  id: string;
  version?: string;

  /** Component name (used by VueComponentsContainer for recognition and GraphicFactory prefix concatenation) */
  readonly componentName = 'page-browser';

  /** Default width/height (used by GraphicFactory) */
  static defaultWidth = 400;
  static defaultHeight = 300;

  /** Graphic config (compatible with BaseGraphic's JSON serialization structure) */
  config: {
    id: string;
    type: string;
    name: string;
    geometry: { x: number; y: number; width: number; height: number; rotation: number; scale: number };
    style: Record<string, any>;
    isGroup: boolean;
    groupId: string | null;
    groupMembers: string[];
    customProps: Record<string, any>;
    locked: boolean;
    visible: boolean;
    disabled: boolean;
    zIndex: number;
    createdAt: number;
    updatedAt: number;
  };

  private _props!: TProps;
  private _app: App | null = null;
  private _mountPoint: HTMLDivElement | null = null;

  protected _x: number;
  protected _y: number;
  protected _width: number;
  protected _height: number;

  constructor(type: string, x = 0, y = 0, width = 400, height = 300) {
    this.type = type;
    this.id = uuidv4();
    this.version = '1.0';
    this._x = x;
    this._y = y;
    this._width = width;
    this._height = height;

    this.config = {
      id: this.id,
      type,
      name: type,
      geometry: { x, y, width, height, rotation: 0, scale: 1 },
      style: {},
      isGroup: false,
      groupId: null,
      groupMembers: [],
      customProps: {},
      locked: false,
      visible: true,
      disabled: false,
      zIndex: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  get pluginProps(): Readonly<TProps> {
    return this._props;
  }

  setDefaultProps(props: TProps): void {
    this._props = { ...props };
    // Sync to config.customProps to ensure persistence
    this.config.customProps = { ...props };
  }

  protected setPluginProps(partial: Partial<TProps>): void {
    const keys = Object.keys(partial) as Array<keyof TProps>;
    for (const k of keys) {
      (this._props as Record<string, any>)[k as string] = partial[k];
      // Sync to config.customProps so property panel changes are persisted
      this.config.customProps[k as string] = partial[k];
    }
    if (this._mountPoint) {
      (this._mountPoint as any).__pluginProps = { ...this._props };
    }
  }

  getSize(): { width: number; height: number } {
    return { width: this._width, height: this._height };
  }

  /** Get the graphic position (compatible with BaseGraphic interaction interface) */
  getPosition(): { x: number; y: number } {
    return { x: this._x, y: this._y };
  }

  /** Set the graphic position (compatible with BaseGraphic interaction interface) */
  setPosition(x: number, y: number): void {
    this._x = x;
    this._y = y;
    this.config.geometry.x = x;
    this.config.geometry.y = y;
    this.config.updatedAt = Date.now();
  }

  /** Set the graphic size (compatible with BaseGraphic interaction interface) */
  setSize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    this.config.geometry.width = width;
    this.config.geometry.height = height;
    this.config.updatedAt = Date.now();
  }

  /** Determine whether a point is inside the graphic (compatible with BaseGraphic interaction interface) */
  containsPoint(x: number, y: number): boolean {
    const g = this.config.geometry;
    if (!g) return false;
    return x >= g.x && x <= g.x + g.width && y >= g.y && y <= g.y + g.height;
  }

  /** Determine whether a region intersects the graphic (compatible with BaseGraphic rubber-band selection interface) */
  intersectsRegion(x: number, y: number, width: number, height: number): boolean {
    const g = this.config.geometry;
    if (!g) return false;
    return g.x < x + width && g.x + g.width > x && g.y < y + height && g.y + g.height > y;
  }

  /** Get the lock state (compatible with BaseGraphic interaction interface) */
  getLocked(): boolean {
    return this.config.locked;
  }

  /** Get visibility (compatible with BaseGraphic interaction interface) */
  getVisible(): boolean {
    return this.config.visible;
  }

  /** Get the rotation angle (compatible with BaseGraphic interaction interface) */
  getRotation(): number {
    return this.config.geometry.rotation;
  }

  /** Get the z-order (compatible with BaseGraphic interaction interface) */
  getZIndex(): number {
    return this.config.zIndex;
  }

  /** Set the lock state (compatible with BaseGraphic interaction interface) */
  setLocked(v: boolean): void {
    this.config.locked = v;
  }

  /** Set visibility (compatible with BaseGraphic interaction interface) */
  setVisible(v: boolean): void {
    this.config.visible = v;
  }

  /** Inject page context (compatible with BaseGraphic interface) */
  _setPageContext(_ctx: any): void {
    // PageBrowser does not need page context, empty implementation
  }

  updateGeometry(x: number, y: number, w: number, h: number): void {
    this._x = x;
    this._y = y;
    this._width = w;
    this._height = h;
    if (this._mountPoint) {
      this._mountPoint.style.left = `${x}px`;
      this._mountPoint.style.top = `${y}px`;
      this._mountPoint.style.width = `${w}px`;
      this._mountPoint.style.height = `${h}px`;
      (this._mountPoint as any).__pluginWidth = w;
      (this._mountPoint as any).__pluginHeight = h;
    }
  }

  async mount(container: HTMLElement): Promise<void> {
    const { createApp, h, reactive } = await import('vue');

    this._mountPoint = document.createElement('div');
    this._mountPoint.className = 'ss-plugin-page-browser';
    this._mountPoint.style.position = 'absolute';
    this._mountPoint.style.left = `${this._x}px`;
    this._mountPoint.style.top = `${this._y}px`;
    this._mountPoint.style.width = `${this._width}px`;
    this._mountPoint.style.height = `${this._height}px`;
    this._mountPoint.style.overflow = 'hidden';
    (this._mountPoint as any).__pluginProps = { ...this._props };
    (this._mountPoint as any).__pluginWidth = this._width;
    (this._mountPoint as any).__pluginHeight = this._height;

    const component = this.getComponent();

    // Reactive sizing: automatically adjusts after page data loads so the selection box matches the actual content
    const dynamicSize = reactive({ width: this._width, height: this._height });

    this._app = createApp({
      render() {
        const el = this.$el?.parentElement as any;
        const props = el?.__pluginProps || {};
        return h(component, {
          pageName: props.pageName,
          displayMode: props.displayMode || 'stretch',
          borderStyle: props.borderStyle || 'solid',
          borderWidth: props.borderWidth ?? 1,
          borderColor: props.borderColor || '#CCCCCC',
          backgroundColor: props.backgroundColor || '#FFFFFF',
          width: dynamicSize.width,
          height: dynamicSize.height,
          onPageLoaded: (pageWidth: number, pageHeight: number) => {
            // Automatically adjust the PageBrowser size to the target page size
            dynamicSize.width = pageWidth;
            dynamicSize.height = pageHeight;
            this.updateGeometry(this._x, this._y, pageWidth, pageHeight);
          },
        });
      },
    });

    container.appendChild(this._mountPoint);
    this._app.mount(this._mountPoint);
  }

  unmount(): void {
    if (this._app) {
      this._app.unmount();
      this._app = null;
    }
    if (this._mountPoint) {
      this._mountPoint.remove();
      this._mountPoint = null;
    }
  }

  update(props: any): void {
    // The props passed in by PropertyPanel contain the full structure of config/events/dataSource/animation,
    // customProps must be extracted from them to update PageBrowser-specific properties
    if (props.config?.customProps) {
      this.setPluginProps(props.config.customProps);
    } else {
      this.setPluginProps(props as Partial<TProps>);
    }
  }

  getComponentProps(): Record<string, any> {
    // Prefer reading from config.customProps (the property panel modifies this object directly),
    // fall back to _props (compatible with the mount() path)
    const cp = this.config.customProps || {};
    const p = this._props || {};
    return {
      pageName: cp.pageName ?? p.pageName,
      displayMode: cp.displayMode || p.displayMode || 'stretch',
      borderStyle: cp.borderStyle || p.borderStyle || 'solid',
      borderWidth: cp.borderWidth ?? p.borderWidth ?? 1,
      borderColor: cp.borderColor || p.borderColor || '#CCCCCC',
      backgroundColor: cp.backgroundColor || p.backgroundColor || '#FFFFFF',
      width: this._width,
      height: this._height,
    };
  }

  getDomElement(): HTMLElement | null {
    return this._mountPoint;
  }

  onMounted(): void {}
  onUnmounted(): void {}
  onPropertyChanged(_changes: Record<string, any>): void {}

  /** Subclass implementation: return the PageBrowser.vue control */
  abstract getComponent(): Component;

  /** Deserialize the graphic state from JSON (compatible with BaseGraphic.fromJSON) */
  fromJSON(data: any): void {
    if (data.version) this.version = data.version;

    if (data.config) {
      this.config = this._deepClone(data.config);
      this.config.id = this.id;
      // Sync customProps to _props
      if (this.config.customProps) {
        this._props = { ...this._props, ...this.config.customProps } as TProps;
      }
      // Sync geometry
      if (this.config.geometry) {
        this._x = this.config.geometry.x;
        this._y = this.config.geometry.y;
        this._width = this.config.geometry.width;
        this._height = this.config.geometry.height;
      }
    }

    this.id = this.config.id;
  }

  /** Serialize to JSON (compatible with BaseGraphic.toJSON) */
  toJSON(): any {
    const result: any = {
      id: this.id,
      type: this.type,
      version: this.version || '1.0',
      config: {
        id: this.config.id,
        type: this.config.type,
        name: this.config.name,
        geometry: this.config.geometry ? { ...this.config.geometry } : undefined,
        style: this.config.style ? { ...this.config.style } : undefined,
        isGroup: this.config.isGroup,
        groupId: this.config.groupId,
        groupMembers: this.config.groupMembers ? [...this.config.groupMembers] : [],
        customProps: this.config.customProps ? this._deepClone(this.config.customProps) : undefined,
        locked: this.config.locked,
        visible: this.config.visible,
        disabled: this.config.disabled,
        zIndex: this.config.zIndex,
        createdAt: this.config.createdAt,
        updatedAt: this.config.updatedAt,
      },
    };
    Object.keys(result.config).forEach(key => {
      if (result.config[key] === undefined) delete result.config[key];
    });
    return result;
  }

  private _deepClone(obj: any, visited = new WeakMap()): any {
    if (obj === null || typeof obj !== 'object') return obj;
    if (visited.has(obj)) return undefined;
    visited.set(obj, true);
    if (obj instanceof Date) return new Date(obj.getTime());
    if (Array.isArray(obj)) return obj.map((item) => this._deepClone(item, visited));
    const cloned: any = {};
    for (const key in obj) {
      if (key === 'target' || !Object.prototype.hasOwnProperty.call(obj, key)) continue;
      const val = this._deepClone(obj[key], visited);
      if (val !== undefined) cloned[key] = val;
    }
    return cloned;
  }
}