import { createOrganicHistoryWriter } from './organic-history-writer.js';
import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';
import {
  createYouTubeAvailabilityAwareGateway,
  normalizeYouTubeAvailability,
  selectYouTubeAvailabilityRows,
  writeYouTubeAvailabilityStates,
} from './youtube-availability-history-storage.js';
import { writeYouTubeAccountSnapshot } from './youtube-account-history-storage.js';

const PLATFORM = 'youtube';
const CONTENT_DATASET_KEY = 'organic_content_cumulative';
const STORAGE_BATCH_SIZE = 500;
const CAPTURE_NAMES = Object.freeze([
  'rawChannels',
  'rawVideos',
  'rawAnalytics',
  'contentRows',
  'dailyRows',
  'accountRows',
]);

export async function writeYouTubeOrganicStorageFirst(context, captured) {
  const rows = requireCapturedRows(captured);
  const ids = await createStorageIds(context, rows);
  const availabilityRows = selectYouTubeAvailabilityRows(rows.rawVideos);
  const contentRows = sortContentRows(rows.contentRows);
  const dailyByContentId = indexDailyRows(rows.dailyRows);
  const contentIds = new Set(contentRows.map((row) => (
    requireText(row.external_content_id, 'external_content_id')
  )));
  const unavailableWithoutContent = availabilityRows.filter((row) => (
    normalizeYouTubeAvailability(row.source_availability_status) !== 'available'
      && !contentIds.has(requireText(row.video_id, 'video_id'))
  ));
  const writer = createWriter(context, ids, createYouTubeAvailabilityAwareGateway({
    gateway: context.gateway,
    rows: availabilityRows,
    accountKey: context.accountKey,
  }));

  const coverageStart = await writer.beginCoverage({
    expectedEntities: availabilityRows.length,
    expectedRows: availabilityRows.length,
    sourceWatermark: ids.sourceWatermark,
  });

  let contentWrite = emptyContentWrite();
  let availabilityWrite = emptyAvailabilityWrite();
  try {
    for (const contentBatch of chunks(contentRows, STORAGE_BATCH_SIZE)) {
      await assertLockActive(context);
      const batchWrite = await writer.writeBatch({
        contentRows: contentBatch,
        dailySnapshotRows: contentBatch.map((row) => {
          const externalContentId = requireText(row.external_content_id, 'external_content_id');
          const daily = dailyByContentId.get(externalContentId);
          if (!daily) {
            throw permanentError('YouTube D1 storage is missing a matching Daily row', {
              code: 'YOUTUBE_END_TO_END_CAPTURE_INCOMPLETE',
              details: { externalContentId },
            });
          }
          return daily;
        }),
      });
      contentWrite = mergeContentWrite(contentWrite, batchWrite);
    }
    await assertLockActive(context);
    availabilityWrite = await writeYouTubeAvailabilityStates({
      context,
      ids,
      rawVideoRows: unavailableWithoutContent,
      batchSize: STORAGE_BATCH_SIZE,
    });
    await assertLockActive(context);
    await writer.completeCoverage({
      expectedEntities: availabilityRows.length,
      observedEntities: availabilityRows.length,
      expectedRows: availabilityRows.length,
      observedRows: availabilityRows.length,
      writtenRows: availabilityRows.length
        + contentWrite.observationsCreated
        + contentWrite.observationsSkipped,
      sourceWatermark: ids.sourceWatermark,
      completedAt: context.observedAt,
    });
  } catch (error) {
    if (!coverageStart.replay) {
      await writer.failCoverage({
        expectedEntities: availabilityRows.length,
        observedEntities: contentWrite.contentRows + availabilityWrite.rowsProcessed,
        expectedRows: availabilityRows.length,
        observedRows: contentWrite.contentRows + availabilityWrite.rowsProcessed,
        writtenRows: contentWrite.contentRows
          + contentWrite.observationsCreated
          + contentWrite.observationsSkipped
          + availabilityWrite.rowsProcessed,
        failedRows: 1,
        sourceWatermark: ids.sourceWatermark,
        errorCode: error?.code ?? 'YOUTUBE_D1_STORAGE_WRITE_FAILED',
        completedAt: context.observedAt,
      });
    }
    throw error;
  }

  await assertLockActive(context);
  const analyticsWrite = await context.analyticsStore.upsertMany(rows.rawAnalytics, {
    customerProfile: context.customerProfile,
    customerKey: context.customerKey,
    accountKey: context.accountKey,
    syncRunId: context.syncRunId,
  });
  await assertLockActive(context);
  const accountWrite = await writeYouTubeAccountSnapshot({
    context,
    ids,
    rawChannelRows: rows.rawChannels,
  });
  return Object.freeze({
    status: 'complete',
    mode: 'd1_first',
    sourceWatermark: ids.sourceWatermark,
    contentCoverageRunId: ids.contentCoverageRunId,
    accountCoverageRunId: ids.accountCoverageRunId,
    historySyncRunId: ids.historySyncRunId,
    content: contentWrite,
    availability: availabilityWrite,
    account: accountWrite,
    analytics: analyticsWrite,
    analyticsStoragePolicy: 'd1_period_facts_not_coerced_into_cumulative_observations',
  });
}

