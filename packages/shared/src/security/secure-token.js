import { permanentError } from '../errors/runtime-error.js';
import { stableSerialize } from '../hash/stable-fingerprint.js';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });
const HMAC_ALGORITHM = Object.freeze({ name: 'HMAC', hash: 'SHA-256' });
const AES_ALGORITHM = 'AES-GCM';
const AES_KEY_BYTES = 32;
const AES_IV_BYTES = 12;
const MIN_SIGNING_KEY_BYTES = 32;
const MAX_COMPACT_TOKEN_BYTES = 8_192;

/** สร้าง nonce/token ด้วย CSPRNG และ encode แบบ Base64URL ไม่มี padding */
export function createSecureRandomToken(byteLength = 32, cryptoImpl = globalThis.crypto) {
  const length = requireIntegerRange(byteLength, 16, 128, 'byteLength');
  const bytes = new Uint8Array(length);
  requireCrypto(cryptoImpl).getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

/** SHA-256 สำหรับเก็บ nonce/token fingerprint โดยไม่ Persist ค่า Token จริง */
export async function hashSecureToken(value, cryptoImpl = globalThis.crypto) {
  const bytes = TEXT_ENCODER.encode(requireText(value, 'token'));
  const digest = await requireCrypto(cryptoImpl).subtle.digest('SHA-256', bytes);
  return encodeBase64Url(new Uint8Array(digest));
}

/**
 * เปรียบเทียบ Secret text โดยไม่ใช้ early-return ตาม byte ที่ต่างกัน
 * Workers รุ่นที่รองรับ timingSafeEqual จะใช้ native primitive; runtime อื่นใช้ constant-work XOR fallback
 * หลัง hash ให้มีความยาวคงที่ก่อนเปรียบเทียบเสมอ.
 */
export async function timingSafeEqualText(left, right, cryptoImpl = globalThis.crypto) {
  const cryptoValue = requireCrypto(cryptoImpl);
  const [leftDigest, rightDigest] = await Promise.all([
    cryptoValue.subtle.digest('SHA-256', TEXT_ENCODER.encode(String(left ?? ''))),
    cryptoValue.subtle.digest('SHA-256', TEXT_ENCODER.encode(String(right ?? ''))),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  if (typeof cryptoValue.subtle.timingSafeEqual === 'function') {
    return cryptoValue.subtle.timingSafeEqual(leftBytes, rightBytes);
  }
  let difference = 0;
  for (let index = 0; index < leftBytes.byteLength; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

/** สร้าง compact signed payload: base64url(canonical JSON).base64url(HMAC-SHA-256) */
export async function signCompactPayload(payload, signingKey, options = {}) {
  const cryptoImpl = requireCrypto(options.cryptoImpl ?? globalThis.crypto);
  const key = await importHmacKey(signingKey, cryptoImpl);
  const serialized = stableSerialize(requirePlainObject(payload, 'signed payload'));
  const encodedPayload = encodeBase64Url(TEXT_ENCODER.encode(serialized));
  const signature = await cryptoImpl.subtle.sign(
    HMAC_ALGORITHM.name,
    key,
    TEXT_ENCODER.encode(encodedPayload),
  );
  return `${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

/** ตรวจ HMAC ก่อน Parse payload และคืน Object ที่ Freeze แล้ว */
export async function verifyCompactPayload(token, signingKey, options = {}) {
  const cryptoImpl = requireCrypto(options.cryptoImpl ?? globalThis.crypto);
  const compact = requireBoundedToken(token);
  const parts = compact.split('.');
  if (parts.length !== 2 || parts.some((part) => part === '')) {
    throw invalidSignature();
  }
  const [encodedPayload, encodedSignature] = parts;
  let signature;
  let payloadBytes;
  try {
    signature = decodeBase64Url(encodedSignature);
    payloadBytes = decodeBase64Url(encodedPayload);
  } catch {
    throw invalidSignature();
  }
  const key = await importHmacKey(signingKey, cryptoImpl);
  const valid = await cryptoImpl.subtle.verify(
    HMAC_ALGORITHM.name,
    key,
    signature,
    TEXT_ENCODER.encode(encodedPayload),
  );
  if (!valid) throw invalidSignature();

  try {
    const payload = JSON.parse(TEXT_DECODER.decode(payloadBytes));
    return deepFreeze(requirePlainObject(payload, 'signed payload'));
  } catch (cause) {
    throw permanentError('Signed payload is invalid', {
      code: 'CONNECTION_SIGNED_PAYLOAD_INVALID',
      cause,
    });
  }
}

/** AES-256-GCM พร้อม random IV และ AAD ที่ผูก Credential กับ Connection/purpose */
export async function encryptSecret(plaintext, keyMaterial, options = {}) {
  const cryptoImpl = requireCrypto(options.cryptoImpl ?? globalThis.crypto);
  const key = await importAesKey(keyMaterial, ['encrypt'], cryptoImpl);
  const iv = new Uint8Array(AES_IV_BYTES);
  cryptoImpl.getRandomValues(iv);
  const additionalData = encodeAuthenticatedContext(options.authenticatedContext);
  const ciphertext = await cryptoImpl.subtle.encrypt(
    { name: AES_ALGORITHM, iv, additionalData, tagLength: 128 },
    key,
    TEXT_ENCODER.encode(requireText(plaintext, 'plaintext')),
  );
  return Object.freeze({
    algorithm: 'AES-256-GCM',
    keyVersion: requireText(options.keyVersion, 'keyVersion'),
    iv: encodeBase64Url(iv),
    ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
  });
}

/** ถอด AES-GCM แบบ fail-closed; tamper/AAD/key mismatch ไม่คืน plaintext */
export async function decryptSecret(envelope, keyMaterial, options = {}) {
  const cryptoImpl = requireCrypto(options.cryptoImpl ?? globalThis.crypto);
  const value = requirePlainObject(envelope, 'encrypted envelope');
  if (value.algorithm !== 'AES-256-GCM') {
    throw permanentError('Encrypted credential algorithm is unsupported', {
      code: 'CONNECTION_CREDENTIAL_ALGORITHM_UNSUPPORTED',
    });
  }
  const expectedVersion = requireText(options.keyVersion, 'keyVersion');
  if (requireText(value.keyVersion, 'envelope.keyVersion') !== expectedVersion) {
    throw permanentError('Encrypted credential key version does not match', {
      code: 'CONNECTION_CREDENTIAL_KEY_VERSION_MISMATCH',
    });
  }

  try {
    const iv = decodeBase64Url(requireText(value.iv, 'envelope.iv'));
    if (iv.byteLength !== AES_IV_BYTES) throw new TypeError('invalid IV length');
    const ciphertext = decodeBase64Url(requireText(value.ciphertext, 'envelope.ciphertext'));
    const key = await importAesKey(keyMaterial, ['decrypt'], cryptoImpl);
    const plaintext = await cryptoImpl.subtle.decrypt(
      {
        name: AES_ALGORITHM,
        iv,
        additionalData: encodeAuthenticatedContext(options.authenticatedContext),
        tagLength: 128,
      },
      key,
      ciphertext,
    );
    return TEXT_DECODER.decode(plaintext);
  } catch (cause) {
    throw permanentError('Encrypted credential could not be decrypted', {
      code: 'CONNECTION_CREDENTIAL_DECRYPT_FAILED',
      cause,
    });
  }
}

/** Decode key จาก Base64URL; ต้องเป็น 256-bit จริงและห้าม derive จาก password อ่อน */
export function decodeEncryptionKey(value) {
  let bytes;
  try {
    bytes = decodeBase64Url(requireText(value, 'encryption key'));
  } catch (cause) {
    throw permanentError('Connection encryption key is invalid', {
      code: 'CONNECTION_ENCRYPTION_KEY_INVALID',
      cause,
    });
  }
  if (bytes.byteLength !== AES_KEY_BYTES) {
    throw permanentError('Connection encryption key must be 256-bit Base64URL', {
      code: 'CONNECTION_ENCRYPTION_KEY_INVALID',
    });
  }
  return bytes;
}

export function encodeBase64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

export function decodeBase64Url(value) {
  const text = requireText(value, 'base64url');
  if (!/^[A-Za-z0-9_-]+$/u.test(text)) throw new TypeError('invalid Base64URL');
  const padding = '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/') + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function importHmacKey(value, cryptoImpl) {
  const bytes = TEXT_ENCODER.encode(requireText(value, 'signing key'));
  if (bytes.byteLength < MIN_SIGNING_KEY_BYTES) {
    throw permanentError('Connection signing key is too short', {
      code: 'CONNECTION_SIGNING_KEY_INVALID',
    });
  }
  return cryptoImpl.subtle.importKey('raw', bytes, HMAC_ALGORITHM, false, ['sign', 'verify']);
}

async function importAesKey(value, usages, cryptoImpl) {
  return cryptoImpl.subtle.importKey(
    'raw',
    decodeEncryptionKey(value),
    { name: AES_ALGORITHM, length: 256 },
    false,
    usages,
  );
}

function encodeAuthenticatedContext(value) {
  return TEXT_ENCODER.encode(stableSerialize(requirePlainObject(
    value,
    'authenticatedContext',
  )));
}

function invalidSignature() {
  return permanentError('Signed payload verification failed', {
    code: 'CONNECTION_SIGNATURE_INVALID',
  });
}

function requireBoundedToken(value) {
  const text = requireText(value, 'compact token');
  if (TEXT_ENCODER.encode(text).byteLength > MAX_COMPACT_TOKEN_BYTES) {
    throw permanentError('Signed payload exceeds the allowed size', {
      code: 'CONNECTION_SIGNED_PAYLOAD_TOO_LARGE',
    });
  }
  return text;
}

function requireCrypto(value) {
  if (
    typeof value?.getRandomValues !== 'function'
    || typeof value?.subtle?.importKey !== 'function'
    || typeof value?.subtle?.sign !== 'function'
    || typeof value?.subtle?.verify !== 'function'
  ) {
    throw permanentError('Web Crypto is unavailable', {
      code: 'CONNECTION_CRYPTO_UNAVAILABLE',
    });
  }
  return value;
}

function requirePlainObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function requireIntegerRange(value, minimum, maximum, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new TypeError(`${fieldName} must be an integer between ${minimum} and ${maximum}`);
  }
  return number;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
