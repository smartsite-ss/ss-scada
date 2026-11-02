// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

interface WrappedResponse<T> {
  data: T;
  message: string;
  timestamp: string;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, WrappedResponse<T> | T> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<WrappedResponse<T> | T> {
    const request = context.switchToHttp().getRequest();

    // Skip basic endpoints like health checks and return the raw data directly
    if (request.url.startsWith('/api/v1/system/health')) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        // Responses already containing the standard wrapper fields (data + message + timestamp) are not wrapped again
        if (
          data &&
          typeof data === 'object' &&
          'data' in data &&
          'message' in data &&
          'timestamp' in data
        ) {
          return data;
        }

        // Paginated query response
        if (data && typeof data === 'object' && 'pagination' in data) {
          return {
            data: data.data,
            pagination: data.pagination,
            message: '查询成功',
            timestamp: new Date().toISOString(),
          };
        }

        // Non-JSON responses such as file downloads
        if (Buffer.isBuffer(data)) return data as any;

        return this.wrapResponse(data);
      }),
    );
  }

  private wrapResponse(data: any): WrappedResponse<any> {
    return {
      data: data ?? null,
      message: '操作成功',
      timestamp: new Date().toISOString(),
    };
  }
}
