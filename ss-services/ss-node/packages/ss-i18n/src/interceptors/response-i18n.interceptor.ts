// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { I18nService } from '../i18n.service';

@Injectable()
export class ResponseI18nInterceptor implements NestInterceptor {
  constructor(private readonly i18nService: I18nService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const lang = (request as any).i18nLang || this.i18nService.getFallbackLanguage();

    return next.handle().pipe(
      map((data) => {
        if (data && typeof data === 'object') {
          return this.translateResponse(data, lang);
        }
        return data;
      }),
    );
  }

  private translateResponse(data: any, lang: string): any {
    if (data === null || data === undefined) {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.translateResponse(item, lang));
    }

    if (typeof data !== 'object') {
      return data;
    }

    // Built-in objects like Date / Buffer / RegExp are not translated recursively; returned as-is
    // Otherwise Object.keys(new Date()) === [] would serialize dates into empty objects {}
    if (data instanceof Date || Buffer.isBuffer(data) || data instanceof RegExp) {
      return data;
    }

    if (data.message && typeof data.message === 'string') {
      const translated = this.i18nService.translateSync(data.message, { lang });
      if (translated !== data.message) {
        data.message = translated;
      }
    }

    const result: Record<string, any> = {};
    for (const key of Object.keys(data)) {
      result[key] = this.translateResponse(data[key], lang);
    }
    return result;
  }
}
