import {
  GOOGLE_ADS_SIGNING_PROVISIONING_CONFIRM_PATH,
  GOOGLE_ADS_SIGNING_PROVISIONING_LIMITS,
  GOOGLE_ADS_SIGNING_PROVISIONING_PROOF_HEADER,
  GOOGLE_ADS_SIGNING_PROVISIONING_REDEEM_PATH,
  createGoogleAdsSigningProvisioningConfirmationInput,
  normalizeGoogleAdsSigningProvisioningRuntimeIdentity,
  validateGoogleAdsSigningProvisioningConfirm,
  validateGoogleAdsSigningProvisioningRedeem,
} from '../../../config/src/google-ads-signing-secret-provisioning-contract.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';
import {
  createStableFingerprint,
  stableSerialize,
} from '../../../shared/src/hash/stable-fingerprint.js';
import {
  createSecureRandomToken,
  hashSecureToken,
} from '../../../shared/src/security/secure-token.js';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });
const HMAC_ALGORITHM = Object.freeze({ name: 'HMAC', hash: 'SHA-256' });
const MIN_SIGNING_KEY_BYTES = 32;

/** Validate HTTPS target, exact JSON content type and single bearer capability. */
export function assertGoogleAdsSigningProvisioningRequestHead(input = {}) {
  const confirmation = input.confirmation === true;
  const expectedPath = confirmation
    ? GOOGLE_ADS_SIGNING_PROVISIONING_CONFIRM_PATH
    : GOOGLE_ADS_SIGNING_PROVISIONING_REDEEM_PATH;
  if (input.method !== 'POST') throw requestInvalid('Provisioning requires POST');
  let url;
  try {
    url = new URL(requireText(input.url, 'url'));
  } catch (cause) {
    throw requestInvalid('Provisioning URL is invalid', cause);
  }
  if (
    url.protocol !== 'https:'
    || url.pathname !== expectedPath
    || url.search !== ''
    || url.hash !== ''
  ) throw requestInvalid('Provisioning target is not allowed');

  const contentType = readSingleHeader(input.headers, 'content-type');
  if (contentType.toLowerCase() !== 'application/json') {
    throw requestInvalid('Provisioning Content-Type must be application/json');
  }
  const authorization = readSingleHeader(input.headers, 'authorization');
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(authorization);
  if (!match) throw authorizationInvalid();

  const proof = confirmation
    ? requirePattern(
      readSingleHeader(input.headers, GOOGLE_ADS_SIGNING_PROVISIONING_PROOF_HEADER),
      'proof',
      /^sha256=[a-f0-9]{64}$/u,
    )
    : null;
  return Object.freeze({ ticket: match[1], proof });
}

/** Parse canonical JSON only after bounded stream read and bind it to runtime identity. */
export function parseGoogleAdsSigningProvisioningBody(input = {}) {
  const bytes = readBoundedBody(input.body);
  let bodyText;
  try {
    bodyText = TEXT_DECODER.decode(bytes);
  } catch (cause) {
    throw bodyInvalid('Provisioning body is not valid UTF-8', cause);
  }
  let value;
  try {
    value = JSON.parse(bodyText);
  } catch (cause) {
    throw bodyInvalid('Provisioning body is not valid JSON', cause);
  }
  let canonical;
  try {
    canonical = stableSerialize(value);
  } catch (cause) {
    throw bodyInvalid('Provisioning body cannot be canonicalized', cause);
  }
  if (canonical !== bodyText) throw bodyInvalid('Provisioning body is not canonical JSON');
  return input.confirmation === true
    ? validateGoogleAdsSigningProvisioningConfirm(value, input.runtimeIdentity)
    : validateGoogleAdsSigningProvisioningRedeem(value, input.runtimeIdentity);
}

/** Generate a 256-bit one-time capability and fingerprint without persisting plaintext. */
export async function createGoogleAdsSigningProvisioningTicket(cryptoImpl = globalThis.crypto) {
  const cryptoValue = requireCrypto(cryptoImpl);
  const ticket = createSecureRandomToken(
    GOOGLE_ADS_SIGNING_PROVISIONING_LIMITS.ticketBytes,
    cryptoValue,
  );
  return Object.freeze({
    ticket,
    ticketFingerprint: await hashSecureToken(ticket, cryptoValue),
  });
}

/** Generate the one-time 256-bit confirmation challenge. */
export async function createGoogleAdsSigningProvisioningChallenge(cryptoImpl = globalThis.crypto) {
  const cryptoValue = requireCrypto(cryptoImpl);
  const challenge = createSecureRandomToken(
    GOOGLE_ADS_SIGNING_PROVISIONING_LIMITS.challengeBytes,
    cryptoValue,
  );
  return Object.freeze({
    challenge,
    challengeFingerprint: await hashSecureToken(challenge, cryptoValue),
  });
}

/** Test/operator helper for the 128-bit Script client nonce contract. */
export function createGoogleAdsSigningProvisioningClientNonce(cryptoImpl = globalThis.crypto) {
  return createSecureRandomToken(
    GOOGLE_ADS_SIGNING_PROVISIONING_LIMITS.clientNonceBytes,
    requireCrypto(cryptoImpl),
  );
}

export function hashGoogleAdsSigningProvisioningCapability(value, cryptoImpl = globalThis.crypto) {
  return hashSecureToken(
    requirePattern(value, 'capability', /^[A-Za-z0-9_-]{43}$/u),
    requireCrypto(cryptoImpl),
  );
}

