import { permanentError } from '../../shared/src/errors/runtime-error.js';

const EXACT_KEYS = new Set([
  'TIKTOK_ADS_APP_ID',
]);

export function isD1RuntimeConfigKeyAllowed(value) {
  if (typeof value !== 'string') return false;
  const key = value.trim();
  if (EXACT_KEYS.has(key)) return true;
  return /^LARK_TABLE_[A-Z0-9_]+$/u.test(key);
}

export function requireD1RuntimeConfigKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!isD1RuntimeConfigKeyAllowed(key)) {
    throw permanentError('D1 runtime config key is not allowlisted', {
      code: 'RUNTIME_CONFIG_KEY_NOT_ALLOWED',
      details: { configKey: key || null },
    });
  }
  return key;
}

export const D1_RUNTIME_CONFIG_BOOTSTRAP_KEYS = Object.freeze([
  'MKT_ENV',
  'MKT_CUSTOMER_PROFILE',
  'MKT_CONNECTION_CUSTOMER_KEY',
  'MKT_CONNECTION_PUBLIC_ORIGIN',
  'MKT_CONNECTION_ENCRYPTION_KEY_VERSION',
]);
