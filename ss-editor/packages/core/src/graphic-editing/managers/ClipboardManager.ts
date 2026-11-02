// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com


import { ITransferableData } from '../../services/InterpageTransferService';

export interface IClipboardData {
  /** Serialized graphic data */
  data: ITransferableData[];
  /** Clipboard operation mode */
  mode: 'cut' | 'copy';
  /** Source page ID */
  sourcePageId: string;
  /** Group metadata (non-empty when source data comes from a group) */
  groupMetadata?: {
    /** Whether this is a group copy */
    isGroupCopy: boolean;
    /** Source group ID */
    sourceGroupId: string;
    /** Source group name */
    groupName: string;
  };
}

export class ClipboardManager {
    private clipboardData: ITransferableData[] = [];
    private sourcePageId: string | null = null;
    private clipboardMode: 'copy' | 'cut' = 'copy';
    private pasteCount: number = 0;
    private groupMetadata: {
        isGroupCopy: boolean;
        sourceGroupId: string;
        groupName: string;
    } | null = null;

    /**
     * Set clipboard data
     */
    setData(
        data: ITransferableData[],
        mode: 'copy' | 'cut',
        sourcePageId: string
    ): void {
        this.clipboardData = [...data];
        this.clipboardMode = mode;
        this.sourcePageId = sourcePageId;
        this.pasteCount = 0;
        this.groupMetadata = null;
    }

    /**
     * Increment the paste count
     */
    incrementPasteCount(): void {
        this.pasteCount++;
    }

    /**
     * Get the paste count
     */
    getPasteCount(): number {
        return this.pasteCount;
    }

    /**
     * Get clipboard data
     */
    getData(): ITransferableData[] {
        return [...this.clipboardData];
    }

    /**
     * Clear clipboard data
     */
    clearData(): void {
        this.clipboardData = [];
        this.clipboardMode = 'copy';
        this.sourcePageId = null;
        this.pasteCount = 0;
        this.groupMetadata = null;
    }

    /**
     * Check whether the clipboard is empty
     */
    isEmpty(): boolean {
        return this.clipboardData.length === 0;
    }

    /**
     * Get the source page ID
     */
    getSourcePageId(): string | null {
        return this.sourcePageId;
    }

    /**
     * Get the clipboard mode
     */
    getClipboardMode(): 'copy' | 'cut' {
        return this.clipboardMode;
    }

    /**
     * Get the number of items in the clipboard
     */
    get itemCount(): number {
        return this.clipboardData.length;
    }

    /**
     * Set group metadata (called when the source data comes from a group copy)
     */
    setGroupMetadata(metadata: { isGroupCopy: boolean; sourceGroupId: string; groupName: string }): void {
        this.groupMetadata = { ...metadata };
    }

    /**
     * Get group metadata
     */
    getGroupMetadata(): { isGroupCopy: boolean; sourceGroupId: string; groupName: string } | null {
        return this.groupMetadata;
    }
}
