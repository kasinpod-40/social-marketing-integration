import { assertConnectorRunnable } from '../../../packages/application/src/connectors/connector-registry.js';
import {
  GOOGLE_ADS_DELIVERY_AUDIT_RETENTION_SECONDS,
  GOOGLE_ADS_DELIVERY_PAYLOAD_RETENTION_SECONDS,
  GOOGLE_ADS_NONCE_RETENTION_SECONDS,
  expectedGoogleAdsIdempotencyKey,
  validateGoogleAdsDeliveryEnvelope,
} from '../../../packages/application/src/google-ads/signed-delivery-contract.js';
import { JOB_TYPES } from '../../../packages/application/src/jobs/job-catalog.js';
import { loadCustomerRuntimeConfig } from '../../../packages/config/src/customer-profiles.js';
import { D1GoogleAdsDeliveryStore } from '../../../packages/connectors/src/google-ads/d1-google-ads-delivery-store.js';
import { verifyGoogleAdsSignedRequest } from '../../../packages/connectors/src/google-ads/google-ads-signature.js';
import { transientError } from '../../../packages/shared/src/errors/runtime-error.js';
import { json } from '../../../packages/shared/src/http/response.js';

/** Verify, reserve replay/idempotency state, and queue a reference-only LIVE job. */
export async function handleGoogleAdsSignedDelivery(input = {}) {
  const runtimeConfig = loadCustomerRuntimeConfig(input.env);
  assertConnectorRunnable(runtimeConfig, 'google_ads');
  const verified = await verifyGoogleAdsSignedRequest({
    request: input.request,
    env: input.env,
    now: input.now,
  });
  const envelope = validateGoogleAdsDeliveryEnvelope(verified.body);
  const expectedIdempotencyKey = expectedGoogleAdsIdempotencyKey(envelope.deliveryId);
  if (verified.headers.idempotencyKey !== expectedIdempotencyKey) {
    const error = new Error('Idempotency header does not match deliveryId');
    error.code = 'GOOGLE_ADS_DELIVERY_IDEMPOTENCY_MISMATCH';
    error.retryable = false;
    throw error;
  }

  const store = input.store ?? new D1GoogleAdsDeliveryStore({
    db: input.env?.MKT_STATE_DB,
    now: input.now,
  });
  const receivedAt = input.now?.() ?? Date.now();
  await store.cleanupRetention({
    now: receivedAt,
    auditCutoff: receivedAt - (GOOGLE_ADS_DELIVERY_AUDIT_RETENTION_SECONDS * 1_000),
  });
  await store.reserveNonce({
    nonce: verified.headers.nonce,
    keyId: verified.headers.keyId,
    contentSha256: verified.contentSha256,
    receivedAt,
    expiresAt: receivedAt + (GOOGLE_ADS_NONCE_RETENTION_SECONDS * 1_000),
  });
  const delivery = await store.reserveDelivery({
    idempotencyKey: expectedIdempotencyKey,
    deliveryId: envelope.deliveryId,
    contentSha256: verified.contentSha256,
    mode: envelope.mode,
    payloadJson: verified.rawBody,
    payloadExpiresAt: receivedAt + (GOOGLE_ADS_DELIVERY_PAYLOAD_RETENTION_SECONDS * 1_000),
  });

  if (envelope.mode === 'PREVIEW') {
    await store.markPreviewValidated({
      deliveryId: envelope.deliveryId,
      validation: { schemaVersion: envelope.schemaVersion, datasetCounts: envelope.datasetCounts },
    });
    return json({
      ok: true,
      status: 'preview_validated',
      schemaVersion: envelope.schemaVersion,
      datasetCounts: envelope.datasetCounts,
    }, { status: 200 });
  }

  if (delivery.status === 'failed_permanent') {
    return json({
      ok: false,
      status: 'terminal_failure',
      deliveryStatus: delivery.status,
    }, { status: 409 });
  }
  if (new Set(['queued', 'processing', 'failed_retryable', 'completed']).has(delivery.status)) {
    return json({
      ok: true,
      status: 'accepted_idempotent',
      deliveryStatus: delivery.status,
    }, { status: delivery.status === 'completed' ? 200 : 202 });
  }

  const queue = input.queue ?? input.env?.MKT_SYNC_QUEUE;
  if (!queue || typeof queue.send !== 'function') {
    throw transientError('Google Ads delivery queue binding is unavailable', {
      code: 'GOOGLE_ADS_DELIVERY_QUEUE_UNAVAILABLE',
    });
  }

  try {
    await queue.send({
      schemaVersion: 1,
      type: JOB_TYPES.GOOGLE_ADS_MANAGER_SCRIPT_DELIVERY,
      deliveryId: envelope.deliveryId,
      requestedAt: envelope.fetchedAt,
    });
    await store.markQueued(expectedIdempotencyKey);
  } catch (cause) {
    await store.markQueueFailed(expectedIdempotencyKey, cause?.code ?? 'QUEUE_SEND_FAILED');
    throw transientError('Failed to enqueue Google Ads delivery', {
      code: 'GOOGLE_ADS_DELIVERY_QUEUE_SEND_FAILED',
      cause,
    });
  }

  return json({ ok: true, status: 'queued' }, { status: 202 });
}
