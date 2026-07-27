import {
  createContentKey,
  createCoverageEntityKey,
  validateStorageRow,
} from './marketing-history-contract.js';
import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const PLATFORM = 'youtube';
const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 1_000;

export function createYouTubeAvailabilityAwareGateway(input) {
  const availabilityByContentKey = new Map(input.rows.map((row) => [
    createContentKey({
      platform: PLATFORM,
      account_key: input.accountKey,
      external_content_id: requireText(row.video_id, 'video_id'),
    }),
    normalizeYouTubeAvailability(row.source_availability_status),
  ]));
  const gateway = input.gateway;
  return Object.freeze({
    listOrganicContentStatesByKeys: (...args) => gateway.listOrganicContentStatesByKeys(...args),
    readCoverageRun: (...args) => gateway.readCoverageRun(...args),
    saveOrganicContentObservation: (...args) => gateway.saveOrganicContentObservation(...args),
    saveCoverageRun: (...args) => gateway.saveCoverageRun(...args),
    saveCoverageEntities: (...args) => gateway.saveCoverageEntities(...args),
    upsertOrganicContentState: (row) => gateway.upsertOrganicContentState({
      ...row,
      source_availability_status: availabilityByContentKey.get(row.content_key)
        ?? row.source_availability_status,
    }),
  });
}

export async function writeYouTubeAvailabilityStates(input) {
  const batchSize = boundedBatchSize(input.batchSize);
  let rowsProcessed = 0;
  let written = 0;
  let skipped = 0;
  let coverageWritten = 0;
  let coverageSkipped = 0;

  for (const rawBatch of chunks(input.rawVideoRows, batchSize)) {
    await assertLockActive(input.context);
    const keys = rawBatch.map((row) => createContentKey({
      platform: PLATFORM,
      account_key: input.context.accountKey,
      external_content_id: requireText(row.video_id, 'video_id'),
    }));
    const existingRows = await input.context.gateway.listOrganicContentStatesByKeys(keys);
    const existingByKey = new Map(existingRows.map((row) => [row.content_key, row]));
    const coverageRows = [];

    for (const raw of rawBatch) {
      const externalContentId = requireText(raw.video_id, 'video_id');
      const contentKey = createContentKey({
        platform: PLATFORM,
        account_key: input.context.accountKey,
        external_content_id: externalContentId,
      });
      const availability = normalizeYouTubeAvailability(raw.source_availability_status);
      const state = await buildAvailabilityState({
        context: input.context,
        ids: input.ids,
        existing: existingByKey.get(contentKey) ?? null,
        contentKey,
        externalContentId,
        availability,
      });
      const result = await input.context.gateway.upsertOrganicContentState(state);
      if (result.status === 'written') written += 1;
      else skipped += 1;
      rowsProcessed += 1;
      coverageRows.push(validateStorageRow('data_coverage_entities', {
        coverage_entity_key: createCoverageEntityKey({
          coverage_run_id: input.ids.contentCoverageRunId,
          entity_type: 'content',
          external_entity_id: externalContentId,
        }),
        coverage_run_id: input.ids.contentCoverageRunId,
        entity_type: 'content',
        external_entity_id: externalContentId,
        observation_status: 'missing',
        source_revision: input.ids.sourceWatermark,
        observed_at: input.context.observedAt,
        created_at: input.context.observedAt,
      }));
    }

    await assertLockActive(input.context);
    const coverageResults = await input.context.gateway.saveCoverageEntities(coverageRows);
    coverageWritten += coverageResults.filter((row) => row.status === 'written').length;
    coverageSkipped += coverageResults.filter((row) => row.status !== 'written').length;
  }

  return Object.freeze({
    rowsProcessed,
    written,
    skipped,
    coverageWritten,
    coverageSkipped,
  });
}

export function selectYouTubeAvailabilityRows(rows) {
  return Object.freeze([...rows].sort((left, right) => (
    requireText(left.video_id, 'video_id').localeCompare(requireText(right.video_id, 'video_id'))
  )));
}

