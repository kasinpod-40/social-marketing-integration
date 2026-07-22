import {
  GOOGLE_ADS_DELIVERY_PATH,
  GOOGLE_ADS_MAX_BODY_BYTES,
  GOOGLE_ADS_REPLAY_WINDOW_SECONDS,
  GOOGLE_ADS_SIGNATURE_HEADERS,
} from '../../../application/src/google-ads/signed-delivery-contract.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const encoder = new TextEncoder();

/** Verify exact required headers, content digest, timestamp and HMAC over raw JSON bytes. */
export async function verifyGoogleAdsSignedRequest(input = {}) {
  const request = input.request;
  if (!(request instanceof Request)) fail('Request is required', 'GOOGLE_ADS_DELIVERY_REQUEST_INVALID');
  const url = new URL(request.url);
  if (request.method !== 'POST'
    || url.pathname !== GOOGLE_ADS_DELIVERY_PATH
    || url.search !== ''
    || url.hash !== '') {
    fail('Signed route mismatch', 'GOOGLE_ADS_DELIVERY_REQUEST_INVALID');
  }
  if (!/^application\/json(?:\s*;.*)?$/iu.test(request.headers.get('content-type') ?? '')) fail('Content-Type must be application/json', 'GOOGLE_ADS_DELIVERY_CONTENT_TYPE_INVALID');

  const headers = readRequiredHeaders(request.headers);
  const rawBody = await request.text();
  const bytes = encoder.encode(rawBody);
  if (bytes.byteLength === 0 || bytes.byteLength > GOOGLE_ADS_MAX_BODY_BYTES) fail('Signed body size is invalid', 'GOOGLE_ADS_DELIVERY_LIMIT_EXCEEDED');
  const digest = await sha256Hex(bytes);
  if (!constantTimeEqual(digest, headers.contentSha256)) fail('Content digest mismatch', 'GOOGLE_ADS_DELIVERY_DIGEST_INVALID');

  const nowSeconds = Math.floor((input.now?.() ?? Date.now()) / 1000);
  const timestampSeconds = readTimestamp(headers.timestamp);
  if (Math.abs(nowSeconds - timestampSeconds) > GOOGLE_ADS_REPLAY_WINDOW_SECONDS) fail('Signed timestamp is outside the replay window', 'GOOGLE_ADS_DELIVERY_TIMESTAMP_EXPIRED');

  const secret = resolveSigningSecret(input.env, headers.keyId);
  const signingInput = createGoogleAdsSigningInput({
    timestamp: headers.timestamp,
    nonce: headers.nonce,
    idempotencyKey: headers.idempotencyKey,
    contentSha256: headers.contentSha256,
  });
  const expected = `sha256=${await hmacSha256Hex(secret, signingInput)}`;
  if (!constantTimeEqual(expected, headers.signature)) fail('Signature verification failed', 'GOOGLE_ADS_DELIVERY_SIGNATURE_INVALID');

  let body;
  try { body = JSON.parse(rawBody); } catch (cause) {
    throw permanentError('Signed body is not valid JSON', { code: 'GOOGLE_ADS_DELIVERY_JSON_INVALID', cause });
  }
  return Object.freeze({ headers, rawBody, body, contentSha256: digest, timestampSeconds });
}

export function createGoogleAdsSigningInput(input) {
  return [
    'MKT-HMAC-SHA256-V1',
    'POST',
    GOOGLE_ADS_DELIVERY_PATH,
    input.timestamp,
    input.nonce,
    input.idempotencyKey,
    input.contentSha256,
  ].join('\n');
}

export async function sha256Hex(value) {
  const bytes = value instanceof Uint8Array ? value : encoder.encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(digest));
}

export async function hmacSha256Hex(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(requireSecret(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(String(value)));
  return bytesToHex(new Uint8Array(signature));
}

function readRequiredHeaders(headers) {
  const result = {};
  for (const [key, name] of Object.entries(GOOGLE_ADS_SIGNATURE_HEADERS)) {
    const value = headers.get(name);
    if (value === null || value.trim() === '') fail(`Missing required header ${name}`, 'GOOGLE_ADS_DELIVERY_HEADER_MISSING');
    if (value.includes(',')) fail(`Duplicate required header ${name}`, 'GOOGLE_ADS_DELIVERY_HEADER_DUPLICATE');
    result[key] = value.trim();
  }
  if (!/^[A-Za-z0-9._-]{1,64}$/u.test(result.keyId)) fail('Signing key id is invalid', 'GOOGLE_ADS_DELIVERY_HEADER_INVALID');
  if (!/^[A-Za-z0-9_-]{22,64}$/u.test(result.nonce)) fail('Nonce is invalid', 'GOOGLE_ADS_DELIVERY_HEADER_INVALID');
  if (!/^google-ads:[0-9a-f-]{36}$/iu.test(result.idempotencyKey)) fail('Idempotency key is invalid', 'GOOGLE_ADS_DELIVERY_HEADER_INVALID');
  if (!/^[0-9a-f]{64}$/u.test(result.contentSha256)) fail('Content SHA-256 is invalid', 'GOOGLE_ADS_DELIVERY_HEADER_INVALID');
  if (!/^sha256=[0-9a-f]{64}$/u.test(result.signature)) fail('Signature format is invalid', 'GOOGLE_ADS_DELIVERY_HEADER_INVALID');
  return Object.freeze(result);
}

function readTimestamp(value) {
  if (!/^\d{10}$/u.test(value)) fail('Timestamp must be Unix seconds', 'GOOGLE_ADS_DELIVERY_HEADER_INVALID');
  const number = Number(value);
  if (!Number.isSafeInteger(number)) fail('Timestamp is invalid', 'GOOGLE_ADS_DELIVERY_HEADER_INVALID');
  return number;
}

function resolveSigningSecret(env, keyId) {
  const candidates = [
    [env?.MKT_GOOGLE_ADS_SIGNING_KEY_ID, env?.MKT_GOOGLE_ADS_SIGNING_SECRET],
    [env?.MKT_GOOGLE_ADS_PREVIOUS_SIGNING_KEY_ID, env?.MKT_GOOGLE_ADS_PREVIOUS_SIGNING_SECRET],
  ];
  const match = candidates.find(([candidate]) => typeof candidate === 'string' && candidate === keyId);
  if (!match || typeof match[1] !== 'string' || match[1].length < 32) fail('Signing key is unavailable', 'GOOGLE_ADS_DELIVERY_KEY_REJECTED');
  return match[1];
}

function requireSecret(value) {
  if (typeof value !== 'string' || value.length < 32) throw new TypeError('HMAC secret must contain at least 32 characters');
  return value;
}
function bytesToHex(bytes) { return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
function constantTimeEqual(left, right) {
  const a = encoder.encode(String(left)); const b = encoder.encode(String(right));
  let mismatch = a.length ^ b.length; const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) mismatch |= (a[index % a.length] ?? 0) ^ (b[index % b.length] ?? 0);
  return mismatch === 0;
}
function fail(message, code) { throw permanentError(message, { code }); }
