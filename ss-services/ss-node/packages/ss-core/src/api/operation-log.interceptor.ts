// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Repository } from 'typeorm';

export interface OperationLogEntity {
  id?: string;
  action: string;
  resource: string;
  resourceId?: string;
  userId?: string;
  username?: string;
  ip?: string;
  userAgent?: string;
  details?: string;
  status: string;
  createdAt: Date;
}

@Injectable()
export class OperationLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(OperationLogInterceptor.name);

  private operationLogRepo: Repository<any> | null = null;

  constructor() {}

  setRepository(repo: Repository<any>): void {
    this.operationLogRepo = repo;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const startTime = Date.now();

    // CODE-01: GET requests are read-only; auditing them has low value, so skip writing operation logs to avoid one SQLite INSERT per API request
    // (which amplifies the latency of all GET requests on IO-constrained swap servers)
    const isReadOperation = request.method === 'GET';

    const logEntry: OperationLogEntity = {
      action: `${request.method} ${request.route?.path || request.url}`,
      resource: request.route?.path || request.url,
      resourceId: request.params?.id,
      userId: request.user?.id,
      username: request.user?.username,
      ip: request.ip || request.connection?.remoteAddress,
      userAgent: request.headers?.['user-agent'],
      details:
        request.method !== 'GET' ? JSON.stringify(request.body || {}).slice(0, 500) : undefined,
      status: 'pending',
      createdAt: new Date(),
    };

    return next.handle().pipe(
      tap({
        next: () => {
          if (isReadOperation) return; // skip GET
          logEntry.status = 'success';
          const duration = `${Date.now() - startTime}ms`;
          // Keep the captured request body, append elapsed time at the end
          logEntry.details = logEntry.details
            ? `${logEntry.details} | Duration: ${duration}`
            : `Duration: ${duration}`;
          void this.saveOperationLog(logEntry);
        },
        error: (error) => {
          if (isReadOperation) return; // skip GET errors too (avoid error-storm IO amplification)
          logEntry.status = 'error';
          const errInfo = `${error.message || 'Unknown error'} (${Date.now() - startTime}ms)`;
          // Keep the captured request body, append error info at the end
          logEntry.details = logEntry.details
            ? `${logEntry.details} | Error: ${errInfo}`
            : `Error: ${errInfo}`;
          void this.saveOperationLog(logEntry);
        },
      }),
    );
  }

  /**
   * CODE-01: save operation logs asynchronously.
   * - Use void + .catch to capture async rejections (the original save() was not awaited and try/catch could not catch Promise rejections)
   * - Do not block the main request response (fire-and-forget), but ensure exceptions are swallowed and logged without producing unhandledRejection
   */
  private saveOperationLog(entry: OperationLogEntity): Promise<void> {
    if (!this.operationLogRepo) return Promise.resolve();
    return this.operationLogRepo.save(entry).catch((error: Error) => {
      this.logger.error(`Failed to save operation log: ${error.message}`);
    });
  }
}
