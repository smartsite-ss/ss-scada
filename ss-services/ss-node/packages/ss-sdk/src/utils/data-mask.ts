// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Data masking utilities
 *
 * Masks sensitive information in logs, API responses, etc.; supports common field types and recursive object masking.
 */
export class DataMask {
  /**
   * Generic string masking (keeps the original length, fills the middle with `*`)
   * @param str the original string
   * @param startKeep number of characters to keep at the start
   * @param endKeep number of characters to keep at the end
   * @returns the masked string
   */
  static maskString(str: string, startKeep: number, endKeep: number): string {
    if (!str) return '';
    const start = Math.max(0, startKeep);
    const end = Math.max(0, endKeep);
    if (start + end >= str.length) {
      return '*'.repeat(str.length);
    }
    const head = str.slice(0, start);
    const tail = str.slice(str.length - end);
    const maskLen = str.length - start - end;
    return head + '*'.repeat(maskLen) + tail;
  }

  /**
   * Phone number masking (keeps length, e.g. `138****5678`)
   * @param phone the phone number
   * @returns the masked phone number
   */
  static maskPhone(phone: string): string {
    if (!phone) return '';
    if (phone.length < 7) {
      return '*'.repeat(phone.length);
    }
    return this.maskString(phone, 3, 4);
  }

  /**
   * Email masking (e.g. `a***@example.com`)
   * @param email the email address
   * @returns the masked email
   */
  static maskEmail(email: string): string {
    if (!email || !email.includes('@')) return email ?? '';
    const atIndex = email.indexOf('@');
    const local = email.slice(0, atIndex);
    const domain = email.slice(atIndex);
    if (local.length === 0) return email;
    return local[0] + '***' + domain;
  }

  /**
   * ID card number masking (keeps length, e.g. `110***********1234`)
   * @param idCard the ID card number
   * @returns the masked ID card number
   */
  static maskIdCard(idCard: string): string {
    if (!idCard) return '';
    if (idCard.length < 8) {
      return '*'.repeat(idCard.length);
    }
    return this.maskString(idCard, 3, 4);
  }

  /**
   * Password masking (always returns `******`)
   * @returns `******`
   */
  static maskPassword(): string {
    return '******';
  }

  /**
   * IP address masking (masks the third segment, e.g. `192.168.*.1`)
   * @param ip the IPv4 address
   * @returns the masked IP
   */
  static maskIp(ip: string): string {
    if (!ip) return '';
    const parts = ip.split('.');
    if (parts.length !== 4) return ip;
    parts[2] = '*';
    return parts.join('.');
  }

  /**
   * Object field masking (recursively processes nested objects and arrays)
   *
   * Fields whose names match `fields` have their values replaced with `******`.
   * Arrays and nested objects are processed recursively.
   *
   * @param obj the original object
   * @param fields list of field names to mask
   * @returns the masked object (shallow copy; the original object is not modified)
   */
  static maskObject<T>(obj: T, fields: string[]): T {
    if (obj === null || obj === undefined) return obj;
    const fieldsSet = new Set(fields);

    const process = (value: unknown): unknown => {
      if (value === null || value === undefined) return value;
      if (Array.isArray(value)) {
        return value.map(process);
      }
      if (typeof value === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
          if (fieldsSet.has(key)) {
            result[key] = '******';
          } else {
            result[key] = process(entryValue);
          }
        }
        return result;
      }
      return value;
    };

    if (typeof obj !== 'object') return obj;
    return process(obj) as T;
  }

  /**
   * JSON string masking
   *
   * Parses the JSON string, recursively masks the specified fields, then re-serializes.
   * If JSON parsing fails, the original string is returned.
   *
   * @param json the JSON string
   * @param fields list of field names to mask
   * @returns the masked JSON string
   */
  static maskJson(json: string, fields: string[]): string {
    try {
      const parsed = JSON.parse(json) as unknown;
      const masked = this.maskObject(parsed, fields);
      return JSON.stringify(masked);
    } catch {
      return json;
    }
  }
}
