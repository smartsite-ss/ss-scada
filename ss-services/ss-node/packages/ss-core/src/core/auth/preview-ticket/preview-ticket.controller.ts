// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PreviewTicketService } from './preview-ticket.service';
import { PreviewTicketExchangeDto } from './dto/preview-ticket-exchange.dto';
import { PreviewTicketIssueDto } from './dto/preview-ticket-issue.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { Public } from '../decorators/public.decorator';

/**
 * Config runtime preview-ticket endpoints (06 Plan Route B #2 ticket auth bridge)
 *
 * - POST /auth/preview-ticket: an authenticated client (mobile Bearer Token) issues a one-time ticket;
 * - POST /auth/preview-ticket-exchange: the H5 runtime shell exchanges the ticket for a session credential (public endpoint, the ticket itself is the credential).
 *
 * Auth mode: Bearer Token (returned in response body).
 * Background: originally set HttpOnly Cookie (SameSite=Strict), only suitable for "shell and H5 same-origin deployment".
 * Now the H5 iframe connects directly to the remote 8080 shell (cross-origin); the browser treats SameSite=Strict Cookie as third-party
 * Cookie and blocks it -> all API calls inside the shell get 401. After switching to Bearer, the shell's axios injects the `Authorization` header,
 * and `JwtStrategy` already supports reading the token from that header (see jwt.strategy.ts `extractJwtFromRequest`).
 */
@ApiTags('认证')
@Controller('auth')
export class PreviewTicketController {
  private readonly logger = new Logger(PreviewTicketController.name);

  constructor(private readonly previewTicketService: PreviewTicketService) {}

  @Post('preview-ticket')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiBody({ type: PreviewTicketIssueDto })
  @ApiOperation({
    summary: '签发一次性预览票据（移动端 Bearer 会话 → 票据 + 完整壳 URL，供 H5 运行态壳兑换 Bearer 会话）',
  })
  async issuePreviewTicket(
    @Req() request: Request,
    @Body() previewTicketIssueDto: PreviewTicketIssueDto,
  ): Promise<{ previewTicket: string; previewUrl?: string }> {
    const user = (request as Request & { user: { id: string } }).user;
    const previewTicket = this.previewTicketService.issuePreviewTicket(user.id);
    // Plan C: backend assembles the full shell URL by SCADA_SHELL_BASE_URL; when unset it is undefined and the frontend falls back to local assembly
    const previewUrl = this.previewTicketService.buildPreviewUrl(previewTicket, previewTicketIssueDto);
    return { previewTicket, previewUrl };
  }

  @Post('preview-ticket-exchange')
  @HttpCode(HttpStatus.OK)
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @ApiBody({ type: PreviewTicketExchangeDto })
  @ApiOperation({ summary: '兑换预览票据为 Bearer 会话（H5 运行态壳启动时调用，票据一次性消费，响应体返回 Token 对）' })
  async exchangePreviewTicket(
    @Body() previewTicketExchangeDto: PreviewTicketExchangeDto,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenPair = await this.previewTicketService.consumePreviewTicket(
      previewTicketExchangeDto.previewTicket,
    );
    this.logger.log('[预览票据] 兑换完成 | 响应体返回 Bearer Token 对（壳内 axios 注入 Authorization 头）');
    return tokenPair;
  }
}
