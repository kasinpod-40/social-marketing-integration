import {
  GOOGLE_ADS_MANAGER_DELIVERY_PATH,
  GOOGLE_ADS_MANAGER_TRANSPORT_LIMITS,
  createGoogleAdsManagerIdempotencyKey,
  validateGoogleAdsManagerDeliveryChunk,
} from '../../../config/src/google-ads-manager-script-delivery-contract.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';
import { stableSerialize } from '../../../shared/src/hash/stable-fingerprint.js';
import { encodeBase64Url } from '../../../shared/src/security/secure-token.js';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });
const HMAC_ALGORITHM = Object.freeze({ name: 'HMAC', hash: 'SHA-256' });
const MIN_SIGNING_KEY_BYTES = 32;

export const GOOGLE_ADS_MANAGER_DELIVERY_HEADERS = Object.freeze({
  keyId: 'x-mkt-key-id',
  timestamp: 'x-mkt-timestamp',
  nonce: 'x-mkt-nonce',
  idempotencyKey: 'x-mkt-idempotency-key',
  contentSha256: 'x-mkt-content-sha256',
  signature: 'x-mkt-signature',
});

/**
 * ตรวจ Transport/Auth/Canonical body แบบ pure ก่อน D1 nonce reservation.
 * คืนเฉพาะ fingerprint/identity ที่ปลอดภัยต่อขั้น Persistence และไม่คืน Secret/Nonce/raw body.
 */
export async function verifyGoogleAdsManagerSignedDelivery(input = {}) {
  const cryptoImpl = requireCrypto(input.cryptoImpl ?? globalThis.crypto);
  assertRequestTarget(input);
  const headers = readSignedHeaders(input.headers);
  const bodyBytes = readBoundedBody(input.body);
  const bodyDigest = await sha256Hex(bodyBytes, cryptoImpl);
  if (headers.contentSha256 !== bodyDigest) {
    throw securityError('Signed delivery body digest does not match', 'GOOGLE_ADS_DELIVERY_DIGEST_INVALID');
  }
  const timestampSeconds = validateTimestamp(headers.timestamp, input.now ?? Date.now());
  const key = resolveSigningKey(input.keyring, headers.keyId);
  const canonicalInput = createGoogleAdsManagerSigningInput({
    timestamp: headers.timestamp,
    nonce: headers.nonce,
    idempotencyKey: headers.idempotencyKey,
    contentSha256: headers.contentSha256,
  });
  await verifyHmac({
    signature: headers.signature,
    canonicalInput,
    secret: key.secret,
    cryptoImpl,
  });
  const nonceFingerprint = await sha256Base64Url(headers.nonce, cryptoImpl);
  const bodyText = decodeBody(bodyBytes);
  const envelope = parseCanonicalEnvelope(bodyText);
  const validatedEnvelope = validateGoogleAdsManagerDeliveryChunk(envelope, {
    runtimeIdentity: input.runtimeIdentity,
    headerTimestampSeconds: timestampSeconds,
  });
  const expectedIdempotencyKey = createGoogleAdsManagerIdempotencyKey(validatedEnvelope);
  if (headers.idempotencyKey !== expectedIdempotencyKey) {
    throw securityError(
      'Signed delivery idempotency key does not match the body',
      'GOOGLE_ADS_DELIVERY_IDEMPOTENCY_CONFLICT',
    );
  }

  return deepFreeze({
    envelope: validatedEnvelope,
    bodyDigest,
    nonceFingerprint,
    idempotencyKey: expectedIdempotencyKey,
    timestampSeconds,
    keySlot: key.slot,
  });
}

