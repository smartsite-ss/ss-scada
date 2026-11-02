// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com


import { IGraphic } from '@scada-editor/plugin-sdk';

export type AlignmentType = 'left' | 'right' | 'top' | 'bottom' | 'center' | 'middle';
export type DistributionDirection = 'horizontal' | 'vertical';

export class AlignmentManager {
    /**
     * Align left
     */
    alignLeft(graphics: IGraphic[]): void {
        // All selected graphics participate in the calculation (including locked ones)
        const validGraphics = this.getValidGraphics(graphics, true);
        if (validGraphics.length < 2) return;

        const referenceValue = Math.min(
            ...validGraphics.map(g => g.getPosition().x)
        );

        // Only move unlocked graphics
        validGraphics.forEach(graphic => {
            if (!graphic.getLocked()) {
                const currentPos = graphic.getPosition();
                graphic.setPosition(referenceValue, currentPos.y);
            }
        });
    }

    /**
     * Align right
     */
    alignRight(graphics: IGraphic[]): void {
        const validGraphics = this.getValidGraphics(graphics, true);
        if (validGraphics.length < 2) return;

        const referenceValue = Math.max(
            ...validGraphics.map(g => {
                const pos = g.getPosition();
                const size = g.getSize();
                return pos.x + size.width;
            })
        );

        validGraphics.forEach(graphic => {
            if (!graphic.getLocked()) {
                const currentPos = graphic.getPosition();
                const size = graphic.getSize();
                graphic.setPosition(referenceValue - size.width, currentPos.y);
            }
        });
    }

    /**
     * Align top
     */
    alignTop(graphics: IGraphic[]): void {
        const validGraphics = this.getValidGraphics(graphics, true);
        if (validGraphics.length < 2) return;

        const referenceValue = Math.min(
            ...validGraphics.map(g => g.getPosition().y)
        );

        validGraphics.forEach(graphic => {
            if (!graphic.getLocked()) {
                const currentPos = graphic.getPosition();
                graphic.setPosition(currentPos.x, referenceValue);
            }
        });
    }

    /**
     * Align bottom
     */
    alignBottom(graphics: IGraphic[]): void {
        const validGraphics = this.getValidGraphics(graphics, true);
        if (validGraphics.length < 2) return;

        const referenceValue = Math.max(
            ...validGraphics.map(g => {
                const pos = g.getPosition();
                const size = g.getSize();
                return pos.y + size.height;
            })
        );

        validGraphics.forEach(graphic => {
            if (!graphic.getLocked()) {
                const currentPos = graphic.getPosition();
                const size = graphic.getSize();
                graphic.setPosition(currentPos.x, referenceValue - size.height);
            }
        });
    }

    /**
     * Horizontal center
     */
    alignCenter(graphics: IGraphic[]): void {
        const validGraphics = this.getValidGraphics(graphics, true);
        if (validGraphics.length < 2) return;

        const minX = Math.min(...validGraphics.map(g => g.getPosition().x));
        const maxX = Math.max(...validGraphics.map(g => {
            const pos = g.getPosition();
            const size = g.getSize();
            return pos.x + size.width;
        }));
        const referenceValue = (minX + maxX) / 2;

        validGraphics.forEach(graphic => {
            if (!graphic.getLocked()) {
                const currentPos = graphic.getPosition();
                const size = graphic.getSize();
                graphic.setPosition(referenceValue - size.width / 2, currentPos.y);
            }
        });
    }

    /**
     * Vertical middle
     */
    alignMiddle(graphics: IGraphic[]): void {
        const validGraphics = this.getValidGraphics(graphics, true);
        if (validGraphics.length < 2) return;

        const minY = Math.min(...validGraphics.map(g => g.getPosition().y));
        const maxY = Math.max(...validGraphics.map(g => {
            const pos = g.getPosition();
            const size = g.getSize();
            return pos.y + size.height;
        }));
        const referenceValue = (minY + maxY) / 2;

        validGraphics.forEach(graphic => {
            if (!graphic.getLocked()) {
                const currentPos = graphic.getPosition();
                const size = graphic.getSize();
                graphic.setPosition(currentPos.x, referenceValue - size.height / 2);
            }
        });
    }

    /**
     * Distribute horizontally
     */
    distributeHorizontal(graphics: IGraphic[]): void {
        // All selected graphics participate in the calculation
        const validGraphics = this.getValidGraphics(graphics, true);
        if (validGraphics.length < 3) return;

        validGraphics.sort((a, b) => a.getPosition().x - b.getPosition().x);
        this.calculateAndApplyDistribution(validGraphics, 'horizontal');
    }

    /**
     * Distribute vertically
     */
    distributeVertical(graphics: IGraphic[]): void {
        // All selected graphics participate in the calculation
        const validGraphics = this.getValidGraphics(graphics, true);
        if (validGraphics.length < 3) return;

        validGraphics.sort((a, b) => a.getPosition().y - b.getPosition().y);
        this.calculateAndApplyDistribution(validGraphics, 'vertical');
    }

    /**
     * Make selected graphics the same width (using the widest as reference)
     */
    makeSameWidth(graphics: IGraphic[]): void {
        const validGraphics = this.getValidGraphics(graphics, true);
        if (validGraphics.length < 2) return;

        // Find the maximum width
        const maxWidth = Math.max(
            ...validGraphics.map(g => g.getSize().width)
        );

        validGraphics.forEach(graphic => {
            if (!graphic.getLocked()) {
                const currentSize = graphic.getSize();
                graphic.setSize(maxWidth, currentSize.height);
            }
        });
    }