export async function writeYouTubeOrganicStorageBatch(context, captured, input = {}) {
  const rows = requireCapturedRows(captured);
  const ids = await createStorageIds(context, rows);
  const availabilityRows = selectYouTubeAvailabilityRows(rows.rawVideos);
  const contentRows = sortContentRows(rows.contentRows);
  const dailyByContentId = indexDailyRows(rows.dailyRows);
  const contentIds = new Set(contentRows.map((row) => (
    requireText(row.external_content_id, 'external_content_id')
  )));
  const unavailableWithoutContent = availabilityRows.filter((row) => (
    normalizeYouTubeAvailability(row.source_availability_status) !== 'available'
      && !contentIds.has(requireText(row.video_id, 'video_id'))
  ));
  const writer = createWriter(context, ids, createYouTubeAvailabilityAwareGateway({
    gateway: context.gateway,
    rows: availabilityRows,
    accountKey: context.accountKey,
  }));
  const start = boundedStorageIndex(input.startIndex ?? 0, contentRows.length);
  const maximum = boundedStorageBatchSize(input.maxRows ?? 100);
  const stop = Math.min(contentRows.length, start + maximum);
  const contentBatch = contentRows.slice(start, stop);

  await writer.beginCoverage({
    expectedEntities: availabilityRows.length,
    expectedRows: availabilityRows.length,
    sourceWatermark: ids.sourceWatermark,
  });
  await assertLockActive(context);
  const contentWrite = contentBatch.length === 0
    ? emptyContentWrite()
    : await writer.writeBatch({
      contentRows: contentBatch,
      dailySnapshotRows: contentBatch.map((row) => {
        const externalContentId = requireText(row.external_content_id, 'external_content_id');
        const daily = dailyByContentId.get(externalContentId);
        if (!daily) {
          throw permanentError('YouTube D1 storage is missing a matching Daily row', {
            code: 'YOUTUBE_END_TO_END_CAPTURE_INCOMPLETE',
            details: { externalContentId },
          });
        }
        return daily;
      }),
    });
  if (stop < contentRows.length) {
    return Object.freeze({
      complete: false,
      nextIndex: stop,
      expectedItems: contentRows.length,
      content: contentWrite,
      sourceWatermark: ids.sourceWatermark,
    });
  }

  await assertLockActive(context);
  const availabilityWrite = await writeYouTubeAvailabilityStates({
    context,
    ids,
    rawVideoRows: unavailableWithoutContent,
    batchSize: STORAGE_BATCH_SIZE,
  });
  const totals = mergeContentWrite(input.contentTotals ?? emptyContentWrite(), contentWrite);
  await assertLockActive(context);
  await writer.completeCoverage({
    expectedEntities: availabilityRows.length,
    observedEntities: availabilityRows.length,
    expectedRows: availabilityRows.length,
    observedRows: availabilityRows.length,
    writtenRows: availabilityRows.length
      + totals.observationsCreated
      + totals.observationsSkipped,
    sourceWatermark: ids.sourceWatermark,
    completedAt: context.observedAt,
  });
  await assertLockActive(context);
  const analyticsWrite = await context.analyticsStore.upsertMany(rows.rawAnalytics, {
    customerProfile: context.customerProfile,
    customerKey: context.customerKey,
    accountKey: context.accountKey,
    syncRunId: context.syncRunId,
  });
  await assertLockActive(context);
  const accountWrite = await writeYouTubeAccountSnapshot({
    context,
    ids,
    rawChannelRows: rows.rawChannels,
  });
  return Object.freeze({
    complete: true,
    nextIndex: stop,
    expectedItems: contentRows.length,
    storage: Object.freeze({
      status: 'complete',
      mode: 'd1_first_bounded',
      sourceWatermark: ids.sourceWatermark,
      contentCoverageRunId: ids.contentCoverageRunId,
      accountCoverageRunId: ids.accountCoverageRunId,
      historySyncRunId: ids.historySyncRunId,
      content: totals,
      availability: availabilityWrite,
      account: accountWrite,
      analytics: analyticsWrite,
      analyticsStoragePolicy: 'd1_period_facts_not_coerced_into_cumulative_observations',
    }),
  });
}

