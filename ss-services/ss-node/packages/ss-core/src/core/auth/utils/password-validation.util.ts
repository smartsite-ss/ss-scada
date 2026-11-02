// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Password-strength validation util
 * Requirements: at least 8 characters, containing both letters and digits
 */
export function validatePasswordStrength(password: string): { valid: boolean; message?: string } {
  if (!password || password.length < 8) {
    return { valid: false, message: '密码长度至少8位' };
  }
  if (!/[a-zA-Z]/.test(password)) {
    return { valid: false, message: '密码必须包含至少一个字母' };
  }
  if (!/\d/.test(password)) {
    return { valid: false, message: '密码必须包含至少一个数字' };
  }
  return { valid: true };
}
