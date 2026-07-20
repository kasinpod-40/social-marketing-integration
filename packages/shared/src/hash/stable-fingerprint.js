import { permanentError } from '../errors/runtime-error.js';

/**
 * สร้าง SHA-256 จากข้อมูล JSON-like แบบเรียง Key คงที่
 * ใช้ตรวจว่าข้อมูล Source เปลี่ยนจริงหรือเป็นเพียง metadata refresh จาก Connector
 */
export async function createStableFingerprint(value, options = {}) {
  const serialized = stableSerialize(value);
  const digest = options.digestImpl ?? globalThis.crypto?.subtle?.digest?.bind(globalThis.crypto.subtle);
  if (typeof digest !== 'function') {
    throw permanentError('SHA-256 digest is unavailable in this runtime', {
      code: 'MKT_FINGERPRINT_RUNTIME_UNAVAILABLE',
    });
  }

  const bytes = new TextEncoder().encode(serialized);
  const hash = await digest('SHA-256', bytes);
  return toHex(hash);
}

/** Serialize ค่า JSON-like โดยเรียง Object key และไม่พึ่ง insertion order */
export function stableSerialize(value) {
  if (value === null) return 'null';

  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw permanentError('Stable fingerprint rejects non-finite numbers', {
        code: 'MKT_FINGERPRINT_INVALID_VALUE',
      });
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }

  if (typeof value === 'bigint') return JSON.stringify({ $bigint: value.toString() });
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw permanentError('Stable fingerprint rejects invalid Date values', {
        code: 'MKT_FINGERPRINT_INVALID_VALUE',
      });
    }
    return JSON.stringify({ $date: value.toISOString() });
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item === undefined ? null : item)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`);
    return `{${entries.join(',')}}`;
  }

  throw permanentError(`Stable fingerprint rejects unsupported value type: ${typeof value}`, {
    code: 'MKT_FINGERPRINT_INVALID_VALUE',
  });
}

/** แปลง ArrayBuffer/TypedArray เป็น Hex lowercase */
function toHex(value) {
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
