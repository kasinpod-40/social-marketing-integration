import {
  assertGoogleAdsManagerSignedDeliveryRequestHead,
  verifyGoogleAdsManagerSignedDelivery,
} from '../../../packages/application/src/google-ads/manager-script-signed-delivery-security.js';
import {
  GOOGLE_ADS_MANAGER_DELIVERY_PATH,
  GOOGLE_ADS_MANAGER_TRANSPORT_LIMITS,
  validateGoogleAdsManagerDeliveryRun,
} from '../../../packages/config/src/google-ads-manager-script-delivery-contract.js';
import { loadCustomerRuntimeConfig } from '../../../packages/config/src/customer-profiles.js';
import {
  D1GoogleAdsManagerDeliveryStore,
} from '../../../packages/connectors/src/google-ads/d1-google-ads-manager-delivery-store.js';
import {
  sanitizeOperationalError,
  sanitizeOperationalValue,
  permanentError,
  transientError,
} from '../../../packages/shared/src/errors/runtime-error.js';
import {
  createStableFingerprint,
  stableSerialize,
} from '../../../packages/shared/src/hash/stable-fingerprint.js';
import { json } from '../../../packages/shared/src/http/response.js';

export const GOOGLE_ADS_MANAGER_DELIVERY_ROUTE = Object.freeze({
  method: 'POST',
  path: GOOGLE_ADS_MANAGER_DELIVERY_PATH,
});

/** สร้าง PREVIEW-only signed ingress; Queue และ Business writer ยังไม่มีใน Phase 2 */
export function createGoogleAdsManagerDeliveryHttpHandler(dependencies = {}) {
  const now = typeof dependencies.now === 'function' ? dependencies.now : () => Date.now();
  const cryptoImpl = dependencies.cryptoImpl ?? globalThis.crypto;
  const createStore = dependencies.createStore
    ?? ((env) => new D1GoogleAdsManagerDeliveryStore({ db: requireD1(env), now }));
  const randomUuid = dependencies.randomUuid
    ?? (() => requireRandomUuid(cryptoImpl).randomUUID());

  return async function handleGoogleAdsManagerDelivery({ request, env, url }) {
    let runFingerprint = null;
    try {
      if (!readBooleanFlag(env?.MKT_GOOGLE_ADS_SIGNED_INGRESS_ENABLED)) {
        return json({ ok: false, error: 'Route not found' }, {
          status: 404,
          headers: noStoreHeaders(),
        });
      }
      if (readBooleanFlag(env?.MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED)) {
        throw permanentError('Google Ads business writer is not implemented', {
          code: 'GOOGLE_ADS_DELIVERY_BUSINESS_WRITE_NOT_IMPLEMENTED',
        });
      }

      assertGoogleAdsManagerSignedDeliveryRequestHead({
        method: request.method,
        url: request.url,
        headers: request.headers,
      });
      const body = await readBoundedRequestBody(
        request,
        GOOGLE_ADS_MANAGER_TRANSPORT_LIMITS.bodyBytes,
      );
      const runtime = loadGoogleAdsManagerDeliveryRuntime(env);
      const store = createStore(env);
      const receivedAt = timestamp(now(), 'now');
      const verified = await verifyGoogleAdsManagerSignedDelivery({
        method: request.method,
        url: url.toString(),
        headers: request.headers,
        body,
        now: receivedAt,
        cryptoImpl,
        keyring: runtime.keyring,
        runtimeIdentity: runtime.identity,
        requireNonceReservation: true,
        async reserveNonce(input) {
          await store.cleanupExpired({ now: receivedAt });
          await store.reserveNonce({
            nonceFingerprint: input.nonceFingerprint,
            requestTimestampSeconds: input.requestTimestampSeconds,
            now: receivedAt,
          });
        },
      });
      runFingerprint = verified.runFingerprint;
      if (verified.envelope.mode !== 'PREVIEW') {
        throw permanentError('Google Ads LIVE delivery is disabled', {
          code: 'GOOGLE_ADS_DELIVERY_LIVE_DISABLED',
        });
      }

      const manifestJson = stableSerialize(verified.envelope.manifest);
      const identityFingerprint = await createStableFingerprint(runtime.identity, {
        digestImpl: cryptoImpl.subtle.digest.bind(cryptoImpl.subtle),
      });
      const manifestDigest = await createStableFingerprint(verified.envelope.manifest, {
        digestImpl: cryptoImpl.subtle.digest.bind(cryptoImpl.subtle),
      });
      const expectedChunkCount = Object.values(verified.envelope.manifest)
        .reduce((total, item) => total + item.chunkCount, 0);
      const expectedRowCount = Object.values(verified.envelope.manifest)
        .reduce((total, item) => total + item.totalRows, 0);
      const staged = await store.stageChunk({
        runId: verified.envelope.runId,
        runFingerprint,
        schemaVersion: verified.envelope.schemaVersion,
        mode: verified.envelope.mode,
        runStartedAt: Date.parse(verified.envelope.runStartedAt),
        identityFingerprint,
        sourceTimezone: verified.envelope.sourceTimezone,
        manifestJson,
        manifestDigest,
        expectedChunkCount,
        expectedRowCount,
        idempotencyKey: verified.idempotencyKey,
        datasetKey: verified.envelope.dataset.key,
        chunkIndex: verified.envelope.dataset.chunkIndex,
        chunkCount: verified.envelope.dataset.chunkCount,
        totalRows: verified.envelope.dataset.totalRows,
        rowCount: verified.envelope.dataset.rows.length,
        bodyDigest: verified.bodyDigest,
        payloadJson: stableSerialize(verified.envelope),
        reservationId: randomUuid(),
        now: receivedAt,
      });

      if (staged.run.status === 'preview_validated') {
        return previewCompleteResponse(staged.run, runFingerprint, 'exact_retry');
      }
      if (staged.run.receivedChunkCount < staged.run.expectedChunkCount) {
        return json({
          ok: true,
          status: 'staged',
          disposition: staged.disposition,
          runFingerprint,
          receivedChunks: staged.run.receivedChunkCount,
          expectedChunks: staged.run.expectedChunkCount,
        }, {
          status: 202,
          headers: noStoreHeaders(),
        });
      }

      const chunks = await store.listRunChunks(verified.envelope.runId);
      const envelopes = chunks.map((chunk) => {
        if (typeof chunk.payloadJson !== 'string') {
          throw permanentError('Signed delivery payload staging is incomplete', {
            code: 'GOOGLE_ADS_DELIVERY_RUN_INCOMPLETE',
          });
        }
        try {
          return JSON.parse(chunk.payloadJson);
        } catch (cause) {
          throw transientError('Signed delivery staged payload cannot be decoded', {
            code: 'GOOGLE_ADS_DELIVERY_D1_PAYLOAD_INVALID',
            cause,
          });
        }
      });
      let summary;
      try {
        summary = validateGoogleAdsManagerDeliveryRun(envelopes);
      } catch (error) {
        await store.markInvalid({
          runId: verified.envelope.runId,
          errorCode: error?.code ?? 'GOOGLE_ADS_DELIVERY_RUN_INVALID',
          now: receivedAt,
        });
        throw error;
      }
      const completed = await store.completePreview({
        runId: verified.envelope.runId,
        now: receivedAt,
      });
      return previewCompleteResponse(completed, runFingerprint, staged.disposition, summary);
    } catch (error) {
      const operational = sanitizeOperationalError(error);
      console.error(JSON.stringify(sanitizeOperationalValue({
        timestamp: new Date(now()).toISOString(),
        scope: 'google_ads_manager_delivery_http',
        route: `${request.method} ${url.pathname}`,
        code: operational.code,
        runFingerprint,
      })));
      return json({
        ok: false,
        status: 'rejected',
        code: boundedErrorCode(operational.code),
        ...(runFingerprint ? { runFingerprint } : {}),
      }, {
        status: statusForDeliveryError(operational.code),
        headers: noStoreHeaders(),
      });
    }
  };
}

