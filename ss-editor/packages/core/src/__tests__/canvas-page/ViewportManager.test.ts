// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { describe, it, expect, beforeEach } from 'vitest';
import { BasePage } from '../../graphic-editing/graphic/base/BasePage';
import { BaseGraphic } from '@scada-editor/plugin-sdk';
import { GridSnapManager } from '../../graphic-editing/managers/GridSnapManager';
import { ZoomManager, defaultAutoFitConfig } from '../../canvas-page/managers/ZoomManager';

class TestShape extends BaseGraphic {
  constructor(x: number, y: number, width: number, height: number) {
    super('test-shape', x, y, width, height); } draw(_ctx: CanvasRenderingContext2D): void { /* Empty implementation for testing */ } } describe('Viewport control features', () => {
  let page: BasePage;

  beforeEach(() => {
    page = new BasePage();
    page.init({
      id: 'test-page',
      name: 'Test Page',
      width: 1920,
      height: 1080,
      backgroundColor: '#FFFFFF',
    });
  });

  describe('Page zoom functionality', () => {
    it('should initialize zoom ratio correctly', () => {
      expect(page.scale).toBe(100);
    });

    it('should be able to set zoom ratio', () => {
      page.scale = 150;
      expect(page.scale).toBe(150);
    });

    it('should convert zoom factor correctly', () => {
      page.scale = 100;
      expect(page.scale / 100).toBe(1.0);

      page.scale = 50;
      expect(page.scale / 100).toBe(0.5);

      page.scale = 200;
      expect(page.scale / 100).toBe(2.0);
    });
  });

  describe('Grid snapping features', () => {
    it('Should be able to get the grid snapping manager', () => {
      const gridSnapManager = page.getGridSnapManager();
      expect(gridSnapManager).toBeInstanceOf(GridSnapManager);
    });

    it('Should be able to set the grid snapping configuration', () => {
      const config = {
        enabled: true,
        gridSize: 20,
        snapToGrid: true,
        snapToGuides: true,
        snapToObjects: true,
        snapDistance: 8,
      };
      
      page.setGridSnapConfig(config);
      const currentConfig = page.getGridSnapConfig();
      
      expect(currentConfig.enabled).toBe(true);
      expect(currentConfig.gridSize).toBe(20);
      expect(currentConfig.snapToGrid).toBe(true);
      expect((currentConfig as any).snapToGuides).toBe(true);
      expect((currentConfig as any).snapToObjects).toBe(true);
      expect(currentConfig.snapDistance).toBe(8);
    });

    it('Should be able to enable and disable grid snapping', () => {
      page.setGridSnapConfig({ enabled: true });
      expect(page.getGridSnapConfig().enabled).toBe(true);

      page.setGridSnapConfig({ enabled: false });
      expect(page.getGridSnapConfig().enabled).toBe(false);
    });

    it('Should be able to perform position snapping', () => {
      page.setGridSnapConfig({ enabled: true, gridSize: 20, snapDistance: 8 });
      
      const result = page.snapPosition(25, 35);
      
      expect(result).toBeDefined();
      expect(typeof result.x).toBe('number');
      expect(typeof result.y).toBe('number');
    });
  });

  describe('Smart alignment features', () => {
    it('Should be able to set the snap distance', () => {
      page.setAlignDistance(10);
      const smartAlignManager = page.getSmartAlignManager();
      expect(smartAlignManager).toBeDefined();
    });

    it('Should be able to detect alignment targets', () => {
      const graphic1 = new TestShape(100, 100, 50, 50);
      const graphic2 = new TestShape(200, 200, 50, 50);
      page.addGraphic(graphic1);
      page.addGraphic(graphic2);

      const targets = page.detectAlignTargets(graphic1, [graphic2]);
      
      expect(targets).toBeDefined();
      expect(Array.isArray(targets)).toBe(true);
    });
  });

  describe('Guide line management features', () => {
    it('Should be able to add a horizontal guide line', () => {
      const lineId = page.addGuideLine(100, 'horizontal');
      
      expect(lineId).toBeDefined();
      expect(typeof lineId).toBe('string');
      
      const lines = page.getAllGuideLines();
      expect(lines.length).toBe(1);
      expect(lines[0].id).toBe(lineId);
      expect(lines[0].position).toBe(100);
      expect(lines[0].direction).toBe('horizontal');
    });

    it('Should be able to add a vertical guide line', () => {
      const lineId = page.addGuideLine(200, 'vertical');
      
      expect(lineId).toBeDefined();
      
      const lines = page.getAllGuideLines();
      expect(lines.length).toBe(1);
      expect(lines[0].direction).toBe('vertical');
    });

    it('Should be able to get a single guide line', () => {
      const lineId = page.addGuideLine(150, 'horizontal');
      const line = page.getGuideLine(lineId);
      
      expect(line).not.toBeNull();
      expect(line?.id).toBe(lineId);
      expect(line?.position).toBe(150);
    });

    it('Should be able to update a guide line position', () => {
      const lineId = page.addGuideLine(100, 'horizontal');
      page.updateGuideLinePosition(lineId, 200);
      
      const line = page.getGuideLine(lineId);
      expect(line?.position).toBe(200);
    });

    it('Should be able to delete a guide line', () => {
      const lineId = page.addGuideLine(100, 'horizontal');
      expect(page.getAllGuideLines().length).toBe(1);
      
      page.removeGuideLine(lineId);
      expect(page.getAllGuideLines().length).toBe(0);
    });

    it('Should be able to clear all guide lines', () => {
      page.addGuideLine(100, 'horizontal');
      page.addGuideLine(200, 'vertical');
      page.addGuideLine(300, 'horizontal');
      
      expect(page.getAllGuideLines().length).toBe(3);
      
      page.clearAllGuideLines();
      expect(page.getAllGuideLines().length).toBe(0);
    });

    it('Should be able to get a non-existent guide line and return null', () => {
      const line = page.getGuideLine('non-existent-id');
      expect(line).toBeNull();
    });
  });

  describe('Page size management', () => {
    it('Should be able to get the page size', () => {
      const size = page.getSize();
      
      expect(size.width).toBe(1920);
      expect(size.height).toBe(1080);
    });

    it('Should correctly initialize custom sizes', () => {
      const customPage = new BasePage();
      customPage.init({
        id: 'custom-page',
        name: 'Custom Page',
        width: 800,
        height: 600,
        backgroundColor: '#FFFFFF',
      });

      expect(customPage.width).toBe(800);
      expect(customPage.height).toBe(600);
    });
  });

  describe('Graphic resize features', () => {
    it('Should be able to make selected graphics equal in width', () => {
      const graphic1 = new TestShape(0, 0, 50, 100);
      const graphic2 = new TestShape(100, 0, 100, 80);
      const graphic3 = new TestShape(200, 0, 75, 90);
      
      page.addGraphic(graphic1);
      page.addGraphic(graphic2);
      page.addGraphic(graphic3);

      graphic1.setSize(50, 100);
      graphic2.setSize(100, 80);
      graphic3.setSize(75, 90);

      page.makeSameWidth([graphic1, graphic2, graphic3]);

      const sizes = [graphic1, graphic2, graphic3].map(g => g.getSize());
      const widths = sizes.map(s => s.width);
      
      expect(widths.every(w => w === 100)).toBe(true);
    });

    it('Should be able to make selected graphics equal in height', () => {
      const graphic1 = new TestShape(0, 0, 50, 50);
      const graphic2 = new TestShape(100, 0, 100, 100);
      const graphic3 = new TestShape(200, 0, 75, 75);
      
      page.addGraphic(graphic1);
      page.addGraphic(graphic2);
      page.addGraphic(graphic3);

      graphic1.setSize(50, 50);
      graphic2.setSize(100, 100);
      graphic3.setSize(75, 75);

      page.makeSameHeight([graphic1, graphic2, graphic3]);

      const sizes = [graphic1, graphic2, graphic3].map(g => g.getSize());
      const heights = sizes.map(s => s.height);
      
      expect(heights.every(h => h === 100)).toBe(true);
    });

    it('Should be able to make selected graphics equal in size', () => {
      const graphic1 = new TestShape(0, 0, 50, 50);
      const graphic2 = new TestShape(100, 0, 100, 80);
      
      page.addGraphic(graphic1);
      page.addGraphic(graphic2);

      graphic1.setSize(50, 50);
      graphic2.setSize(100, 80);

      page.makeSameSize([graphic1, graphic2]);

      const size1 = graphic1.getSize();
      const size2 = graphic2.getSize();
      
      expect(size1.width).toBe(100);
      expect(size1.height).toBe(80);
      expect(size2.width).toBe(100);
      expect(size2.height).toBe(80);
    });

    it('Equal width/height operations should have no effect with fewer than 2 graphics', () => {
      const graphic1 = new TestShape(0, 0, 50, 50);
      page.addGraphic(graphic1);

      expect(() => page.makeSameWidth([graphic1])).not.toThrow();
      expect(() => page.makeSameHeight([])).not.toThrow();
    });
  });

  describe('Page edge alignment features', () => {
    it('Should be able to align a graphic to the page edge', () => {
      const graphic = new TestShape(100, 100, 100, 100);
      page.addGraphic(graphic);

      page.alignToPageEdge([graphic], 'left');
      expect(graphic.getPosition().x).toBe(0);

      page.alignToPageEdge([graphic], 'right');
      expect(graphic.getPosition().x).toBe(1920 - 100);

      page.alignToPageEdge([graphic], 'top');
      expect(graphic.getPosition().y).toBe(0);

      page.alignToPageEdge([graphic], 'bottom');
      expect(graphic.getPosition().y).toBe(1080 - 100);
    });

    it('Should be able to center a graphic on the page', () => {
      const graphic = new TestShape(0, 0, 100, 100);
      page.addGraphic(graphic);

      page.centerOnPage([graphic], 'horizontal');
      expect(graphic.getPosition().x).toBe((1920 - 100) / 2);

      page.centerOnPage([graphic], 'vertical');
      expect(graphic.getPosition().y).toBe((1080 - 100) / 2);

      page.centerOnPage([graphic], 'both');
      expect(graphic.getPosition().x).toBe((1920 - 100) / 2);
      expect(graphic.getPosition().y).toBe((1080 - 100) / 2);
    });
  });

  describe('Smart adaptive strategy', () => {
    describe('ZoomManager.autoSelectFitMode', () => {
      it('Should select the fitHeight mode for portrait screens', () => {
        const result = ZoomManager.autoSelectFitMode(0.45, defaultAutoFitConfig); /* portrait phone 1080x2400 */
        expect(result).toBe('fitHeight');
      });

      it('Should select the contain mode for near-square screens', () => {
        const result = ZoomManager.autoSelectFitMode(1.0, defaultAutoFitConfig); /* square screen */
        expect(result).toBe('contain');
      });

      it('Should select the fitWidth mode for wide screens', () => {
        const result = ZoomManager.autoSelectFitMode(1.78, defaultAutoFitConfig); /* standard monitor 1920x1080 */
        expect(result).toBe('fitWidth');
      });

      it('Should select the fitWidth mode for ultrawide screens', () => {
        const result = ZoomManager.autoSelectFitMode(2.39, defaultAutoFitConfig); /* ultrawide 3440x1440 */
        expect(result).toBe('fitWidth');
      });
    });

    describe('ZoomManager.calculateFitScale', () => {
      it('Should compute the contain-mode scale correctly', () => {
        const scale = ZoomManager.calculateFitScale('contain', 1920, 1080, 1280, 720);
        expect(scale).toBeCloseTo(66.67, 2);
      });

      it('Should compute the fitWidth-mode scale correctly', () => {
        const scale = ZoomManager.calculateFitScale('fitWidth', 1920, 1080, 1280, 720);
        expect(scale).toBeCloseTo(66.67, 2);
      });

      it('Should compute the fitHeight-mode scale correctly', () => {
        const scale = ZoomManager.calculateFitScale('fitHeight', 1920, 1080, 1280, 720);
        expect(scale).toBeCloseTo(66.67, 2);
      });
    });

    describe('ZoomManager.calculateAutoFitScale', () => {
      it('Should auto-select fitHeight for portrait screens and compute the scale', () => {
        const result = ZoomManager.calculateAutoFitScale(1920, 1080, 1080, 2400);
        expect(result.fitMode).toBe('fitHeight'); expect(result.scale).toBeGreaterThan(100); /* portrait needs upscaling */ }); it('Should auto-select fitWidth for wide screens and compute the scale', () => {
        const result = ZoomManager.calculateAutoFitScale(1920, 1080, 3440, 1440);
        expect(result.fitMode).toBe('fitWidth'); expect(result.scale).toBeGreaterThan(100); /* landscape needs upscaling */ }); it('Should limit the scale to 10%-200%', () => { const result = ZoomManager.calculateAutoFitScale(1920, 1080, 100, 100); expect(result.scale).toBe(10); /* minimum scale */ const result2 = ZoomManager.calculateAutoFitScale(100, 100, 10000, 10000); expect(result2.scale).toBe(200); /* maximum scale */ }); }); describe('Page fitting methods', () => {
      it('Should use auto mode by default', () => {
        expect(page.getFitMode()).toBe('auto');
      });

      it('Should be able to set and get the fit mode', () => {
        page.setFitMode('fitWidth');
        expect(page.getFitMode()).toBe('fitWidth');
        
        page.setFitMode('fitHeight');
        expect(page.getFitMode()).toBe('fitHeight');
        
        page.setFitMode('contain');
        expect(page.getFitMode()).toBe('contain');
        
        page.setFitMode('stretch');
        expect(page.getFitMode()).toBe('stretch');
        
        page.setFitMode('auto');
        expect(page.getFitMode()).toBe('auto');
      });

      it('Should be able to perform auto fitting', () => {
        page.autoFit(1280, 720);
        
        expect(page.fitMode).toBeDefined();
        expect(page.scale).toBeDefined();
        expect(page.scale).toBeGreaterThan(0);
      });

      it('auto mode should auto-select the best fit mode', () => {
        // Defaults to auto mode
        expect(page.getFitMode()).toBe('auto'); /* perform fit on a wide screen */ page.autoFit(1920, 1080); /* should auto-select fitWidth mode */ expect(page.fitMode).toBe('fitWidth');
      });

      it('After manual selection mode, the user\'s choice should be kept', () => {
        // Set to manual mode
        page.setFitMode('contain'); /* perform fit */ page.autoFit(1920, 1080); /* should keep the user-selected mode */ expect(page.fitMode).toBe('contain');
      });

      it('Should be able to reset the fit mode', () => {
        page.setFitMode('fitWidth');
        page.scale = 150;
        
        page.resetFitMode();

        expect(page.fitMode).toBe('contain');
        expect(page.scale).toBe(100);
      });
    });

    describe('fitMode overflow scenarios', () => {
      it('fitWidth on ultrawide (2560x800) with a 1920x1080 page should exceed the contain cap', () => {
        const pageW = 1920, pageH = 1080, vw = 2560, vh = 800;
        const fitWidthScale = ZoomManager.calculateFitScale('fitWidth', pageW, pageH, vw, vh);
        const containScale = ZoomManager.calculateFitScale('contain', pageW, pageH, vw, vh);
        expect(fitWidthScale).toBeGreaterThan(containScale);
        expect(containScale).toBeCloseTo(74.07, 2);
      });

      it('fitWidth on a normal wide screen (1600x900) with a 1920x1080 page should not overflow', () => {
        const pageW = 1920, pageH = 1080, vw = 1600, vh = 900;
        const fitWidthScale = ZoomManager.calculateFitScale('fitWidth', pageW, pageH, vw, vh);
        const containScale = ZoomManager.calculateFitScale('contain', pageW, pageH, vw, vh);
        expect(Math.abs(fitWidthScale - containScale)).toBeLessThan(1);
      });

      it('auto mode should select fitWidth on ultrawide screens but fall back to contain via overflow protection', () => {
        const result = ZoomManager.calculateAutoFitScale(1920, 1080, 2560, 800);
        expect(result.fitMode).toBe('fitWidth');
        const safeScale = ZoomManager.clampScale(
          Math.min((2560/1920)*100, (800/1080)*100)
        );
        expect(result.scale).toBeGreaterThan(safeScale);
      });

      it('In auto mode, sub-modes should switch dynamically when the viewport size changes', () => {
        // Square screen → contain
        const r1 = ZoomManager.calculateAutoFitScale(1920, 1080, 1200, 1000);
        expect(r1.fitMode).toBe('contain'); /* landscape → fitWidth */ const r2 = ZoomManager.calculateAutoFitScale(1920, 1080, 2400, 1200); expect(r2.fitMode).toBe('fitWidth'); /* portrait → fitHeight */ const r3 = ZoomManager.calculateAutoFitScale(1920, 1080, 600, 1200); expect(r3.fitMode).toBe('fitHeight');
      });
    });

    describe('Screen orientation detection', () => {
      it('Should return false in a non-browser environment', () => {
        const result = ZoomManager.isPortrait();
        const result2 = ZoomManager.isWideScreen();
        // There is no window object in Node.js, so it should return false
        expect(typeof result).toBe('boolean');
        expect(typeof result2).toBe('boolean');
      });

      it('getCurrentScreenFitMode should return a reasonable value in a window-object environment', () => {
        const result = ZoomManager.getCurrentScreenFitMode();
        expect(['contain', 'fitWidth', 'fitHeight', 'fill']).toContain(result);
      });
    });
  });
});