export async function previewYouTubeOrganicStorage(context, captured) {
  const rows = requireCapturedRows(captured);
  const ids = await createStorageIds(context, rows);
  const contentRows = sortContentRows(rows.contentRows);
  const dailyByContentId = indexDailyRows(rows.dailyRows);
  const contentIds = new Set(contentRows.map((row) => row.external_content_id));
  let plannedStateRows = 0;
  let plannedObservationRows = 0;
  for (const contentBatch of chunks(contentRows, STORAGE_BATCH_SIZE)) {
    await assertLockActive(context);
    const plan = await createWriter(context, ids, context.gateway).preflightBatch({
      contentRows: contentBatch,
      dailySnapshotRows: contentBatch.map((row) => {
        const externalContentId = requireText(row.external_content_id, 'external_content_id');
        const daily = dailyByContentId.get(externalContentId);
        if (!daily) {
          throw permanentError('YouTube D1 preview is missing a matching Daily row', {
            code: 'YOUTUBE_END_TO_END_CAPTURE_INCOMPLETE',
            details: { externalContentId },
          });
        }
        return daily;
      }),
    });
    plannedStateRows += plan.stateRows.length;
    plannedObservationRows += plan.observationRows.length;
  }
  return Object.freeze({
    status: 'preview',
    mode: 'read_only',
    sourceWatermark: ids.sourceWatermark,
    contentCoverageRunId: ids.contentCoverageRunId,
    accountCoverageRunId: ids.accountCoverageRunId,
    plannedStateRows,
    plannedObservationRows,
    plannedAvailabilityRows: selectYouTubeAvailabilityRows(rows.rawVideos).filter((row) => (
      normalizeYouTubeAvailability(row.source_availability_status) !== 'available'
        && !contentIds.has(row.video_id)
    )).length,
    plannedAccountRows: rows.rawChannels.length,
    plannedAnalyticsRows: rows.rawAnalytics.length,
  });
}

function createWriter(context, ids, gateway) {
  return createOrganicHistoryWriter({
    gateway,
    customerProfile: context.customerProfile,
    customerKey: context.customerKey,
    platform: PLATFORM,
    accountKey: context.accountKey,
    sourceAccountId: context.sourceAccountId,
    sourceTimezone: context.sourceTimezone,
    observedAt: context.observedAt,
    fetchedAt: context.fetchedAt,
    historySyncRunId: ids.historySyncRunId,
    coverageRunId: ids.contentCoverageRunId,
    sourceRevision: ids.sourceWatermark,
    scopeMode: context.scopeMode,
    datasetKey: CONTENT_DATASET_KEY,
  });
}

async function createStorageIds(context, rows) {
  const sourceWatermark = await createStableFingerprint({
    contract: 'youtube-organic-storage-source-v1',
    workKey: context.workKey,
    generation: context.generation,
    accountKey: context.accountKey,
    contentRows: sortContentRows(rows.contentRows),
    availability: selectYouTubeAvailabilityRows(rows.rawVideos).map((row) => ({
      videoId: row.video_id,
      status: row.source_availability_status,
      etag: row.etag ?? null,
    })),
    channel: rows.rawChannels.map((row) => ({
      channelId: row.channel_id,
      subscriberCountHidden: row.subscriber_count_hidden === true,
      videoCount: row.video_count ?? null,
      viewCount: row.view_count ?? null,
      subscriberCount: row.subscriber_count ?? null,
    })),
  });
  const digest = await createStableFingerprint({
    contract: 'youtube-organic-storage-operation-v1',
    workKey: context.workKey,
    generation: context.generation,
    accountKey: context.accountKey,
  });
  return Object.freeze({
    sourceWatermark,
    contentCoverageRunId: `coverage:youtube:${digest}`,
    accountCoverageRunId: `coverage:youtube-account:${digest}`,
    historySyncRunId: `history:youtube:${digest}`,
  });
}