    /**
     * Make selected graphics the same height (using the tallest as reference)
     */
    makeSameHeight(graphics: IGraphic[]): void {
        const validGraphics = this.getValidGraphics(graphics, true);
        if (validGraphics.length < 2) return;

        // Find the maximum height
        const maxHeight = Math.max(
            ...validGraphics.map(g => g.getSize().height)
        );

        validGraphics.forEach(graphic => {
            if (!graphic.getLocked()) {
                const currentSize = graphic.getSize();
                graphic.setSize(currentSize.width, maxHeight);
            }
        });
    }

    /**
     * Make selected graphics the same size (using the largest as reference)
     */
    makeSameSize(graphics: IGraphic[]): void {
        const validGraphics = this.getValidGraphics(graphics, true);
        if (validGraphics.length < 2) return;

        // Find the maximum width and height
        const maxWidth = Math.max(
            ...validGraphics.map(g => g.getSize().width)
        );
        const maxHeight = Math.max(
            ...validGraphics.map(g => g.getSize().height)
        );

        validGraphics.forEach(graphic => {
            if (!graphic.getLocked()) {
                graphic.setSize(maxWidth, maxHeight);
            }
        });
    }

    /**
     * Adjust spacing
     */
    adjustSpacing(
        graphics: IGraphic[],
        spacing: number,
        direction: DistributionDirection
    ): void {
        // All selected graphics participate in the calculation
        const validGraphics = this.getValidGraphics(graphics, true);
        if (validGraphics.length < 2) return;

        if (direction === 'horizontal') {
            validGraphics.sort((a, b) => a.getPosition().x - b.getPosition().x);
            let currentX = validGraphics[0].getPosition().x;

            validGraphics.forEach((graphic, index) => {
                if (index > 0 && !graphic.getLocked()) {
                    const currentPos = graphic.getPosition();
                    graphic.setPosition(currentX + spacing, currentPos.y);
                }
                const pos = graphic.getPosition();
                const size = graphic.getSize();
                currentX = pos.x + size.width;
            });
        } else {
            validGraphics.sort((a, b) => a.getPosition().y - b.getPosition().y);
            let currentY = validGraphics[0].getPosition().y;

            validGraphics.forEach((graphic, index) => {
                if (index > 0 && !graphic.getLocked()) {
                    const currentPos = graphic.getPosition();
                    graphic.setPosition(currentPos.x, currentY + spacing);
                }
                const pos = graphic.getPosition();
                const size = graphic.getSize();
                currentY = pos.y + size.height;
            });
        }
    }

    // ==================== Internal Helper Methods ====================

    private getValidGraphics(graphics: IGraphic[], includeLocked: boolean = false): IGraphic[] {
        return graphics.filter(g => {
            // If locked graphics are not included, filter them out
            if (!includeLocked && g.getLocked()) {
                return false;
            }

            // Check whether the graphic is valid
            try {
                const pos = g.getPosition();
                const size = g.getSize();
                return typeof pos.x === 'number' &&
                       typeof pos.y === 'number' &&
                       typeof size.width === 'number' &&
                       typeof size.height === 'number';
            } catch {
                return false;
            }
        });
    }

    private calculateAndApplyDistribution(
        graphics: IGraphic[],
        direction: DistributionDirection
    ): void {
        const firstGraphic = graphics[0];
        const lastGraphic = graphics[graphics.length - 1];
        const firstPos = firstGraphic.getPosition();
        const firstSize = firstGraphic.getSize();
        const lastPos = lastGraphic.getPosition();
        const lastSize = lastGraphic.getSize();

        if (direction === 'horizontal') {
            const minX = firstPos.x;
            const maxX = lastPos.x + lastSize.width;
            const totalWidth = maxX - minX;
            const elementTotalWidth = graphics.reduce((sum, g) => sum + g.getSize().width, 0);
            const totalGap = totalWidth - elementTotalWidth;
            const gap = totalGap / (graphics.length - 1);

            let currentRightEdge = minX + firstSize.width;
            for (let i = 1; i < graphics.length; i++) {
                const graphic = graphics[i];
                const currentPos = graphic.getPosition();
                const currentSize = graphic.getSize();
                const newX = i === graphics.length - 1
                    ? maxX - currentSize.width      // Last element: right-aligned boundary
                    : currentRightEdge + gap;       // Middle element: prevRightEdge + gap
                if (!graphic.getLocked()) {
                    graphic.setPosition(newX, currentPos.y);
                }
                currentRightEdge = newX + currentSize.width;
            }
        } else {
            const minY = firstPos.y;
            const maxY = lastPos.y + lastSize.height;
            const totalHeight = maxY - minY;
            const elementTotalHeight = graphics.reduce((sum, g) => sum + g.getSize().height, 0);
            const totalGap = totalHeight - elementTotalHeight;
            const gap = totalGap / (graphics.length - 1);

            let currentBottomEdge = minY + firstSize.height;
            for (let i = 1; i < graphics.length; i++) {
                const graphic = graphics[i];
                const currentPos = graphic.getPosition();
                const currentSize = graphic.getSize();
                const newY = i === graphics.length - 1
                    ? maxY - currentSize.height     // Last element: bottom-aligned boundary
                    : currentBottomEdge + gap;      // Middle element: prevBottomEdge + gap
                if (!graphic.getLocked()) {
                    graphic.setPosition(currentPos.x, newY);
                }
                currentBottomEdge = newY + currentSize.height;
            }
        }
    }
}
