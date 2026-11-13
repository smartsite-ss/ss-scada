// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { IGraphic } from '../types';

/**
 * Collaboration service
 * Supports multi-user collaborative editing
 */
export class CollaborationService {
  private static instance: CollaborationService;
  private socket: WebSocket | null = null;
  private userId: string;
  private userName: string;
  private listeners: Map<string, ((...args: any[]) => any)[]> = new Map();
  private isConnected: boolean = false;

  private constructor() {
    this.userId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.userName = `User ${Math.floor(Math.random() * 1000)}`;
  }

  static getInstance(): CollaborationService {
    if (!CollaborationService.instance) {
      CollaborationService.instance = new CollaborationService();
    }
    return CollaborationService.instance;
  }

  /**
   * Connect to the collaboration server
   * @param url Server URL
   */
  connect(url: string = 'ws://localhost:8800'): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        this.socket = new WebSocket(url);

        this.socket.onopen = () => {
          ('协作服务器连接成功');
          this.isConnected = true;
          this.send({
            type: 'join',
            userId: this.userId,
            userName: this.userName,
          });
          resolve(true);
        };

        this.socket.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.socket.onclose = () => {
          ('协作服务器连接关闭');
          this.isConnected = false;
        };

        this.socket.onerror = (error) => {
          console.error('Collaboration server connection error:', error);
          this.isConnected = false;
          resolve(false);
        };
      } catch (error) {
        console.error('Failed to connect to collaboration server:', error);
        resolve(false);
      }
    });
  }

  /**
   * Disconnect
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
      this.isConnected = false;
    }
  }

  /**
   * Send a message
   * @param message Message content
   */
  private send(message: any): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  /**
   * Handle received messages
   * @param data Message data
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);
      const { type, payload } = message;

      switch (type) {
        case 'userJoined':
          this.emit('userJoined', payload);
          break;
        case 'userLeft':
          this.emit('userLeft', payload);
          break;
        case 'graphicAdded':
          this.emit('graphicAdded', payload);
          break;
        case 'graphicUpdated':
          this.emit('graphicUpdated', payload);
          break;
        case 'graphicDeleted':
          this.emit('graphicDeleted', payload);
          break;
        case 'selectionChanged':
          this.emit('selectionChanged', payload);
          break;
        case 'cursorMoved':
          this.emit('cursorMoved', payload);
          break;
        default:
          break;
      }
    } catch (error) {
      console.error('Failed to handle collaboration message:', error);
    }
  }

  /**
   * Listen for an event
   * @param event Event name
   * @param callback Callback function
   */
  on(event: string, callback: (...args: any[]) => any): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)?.push(callback);
  }

  /**
   * Remove an event listener
   * @param event Event name
   * @param callback Callback function
   */
  off(event: string, callback: (...args: any[]) => any): void {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners
        .get(event)
        ?.filter((cb) => cb !== callback);
      if (callbacks) {
        this.listeners.set(event, callbacks);
      }
    }
  }

  /**
   * Emit an event
   * @param event Event name
   * @param data Event data
   */
  private emit(event: string, data: any): void {
    if (this.listeners.has(event)) {
      this.listeners.get(event)?.forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          console.error('Failed to trigger event callback:', error);
        }
      });
    }
  }

  /**
   * Send a graphic-added event
   * @param graphic Graphic object
   */
  sendGraphicAdded(graphic: IGraphic): void {
    this.send({
      type: 'graphicAdded',
      payload: {
        userId: this.userId,
        userName: this.userName,
        graphic: graphic.toJSON(),
      },
    });
  }

  /**
   * Send a graphic-updated event
   * @param graphic Graphic object
   */
  sendGraphicUpdated(graphic: IGraphic): void {
    this.send({
      type: 'graphicUpdated',
      payload: {
        userId: this.userId,
        userName: this.userName,
        graphic: graphic.toJSON(),
      },
    });
  }

  /**
   * Send a graphic-deleted event
   * @param graphicId Graphic ID
   */
  sendGraphicDeleted(graphicId: string): void {
    this.send({
      type: 'graphicDeleted',
      payload: {
        userId: this.userId,
        userName: this.userName,
        graphicId,
      },
    });
  }

  /**
   * Send a selection-changed event
   * @param selectedGraphicIds List of selected graphic IDs
   */
  sendSelectionChanged(selectedGraphicIds: string[]): void {
    this.send({
      type: 'selectionChanged',
      payload: {
        userId: this.userId,
        userName: this.userName,
        selectedGraphicIds,
      },
    });
  }

  /**
   * Send a cursor-moved event
   * @param x X coordinate
   * @param y Y coordinate
   */
  sendCursorMoved(x: number, y: number): void {
    this.send({
      type: 'cursorMoved',
      payload: {
        userId: this.userId,
        userName: this.userName,
        x,
        y,
      },
    });
  }

  /**
   * Get the current user information
   * @returns User information
   */
  getUserInfo(): { userId: string; userName: string } {
    return { userId: this.userId, userName: this.userName };
  }

  /**
   * Check whether connected
   * @returns Whether connected
   */
  getIsConnected(): boolean {
    return this.isConnected;
  }
}
