// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AuthService } from '../auth.service';
import { UserService } from '../../user/user.service';

/** One-time preview-ticket entry: bound to the issuing user and expiration time */
interface PreviewTicketEntry {
  userId: string;
  expiresAtTimestamp: number;
}

/** Ticket generation result */
export interface PreviewTicketTokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Ticket validity (ms): long enough for the H5 runtime shell to load and complete exchange, short enough to lower URL-leak risk */
const PREVIEW_TICKET_TTL_MS = 60 * 1000;

/** Ticket storage cap: prevent malicious high-frequency issuance from exhausting memory (evict oldest entries when exceeded) */
const MAX_PREVIEW_TICKET_COUNT = 1000;

/**
 * Config runtime preview one-time ticket service (06 Plan Route B #2 ticket auth bridge)
 *
 * Scenario: the mobile end (uni-app H5/App/mini-program) holds the session via Bearer Token, while the Web config runtime shell
 * (ss-editor /preview) relies on the HttpOnly Cookie session. The ticket bridges the two session forms:
 *   1. The mobile end carries the Bearer Token and calls POST /auth/preview-ticket to issue a one-time ticket;
 *   2. The ticket is passed via URL into the H5 runtime shell, which calls POST /auth/preview-ticket-exchange
 *      to exchange it for an HttpOnly Cookie session (destroyed on exchange, preventing replay).
 */
@Injectable()
export class PreviewTicketService {
  private readonly logger = new Logger(PreviewTicketService.name);
  private readonly previewTicketStore = new Map<string, PreviewTicketEntry>();

  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
  ) {}

  /**
   * Assemble the full preview URL of the runtime shell (Plan C: backend issues it, frontend does zero assembly).
   * The shell base URL is configured by the backend env var SCADA_SHELL_BASE_URL:
   * - Local debug: http://localhost:5173 (full shell dev, cross-port explicitly given by backend);
   * - Production: /scada-preview (H5 same-origin relative path, resolved by the browser against the current origin, naturally same-origin).
   * When unset, returns undefined and the caller falls back to local assembly (VITE_WEB_PREVIEW_BASE_URL).
   */
  buildPreviewUrl(
    previewTicket: string,
    parameters: { projectId?: string; pageName?: string; group?: string },
  ): string | undefined {
    const shellBaseUrl = process.env.SCADA_SHELL_BASE_URL?.trim();
    if (!shellBaseUrl) {
      return undefined;
    }
    const queryParts = [`ticket=${encodeURIComponent(previewTicket)}`];
    if (parameters.projectId) {
      queryParts.push(`projectId=${encodeURIComponent(parameters.projectId)}`);
    }
    if (parameters.pageName) {
      queryParts.push(`pageName=${encodeURIComponent(parameters.pageName)}`);
    }
    if (parameters.group) {
      queryParts.push(`group=${encodeURIComponent(parameters.group)}`);
    }
    return `${shellBaseUrl.replace(/\/+$/, '')}/preview?${queryParts.join('&')}`;
  }

  /** Issue a one-time preview ticket for the specified user (valid 60s, destroyed immediately on exchange) */
  issuePreviewTicket(userId: string): string {
    this.purgeExpiredPreviewTickets();
    if (this.previewTicketStore.size >= MAX_PREVIEW_TICKET_COUNT) {
      const oldestTicketKey = this.previewTicketStore.keys().next().value;
      if (oldestTicketKey !== undefined) {
        this.previewTicketStore.delete(oldestTicketKey);
      }
    }
    const previewTicket = randomUUID();
    this.previewTicketStore.set(previewTicket, {
      userId,
      expiresAtTimestamp: Date.now() + PREVIEW_TICKET_TTL_MS,
    });
    this.logger.debug(
      `[预览票据] 已签发 | userId="${userId}" | pendingTicketCount=${this.previewTicketStore.size}`,
    );
    return previewTicket;
  }

  /**
   * Exchange a ticket for a token pair (one-time consumption: remove first regardless of validity, preventing replay).
   * Invalid/expired/nonexistent user all throw 401 without leaking the specific reason difference to the caller.
   */
  async consumePreviewTicket(previewTicket: string): Promise<PreviewTicketTokenPair> {
    this.purgeExpiredPreviewTickets();
    const ticketEntry = this.previewTicketStore.get(previewTicket);
    this.previewTicketStore.delete(previewTicket);
    if (!ticketEntry || Date.now() > ticketEntry.expiresAtTimestamp) {
      this.logger.warn('[预览票据] 兑换失败：票据不存在或已过期');
      throw new UnauthorizedException('预览票据无效或已过期');
    }
    const user = await this.userService.findById(ticketEntry.userId);
    if (!user) {
      this.logger.warn(`[预览票据] 兑换失败：用户不存在 | userId="${ticketEntry.userId}"`);
      throw new UnauthorizedException('预览票据无效或已过期');
    }
    this.logger.log(
      `[预览票据] 兑换成功 | userId="${user.id}" username="${user.username}" | pendingTicketCount=${this.previewTicketStore.size}`,
    );
    return this.authService.generateTokensForUser({
      id: user.id,
      username: user.username,
      role: user.role,
    });
  }

  /** Clean up expired tickets (run opportunistically on issue/exchange, no separate timer needed) */
  private purgeExpiredPreviewTickets(): void {
    const nowTimestamp = Date.now();
    for (const [ticketKey, ticketEntry] of this.previewTicketStore) {
      if (nowTimestamp > ticketEntry.expiresAtTimestamp) {
        this.previewTicketStore.delete(ticketKey);
      }
    }
  }
}
