import { JOB_TYPES } from '../jobs/job-catalog.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const EXACT_KEYS = Object.freeze([
  'schemaVersion',
  'type',
  'operationId',
  'workKey',
  'generation',
  'originalRequestedAt',
  'requestedAt',
]);

/** Build the only Queue payload allowed for one completely validated Google Ads LIVE run. */
export function buildGoogleAdsQueueReference(input = {}) {
  const runId = requireUuid(input.runId, 'runId');
  const generation = requireTimestamp(input.runStartedAt, 'runStartedAt');
  return Object.freeze({
    schemaVersion: 1,
    type: JOB_TYPES.GOOGLE_ADS_MANAGER_SIGNED_DELIVERY_PROCESS,
    operationId: runId,
    workKey: `google_ads:${runId}`,
    generation,
    originalRequestedAt: generation,
    requestedAt: new Date(generation).toISOString(),
  });
}

/** Reject unknown fields and every identity drift before the Queue consumer can run. */
export function validateGoogleAdsQueueReference(value) {
  const body = requirePlainObject(value, 'Google Ads Queue reference');
  const keys = Object.keys(body).sort();
  const expected = [...EXACT_KEYS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw permanentError('Google Ads Queue reference has an invalid schema', {
      code: 'GOOGLE_ADS_QUEUE_REFERENCE_SCHEMA_INVALID',
      details: { keys },
    });
  }

  if (body.schemaVersion !== 1) {
    throw permanentError('Google Ads Queue reference schema version is unsupported', {
      code: 'GOOGLE_ADS_QUEUE_REFERENCE_VERSION_UNSUPPORTED',
      details: { schemaVersion: body.schemaVersion ?? null },
    });
  }
  if (body.type !== JOB_TYPES.GOOGLE_ADS_MANAGER_SIGNED_DELIVERY_PROCESS) {
    throw permanentError('Google Ads Queue reference type is invalid', {
      code: 'GOOGLE_ADS_QUEUE_REFERENCE_TYPE_INVALID',
    });
  }

  const operationId = requireUuid(body.operationId, 'operationId');
  const generation = requireTimestamp(body.generation, 'generation');
  const originalRequestedAt = requireTimestamp(
    body.originalRequestedAt,
    'originalRequestedAt',
  );
  const expectedWorkKey = `google_ads:${operationId}`;
  if (body.workKey !== expectedWorkKey) {
    throw permanentError('Google Ads Queue reference workKey is inconsistent', {
      code: 'GOOGLE_ADS_QUEUE_REFERENCE_IDENTITY_MISMATCH',
    });
  }
  if (generation !== originalRequestedAt) {
    throw permanentError('Google Ads Queue reference generation is inconsistent', {
      code: 'GOOGLE_ADS_QUEUE_REFERENCE_GENERATION_MISMATCH',
    });
  }
  const requestedAt = new Date(generation).toISOString();
  if (body.requestedAt !== requestedAt) {
    throw permanentError('Google Ads Queue reference requestedAt is inconsistent', {
      code: 'GOOGLE_ADS_QUEUE_REFERENCE_REQUESTED_AT_MISMATCH',
    });
  }

  return Object.freeze({
    schemaVersion: 1,
    type: body.type,
    operationId,
    workKey: expectedWorkKey,
    generation,
    originalRequestedAt,
    requestedAt,
  });
}

function requirePlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw permanentError(`${label} must be an object`, {
      code: 'GOOGLE_ADS_QUEUE_REFERENCE_SCHEMA_INVALID',
    });
  }
  return value;
}

function requireUuid(value, fieldName) {
  if (typeof value !== 'string' || !UUID_V4.test(value)) {
    throw permanentError(`Google Ads Queue reference requires UUID ${fieldName}`, {
      code: 'GOOGLE_ADS_QUEUE_REFERENCE_IDENTITY_INVALID',
      details: { fieldName },
    });
  }
  return value;
}

function requireTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < Date.UTC(2000, 0, 1)) {
    throw permanentError(`Google Ads Queue reference requires timestamp ${fieldName}`, {
      code: 'GOOGLE_ADS_QUEUE_REFERENCE_IDENTITY_INVALID',
      details: { fieldName },
    });
  }
  return number;
}
