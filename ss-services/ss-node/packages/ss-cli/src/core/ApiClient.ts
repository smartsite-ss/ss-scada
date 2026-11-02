// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * ApiClient - an API client built on Node.js built-in http/https modules
 *
 * Does not depend on axios; uses the built-in networking modules for REST requests.
 * Supports both JWT Token and API Key authentication.
 */

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

/** ApiClient configuration */
export interface ApiClientConfig {
  /** Server base URL, e.g. http://localhost:4000 */
  baseUrl: string;
  /** JWT Token (optional) */
  token?: string;
  /** API Key (optional) */
  apiKey?: string;
  /** Request timeout (ms), default 30000 */
  timeout?: number;
}

/** API error */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * REST API client
 */
export class ApiClient {
  private readonly config: ApiClientConfig;

  constructor(config: ApiClientConfig) {
    this.config = config;
  }

  /** GET request */
  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  /** POST request */
  async post<T>(path: string, data?: unknown): Promise<T> {
    return this.request<T>('POST', path, data);
  }

  /** PUT request */
  async put<T>(path: string, data?: unknown): Promise<T> {
    return this.request<T>('PUT', path, data);
  }

  /** DELETE request */
  async delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  /** Underlying request method */
  private request<T>(method: string, path: string, data?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const url = new URL(path, this.config.baseUrl);
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };

      if (this.config.token) {
        headers['Authorization'] = `Bearer ${this.config.token}`;
      }

      if (this.config.apiKey) {
        headers['X-API-Key'] = this.config.apiKey;
      }

      const body = data ? JSON.stringify(data) : undefined;
      if (body) {
        headers['Content-Length'] = Buffer.byteLength(body).toString();
      }

      const req = lib.request(
        {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          method,
          headers,
          timeout: this.config.timeout ?? 30000,
        },
        (res: http.IncomingMessage) => {
          let responseData = '';

          res.on('data', (chunk: Buffer) => {
            responseData += chunk.toString();
          });

          res.on('end', () => {
            const statusCode = res.statusCode ?? 0;

            if (statusCode < 200 || statusCode >= 300) {
              reject(
                new ApiError(
                  `API request failed: ${method} ${path} → ${statusCode}`,
                  statusCode,
                  responseData,
                ),
              );
              return;
            }

            // Try to parse JSON; on failure, return the raw string
            try {
              resolve(JSON.parse(responseData) as T);
            } catch {
              resolve(responseData as unknown as T);
            }
          });
        },
      );

      req.on('error', (err: Error) => {
        reject(new Error(`Network error: ${err.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timeout after ${this.config.timeout ?? 30000}ms`));
      });

      if (body) {
        req.write(body);
      }

      req.end();
    });
  }
}