function requireCapturedRows(captured) {
  const result = {};
  for (const name of CAPTURE_NAMES) {
    const rows = captured.get(name);
    if (!Array.isArray(rows)) {
      throw permanentError(`YouTube end-to-end capture is missing ${name}`, {
        code: 'YOUTUBE_END_TO_END_CAPTURE_INCOMPLETE',
        details: { missing: name },
      });
    }
    result[name] = rows;
  }
  if (result.rawChannels.length !== 1) {
    throw permanentError('YouTube end-to-end capture requires exactly one Channel row', {
      code: 'YOUTUBE_CHANNEL_IDENTITY_MISMATCH',
      details: { channelRows: result.rawChannels.length },
    });
  }
  const rawIds = new Set(result.rawVideos.map((row) => requireText(row.video_id, 'video_id')));
  if (rawIds.size !== result.rawVideos.length) {
    throw permanentError('YouTube RAW Video capture contains duplicate Video IDs', {
      code: 'YOUTUBE_VIDEO_DUPLICATE_RESOURCE',
    });
  }
  return Object.freeze(result);
}

function sortContentRows(rows) {
  return Object.freeze([...rows].sort((left, right) => (
    requireText(left.external_content_id, 'external_content_id')
      .localeCompare(requireText(right.external_content_id, 'external_content_id'))
  )));
}

function indexDailyRows(rows) {
  const result = new Map();
  for (const row of rows) {
    const externalContentId = requireText(row.external_content_id, 'daily.external_content_id');
    if (result.has(externalContentId)) {
      throw permanentError('YouTube D1 capture contains duplicate Daily Content IDs', {
        code: 'YOUTUBE_END_TO_END_CAPTURE_INCOMPLETE',
        details: { externalContentId },
      });
    }
    result.set(externalContentId, row);
  }
  return result;
}

function chunks(rows, size) {
  const result = [];
  for (let offset = 0; offset < rows.length; offset += size) {
    result.push(Object.freeze(rows.slice(offset, offset + size)));
  }
  return result;
}

function boundedStorageIndex(value, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > maximum) {
    throw new TypeError('YouTube D1 storage startIndex is outside the snapshot');
  }
  return number;
}

function boundedStorageBatchSize(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 500) {
    throw new TypeError('YouTube D1 storage maxRows must be an integer from 1 to 500');
  }
  return number;
}

function mergeContentWrite(left, right) {
  return Object.freeze({
    contentRows: left.contentRows + right.contentRows,
    stateWritten: left.stateWritten + right.stateWritten,
    stateSkipped: left.stateSkipped + right.stateSkipped,
    observationsCreated: left.observationsCreated + right.observationsCreated,
    observationsSkipped: left.observationsSkipped + right.observationsSkipped,
    observationsNotRequired: left.observationsNotRequired + right.observationsNotRequired,
    coverageEntitiesWritten: left.coverageEntitiesWritten + right.coverageEntitiesWritten,
    coverageEntitiesSkipped: left.coverageEntitiesSkipped + right.coverageEntitiesSkipped,
    classifications: Object.freeze([
      ...(left.classifications ?? []),
      ...(right.classifications ?? []),
    ]),
  });
}

function emptyContentWrite() {
  return Object.freeze({
    contentRows: 0,
    stateWritten: 0,
    stateSkipped: 0,
    observationsCreated: 0,
    observationsSkipped: 0,
    observationsNotRequired: 0,
    coverageEntitiesWritten: 0,
    coverageEntitiesSkipped: 0,
    classifications: Object.freeze([]),
  });
}

function emptyAvailabilityWrite() {
  return Object.freeze({
    rowsProcessed: 0,
    written: 0,
    skipped: 0,
    coverageWritten: 0,
    coverageSkipped: 0,
  });
}

async function assertLockActive(context) {
  if (typeof context.assertLockActive === 'function') {
    await context.assertLockActive();
  }
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`YouTube organic storage requires ${fieldName}`);
  }
  return value.trim();
}
