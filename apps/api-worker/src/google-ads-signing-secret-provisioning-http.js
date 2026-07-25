import {
  assertGoogleAdsSigningProvisioningRequestHead,
  createGoogleAdsSigningProvisioningChallenge,
  createGoogleAdsSigningProvisioningIdentityFingerprint,
  hashGoogleAdsSigningProvisioningCapability,
  parseGoogleAdsSigningProvisioningBody,
  verifyGoogleAdsSigningProvisioningConfirmation,
} from '../../../packages/application/src/google-ads/manager-script-signing-secret-provisioning-security.js';
import {
  GOOGLE_ADS_SIGNING_PROVISIONING_CONFIRM_PATH,
  GOOGLE_ADS_SIGNING_PROVISIONING_LIMITS,
  GOOGLE_ADS_SIGNING_PROVISIONING_REDEEM_PATH,
} from '../../../packages/config/src/google-ads-signing-secret-provisioning-contract.js';
import { loadCustomerRuntimeConfig } from '../../../packages/config/src/customer-profiles.js';
import {
  D1GoogleAdsSigningSecretProvisioningStore,
} from '../../../packages/connectors/src/google-ads/d1-google-ads-signing-secret-provisioning-store.js';
import {
  permanentError,
  sanitizeOperationalError,
  sanitizeOperationalValue,
} from '../../../packages/shared/src/errors/runtime-error.js';
import { json } from '../../../packages/shared/src/http/response.js';

export const GOOGLE_ADS_SIGNING_PROVISIONING_ROUTES = Object.freeze([
  Object.freeze({ method: 'POST', path: GOOGLE_ADS_SIGNING_PROVISIONING_REDEEM_PATH }),
  Object.freeze({ method: 'POST', path: GOOGLE_ADS_SIGNING_PROVISIONING_CONFIRM_PATH }),
]);

