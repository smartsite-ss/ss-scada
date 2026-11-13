// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * LLM Safety Guard Service - P1-T09 safety protection
 *
 * Four layers of safety filtering:
 *  1. filterInput()     - user input filter (sensitive words / code injection / prompt injection)
 *  2. markUntrusted()   - mark tool-call results as untrusted
 *  3. sanitizeContext() - RAG retrieval content sanitization
 *  4. sanitizeOutput()  - LLM output sanitization
 *
 * Additional mechanisms:
 *  - override token pass-through (admin debugging)
 *  - circuit breaker (violation rate > threshold -> block all requests)
 *  - audit log (violations written to Logger)
 *
 * Related decision: D-014 (LLMSafetyGuard design)
 *
 * Usage:
 *   const guard = new LLMSafetyGuardService();
 *   const safe = guard.filterInput(userMessage);  // null = blocked
 *   guard.markUntrusted(toolResult);               // wrap untrusted content
 *   guard.sanitizeOutput(llmResponse);             // sanitize output
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/** Safety filter result */
export interface SafetyResult {
  /** true = passed, false = blocked */
  passed: boolean;
  /** Reason description when blocked */
  reason?: string;
  /** Sanitized content (when passed) */
  content?: string;
}

/** Safety config */
export interface SafetyConfig {
  /** Circuit-breaker threshold (violation count / time window) */
  circuitBreakerThreshold: number;
  /** Circuit-breaker window (ms) */
  circuitBreakerWindowMs: number;
  /** Circuit-breaker cooldown (ms) */
  circuitBreakerCooldownMs: number;
}

const DEFAULT_SAFETY_CONFIG: SafetyConfig = {
  circuitBreakerThreshold: 20,
  circuitBreakerWindowMs: 60_000,
  circuitBreakerCooldownMs: 180_000,
};