export function createGoogleAdsSigningProvisioningIdentityFingerprint(
  runtimeIdentity,
  cryptoImpl = globalThis.crypto,
) {
  const cryptoValue = requireCrypto(cryptoImpl);
  return createStableFingerprint(
    normalizeGoogleAdsSigningProvisioningRuntimeIdentity(runtimeIdentity),
    { digestImpl: cryptoValue.subtle.digest.bind(cryptoValue.subtle) },
  );
}

/** Create proof for tests and the protocol contract; production Worker uses verify. */
export async function signGoogleAdsSigningProvisioningConfirmation(input = {}) {
  const cryptoImpl = requireCrypto(input.cryptoImpl ?? globalThis.crypto);
  const canonicalInput = createGoogleAdsSigningProvisioningConfirmationInput(input);
  return `sha256=${await createHmacHex(canonicalInput, input.signingSecret, cryptoImpl)}`;
}

/** Verify exact challenge proof using the current Worker Signing Secret. */
export async function verifyGoogleAdsSigningProvisioningConfirmation(input = {}) {
  const cryptoImpl = requireCrypto(input.cryptoImpl ?? globalThis.crypto);
  const proof = requirePattern(input.proof, 'proof', /^sha256=[a-f0-9]{64}$/u);
  const signature = decodeHex(proof.slice('sha256='.length));
  const key = await importHmacKey(input.signingSecret, cryptoImpl);
  const canonicalInput = createGoogleAdsSigningProvisioningConfirmationInput(input);
  const valid = await cryptoImpl.subtle.verify(
    HMAC_ALGORITHM.name,
    key,
    signature,
    TEXT_ENCODER.encode(canonicalInput),
  );
  if (!valid) {
    throw permanentError('Provisioning confirmation proof is invalid', {
      code: 'GOOGLE_ADS_PROVISIONING_PROOF_INVALID',
    });
  }
  return true;
}

function readSingleHeader(source, headerName) {
  if (!source || (typeof source !== 'object' && typeof source?.get !== 'function')) {
    throw requestInvalid('Provisioning headers are required');
  }
  let values;
  if (typeof source.get === 'function') {
    const value = source.get(headerName);
    values = value === null ? [] : [value];
  } else {
    values = Object.entries(source)
      .filter(([name]) => name.toLowerCase() === headerName)
      .flatMap(([, value]) => (Array.isArray(value) ? value : [value]));
  }
  if (
    values.length !== 1
    || typeof values[0] !== 'string'
    || values[0].trim() === ''
    || values[0].includes(',')
  ) throw requestInvalid(`Provisioning requires one ${headerName} header`);
  return values[0].trim();
}

function readBoundedBody(value) {
  let bytes;
  if (typeof value === 'string') bytes = TEXT_ENCODER.encode(value);
  else if (value instanceof Uint8Array) bytes = value;
  else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
  else throw bodyInvalid('Provisioning body must be UTF-8 bytes');
  if (
    bytes.byteLength === 0
    || bytes.byteLength > GOOGLE_ADS_SIGNING_PROVISIONING_LIMITS.bodyBytes
  ) throw bodyInvalid('Provisioning body size is invalid');
  return bytes;
}

async function createHmacHex(value, signingSecret, cryptoImpl) {
  const key = await importHmacKey(signingSecret, cryptoImpl);
  const signature = await cryptoImpl.subtle.sign(
    HMAC_ALGORITHM.name,
    key,
    TEXT_ENCODER.encode(value),
  );
  return toHex(signature);
}

async function importHmacKey(signingSecret, cryptoImpl) {
  const bytes = TEXT_ENCODER.encode(requireText(signingSecret, 'signingSecret'));
  if (bytes.byteLength < MIN_SIGNING_KEY_BYTES) {
    throw permanentError('Provisioning signing key is invalid', {
      code: 'GOOGLE_ADS_PROVISIONING_SECRET_INVALID',
    });
  }
  return cryptoImpl.subtle.importKey('raw', bytes, HMAC_ALGORITHM, false, ['sign', 'verify']);
}

function decodeHex(value) {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw permanentError('Provisioning confirmation proof is invalid', {
      code: 'GOOGLE_ADS_PROVISIONING_PROOF_INVALID',
    });
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
  if (!pattern.test(text)) throw requestInvalid(`Provisioning ${fieldName} is invalid`);
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw requestInvalid(`Provisioning ${fieldName} is required`);
  }
  return value.trim();
}

function requireCrypto(value) {
  if (
    typeof value?.getRandomValues !== 'function'
    || typeof value?.subtle?.digest !== 'function'
    || typeof value?.subtle?.importKey !== 'function'
    || typeof value?.subtle?.sign !== 'function'
    || typeof value?.subtle?.verify !== 'function'
  ) {
    throw permanentError('Provisioning Web Crypto is unavailable', {
      code: 'GOOGLE_ADS_PROVISIONING_CRYPTO_UNAVAILABLE',
    });
  }
  return value;
}

function requestInvalid(message, cause) {
  return permanentError(message, { code: 'GOOGLE_ADS_PROVISIONING_REQUEST_INVALID', cause });
}

function authorizationInvalid() {
  return permanentError('Provisioning bearer capability is invalid', {
    code: 'GOOGLE_ADS_PROVISIONING_AUTHORIZATION_INVALID',
  });
}

function bodyInvalid(message, cause) {
  return permanentError(message, { code: 'GOOGLE_ADS_PROVISIONING_BODY_INVALID', cause });
}