/** One-time provisioning endpoint; independent from signed-ingress and Business flags. */
export function createGoogleAdsSigningSecretProvisioningHttpHandler(dependencies = {}) {
  const now = typeof dependencies.now === 'function' ? dependencies.now : () => Date.now();
  const cryptoImpl = dependencies.cryptoImpl ?? globalThis.crypto;
  const createStore = dependencies.createStore
    ?? ((env) => new D1GoogleAdsSigningSecretProvisioningStore({ db: requireD1(env), now }));
  const loadSigningSecret = dependencies.loadSigningSecret
    ?? ((env) => signingSecret(env?.MKT_GOOGLE_ADS_SIGNING_SECRET));
  const createChallenge = dependencies.createChallenge
    ?? (() => createGoogleAdsSigningProvisioningChallenge(cryptoImpl));

  return async function handleGoogleAdsSigningSecretProvisioning({ request, env, url }) {
    try {
      if (!readBooleanFlag(env?.MKT_GOOGLE_ADS_SECRET_PROVISIONING_ENABLED)) {
        return json({ ok: false, error: 'Route not found' }, {
          status: 404,
          headers: noStoreHeaders(),
        });
      }
      const confirmation = url.pathname === GOOGLE_ADS_SIGNING_PROVISIONING_CONFIRM_PATH;
      if (
        !confirmation
        && url.pathname !== GOOGLE_ADS_SIGNING_PROVISIONING_REDEEM_PATH
      ) throw requestInvalid('Provisioning route is invalid');

      const requestHead = assertGoogleAdsSigningProvisioningRequestHead({
        method: request.method,
        url: request.url,
        headers: request.headers,
        confirmation,
      });
      const body = await readBoundedRequestBody(
        request,
        GOOGLE_ADS_SIGNING_PROVISIONING_LIMITS.bodyBytes,
      );
      const runtimeIdentity = loadProvisioningRuntimeIdentity(env);
      const payload = parseGoogleAdsSigningProvisioningBody({
        body,
        confirmation,
        runtimeIdentity,
      });
      const [ticketFingerprint, identityFingerprint] = await Promise.all([
        hashGoogleAdsSigningProvisioningCapability(requestHead.ticket, cryptoImpl),
        createGoogleAdsSigningProvisioningIdentityFingerprint(runtimeIdentity, cryptoImpl),
      ]);
      const store = createStore(env);
      const requestNow = timestamp(now(), 'now');

      if (!confirmation) {
        const challenge = await createChallenge();
        await store.redeemTicket({
          ticketFingerprint,
          identityFingerprint,
          keyId: payload.keyId,
          challengeFingerprint: challenge.challengeFingerprint,
          now: requestNow,
        });
        const secret = loadSigningSecret(env);
        return json({
          ok: true,
          status: 'redeemed_pending_confirmation',
          keyId: payload.keyId,
          signingSecret: secret,
          challenge: challenge.challenge,
        }, {
          status: 200,
          headers: noStoreHeaders(),
        });
      }

      const challengeFingerprint = await hashGoogleAdsSigningProvisioningCapability(
        payload.challenge,
        cryptoImpl,
      );
      await store.readTicketForConfirmation({
        ticketFingerprint,
        identityFingerprint,
        keyId: payload.keyId,
        challengeFingerprint,
        now: requestNow,
      });
      const secret = loadSigningSecret(env);
      await verifyGoogleAdsSigningProvisioningConfirmation({
        proof: requestHead.proof,
        keyId: payload.keyId,
        clientNonce: payload.clientNonce,
        challenge: payload.challenge,
        signingSecret: secret,
        cryptoImpl,
      });
      await store.confirmTicket({
        ticketFingerprint,
        identityFingerprint,
        keyId: payload.keyId,
        challengeFingerprint,
        now: requestNow,
      });
      return json({ ok: true, status: 'confirmed' }, {
        status: 200,
        headers: noStoreHeaders(),
      });
    } catch (error) {
      const operational = sanitizeOperationalError(error);
      console.error(JSON.stringify(sanitizeOperationalValue({
        timestamp: new Date(now()).toISOString(),
        scope: 'google_ads_signing_secret_provisioning_http',
        route: `${request.method} ${url.pathname}`,
        code: operational.code,
      })));
      return json({
        ok: false,
        status: 'rejected',
        code: boundedErrorCode(operational.code),
      }, {
        status: statusForProvisioningError(operational.code),
        headers: noStoreHeaders(),
      });
    }
  };
}

function loadProvisioningRuntimeIdentity(env = {}) {
  const profile = loadCustomerRuntimeConfig(env);
  return Object.freeze({
    environment: profile.environment,
    profileKey: profile.profileKey,
    managerCustomerId: customerId(
      env.MKT_GOOGLE_ADS_MANAGER_CUSTOMER_ID,
      'MKT_GOOGLE_ADS_MANAGER_CUSTOMER_ID',
    ),
    customerId: customerId(
      env.MKT_GOOGLE_ADS_ADVERTISER_CUSTOMER_ID,
      'MKT_GOOGLE_ADS_ADVERTISER_CUSTOMER_ID',
    ),
    customerKey: profile.customerKey,
    accountKey: profile.connectors.google_ads.accountKey,
    keyId: keyId(env.MKT_GOOGLE_ADS_SIGNING_KEY_ID),
  });
}