/** สร้าง Header ชุดเดียวกับ Manager Script เพื่อใช้ Fixture/contract tests เท่านั้น */
export async function signGoogleAdsManagerDelivery(input = {}) {
  const cryptoImpl = requireCrypto(input.cryptoImpl ?? globalThis.crypto);
  const body = typeof input.body === 'string'
    ? input.body
    : stableSerialize(input.body);
  const bodyBytes = readBoundedBody(body);
  const keyId = requirePattern(input.keyId, 'keyId', /^[A-Za-z0-9._-]{1,64}$/u);
  const timestamp = requirePattern(String(input.timestamp), 'timestamp', /^\d{10}$/u);
  const nonce = requirePattern(input.nonce, 'nonce', /^[A-Za-z0-9_-]{22}$/u);
  const idempotencyKey = requireText(input.idempotencyKey, 'idempotencyKey');
  const contentSha256 = await sha256Hex(bodyBytes, cryptoImpl);
  const canonicalInput = createGoogleAdsManagerSigningInput({
    timestamp,
    nonce,
    idempotencyKey,
    contentSha256,
  });
  const signature = await createHmacHex(canonicalInput, input.secret, cryptoImpl);
  return deepFreeze({
    body,
    headers: {
      'content-type': 'application/json',
      [GOOGLE_ADS_MANAGER_DELIVERY_HEADERS.keyId]: keyId,
      [GOOGLE_ADS_MANAGER_DELIVERY_HEADERS.timestamp]: timestamp,
      [GOOGLE_ADS_MANAGER_DELIVERY_HEADERS.nonce]: nonce,
      [GOOGLE_ADS_MANAGER_DELIVERY_HEADERS.idempotencyKey]: idempotencyKey,
      [GOOGLE_ADS_MANAGER_DELIVERY_HEADERS.contentSha256]: contentSha256,
      [GOOGLE_ADS_MANAGER_DELIVERY_HEADERS.signature]: `sha256=${signature}`,
    },
  });
}

export function createGoogleAdsManagerSigningInput(input = {}) {
  return [
    'MKT-HMAC-SHA256-V1',
    'POST',
    GOOGLE_ADS_MANAGER_DELIVERY_PATH,
    requirePattern(String(input.timestamp), 'timestamp', /^\d{10}$/u),
    requirePattern(input.nonce, 'nonce', /^[A-Za-z0-9_-]{22}$/u),
    requireText(input.idempotencyKey, 'idempotencyKey'),
    requirePattern(input.contentSha256, 'contentSha256', /^[a-f0-9]{64}$/u),
  ].join('\n');
}

function assertRequestTarget(input) {
  if (input.method !== 'POST') {
    throw securityError('Signed delivery requires POST', 'GOOGLE_ADS_DELIVERY_REQUEST_INVALID');
  }
  let url;
  try {
    url = new URL(requireText(input.url, 'url'));
  } catch (cause) {
    throw securityError('Signed delivery URL is invalid', 'GOOGLE_ADS_DELIVERY_REQUEST_INVALID', cause);
  }
  if (
    url.protocol !== 'https:'
    || url.pathname !== GOOGLE_ADS_MANAGER_DELIVERY_PATH
    || url.search !== ''
    || url.hash !== ''
  ) {
    throw securityError('Signed delivery target is not allowed', 'GOOGLE_ADS_DELIVERY_REQUEST_INVALID');
  }
}

function readSignedHeaders(source) {
  const contentType = readSingleHeader(source, 'content-type');
  if (contentType.toLowerCase() !== 'application/json') {
    throw securityError(
      'Signed delivery Content-Type must be application/json',
      'GOOGLE_ADS_DELIVERY_REQUEST_INVALID',
    );
  }
  return Object.freeze({
    keyId: requirePattern(
      readSingleHeader(source, GOOGLE_ADS_MANAGER_DELIVERY_HEADERS.keyId),
      'keyId',
      /^[A-Za-z0-9._-]{1,64}$/u,
    ),
    timestamp: requirePattern(
      readSingleHeader(source, GOOGLE_ADS_MANAGER_DELIVERY_HEADERS.timestamp),
      'timestamp',
      /^\d{10}$/u,
    ),
    nonce: requirePattern(
      readSingleHeader(source, GOOGLE_ADS_MANAGER_DELIVERY_HEADERS.nonce),
      'nonce',
      /^[A-Za-z0-9_-]{22}$/u,
    ),
    idempotencyKey: requirePattern(
      readSingleHeader(source, GOOGLE_ADS_MANAGER_DELIVERY_HEADERS.idempotencyKey),
      'idempotencyKey',
      /^google-ads:[0-9a-f-]{36}:[A-Za-z]+:\d+$/u,
    ),
    contentSha256: requirePattern(
      readSingleHeader(source, GOOGLE_ADS_MANAGER_DELIVERY_HEADERS.contentSha256),
      'contentSha256',
      /^[a-f0-9]{64}$/u,
    ),
    signature: requirePattern(
      readSingleHeader(source, GOOGLE_ADS_MANAGER_DELIVERY_HEADERS.signature),
      'signature',
      /^sha256=[a-f0-9]{64}$/u,
    ),
  });
}