function loadGoogleAdsManagerDeliveryRuntime(env = {}) {
  const profile = loadCustomerRuntimeConfig(env);
  const identity = Object.freeze({
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
    sourceTimezone: text(
      env.MKT_GOOGLE_ADS_SOURCE_TIMEZONE ?? env.DEFAULT_TIMEZONE,
      'MKT_GOOGLE_ADS_SOURCE_TIMEZONE',
    ),
  });
  const previousKeyId = optionalText(env.MKT_GOOGLE_ADS_PREVIOUS_SIGNING_KEY_ID);
  const previousSecret = optionalText(env.MKT_GOOGLE_ADS_PREVIOUS_SIGNING_SECRET);
  if (Boolean(previousKeyId) !== Boolean(previousSecret)) {
    throw permanentError('Previous Google Ads signing key is incomplete', {
      code: 'GOOGLE_ADS_DELIVERY_RUNTIME_CONFIG_INVALID',
    });
  }
  return Object.freeze({
    identity,
    keyring: Object.freeze({
      current: Object.freeze({
        keyId: text(
          env.MKT_GOOGLE_ADS_SIGNING_KEY_ID,
          'MKT_GOOGLE_ADS_SIGNING_KEY_ID',
        ),
        secret: secret(
          env.MKT_GOOGLE_ADS_SIGNING_SECRET,
          'MKT_GOOGLE_ADS_SIGNING_SECRET',
        ),
      }),
      ...(previousKeyId
        ? {
          previous: Object.freeze({
            keyId: previousKeyId,
            secret: secret(
              previousSecret,
              'MKT_GOOGLE_ADS_PREVIOUS_SIGNING_SECRET',
            ),
          }),
        }
        : {}),
    }),
  });
}

