// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { IGraphic } from '@scada-editor/plugin-sdk';
import { GraphicFactory } from '../graphic-editing/graphic/factory/GraphicFactory';

export interface ITransferableData {
    id: string;
    type: string;
    config: any;
    x: number;
    y: number;
    width: number;
    height: number;
}

export class InterpageTransferService {
    private idCounter: number = 0;

    /**
     * Serialize a single graphic (fully compatible with the toJSON format)
     */
    serializeGraphic(graphic: IGraphic): ITransferableData {
        const graphicData = graphic.toJSON();
        return {
            id: graphicData.id,
            type: graphicData.type,
            config: graphicData.config,
            x: graphicData.config.geometry?.x || 0,
            y: graphicData.config.geometry?.y || 0,
            width: graphicData.config.geometry?.width || 0,
            height: graphicData.config.geometry?.height || 0
        };
    }

    /**
     * Serialize graphics in batch
     */
    serializeGraphics(graphics: IGraphic[]): ITransferableData[] {
        return graphics.map(g => this.serializeGraphic(g));
    }

    /**
     * Deserialize a single graphic (fully compatible with GraphicFactory)
     */
    deserializeGraphic(data: ITransferableData): IGraphic {
        // Rebuild into a structure consistent with the toJSON format
        const jsonData = {
            id: data.id,
            type: data.type,
            config: data.config
        };

        // Create the graphic via GraphicFactory
        const graphic = GraphicFactory.createGraphicFromJSON(jsonData);
        return graphic;
    }

    /**
     * Deserialize graphics in batch
     */
    deserializeGraphics(data: ITransferableData[]): IGraphic[] {
        return data.map(d => this.deserializeGraphic(d));
    }

    /**
     * Coordinate transform
     */
    transformCoordinates(graphic: IGraphic, offsetX: number, offsetY: number): void {
        if (graphic.config.geometry) {
            graphic.config.geometry.x += offsetX;
            graphic.config.geometry.y += offsetY;
        }
    }

    /**
     * Generate a new ID
     */
    generateNewId(existingIds: string[]): string {
        let newId: string;
        do {
            newId = `graphic-${Date.now()}-${this.idCounter++}`;
        } while (existingIds.includes(newId));
        return newId;
    }

    /**
     * Reassign IDs (avoid conflicts)
     */
    reassignIds(graphics: IGraphic[], existingIds: string[]): IGraphic[] {
        return graphics.map(graphic => {
            const newId = this.generateNewId(existingIds);
            // Update ID
            graphic.id = newId;
            graphic.config.id = newId;
            existingIds.push(newId);
            return graphic;
        });
    }
}
