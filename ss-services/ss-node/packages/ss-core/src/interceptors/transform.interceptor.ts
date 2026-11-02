// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponse, PaginatedResponse } from '../common/api-response.interface';

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T> | T> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T> | T> {
    const request = context.switchToHttp().getRequest();

    // Skip basic endpoints such as health checks and return raw data
    if (request.url?.startsWith('/api/v1/system/health')) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        // Responses already containing the standard wrapper fields (code + data + message + timestamp) are not wrapped again
        if (
          data &&
          typeof data === 'object' &&
          'code' in data &&
          'data' in data &&
          'message' in data &&
          'timestamp' in data
        ) {
          return data;
        }

        // Paginated query responses (compatible with both the data and items field names)
        if (data && typeof data === 'object' && 'pagination' in data) {
          const paginated = data as any;
          return {
            code: 200,
            data: paginated.data ?? paginated.items,
            pagination: paginated.pagination,
            message: 'success',
            timestamp: new Date().toISOString(),
          } as PaginatedResponse<T>;
        }

        // File-stream download (StreamableFile) -- left to NestJS built-in streaming response, not wrapped
        // Otherwise wrapResponse would serialize it as {code,data:{stream:...}}, corrupting the download content
        if (data instanceof StreamableFile) return data;

        // Non-JSON responses such as file downloads / streams
        if (Buffer.isBuffer(data)) return data as any;

        return this.wrapResponse(data);
      }),
    );
  }

  private wrapResponse(data: any): ApiResponse<any> {
    return {
      code: 200,
      data: data ?? null,
      message: 'success',
      timestamp: new Date().toISOString(),
    };
  }
}