async function readBoundedRequestBody(request, maximumBytes) {
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) {
      throw permanentError('Signed delivery Content-Length is invalid', {
        code: 'GOOGLE_ADS_DELIVERY_REQUEST_INVALID',
      });
    }
    if (length > maximumBytes) throw bodyTooLarge();
  }
  if (!request.body) {
    throw permanentError('Signed delivery body is required', {
      code: 'GOOGLE_ADS_DELIVERY_BODY_INVALID',
    });
  }
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
  if (totalBytes === 0) {
    throw permanentError('Signed delivery body is required', {
      code: 'GOOGLE_ADS_DELIVERY_BODY_INVALID',
    });
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function previewCompleteResponse(run, runFingerprint, disposition, summary = null) {
  return json({
    ok: true,
    status: 'preview_validated',
    disposition,
    runFingerprint,
    receivedChunks: run.receivedChunkCount,
    expectedChunks: run.expectedChunkCount,
    receivedRows: run.receivedRowCount,
    expectedRows: run.expectedRowCount,
    ...(summary ? { datasets: summary.datasets } : {}),
  }, {
    status: 200,
    headers: noStoreHeaders(),
  });
}

function statusForDeliveryError(code) {
  if (code === 'GOOGLE_ADS_DELIVERY_NONCE_REPLAYED') return 409;
  if (code?.includes('_CONFLICT') || code?.endsWith('_RUN_INCOMPLETE')) return 409;
  if (code === 'GOOGLE_ADS_DELIVERY_BODY_TOO_LARGE') return 413;
  if (code === 'GOOGLE_ADS_DELIVERY_SIGNATURE_INVALID') return 401;
  if (code === 'GOOGLE_ADS_DELIVERY_LIVE_DISABLED'
    || code === 'GOOGLE_ADS_DELIVERY_BUSINESS_WRITE_NOT_IMPLEMENTED') return 403;
  if (code?.includes('_D1_')) return 503;
  return 400;
}

function boundedErrorCode(code) {
  return typeof code === 'string' && /^GOOGLE_ADS_DELIVERY_[A-Z0-9_]{1,96}$/u.test(code)
    ? code
    : 'GOOGLE_ADS_DELIVERY_REJECTED';
}

function noStoreHeaders() {
  return {
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  };
}

function bodyTooLarge() {
  return permanentError('Signed delivery body exceeds the byte limit', {
    code: 'GOOGLE_ADS_DELIVERY_BODY_TOO_LARGE',
  });
}

function readBooleanFlag(value) {
  if (value === undefined || value === null || value === '' || value === false || value === 'false') {
    return false;
  }
  if (value === true || value === 'true') return true;
  throw permanentError('Google Ads delivery feature flag is invalid', {
    code: 'GOOGLE_ADS_DELIVERY_RUNTIME_CONFIG_INVALID',
  });
}

function requireD1(env) {
  const db = env?.MKT_STATE_DB;
  if (typeof db?.prepare !== 'function' || typeof db?.batch !== 'function') {
    throw permanentError('Google Ads delivery D1 binding is unavailable', {
      code: 'GOOGLE_ADS_DELIVERY_D1_BINDING_UNAVAILABLE',
    });
  }
  return db;
}

function requireRandomUuid(value) {
  if (typeof value?.randomUUID !== 'function') {
    throw permanentError('Web Crypto randomUUID is unavailable', {
      code: 'GOOGLE_ADS_DELIVERY_CRYPTO_UNAVAILABLE',
    });
  }
  return value;
}

function customerId(value, fieldName) {
  const normalized = text(value, fieldName).replaceAll('-', '');
  if (!/^\d{10}$/u.test(normalized)) {
    throw permanentError('Google Ads delivery customer mapping is invalid', {
      code: 'GOOGLE_ADS_DELIVERY_RUNTIME_CONFIG_INVALID',
    });
  }
  return normalized;
}

function secret(value, fieldName) {
  const normalized = text(value, fieldName);
  if (new TextEncoder().encode(normalized).byteLength < 32
    || /^(?:replace-with-|example|changeme)/iu.test(normalized)) {
    throw permanentError('Google Ads delivery signing Secret is invalid', {
      code: 'GOOGLE_ADS_DELIVERY_RUNTIME_CONFIG_INVALID',
    });
  }
  return normalized;
}

function text(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw permanentError(`Missing ${fieldName}`, {
      code: 'GOOGLE_ADS_DELIVERY_RUNTIME_CONFIG_INVALID',
    });
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function timestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${fieldName} must be a timestamp`);
  }
  return number;
}
