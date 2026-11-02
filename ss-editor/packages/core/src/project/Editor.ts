// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Project } from './Project';
import { BasePage } from '../graphic-editing/graphic/base/BasePage';
import { IGraphic } from '@scada-editor/plugin-sdk';

/**
 * Editor is the project entry class providing convenient API access
 */
export class Editor {
    private project: Project;

    constructor(projectConfig?: { id?: string; name?: string }) {
        this.project = new Project(projectConfig);
    }

    // ==================== Project access ====================

    getProject(): Project {
        return this.project;
    }

    // ==================== Page management (shortcut methods) ====================

    createPage(config?: { id?: string; name?: string; width?: number; height?: number }): BasePage {
        return this.project.createPage(config);
    }

    removePage(pageId: string): void {
        this.project.removePage(pageId);
    }

    getPage(pageId: string): BasePage | null {
        return this.project.getPage(pageId);
    }

    getActivePage(): BasePage | null {
        return this.project.getActivePage();
    }

    setActivePage(pageId: string): boolean {
        return this.project.setActivePage(pageId);
    }

    getAllPages(): BasePage[] {
        return this.project.getAllPages();
    }

    // ==================== Cross-page operations (shortcut methods) ====================

    copyToPage(graphicIds: string[], targetPageId: string): IGraphic[] {
        const activePage = this.getActivePage();
        if (!activePage) return [];
        return this.project.copyBetweenPages(graphicIds, activePage.id, targetPageId);
    }

    moveToPage(graphicIds: string[], targetPageId: string): IGraphic[] {
        const activePage = this.getActivePage();
        if (!activePage) return [];
        return this.project.moveBetweenPages(graphicIds, activePage.id, targetPageId);
    }

    copyToClipboard(graphicIds: string[]): void {
        const activePage = this.getActivePage();
        if (activePage) {
            this.project.copyToClipboard(activePage.id, graphicIds);
        }
    }

    cutToClipboard(graphicIds: string[]): void {
        const activePage = this.getActivePage();
        if (activePage) {
            this.project.cutToClipboard(activePage.id, graphicIds);
        }
    }

    pasteFromClipboard(): IGraphic[] {
        const activePage = this.getActivePage();
        if (activePage) {
            return this.project.pasteFromClipboard(activePage.id);
        }
        return [];
    }
}