function readSingleHeader(source, headerName) {
  if (!source || (typeof source !== 'object' && typeof source?.get !== 'function')) {
    throw securityError('Signed delivery headers are required', 'GOOGLE_ADS_DELIVERY_REQUEST_INVALID');
  }
  let values;
  if (typeof source.get === 'function') {
    const value = source.get(headerName);
    values = value === null ? [] : [value];
  } else {
    const matches = Object.entries(source)
      .filter(([name]) => name.toLowerCase() === headerName)
      .flatMap(([, value]) => (Array.isArray(value) ? value : [value]));
    values = matches;
  }
  if (
    values.length !== 1
    || typeof values[0] !== 'string'
    || values[0].trim() === ''
    || values[0].includes(',')
  ) {
    throw securityError(
      `Signed delivery requires one ${headerName} header`,
      'GOOGLE_ADS_DELIVERY_REQUEST_INVALID',
    );
  }
  return values[0].trim();
}

function readBoundedBody(value) {
  let bytes;
  if (typeof value === 'string') bytes = TEXT_ENCODER.encode(value);
  else if (value instanceof Uint8Array) bytes = value;
  else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
  else {
    throw securityError('Signed delivery body must be UTF-8 bytes', 'GOOGLE_ADS_DELIVERY_BODY_INVALID');
  }
  if (bytes.byteLength === 0 || bytes.byteLength > GOOGLE_ADS_MANAGER_TRANSPORT_LIMITS.bodyBytes) {
    throw securityError('Signed delivery body size is invalid', 'GOOGLE_ADS_DELIVERY_BODY_INVALID');
  }
  return bytes;
}

function decodeBody(bytes) {
  try {
    return TEXT_DECODER.decode(bytes);
  } catch (cause) {
    throw securityError('Signed delivery body is not valid UTF-8', 'GOOGLE_ADS_DELIVERY_BODY_INVALID', cause);
  }
}

function parseCanonicalEnvelope(bodyText) {
  let envelope;
  try {
    envelope = JSON.parse(bodyText);
  } catch (cause) {
    throw securityError('Signed delivery body is not valid JSON', 'GOOGLE_ADS_DELIVERY_BODY_INVALID', cause);
  }
  let canonical;
  try {
    canonical = stableSerialize(envelope);
  } catch (cause) {
    throw securityError('Signed delivery body cannot be canonicalized', 'GOOGLE_ADS_DELIVERY_BODY_INVALID', cause);
  }
  if (canonical !== bodyText) {
    throw securityError('Signed delivery body is not canonical JSON', 'GOOGLE_ADS_DELIVERY_BODY_INVALID');
  }
  return envelope;
}

function validateTimestamp(value, now) {
  const timestampSeconds = Number(value);
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isSafeInteger(timestampSeconds) || !Number.isFinite(nowMs)) {
    throw securityError('Signed delivery timestamp is invalid', 'GOOGLE_ADS_DELIVERY_TIMESTAMP_INVALID');
  }
  const nowSeconds = Math.trunc(nowMs / 1_000);
  if (Math.abs(nowSeconds - timestampSeconds) > GOOGLE_ADS_MANAGER_TRANSPORT_LIMITS.clockSkewSeconds) {
    throw securityError('Signed delivery timestamp is outside the allowed window', 'GOOGLE_ADS_DELIVERY_TIMESTAMP_INVALID');
  }
  return timestampSeconds;
}

