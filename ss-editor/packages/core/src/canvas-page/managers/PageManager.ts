// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com


import { BasePage } from '../../graphic-editing/graphic/base/BasePage';
import { IGraphic } from '@scada-editor/plugin-sdk';
import { InterpageTransferService, ITransferableData } from '../../services/InterpageTransferService';
import { ClipboardManager } from '../../graphic-editing/managers/ClipboardManager';

export interface PageConfig {
    id?: string;
    name?: string;
    width?: number;
    height?: number;
}

export class PageManager {
    private pages: Map<string, BasePage> = new Map();
    private activePageId: string | null = null;
    private transferService: InterpageTransferService;
    private clipboardManager: ClipboardManager;

    constructor() {
        this.transferService = new InterpageTransferService();
        this.clipboardManager = new ClipboardManager();
    }

    // ==================== Page Management ====================

    /**
     * Create a page
     */
    createPage(config: PageConfig = {}): BasePage {
        const id = config.id || `page-${Date.now()}-${this.pages.size}`;
        const page = new BasePage();
        page.init({
            id,
            name: config.name || `Page${this.pages.size + 1}`,
            width: config.width || 1920,
            height: config.height || 1080,
        });

        this.pages.set(id, page);

        // If no active page, set as the first one
        if (!this.activePageId) {
            this.activePageId = id;
        }

        return page;
    }

    /**
     * Remove a page
     */
    removePage(pageId: string): void {
        if (this.pages.has(pageId)) {
            this.pages.delete(pageId);

            // If the removed page is the active one, switch to another page
            if (this.activePageId === pageId) {
                const remainingPages = Array.from(this.pages.keys());
                this.activePageId = remainingPages.length > 0 ? remainingPages[0] : null;
            }
        }
    }

    /**
     * Get a page
     */
    getPage(pageId: string): BasePage | null {
        return this.pages.get(pageId) || null;
    }

    /**
     * Get the active page
     */
    getActivePage(): BasePage | null {
        return this.activePageId ? this.getPage(this.activePageId) : null;
    }

    /**
     * Set the active page
     */
    setActivePage(pageId: string): boolean {
        if (this.pages.has(pageId)) {
            this.activePageId = pageId;
            return true;
        }
        return false;
    }

    /**
     * Get all pages
     */
    getAllPages(): BasePage[] {
        return Array.from(this.pages.values());
    }

    /**
     * Get the page count
     */
    get pageCount(): number {
        return this.pages.size;
    }

    // ==================== Cross-page Graphic Operations ====================

    /**
     * Copy graphics between pages
     */
    copyBetweenPages(
        graphicIds: string[],
        fromPageId: string,
        toPageId: string
    ): IGraphic[] {
        const fromPage = this.getPage(fromPageId);
        const toPage = this.getPage(toPageId);

        if (!fromPage || !toPage) {
            return [];
        }

        // Get the source graphic list
        const sourceGraphics = graphicIds
            .map(id => fromPage.getGraphicById(id))
            .filter(g => g !== null) as IGraphic[];

        if (sourceGraphics.length === 0) {
            return [];
        }

        // Serialize and transform
        const serialized = this.transferService.serializeGraphics(sourceGraphics);

        // Get existing IDs of the target page
        const existingIds = toPage.getGraphics().map(g => g.id);

        // Rebuild and add to the target page
        const newGraphics = serialized.map(data => {
            data.id = this.transferService.generateNewId(existingIds);
            existingIds.push(data.id);
            return this.transferService.deserializeGraphic(data);
        });

        // Add to the target page
        newGraphics.forEach(g => toPage.addGraphic(g));

        return newGraphics;
    }

    /**
     * Move graphics between pages
     */
    moveBetweenPages(
        graphicIds: string[],
        fromPageId: string,
        toPageId: string
    ): IGraphic[] {
        // 1. Copy to the target page
        const copiedGraphics = this.copyBetweenPages(graphicIds, fromPageId, toPageId);

        // 2. Remove from the source page
        const fromPage = this.getPage(fromPageId);
        if (fromPage) {
            graphicIds.forEach(id => fromPage.removeGraphic(id));
        }

        return copiedGraphics;
    }

    // ==================== Clipboard Functionality ====================

    /**
     * Copy to clipboard
     */
    copyToClipboard(pageId: string, graphicIds: string[]): void {
        const page = this.getPage(pageId);
        if (!page) return;

        const graphics = graphicIds
            .map(id => page.getGraphicById(id))
            .filter(g => g !== null) as IGraphic[];

        const serialized = this.transferService.serializeGraphics(graphics);
        this.clipboardManager.setData(serialized, 'copy', pageId);
    }

    /**
     * Cut to clipboard
     */
    cutToClipboard(pageId: string, graphicIds: string[]): void {
        const page = this.getPage(pageId);
        if (!page) return;

        const graphics = graphicIds
            .map(id => page.getGraphicById(id))
            .filter(g => g !== null) as IGraphic[];

        const serialized = this.transferService.serializeGraphics(graphics);
        this.clipboardManager.setData(serialized, 'cut', pageId);
    }

    /**
     * Paste from clipboard
     */
    pasteFromClipboard(pageId: string): IGraphic[] {
        const page = this.getPage(pageId);
        if (!page) return [];

        const data = this.clipboardManager.getData();
        if (data.length === 0) return [];

        const existingIds = page.getGraphics().map(g => g.id);
        const pasteCount = this.clipboardManager.getPasteCount();

        // Rebuild and reassign IDs
        const newGraphics = data.map((d: ITransferableData) => {
            d.id = this.transferService.generateNewId(existingIds);
            existingIds.push(d.id);
            return this.transferService.deserializeGraphic(d);
        });

        // Compute cumulative offset position (each paste adds 20px)
        const totalOffsetX = 20 * (pasteCount + 1);
        const totalOffsetY = 20 * (pasteCount + 1);

        // Apply offset to the pasted graphics
        newGraphics.forEach((g, index) => {
            this.transferService.transformCoordinates(g, totalOffsetX + index * 5, totalOffsetY + index * 5);
        });

        // Add to the page
        newGraphics.forEach(g => page.addGraphic(g));

        // Clear the original selection first, then select the newly pasted graphics
        page.clearSelection();
        const newIds = newGraphics.map((g) => g.id);
        page.selectMultipleGraphics(newIds);

        // Increment the paste count
        this.clipboardManager.incrementPasteCount();

        // If it is a cut, clear the clipboard
        if (this.clipboardManager.getClipboardMode() === 'cut') {
            this.clipboardManager.clearData();
        }

        return newGraphics;
    }

    /**
     * Clear the clipboard
     */
    clearClipboard(): void {
        this.clipboardManager.clearData();
    }

    /**
     * Get the clipboard manager
     */
    getClipboardManager(): ClipboardManager {
        return this.clipboardManager;
    }

    /**
     * Get the transfer service
     */
    getTransferService(): InterpageTransferService {
        return this.transferService;
    }
}