async function readBoundedRequestBody(request, maximumBytes) {
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) {
      throw requestInvalid('Provisioning Content-Length is invalid');
    }
    if (length > maximumBytes) throw bodyTooLarge();
  }
  if (!request.body) throw bodyInvalid('Provisioning body is required');
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw bodyTooLarge();
    }
    chunks.push(value);
  }
  if (totalBytes === 0) throw bodyInvalid('Provisioning body is required');
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function statusForProvisioningError(code) {
  if (code === 'GOOGLE_ADS_PROVISIONING_AUTHORIZATION_INVALID'
    || code === 'GOOGLE_ADS_PROVISIONING_PROOF_INVALID') return 401;
  if (code === 'GOOGLE_ADS_PROVISIONING_TICKET_UNAVAILABLE'
    || code === 'GOOGLE_ADS_PROVISIONING_TICKET_UNUSABLE'
    || code === 'GOOGLE_ADS_PROVISIONING_IDENTITY_MISMATCH'
    || code === 'GOOGLE_ADS_PROVISIONING_TICKET_CONFLICT') return 409;
  if (code === 'GOOGLE_ADS_PROVISIONING_BODY_TOO_LARGE') return 413;
  if (code?.includes('_D1_')
    || code === 'GOOGLE_ADS_PROVISIONING_SECRET_INVALID'
    || code === 'GOOGLE_ADS_PROVISIONING_RUNTIME_CONFIG_INVALID') return 503;
  return 400;
}

function boundedErrorCode(code) {
  return typeof code === 'string' && /^GOOGLE_ADS_PROVISIONING_[A-Z0-9_]{1,96}$/u.test(code)
    ? code
    : 'GOOGLE_ADS_PROVISIONING_REJECTED';
}

function noStoreHeaders() {
  return {
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  };
}

function readBooleanFlag(value) {
  if (value === undefined || value === null || value === '' || value === false || value === 'false') {
    return false;
  }
  if (value === true || value === 'true') return true;
  throw permanentError('Google Ads provisioning feature flag is invalid', {
    code: 'GOOGLE_ADS_PROVISIONING_RUNTIME_CONFIG_INVALID',
  });
}

function requireD1(env) {
  const db = env?.MKT_STATE_DB;
  if (typeof db?.prepare !== 'function') {
    throw permanentError('Google Ads provisioning D1 binding is unavailable', {
      code: 'GOOGLE_ADS_PROVISIONING_D1_BINDING_UNAVAILABLE',
    });
  }
  return db;
}

function signingSecret(value) {
  const textValue = typeof value === 'string' ? value : '';
  if (new TextEncoder().encode(textValue).byteLength < 32) {
    throw permanentError('Google Ads provisioning Signing Secret is invalid', {
      code: 'GOOGLE_ADS_PROVISIONING_SECRET_INVALID',
    });
  }
  return textValue;
}

function customerId(value, fieldName) {
  const normalized = text(value, fieldName).replaceAll('-', '');
  if (!/^\d{10}$/u.test(normalized)) {
    throw permanentError(`${fieldName} is invalid`, {
      code: 'GOOGLE_ADS_PROVISIONING_RUNTIME_CONFIG_INVALID',
    });
  }
  return normalized;
}

function keyId(value) {
  const normalized = text(value, 'MKT_GOOGLE_ADS_SIGNING_KEY_ID');
  if (!/^[A-Za-z0-9._-]{1,64}$/u.test(normalized)) {
    throw permanentError('MKT_GOOGLE_ADS_SIGNING_KEY_ID is invalid', {
      code: 'GOOGLE_ADS_PROVISIONING_RUNTIME_CONFIG_INVALID',
    });
  }
  return normalized;
}

function text(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw permanentError(`${fieldName} is required`, {
      code: 'GOOGLE_ADS_PROVISIONING_RUNTIME_CONFIG_INVALID',
    });
  }
  return value.trim();
}

function timestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw permanentError(`${fieldName} is invalid`, {
      code: 'GOOGLE_ADS_PROVISIONING_RUNTIME_CONFIG_INVALID',
    });
  }
  return number;
}

function requestInvalid(message) {
  return permanentError(message, { code: 'GOOGLE_ADS_PROVISIONING_REQUEST_INVALID' });
}

function bodyInvalid(message) {
  return permanentError(message, { code: 'GOOGLE_ADS_PROVISIONING_BODY_INVALID' });
}

function bodyTooLarge() {
  return permanentError('Provisioning body exceeds the byte limit', {
    code: 'GOOGLE_ADS_PROVISIONING_BODY_TOO_LARGE',
  });
}
