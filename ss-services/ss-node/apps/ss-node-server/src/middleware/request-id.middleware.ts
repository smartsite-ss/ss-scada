// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';

/**
 * Request ID injection middleware
 *
 * Injects a unique requestId into every request, threaded through request-response-logging for easier frontend/backend joint debugging.
 * - Prefer the client-supplied X-Request-Id header
 * - Generate a UUID automatically when absent
 * - Propagate it to the response header so the frontend can correlate logs
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: () => void): void {
    const existingId = req.headers['x-request-id'] as string | undefined;
    const requestId = existingId || randomUUID();

    // Ensure the request header carries requestId (read later by filters/interceptors)
    req.headers['x-request-id'] = requestId;

    // Propagate to the response header
    res.setHeader('X-Request-Id', requestId);

    next();
  }
}