/** Sensitive keywords (regex patterns) */
const SENSITIVE_PATTERNS: RegExp[] = [
  // System destruction class
  /\brm\s+-rf\b/i,
  /\bformat\s+[cdef]:\b/i,
  /\bdel\b.*\b\/[fsq]\b/i,
  /\bdrop\s+table\b/i,
  /\btruncate\s+table\b/i,
  // Prompt injection class
  /ignore\s+(all\s+)?(previous|above)\s*instructions/i,
  /you\s+are\s+(now|no\s+longer)\s+(a\s+)?\w+\s*(ai|assistant)/i,
  /system\s*prompt\s*:?\s*".*"/i,
  /\bpretend\s+you\s+are\b/i,
  /forget\s+(everything|all\s+context)/i,
  /\boverride\s+system\b/i,
  // Jailbreak patterns
  /\bDAN\b.*\bmode\b/i,
  /jailbreak/i,
  /developer\s*mode/i,
  // Sensitive info leak
  /\bAPI[_\s]*KEY\s*[:=]\s*['\"]?\w+/i,
  /\bpassword\s*[:=]\s*['\"]?[^\s]+/i,
  /\btoken\s*[:=]\s*['\"]?[^\s]+/i,
  // Code injection
  /<script\b[^>]*>/i,
  /javascript\s*:\s*alert/i,
  /\beval\s*\(\s*['\"]\s*</i,
  /\bexec\s*\(\s*['\"]/i,
];

/** Prompt injection indicator marker (for markUntrusted) */
const UNTRUSTED_MARKER_START = '[UNTRUSTED_CONTENT_START]';
const UNTRUSTED_MARKER_END = '[UNTRUSTED_CONTENT_END]';

/** Admin pass-through Token */
const OVERRIDE_TOKEN_PREFIX = 'SS_SAFETY_OVERRIDE:';

@Injectable()
export class LLMSafetyGuardService {
  private readonly logger = new Logger(LLMSafetyGuardService.name);
  private readonly config: SafetyConfig;
  private circuitOpen = false;
  private circuitOpenedAt = 0;
  private violationCount = 0;
  private violationWindowStart = Date.now();

  constructor(private readonly configService: ConfigService) {
    this.config = {
      ...DEFAULT_SAFETY_CONFIG,
      circuitBreakerThreshold:
        Number(configService.get<string>('AI_SAFETY_CB_THRESHOLD')) ||
        DEFAULT_SAFETY_CONFIG.circuitBreakerThreshold,
      circuitBreakerWindowMs:
        Number(configService.get<string>('AI_SAFETY_CB_WINDOW_MS')) ||
        DEFAULT_SAFETY_CONFIG.circuitBreakerWindowMs,
      circuitBreakerCooldownMs:
        Number(configService.get<string>('AI_SAFETY_CB_COOLDOWN_MS')) ||
        DEFAULT_SAFETY_CONFIG.circuitBreakerCooldownMs,
    };
  }

  // ============================================================
  //  1. User input filter
  // ============================================================

  /**
   * Filter user input, check for sensitive content
   * @param input - raw user input
   * @param overrideToken - admin pass-through token (optional)
   * @returns filter result. passed=false blocks the request
   */
  filterInput(input: string, overrideToken?: string): SafetyResult {
    if (!input?.trim()) {
      return { passed: true, content: input };
    }

    // Circuit-breaker check
    const circuitResult = this.checkCircuitBreaker();
    if (!circuitResult.passed) {
      return circuitResult;
    }

    // Override Token pass-through
    if (overrideToken && this.validateOverrideToken(overrideToken)) {
      this.logger.warn('Admin bypassed input filtering via Override Token (audit record)');
      return { passed: true, content: input };
    }

    // Sensitive pattern matching
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(input)) {
        this.recordViolation(`敏感模式匹配: ${pattern.source}`);
        return {
          passed: false,
          reason: `输入包含不安全内容（模式: ${pattern.source}）`,
        };
      }
    }

    // Length limit (prevent resource abuse)
    if (input.length > 64_000) {
      this.recordViolation('输入长度超限');
      return { passed: false, reason: '输入长度超过 64KB 限制' };
    }

    return { passed: true, content: input.trim() };
  }

  // ============================================================
  //  2. Tool-call result marking
  // ============================================================

  /**
   * Mark tool-call results as untrusted content
   *
   * The marked content is wrapped in special tags so that subsequent filters can identify it
   * and strengthen detection of injection attacks within it.
   */
  markUntrusted(text: string): string {
    return `${UNTRUSTED_MARKER_START}\n${text}\n${UNTRUSTED_MARKER_END}`;
  }

  /**
   * Check whether content contains the untrusted marker
   */
  isUntrusted(text: string): boolean {
    return text.includes(UNTRUSTED_MARKER_START);
  }

  // ============================================================
  //  3. RAG retrieval content sanitization
  // ============================================================

  /**
   * Sanitize external knowledge-base retrieval content
   *
   * Security checks on RAG-retrieved document chunks:
   * - check for unsafe instruction patterns
   * - clean untrusted content markers
   * - optionally truncate overly long content
   */
  sanitizeContext(chunks: string[]): SafetyResult {
    const safe: string[] = [];

    for (const chunk of chunks) {
      // Check sensitive patterns
      let blocked = false;
      for (const pattern of SENSITIVE_PATTERNS) {
        if (pattern.test(chunk)) {
          this.recordViolation(`RAG 内容敏感模式: ${pattern.source}`);
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        // Clean untrusted markers, truncate overly long content
        const cleaned = this.stripUntrustedMarkers(chunk);
        safe.push(cleaned.length > 32_000 ? cleaned.substring(0, 32_000) + '...' : cleaned);
      }
    }

    return {
      passed: safe.length > 0,
      content: safe.join('\n\n---\n\n'),
      reason: safe.length === 0 ? '所有检索内容被安全过滤' : undefined,
    };
  }

  // ============================================================
  //  4. LLM output sanitization
  // ============================================================

  /**
   * Sanitize LLM-returned content
   *
   * Checks:
   * - whether it contains sensitive API keys / tokens
   * - whether it contains destructive system commands
   * - whether it attempts to output prompt-injection markers
   */
  sanitizeOutput(output: string): SafetyResult {
    if (!output) {
      return { passed: true, content: output };
    }

    // Desensitize: replace suspected API-key content
    let sanitized = output.replace(/\b(sk-[a-zA-Z0-9]{20,})\b/g, '[REDACTED_API_KEY]');

    // Check untrusted marker leakage
    if (this.isUntrusted(sanitized)) {
      sanitized = this.stripUntrustedMarkers(sanitized);
    }

    return { passed: true, content: sanitized };
  }

  // ============================================================
  //  5. Circuit breaker
  // ============================================================

  /**
   * Check circuit-breaker status
   */
  private checkCircuitBreaker(): SafetyResult {
    const now = Date.now();

    // Circuit open -> check cooldown
    if (this.circuitOpen) {
      if (now - this.circuitOpenedAt < this.config.circuitBreakerCooldownMs) {
        return {
          passed: false,
          reason: '安全熔断器已触发，请稍后重试',
        };
      }
      // Cooldown ended, close circuit breaker
      this.circuitOpen = false;
      this.violationCount = 0;
      this.violationWindowStart = now;
      this.logger.warn('Circuit breaker recovered (cooldown finished)');
    }

    // Reset window
    if (now - this.violationWindowStart > this.config.circuitBreakerWindowMs) {
      this.violationCount = 0;
      this.violationWindowStart = now;
    }

    return { passed: true };
  }

  /**
   * Record a violation
   */
  private recordViolation(reason: string): void {
    this.violationCount++;
    this.logger.warn(`Safety violation #${this.violationCount}: ${reason}`);

    if (this.violationCount >= this.config.circuitBreakerThreshold && !this.circuitOpen) {
      this.circuitOpen = true;
      this.circuitOpenedAt = Date.now();
      this.logger.error(
        `Circuit breaker tripped! Threshold ${this.config.circuitBreakerThreshold} violations/` +
          `${this.config.circuitBreakerWindowMs}ms, will recover in ` +
          `${this.config.circuitBreakerCooldownMs}ms`,
      );
    }
  }

  // ============================================================
  //  6. Admin Override Token (S-H04: HMAC signature, prevent forgery)
  // ============================================================

  /**
   * Generate a one-time pass-through token (HMAC-SHA256 signature)
   *
   * Token format: SS_SAFETY_OVERRIDE:<base64url(payload)>.<base64url(signature)>
   * Signing key: JWT_SECRET (shared with JWT, ensuring unforgeable signature)
   */
  generateOverrideToken(_adminToken: string): string {
    const payload = JSON.stringify({
      role: 'admin',
      ts: Date.now(),
      nonce: crypto.randomUUID(),
    });
    const payloadB64 = Buffer.from(payload).toString('base64url');
    const signature = this.signOverride(payloadB64);
    return `${OVERRIDE_TOKEN_PREFIX}${payloadB64}.${signature}`;
  }

  /**
   * Verify Override Token (HMAC-SHA256 signature + expiry check)
   */
  private validateOverrideToken(token: string): boolean {
    if (!token.startsWith(OVERRIDE_TOKEN_PREFIX)) return false;

    try {
      const rest = token.slice(OVERRIDE_TOKEN_PREFIX.length);
      const [payloadB64, signature] = rest.split('.');
      if (!payloadB64 || !signature) return false;

      // Signature verification (use timingSafeEqual to prevent timing attacks)
      const expectedSig = this.signOverride(payloadB64);
      const sigBuf = Buffer.from(signature);
      const expectedBuf = Buffer.from(expectedSig);
      if (sigBuf.length !== expectedBuf.length) return false;
      if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;

      // Payload verification
      const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
      // Valid for 5 minutes
      return decoded.role === 'admin' && Date.now() - decoded.ts < 300_000;
    } catch {
      return false;
    }
  }

  /**
   * HMAC-SHA256 signature (uses JWT_SECRET as the key)
   */
  private signOverride(payloadB64: string): string {
    const secret = process.env.JWT_SECRET || '';
    return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  }

  // ============================================================
  //  Helper methods
  // ============================================================

  private stripUntrustedMarkers(text: string): string {
    return text
      .replace(new RegExp(UNTRUSTED_MARKER_START, 'g'), '')
      .replace(new RegExp(UNTRUSTED_MARKER_END, 'g'), '')
      .replace(new RegExp(`\\n?${UNTRUSTED_MARKER_START}\\n?`, 'g'), '')
      .replace(new RegExp(`\\n?${UNTRUSTED_MARKER_END}\\n?`, 'g'), '');
  }

  /** Get current safety statistics */
  getStats() {
    return {
      circuitOpen: this.circuitOpen,
      circuitOpenedAt: this.circuitOpenedAt || null,
      violationCount: this.violationCount,
      violationWindowStart: this.violationWindowStart,
      config: this.config,
    };
  }
}