export function normalizeYouTubeAvailability(value) {
  const status = optionalText(value) ?? 'unknown';
  if (!['available', 'missing', 'private', 'deleted', 'expired', 'unknown'].includes(status)) {
    throw permanentError('Unsupported YouTube availability status', {
      code: 'YOUTUBE_AVAILABILITY_STATUS_INVALID',
      details: { status },
    });
  }
  return status;
}

async function buildAvailabilityState(input) {
  const metrics = Object.freeze({
    views: valueOrNull(input.existing?.views),
    likes: valueOrNull(input.existing?.likes),
    comments: valueOrNull(input.existing?.comments),
    shares: valueOrNull(input.existing?.shares),
    unique_viewers: valueOrNull(input.existing?.unique_viewers),
    avg_watch_time_seconds: valueOrNull(input.existing?.avg_watch_time_seconds),
    total_watch_time_seconds: valueOrNull(input.existing?.total_watch_time_seconds),
    completion_rate: valueOrNull(input.existing?.completion_rate),
  });
  const metadata = Object.freeze({
    source_account_id: input.context.sourceAccountId,
    content_type: optionalText(input.existing?.content_type),
    published_at: optionalInteger(input.existing?.published_at),
    caption: null,
    content_url: null,
    thumbnail_url: null,
    duration_seconds: null,
  });
  const metricsHash = optionalText(input.existing?.metrics_hash)
    ?? await createStableFingerprint({ contract: 'organic-cumulative-metrics-v1', ...metrics });
  const metadataHash = optionalText(input.existing?.metadata_hash)
    ?? await createStableFingerprint({ contract: 'organic-content-metadata-v1', ...metadata });
  const changed = !input.existing
    || optionalText(input.existing?.source_availability_status) !== input.availability;

  return validateStorageRow('organic_content_state', {
    content_key: input.contentKey,
    customer_profile: input.context.customerProfile,
    customer_key: input.context.customerKey,
    platform: PLATFORM,
    account_key: input.context.accountKey,
    source_account_id: input.context.sourceAccountId,
    external_content_id: input.externalContentId,
    content_type: metadata.content_type,
    published_at: metadata.published_at,
    first_seen_at: optionalInteger(input.existing?.first_seen_at) ?? input.context.observedAt,
    last_observed_at: input.context.observedAt,
    last_changed_at: changed
      ? input.context.observedAt
      : optionalInteger(input.existing?.last_changed_at),
    source_availability_status: input.availability,
    ...metrics,
    metrics_hash: metricsHash,
    metadata_hash: metadataHash,
    last_coverage_run_id: input.ids.contentCoverageRunId,
    last_sync_run_id: input.ids.historySyncRunId,
    created_at: optionalInteger(input.existing?.created_at) ?? input.context.observedAt,
    updated_at: input.context.observedAt,
  });
}

function boundedBatchSize(value) {
  if (value === null || value === undefined || value === '') return DEFAULT_BATCH_SIZE;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > MAX_BATCH_SIZE) {
    throw permanentError(`YouTube availability batchSize must be from 1 to ${MAX_BATCH_SIZE}`, {
      code: 'YOUTUBE_END_TO_END_STORAGE_BATCH_INVALID',
    });
  }
  return number;
}

function chunks(rows, size) {
  const result = [];
  for (let offset = 0; offset < rows.length; offset += size) {
    result.push(Object.freeze(rows.slice(offset, offset + size)));
  }
  return result;
}

async function assertLockActive(context) {
  if (typeof context.assertLockActive === 'function') {
    await context.assertLockActive();
  }
}

function valueOrNull(value) {
  return value === undefined || value === null ? null : value;
}

function optionalInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`YouTube availability storage requires ${fieldName}`);
  }
  return value.trim();
}

function optionalText(value) {
  if (value === undefined || value === null || value === '') return null;
  return typeof value === 'string' ? (value.trim() || null) : null;
}