function resolveSigningKey(value, keyId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw securityError('Signed delivery keyring is unavailable', 'GOOGLE_ADS_DELIVERY_SIGNATURE_INVALID');
  }
  for (const slot of ['current', 'previous']) {
    const candidate = value[slot];
    if (!candidate) continue;
    if (
      typeof candidate.keyId === 'string'
      && typeof candidate.secret === 'string'
      && candidate.keyId === keyId
      && TEXT_ENCODER.encode(candidate.secret).byteLength >= MIN_SIGNING_KEY_BYTES
    ) {
      return Object.freeze({ slot, secret: candidate.secret });
    }
  }
  throw securityError('Signed delivery signature verification failed', 'GOOGLE_ADS_DELIVERY_SIGNATURE_INVALID');
}

async function verifyHmac(input) {
  const signature = decodeHex(input.signature.slice('sha256='.length));
  const key = await importHmacKey(input.secret, input.cryptoImpl);
  const valid = await input.cryptoImpl.subtle.verify(
    HMAC_ALGORITHM.name,
    key,
    signature,
    TEXT_ENCODER.encode(input.canonicalInput),
  );
  if (!valid) {
    throw securityError('Signed delivery signature verification failed', 'GOOGLE_ADS_DELIVERY_SIGNATURE_INVALID');
  }
}

async function createHmacHex(value, secret, cryptoImpl) {
  const key = await importHmacKey(secret, cryptoImpl);
  const signature = await cryptoImpl.subtle.sign(
    HMAC_ALGORITHM.name,
    key,
    TEXT_ENCODER.encode(value),
  );
  return toHex(signature);
}

async function importHmacKey(secret, cryptoImpl) {
  const bytes = TEXT_ENCODER.encode(requireText(secret, 'signing secret'));
  if (bytes.byteLength < MIN_SIGNING_KEY_BYTES) {
    throw securityError('Signed delivery signing key is invalid', 'GOOGLE_ADS_DELIVERY_SIGNATURE_INVALID');
  }
  return cryptoImpl.subtle.importKey('raw', bytes, HMAC_ALGORITHM, false, ['sign', 'verify']);
}

async function sha256Hex(value, cryptoImpl) {
  return toHex(await cryptoImpl.subtle.digest('SHA-256', value));
}

async function sha256Base64Url(value, cryptoImpl) {
  const digest = await cryptoImpl.subtle.digest('SHA-256', TEXT_ENCODER.encode(value));
  return encodeBase64Url(new Uint8Array(digest));
}

function decodeHex(value) {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw securityError('Signed delivery signature verification failed', 'GOOGLE_ADS_DELIVERY_SIGNATURE_INVALID');
  }
  return Uint8Array.from(
    { length: value.length / 2 },
    (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

function toHex(value) {
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function requirePattern(value, fieldName, pattern) {
  const text = requireText(value, fieldName);
  if (!pattern.test(text)) {
    throw securityError(`Signed delivery ${fieldName} is invalid`, 'GOOGLE_ADS_DELIVERY_REQUEST_INVALID');
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw securityError(`Signed delivery ${fieldName} is required`, 'GOOGLE_ADS_DELIVERY_REQUEST_INVALID');
  }
  return value.trim();
}

function requireCrypto(value) {
  if (
    typeof value?.subtle?.digest !== 'function'
    || typeof value?.subtle?.importKey !== 'function'
    || typeof value?.subtle?.sign !== 'function'
    || typeof value?.subtle?.verify !== 'function'
  ) {
    throw securityError('Web Crypto is unavailable', 'GOOGLE_ADS_DELIVERY_CRYPTO_UNAVAILABLE');
  }
  return value;
}

function securityError(message, code, cause) {
  return permanentError(message, { code, cause });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
