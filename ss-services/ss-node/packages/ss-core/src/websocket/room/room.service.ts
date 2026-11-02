// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { I18nService } from '@ss-node/ss-i18n';
import { EventBusService } from '../../event-bus/event-bus.service';

export interface RoomMember {
  socketId: string;
  userId?: string;
  username?: string;
  joinedAt: number;
}

export interface RoomJoinResult {
  allowed: boolean;
  reason?: string;
}

@Injectable()
export class RoomService implements OnModuleInit {
  private readonly logger = new Logger(RoomService.name);

  /** Room-member store: roomName -> Set<RoomMember> */
  private readonly memberStore = new Map<string, Map<string, RoomMember>>();

  /** User's rooms: userId -> Set<roomName> */
  private readonly userRooms = new Map<string, Set<string>>();

  /** Socket's rooms: socketId -> Set<roomName> */
  private readonly socketRooms = new Map<string, Set<string>>();

  constructor(
    @Inject(I18nService)
    private readonly i18n: I18nService,
    private readonly eventBus: EventBusService,
  ) {}

  onModuleInit(): void {
    this.logger.log('RoomService initialized');
  }

  /**
   * Join a project room (with permission check)
   * @param room room name
   * @param socketId socket ID
   * @param userId user ID (undefined for unauthenticated users)
   * @param username username
   * @param canAccess permission-check function: returns whether the user may access the project
   */
  joinProjectRoom(
    room: string,
    socketId: string,
    userId: string | undefined,
    username: string | undefined,
    canAccess: boolean,
  ): RoomJoinResult {
    if (!userId) {
      const reason = this.i18n.tSync('websocket.room.not_authenticated');
      return { allowed: false, reason };
    }

    if (!canAccess) {
      const projectId = room.replace('project:', '');
      const reason = this.i18n.tSync('websocket.room.permission_denied', {
        projectId,
      });
      this.logger.warn(`Permission denied: user ${username} tried to join ${room}`);
      return { allowed: false, reason };
    }

    this.addMember(room, socketId, userId, username);
    return { allowed: true };
  }

  /**
   * Join a normal room (no permission check)
   */
  joinRoom(room: string, socketId: string, userId?: string, username?: string): void {
    this.addMember(room, socketId, userId, username);
  }

  /**
   * Leave a room
   */
  leaveRoom(room: string, socketId: string): void {
    const members = this.memberStore.get(room);
    if (!members) return;

    const member = members.get(socketId);
    if (!member) return;

    members.delete(socketId);
    if (members.size === 0) {
      this.memberStore.delete(room);
    }

    // Clean up the user's room index
    if (member.userId) {
      const rooms = this.userRooms.get(member.userId);
      if (rooms) {
        rooms.delete(room);
        if (rooms.size === 0) {
          this.userRooms.delete(member.userId);
        }
      }
    }

    // Clean up the socket's room index
    const socketRooms = this.socketRooms.get(socketId);
    if (socketRooms) {
      socketRooms.delete(room);
      if (socketRooms.size === 0) {
        this.socketRooms.delete(socketId);
      }
    }

    const message = this.i18n.tSync('websocket.room.left', {
      username: member.username || socketId,
      room,
    });
    this.logger.log(message);

    // Emit the user:left event
    this.eventBus.emit('user.left', {
      socketId,
      userId: member.userId,
      username: member.username,
      room,
      timestamp: Date.now(),
    });
  }

  /** Remove all rooms of a socket */
  leaveAllRooms(socketId: string): void {
    const rooms = this.socketRooms.get(socketId);
    if (!rooms) return;

    const roomNames = Array.from(rooms);
    for (const room of roomNames) {
      this.leaveRoom(room, socketId);
    }
  }

  /** Get a room's member list */
  getRoomMembers(room: string): RoomMember[] {
    const members = this.memberStore.get(room);
    if (!members) return [];
    return Array.from(members.values());
  }

  /** Get a room's member count */
  getRoomMemberCount(room: string): number {
    return this.memberStore.get(room)?.size || 0;
  }

  /** Get a user's rooms */
  getUserRooms(userId: string): string[] {
    const rooms = this.userRooms.get(userId);
    return rooms ? Array.from(rooms) : [];
  }

  /** Get a socket's rooms */
  getSocketRooms(socketId: string): string[] {
    const rooms = this.socketRooms.get(socketId);
    return rooms ? Array.from(rooms) : [];
  }

  /** Get all room names */
  getAllRoomNames(): string[] {
    return Array.from(this.memberStore.keys());
  }

  /** Get all room statistics */
  getRoomStats(): Array<{ name: string; memberCount: number }> {
    const stats: Array<{ name: string; memberCount: number }> = [];
    this.memberStore.forEach((members, name) => {
      stats.push({ name, memberCount: members.size });
    });
    return stats.sort((a, b) => b.memberCount - a.memberCount);
  }

  /** Check whether a user is in a room */
  isMemberInRoom(room: string, socketId: string): boolean {
    return this.memberStore.get(room)?.has(socketId) || false;
  }

  private addMember(room: string, socketId: string, userId?: string, username?: string): void {
    if (!this.memberStore.has(room)) {
      this.memberStore.set(room, new Map());
    }

    const member: RoomMember = {
      socketId,
      userId,
      username,
      joinedAt: Date.now(),
    };

    this.memberStore.get(room)!.set(socketId, member);

    // Update the user's room index
    if (userId) {
      if (!this.userRooms.has(userId)) {
        this.userRooms.set(userId, new Set());
      }
      this.userRooms.get(userId)!.add(room);
    }

    // Update the socket's room index
    if (!this.socketRooms.has(socketId)) {
      this.socketRooms.set(socketId, new Set());
    }
    this.socketRooms.get(socketId)!.add(room);

    const message = this.i18n.tSync('websocket.room.joined', {
      username: username || socketId,
      room,
    });
    this.logger.log(message);

    // Emit the user:joined event
    this.eventBus.emit('user.joined', {
      socketId,
      userId,
      username,
      room,
      timestamp: Date.now(),
    });
  }
}
