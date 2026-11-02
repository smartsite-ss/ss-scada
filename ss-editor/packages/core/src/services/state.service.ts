// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

// State management service for optimized state updates and management
import * as StorageService from './storage.service';
import { ProjectMigration } from '@scada-editor/plugin-sdk';
import type { SchemaMigration } from '@scada-editor/plugin-sdk';

// State management service
export class StateService {
  private static instance: StateService;
  private graphicStore: any = null;
  private pageStore: any = null;
  private autoSaveInterval: number | null = null;
  private schemaMigrations: Record<string, SchemaMigration[]> = {};
  private inEditMode: boolean = false;

  // Singleton pattern
  public static getInstance(): StateService {
    if (!StateService.instance) {
      StateService.instance = new StateService();
    }
    return StateService.instance;
  }

  // Initialize the state service
  public async init() {
    // Lazily get store instances to ensure Pinia is initialized
    const { useGraphicStore } = await import('../store/graphic.store');
    const { usePageStore } = await import('../store/page.store');
    this.graphicStore = useGraphicStore();
    this.pageStore = usePageStore();

    this.setupAutoSave();
  }

  // Set the edit-mode flag
  public setEditMode(isEdit: boolean) {
    this.inEditMode = isEdit;
  }

  // Get the edit-mode flag
  public getEditMode(): boolean {
    return this.inEditMode;
  }

  // Set up auto-save
  private setupAutoSave() {
    const settings = StorageService.loadSettings();
    if (settings.autoSave) {
      this.startAutoSave(settings.autoSaveInterval || 30000);
    }
  }

  // Start auto-save
  public startAutoSave(interval: number) {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }

    this.autoSaveInterval = window.setInterval(() => {
      this.autoSave();
    }, interval);
  }

  // Stop auto-save
  public stopAutoSave() {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }
  }

  // Check whether stores are initialized
  private checkStoresInitialized() {
    if (!this.graphicStore || !this.pageStore) {
      throw new Error('StateService not initialized. Call init() first.');
    }
  }

  // Auto save
  private autoSave() {
    this.checkStoresInitialized();
    if (!this.inEditMode) return;
    const currentPage = this.pageStore.currentPage;
    if (currentPage) {
      StorageService.saveAutoSave({
        pages: this.pageStore.pages,
        currentPageId: this.pageStore.currentPageId,
      });
    }
  }

  // Save project
  public saveProject(name: string) {
    this.checkStoresInitialized();
    const project = {
      name,
      pages: this.pageStore.pages,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const projects = StorageService.loadProjects();
    projects.push(project);
    StorageService.saveProjects(projects);

    // Clear auto-save
    StorageService.clearAutoSave();

    return project;
  }

  // Load project
  public loadProject(projectIndex: number) {
    this.checkStoresInitialized();
    const projects = StorageService.loadProjects();
    if (projectIndex < 0 || projectIndex >= projects.length) return false;

    const project = projects[projectIndex];
    const migrated = ProjectMigration.migrateProject(project, this.schemaMigrations);
    this.pageStore.pages = migrated.data.pages;
    this.pageStore.currentPageId = migrated?.data?.pages?.[0]?.id || null;

    StorageService.clearAutoSave();

    return true;
  }

  // Delete project
  public deleteProject(projectIndex: number) {
    this.checkStoresInitialized();
    const projects = StorageService.loadProjects();
    if (projectIndex < 0 || projectIndex >= projects.length) return false;

    projects.splice(projectIndex, 1);
    StorageService.saveProjects(projects);

    return true;
  }

  // Save template
  public saveTemplate(name: string) {
    this.checkStoresInitialized();
    if (
      !this.pageStore.currentPage ||
      this.pageStore.currentPage.selectedGraphicIds.length === 0
    )
      return null;

    const template = {
      name,
      graphics: this.graphicStore.selectedGraphics.map((g: any) => g.toJSON()),
      createdAt: new Date().toISOString(),
    };

    const templates = StorageService.loadTemplates();
    templates.push(template);
    StorageService.saveTemplates(templates);

    return template;
  }

  // Apply template
  public async applyTemplate(templateIndex: number) {
    this.checkStoresInitialized();
    const templates = StorageService.loadTemplates();
    if (templateIndex < 0 || templateIndex >= templates.length) return;

    const template = templates[templateIndex];
    if (!this.pageStore.currentPage) return;

    const { GraphicFactory } =
      await import('../graphic-editing/graphic/factory/GraphicFactory');

    template.graphics.forEach((graphicData: any) => {
      const graphic = GraphicFactory.createGraphicFromJSON(graphicData);
      // Offset position to avoid overlap
      const { x, y } = graphic.getPosition();
      graphic.setPosition(x + 20, y + 20);
      this.pageStore.currentPage!.graphics.push(graphic);
    });
  }

  // Batch operation optimization
  public batchOperation(operations: Array<{ type: string; payload: any }>) {
    this.checkStoresInitialized();
    this.graphicStore.startBatchOperation();

    try {
      const currentPage = this.pageStore.currentPage;
      operations.forEach((operation) => {
        switch (operation.type) {
          case 'add':
            this.graphicStore.addGraphic(
              operation.payload.type,
              operation.payload.x,
              operation.payload.y,
              operation.payload.width,
              operation.payload.height
            );
            break;
          case 'update':
            currentPage?.updateGraphic(
              operation.payload.id,
              operation.payload.properties
            );
            break;
          case 'delete':
            currentPage?.removeGraphic(operation.payload);
            break;
          case 'move':
            currentPage?.moveGraphic(
              operation.payload.id,
              operation.payload.x,
              operation.payload.y
            );
            break;
        }
      });
    } finally {
      this.graphicStore.endBatchOperation();
    }
  }

  // Export project
  public exportProject(): string {
    this.checkStoresInitialized();
    const project = {
      pages: this.pageStore.pages,
      exportTime: new Date().toISOString(),
    };

    return JSON.stringify(project, null, 2);
  }

  // Import project
  public importProject(jsonData: string): boolean {
    this.checkStoresInitialized();
    try {
      const project = JSON.parse(jsonData);
      const migrated = ProjectMigration.migrateProject(project, this.schemaMigrations);
      this.pageStore.pages = migrated.data.pages;
      this.pageStore.currentPageId = migrated?.data?.pages?.[0]?.id || null;
      return true;
    } catch (error) {
      console.error('Error importing project:', error);
      return false;
    }
  }

  registerSchemaMigrations(pluginType: string, migrations: SchemaMigration[]): void {
    this.schemaMigrations[pluginType] = migrations;
  }

  getSchemaMigrations(): Record<string, SchemaMigration[]> {
    return { ...this.schemaMigrations };
  }

  // Cleanup state
  public cleanup() {
    this.stopAutoSave();
  }
}

// Export singleton instance
export const stateService = StateService.getInstance();
