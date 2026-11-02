// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Lightweight HTTP client util - P1-T01 LLM API access
 *
 * Uses Node.js built-in http/https modules to avoid extra deps like axios.
 * Supports:
 *   - POST requests (JSON body)
 *   - Streaming responses (SSE parsing)
 *   - Timeout control
 *   - Bearer token auth
 *
 * Only used for AI provider cloud API calls; does not replace other HTTP clients in the project.
 */

import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

export interface HttpRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: any;
  /** Request timeout (ms) */
  timeoutMs?: number;
  /** Whether streaming response (true: returns AsyncGenerator; false: returns buffer) */
  stream?: boolean;
}

export interface HttpResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** HTTP error (non-2xx) */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly statusText: string,
    public readonly body: string,
    public readonly url: string,
  ) {
    super(`HTTP ${statusCode} ${statusText} — ${url}: ${body.slice(0, 500)}`);
    this.name = 'HttpError';
  }
}

/** Timeout error */
export class HttpTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`);
    this.name = 'HttpTimeoutError';
  }
}

/**
 * Send an HTTP request and return the full response (non-streaming)
 */
export function httpRequest(options: HttpRequestOptions): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(options.url);
    const lib = url.protocol === 'https:' ? https : http;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers || {}),
    };

    const bodyStr = options.body != null ? JSON.stringify(options.body) : '';
    if (bodyStr && !headers['Content-Length']) {
      headers['Content-Length'] = Buffer.byteLength(bodyStr).toString();
    }

    const req = lib.request(
      url,
      {
        method: options.method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body,
            });
          } else {
            reject(new HttpError(res.statusCode || 0, res.statusMessage || '', body, options.url));
          }
        });
      },
    );

    req.on('error', (err) => reject(err));

    if (options.timeoutMs) {
      req.setTimeout(options.timeoutMs, () => {
        req.destroy(new HttpTimeoutError(options.url, options.timeoutMs!));
      });
    }

    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

/**
 * Send an HTTP request and return the response as a stream (SSE/Stream)
 *
 * Yields string chunks (already UTF-8 decoded).
 */
export async function* httpStream(
  options: HttpRequestOptions,
): AsyncGenerator<string, void, unknown> {
  const url = new URL(options.url);
  const lib = url.protocol === 'https:' ? https : http;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    ...(options.headers || {}),
  };

  const bodyStr = options.body != null ? JSON.stringify(options.body) : '';
  if (bodyStr && !headers['Content-Length']) {
    headers['Content-Length'] = Buffer.byteLength(bodyStr).toString();
  }

  // Await the response headers via a Promise first, then return the inner AsyncGenerator
  const generator = await new Promise<AsyncGenerator<string, void, unknown>>((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method: options.method,
        headers,
      },
      (res) => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            reject(
              new HttpError(
                res.statusCode || 0,
                res.statusMessage || '',
                Buffer.concat(chunks).toString('utf-8'),
                options.url,
              ),
            );
          });
          return;
        }

        async function* gen(): AsyncGenerator<string, void, unknown> {
          for await (const chunk of res) {
            yield chunk.toString('utf-8');
          }
        }

        resolve(gen());
      },
    );

    req.on('error', (err) => reject(err));

    if (options.timeoutMs) {
      req.setTimeout(options.timeoutMs, () => {
        req.destroy(new HttpTimeoutError(options.url, options.timeoutMs!));
      });
    }

    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });

  // Forward chunks from the underlying stream
  yield* generator;
}

/**
 * Parse an SSE text stream, extracting the content of data: fields
 *
 * SSE protocol format (OpenAI-compatible):
 *   data: {"id":...}\n\n
 *   data: {"id":...}\n\n
 *   data: [DONE]\n\n
 */
export async function* parseSSEStream(
  stream: AsyncGenerator<string, void, unknown>,
): AsyncGenerator<string, void, unknown> {
  let buffer = '';
  for await (const chunk of stream) {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of rawEvent.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data:')) {
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') {
            return;
          }
          if (data) {
            yield data;
          }
        }
      }
    }
  }
}
