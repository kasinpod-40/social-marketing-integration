import {
  mapMissingYouTubeVideoRawRow,
  mapYouTubeAnalyticsResponse,
  mapYouTubeChannelRawRow,
  mapYouTubeVideoRawRow,
} from '../../../connectors/src/youtube/youtube-raw.adapter.js';
import { mapYouTubeChannelResource } from '../../../connectors/src/youtube/youtube-organic.adapter.js';
import { normalizeYouTubeVideoBatch } from './normalize-youtube-video-batch.js';
import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';
import { requireDateOnly } from '../../../shared/src/date/date-only.js';

const ANALYTICS_METRICS = 'views,likes,comments,shares,estimatedMinutesWatched,averageViewDuration,averageViewPercentage';
const ANALYTICS_DIMENSIONS = 'day,video';
const ANALYTICS_SORT = 'day,video';

/**
 * Manual UAT YouTube sync: RAW → Canonical → Account activation row → D1 checkpoint
 * ไม่มี Scheduler producer และไม่เปลี่ยน Connector เป็น active จนกว่า Live DEV UAT จะผ่าน
 */
export async function syncYouTubeOrganicToLark(input = {}) {
  const repository = requireRepository(input.repository);
  const syncEngine = requireSyncEngine(input.syncEngine);
  const publicClient = requireYouTubeClient(input.publicClient, 'publicClient');
  const ownerClient = input.ownerClient ?? null;
  const stateStore = requireStateStore(input.incrementalStateStore);
  const assertLockActive = typeof input.assertLockActive === 'function'
    ? input.assertLockActive
    : async () => undefined;
  const onProgress = typeof input.onProgress === 'function' ? input.onProgress : () => undefined;
  const now = typeof input.now === 'function' ? input.now : () => Date.now();
  const fetchedAt = safeTimestamp(now());
  const syncRunId = requireText(input.syncRunId, 'syncRunId');
  const channelId = requireText(input.channelId, 'channelId');
  const accountKey = requireText(input.accountKey, 'accountKey');
  const customerProfile = requireText(input.customerProfile, 'customerProfile');
  const cursorKey = requireText(input.cursorKey, 'cursorKey');
  const metricDate = requireDateOnly(input.metricDate, { label: 'metricDate' });
  const tables = requireTables(input.tables);
  const analyticsEnabled = input.analyticsEnabled === true;

  onProgress({ stage: 'youtube_checkpoint_loading', cursorKey });
  const checkpoint = await stateStore.loadCheckpoint(cursorKey);
  const syncMode = decideSyncMode({
    requested: input.syncMode,
    checkpoint,
    now: fetchedAt,
    fullSyncIntervalMs: positiveInteger(input.fullSyncIntervalMs ?? 86_400_000, 'fullSyncIntervalMs'),
  });

  await assertLockActive();
  const channelResource = await publicClient.getChannel({ channelId });
  const channel = mapYouTubeChannelResource(channelResource, channelId);
  if (analyticsEnabled) await assertOwnerChannel({ ownerClient, channelId });

  const recentVideoLimit = positiveInteger(input.recentVideoLimit ?? 100, 'recentVideoLimit');
  const videoIds = await publicClient.listUploadVideoIds({
    uploadsPlaylistId: channel.uploadsPlaylistId,
    ...(syncMode.fullSnapshot ? {} : { maxItems: recentVideoLimit }),
  });
  const videoResources = videoIds.length > 0 ? await publicClient.listVideos({ videoIds }) : [];
  const returnedVideoIds = new Set(videoResources.map((video) => requireText(video?.id, 'video.id')));
  const requestedButUnavailable = videoIds.filter((videoId) => !returnedVideoIds.has(videoId));

  const rawChannelRows = [mapYouTubeChannelRawRow(channelResource, { expectedChannelId: channelId, fetchedAt })];
  const rawVideoRows = videoResources.map((video) => mapYouTubeVideoRawRow(video, { expectedChannelId: channelId, fetchedAt }));
  const priorStates = Array.isArray(checkpoint?.recordStates) ? checkpoint.recordStates : [];
  const priorIds = new Set(priorStates.map((state) => state.externalContentId).filter(Boolean));
  const missingIds = syncMode.fullSnapshot
    ? [...new Set([...requestedButUnavailable, ...[...priorIds].filter((videoId) => !videoIds.includes(videoId))])]
    : requestedButUnavailable;
  const missingKeys = missingIds.map((videoId) => `youtube:${channelId}:${videoId}`);
  const existingMissingRecords = missingKeys.length === 0
    ? []
    : await repository.listByFieldValues(tables.rawYouTubeVideos, 'raw_video_key', missingKeys);
  const normalizedMissingRecords = await normalizeExistingRecords({
    repository,
    tableId: tables.rawYouTubeVideos,
    records: existingMissingRecords,
    fieldNames: ['raw_video_key', 'last_seen_at', 'missing_since'],
  });
  const existingMissingByKey = new Map(normalizedMissingRecords.map((record) => [
    record?.fields?.raw_video_key,
    record?.fields ?? {},
  ]));
  const requestedUnavailableSet = new Set(requestedButUnavailable);
  const priorStateById = new Map(priorStates.map((state) => [state.externalContentId, state]));
  const missingRows = missingIds.map((videoId) => {
    const key = `youtube:${channelId}:${videoId}`;
    const existing = existingMissingByKey.get(key) ?? {};
    const observedInUploadsPlaylist = requestedUnavailableSet.has(videoId);
    const lastSeenAt = observedInUploadsPlaylist
      ? fetchedAt
      : readSafeTimestamp(existing.last_seen_at)
        ?? readSafeTimestamp(priorStateById.get(videoId)?.lastSeenAt)
        ?? fetchedAt;
    return mapMissingYouTubeVideoRawRow({
      channelId,
      videoId,
      fetchedAt,
      lastSeenAt,
      missingSince: readSafeTimestamp(existing.missing_since) ?? fetchedAt,
      observedInUploadsPlaylist,
    });
  });

  const normalized = normalizeYouTubeVideoBatch({
    videoResources,
    accountId: accountKey,
    channelId,
    metricDate,
    dictionaryRules: input.dictionaryRules ?? [],
  });
  if (normalized.skippedRows.length > 0 || normalized.sourceChannelIds.some((id) => id !== channelId)) {
    throw permanentError('YouTube normalization preflight failed', {
      code: 'YOUTUBE_SYNC_NOT_READY',
      details: { skippedRows: normalized.skippedRows.length, sourceChannelIds: normalized.sourceChannelIds },
    });
  }

  const analyticsRange = analyticsEnabled
    ? Object.freeze({
      startDate: requireDateOnly(input.analyticsStartDate, { label: 'analyticsStartDate' }),
      endDate: requireDateOnly(input.analyticsEndDate, { label: 'analyticsEndDate' }),
    })
    : null;
  const analyticsVideoIds = videoResources.map((video) => requireText(video.id, 'video.id'));
  const analyticsRows = analyticsRange
    ? await loadAnalyticsRows({
      ownerClient,
      channelId,
      videoIds: analyticsVideoIds,
      startDate: analyticsRange.startDate,
      endDate: analyticsRange.endDate,
      fetchedAt,
      assertLockActive,
      maxPages: positiveInteger(input.analyticsMaxPages ?? 1000, 'analyticsMaxPages'),
    })
    : [];
  const analyticsReconciliation = analyticsRange
    ? await reconcileAnalyticsRows({
      repository,
      tableId: tables.rawYouTubeAnalyticsDaily,
      channelId,
      videoIds: analyticsVideoIds,
      startDate: analyticsRange.startDate,
      endDate: analyticsRange.endDate,
      analyticsRows,
      assertLockActive,
      onProgress,
    })
    : emptyAnalyticsReconciliation();

  const accountRows = [Object.freeze({
    account_key: `youtube:${accountKey}`,
    platform: 'youtube',
    account_id: channelId,
    account_name: channel.title,
    account_type: 'channel',
    connection_status: 'connected',
    timezone: requireText(input.reportingTimezone ?? 'Asia/Bangkok', 'reportingTimezone'),
    last_sync_at: fetchedAt,
  })];

  const plans = await planAll({
    repository,
    syncEngine,
    tables,
    rows: {
      rawChannels: rawChannelRows,
      rawVideos: [...rawVideoRows, ...missingRows],
      rawAnalytics: analyticsRows,
      content: normalized.contentRows,
      daily: normalized.dailySnapshotRows,
      accounts: accountRows,
    },
    onProgress,
  });

  if (input.dryRun === true) {
    return buildResult({
      mode: 'dry_run', syncRunId, syncMode, videoIds, videoResources, missingIds,
      analyticsRows, analyticsReconciliation, plans, checkpointSaved: false,
    });
  }

  const results = {};
  for (const [name, plan] of orderedPlans(plans)) {
    await assertLockActive();
    results[name] = await syncEngine.executePlan(plan, {
      beforeWriteChunk: assertLockActive,
      onProgress: (event) => onProgress({ scope: name, ...event }),
    });
  }

  await assertLockActive();
  const completedAt = safeTimestamp(now());
  const recordStates = await buildCheckpointStates({
    videoResources,
    missingIds,
    priorStates,
  });
  await stateStore.saveCheckpoint({
    cursor: {
      cursorKey,
      customerProfile,
      platform: 'youtube',
      accountKey,
      source: 'youtube_data_api',
      syncType: 'organic_manual_uat',
      lastMetricDate: metricDate,
      dictionaryHash: null,
      lastFullSyncAt: syncMode.fullSnapshot ? completedAt : (checkpoint?.cursor?.lastFullSyncAt ?? null),
      lastSuccessfulSyncAt: completedAt,
      incrementalRunCount: syncMode.fullSnapshot ? 0 : Number(checkpoint?.cursor?.incrementalRunCount ?? 0) + 1,
      lastSyncRunId: syncRunId,
    },
    records: recordStates,
    fullSnapshot: syncMode.fullSnapshot,
  });

  return buildResult({
    mode: 'write', syncRunId, syncMode, videoIds, videoResources, missingIds,
    analyticsRows, analyticsReconciliation, plans, results, checkpointSaved: true,
  });
}

/**
 * ตรวจเฉพาะ Stable key ที่เคยมีอยู่ในช่วงวันที่/Video ที่รอบนี้ query จริง
 * แถวที่หายจะไม่ถูกเขียนทับหรือลบ และถูกส่งเป็น Warning เพื่อให้ตรวจ Reconciliation
 */
async function reconcileAnalyticsRows(input) {
  const sourceMetricDates = enumerateDateOnlyRange(input.startDate, input.endDate);
  const videoIds = new Set(input.videoIds);
  const observedStableKeys = new Set(input.analyticsRows.map((row) => requireText(
    row.raw_analytics_daily_key,
    'raw_analytics_daily_key',
  )));
  if (videoIds.size === 0) {
    return createAnalyticsReconciliation({
      startDate: input.startDate,
      endDate: input.endDate,
      observedStableKeys: observedStableKeys.size,
    });
  }

  await input.assertLockActive();
  input.onProgress({
    stage: 'youtube_analytics_reconciliation_loading',
    sourceMetricDates: sourceMetricDates.length,
    videos: videoIds.size,
  });
  const existingRecords = await input.repository.listByFieldValues(
    input.tableId,
    'source_metric_date',
    sourceMetricDates,
  );
  const normalizedRecords = await normalizeExistingRecords({
    repository: input.repository,
    tableId: input.tableId,
    records: existingRecords,
    fieldNames: ['raw_analytics_daily_key', 'source_metric_date', 'channel_id', 'video_id'],
  });
  const requestedDates = new Set(sourceMetricDates);
  const previouslyObservedStableKeys = new Set();
  for (const record of normalizedRecords) {
    const fields = record?.fields ?? {};
    const stableKey = optionalText(fields.raw_analytics_daily_key);
    const sourceMetricDate = optionalText(fields.source_metric_date);
    const sourceChannelId = optionalText(fields.channel_id);
    const videoId = optionalText(fields.video_id);
    if (!stableKey
      || sourceChannelId !== input.channelId
      || !videoIds.has(videoId)
      || !requestedDates.has(sourceMetricDate)) {
      continue;
    }
    previouslyObservedStableKeys.add(stableKey);
  }

  const missingStableKeys = [...previouslyObservedStableKeys]
    .filter((stableKey) => !observedStableKeys.has(stableKey))
    .sort();
  input.onProgress({
    stage: 'youtube_analytics_reconciliation_complete',
    previouslyObserved: previouslyObservedStableKeys.size,
    observed: observedStableKeys.size,
    missing: missingStableKeys.length,
  });
  return createAnalyticsReconciliation({
    startDate: input.startDate,
    endDate: input.endDate,
    observedStableKeys: observedStableKeys.size,
    previouslyObservedStableKeys: previouslyObservedStableKeys.size,
    missingStableKeys,
  });
}

async function loadAnalyticsRows(input) {
  if (!input.ownerClient) throw permanentError('YouTube Analytics requires OAuth owner client', { code: 'YOUTUBE_ANALYTICS_OAUTH_REQUIRED' });
  const rows = [];
  const chunks = chunk(input.videoIds, 50);
  for (const videoIds of chunks) {
    let startIndex = 1;
    for (let page = 1; page <= input.maxPages; page += 1) {
      await input.assertLockActive();
      const response = await input.ownerClient.queryAnalytics({
        channelId: input.channelId,
        startDate: input.startDate,
        endDate: input.endDate,
        metrics: ANALYTICS_METRICS,
        dimensions: ANALYTICS_DIMENSIONS,
        filters: `video==${videoIds.join(',')}`,
        sort: ANALYTICS_SORT,
        maxResults: 200,
        startIndex,
      });
      const mapped = mapYouTubeAnalyticsResponse(response, {
        channelId: input.channelId,
        fetchedAt: input.fetchedAt,
      });
      rows.push(...mapped);
      if (mapped.length < 200) break;
      startIndex += mapped.length;
      if (page === input.maxPages) {
        throw permanentError('YouTube Analytics pagination exceeded maxPages', {
          code: 'YOUTUBE_ANALYTICS_PAGINATION_LIMIT',
          details: { maxPages: input.maxPages },
        });
      }
    }
  }
  return rows;
}

async function assertOwnerChannel({ ownerClient, channelId }) {
  if (!ownerClient) throw permanentError('YouTube Analytics requires OAuth owner credentials', { code: 'YOUTUBE_ANALYTICS_OAUTH_REQUIRED' });
  const owner = await ownerClient.getChannel({ mine: true });
  mapYouTubeChannelResource(owner, channelId);
}

async function planAll(input) {
  const definitions = [
    ['rawChannels', input.tables.rawYouTubeChannels, 'raw_channel_key', input.rows.rawChannels],
    ['rawVideos', input.tables.rawYouTubeVideos, 'raw_video_key', input.rows.rawVideos],
    ['rawAnalytics', input.tables.rawYouTubeAnalyticsDaily, 'raw_analytics_daily_key', input.rows.rawAnalytics],
    ['content', input.tables.mktContent, 'content_key', input.rows.content],
    ['dailySnapshots', input.tables.mktContentDaily, 'content_daily_key', input.rows.daily],
    // Account ต้อง Execute สุดท้ายเพื่อไม่ประกาศ connected ก่อน RAW/Canonical writes ผ่าน
    ['accounts', input.tables.mktAccounts, 'account_key', input.rows.accounts],
  ];
  const result = {};
  for (const [name, tableId, keyField, rows] of definitions) {
    result[name] = await input.syncEngine.planByKey({
      repository: input.repository,
      tableId,
      keyField,
      rows,
      onProgress: (event) => input.onProgress({ scope: name, ...event }),
    });
  }
  return Object.freeze(result);
}

function orderedPlans(plans) {
  return ['rawChannels', 'rawVideos', 'rawAnalytics', 'content', 'dailySnapshots', 'accounts']
    .map((name) => [name, plans[name]]);
}

async function buildCheckpointStates({ videoResources, missingIds, priorStates }) {
  const states = [];
  for (const video of videoResources) {
    states.push(Object.freeze({
      sourceRecordId: requireText(video.id, 'video.id'),
      sourceModifiedAt: Date.parse(video?.snippet?.publishedAt ?? '') || null,
      sourceHash: await createStableFingerprint(video),
      externalContentId: requireText(video.id, 'video.id'),
    }));
  }
  const priorById = new Map(priorStates.map((state) => [state.externalContentId, state]));
  for (const videoId of missingIds) {
    const prior = priorById.get(videoId);
    states.push(Object.freeze({
      sourceRecordId: videoId,
      sourceModifiedAt: prior?.sourceModifiedAt ?? null,
      sourceHash: await createStableFingerprint({ videoId, availability: 'missing' }),
      externalContentId: videoId,
    }));
  }
  return dedupeBy(states, (state) => state.sourceRecordId);
}

function decideSyncMode(input) {
  const requested = optionalText(input.requested)?.toLowerCase() ?? 'auto';
  if (!['auto', 'full', 'incremental'].includes(requested)) {
    throw permanentError(`Unsupported YouTube syncMode: ${requested}`, { code: 'MKT_RUNTIME_CONFIG_INVALID' });
  }
  if (requested === 'full') return Object.freeze({ requested, mode: 'full', reason: 'manual_full', fullSnapshot: true });
  if (!input.checkpoint?.cursor) return Object.freeze({ requested, mode: 'full', reason: 'initial_checkpoint', fullSnapshot: true });
  if (input.checkpoint.cursor.lastFullSyncAt === null
    || input.now - input.checkpoint.cursor.lastFullSyncAt >= input.fullSyncIntervalMs) {
    return Object.freeze({ requested, mode: 'full', reason: 'periodic_reconciliation', fullSnapshot: true });
  }
  return Object.freeze({ requested, mode: 'incremental', reason: 'recent_upload_window', fullSnapshot: false });
}

function buildResult(input) {
  const summaries = Object.fromEntries(Object.entries(input.plans).map(([name, plan]) => [name, Object.freeze({
    createRows: plan.createRows.length,
    updateRows: plan.updateRows.length,
    skipped: plan.skipped,
    ...(input.results?.[name] ? { result: input.results[name] } : {}),
  })]));
  const output = (name) => input.results?.[name] ?? Object.freeze({
    created: 0,
    updated: 0,
    skipped: input.plans[name].skipped,
    writeOutcome: input.mode === 'dry_run' ? 'not_started' : null,
  });
  const videoWarnings = input.missingIds.map((videoId) => Object.freeze({
    code: 'YOUTUBE_VIDEO_RECONCILIATION_REQUIRED',
    videoId,
    message: 'Retained prior RAW video metrics because the current traversal could not return the video resource.',
  }));
  const analyticsWarnings = input.analyticsReconciliation.missingStableKeys.length > 0
    ? [Object.freeze({
      code: 'YOUTUBE_ANALYTICS_RECONCILIATION_REQUIRED',
      missingStableKeys: input.analyticsReconciliation.missingStableKeys,
      missingCount: input.analyticsReconciliation.missingStableKeys.length,
      message: 'Retained previously observed RAW Analytics rows that disappeared from the current re-fetch.',
    })]
    : [];
  return Object.freeze({
    syncRunId: input.syncRunId,
    platform: 'youtube',
    source: 'youtube_data_api',
    mode: input.mode,
    incremental: input.syncMode,
    rawRecords: 1 + input.videoResources.length + input.analyticsRows.length,
    warnings: Object.freeze([...videoWarnings, ...analyticsWarnings]),
    reconciliation: Object.freeze({
      required: input.missingIds.length > 0
        || input.analyticsReconciliation.missingStableKeys.length > 0,
      missingVideoIds: Object.freeze([...input.missingIds]),
      missingAnalyticsStableKeys: input.analyticsReconciliation.missingStableKeys,
      analytics: input.analyticsReconciliation,
      policy: 'retain_prior_metrics_never_delete_or_zero_fill',
    }),
    sourceSummary: Object.freeze({
      playlistVideoIds: input.videoIds.length,
      videoResources: input.videoResources.length,
      missingVideos: input.missingIds.length,
      analyticsRows: input.analyticsRows.length,
      missingAnalyticsRows: input.analyticsReconciliation.missingStableKeys.length,
    }),
    rawChannels: output('rawChannels'),
    rawVideos: output('rawVideos'),
    rawAnalytics: output('rawAnalytics'),
    content: output('content'),
    dailySnapshots: output('dailySnapshots'),
    accounts: output('accounts'),
    tables: Object.freeze(summaries),
    checkpointSaved: input.checkpointSaved,
  });
}

function createAnalyticsReconciliation(input = {}) {
  return Object.freeze({
    enabled: true,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    observedStableKeys: Number(input.observedStableKeys ?? 0),
    previouslyObservedStableKeys: Number(input.previouslyObservedStableKeys ?? 0),
    missingStableKeys: Object.freeze([...(input.missingStableKeys ?? [])]),
    policy: 'retain_prior_row_emit_reconciliation_warning',
  });
}

function emptyAnalyticsReconciliation() {
  return Object.freeze({
    enabled: false,
    startDate: null,
    endDate: null,
    observedStableKeys: 0,
    previouslyObservedStableKeys: 0,
    missingStableKeys: Object.freeze([]),
    policy: 'not_enabled',
  });
}

function enumerateDateOnlyRange(startDate, endDate) {
  const start = requireDateOnly(startDate, { label: 'analyticsStartDate' });
  const end = requireDateOnly(endDate, { label: 'analyticsEndDate' });
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (endMs < startMs) throw new RangeError('analyticsEndDate must not be before analyticsStartDate');
  const dates = [];
  for (let instant = startMs; instant <= endMs; instant += 86_400_000) {
    dates.push(new Date(instant).toISOString().slice(0, 10));
  }
  return Object.freeze(dates);
}

async function normalizeExistingRecords(input) {
  if (input.records.length === 0 || typeof input.repository.prepareExistingRecords !== 'function') {
    return input.records;
  }
  return input.repository.prepareExistingRecords(input.tableId, input.records, {
    incomingFieldNames: input.fieldNames,
  });
}

function readSafeTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
function requireRepository(value) {
  for (const method of ['prepareRows', 'createMany', 'updateMany', 'listByFieldValues']) if (typeof value?.[method] !== 'function') throw new TypeError(`YouTube sync requires repository.${method}`);
  return value;
}
function requireSyncEngine(value) {
  for (const method of ['planByKey', 'executePlan']) if (typeof value?.[method] !== 'function') throw new TypeError(`YouTube sync requires syncEngine.${method}`);
  return value;
}
function requireYouTubeClient(value, fieldName) {
  for (const method of ['getChannel', 'listUploadVideoIds', 'listVideos']) if (typeof value?.[method] !== 'function') throw new TypeError(`YouTube sync requires ${fieldName}.${method}`);
  return value;
}
function requireStateStore(value) {
  for (const method of ['loadCheckpoint', 'saveCheckpoint']) if (typeof value?.[method] !== 'function') throw new TypeError(`YouTube sync requires incrementalStateStore.${method}`);
  return value;
}
function requireTables(value) {
  const keys = ['mktAccounts', 'rawYouTubeChannels', 'rawYouTubeVideos', 'rawYouTubeAnalyticsDaily', 'mktContent', 'mktContentDaily'];
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, requireText(value?.[key], `tables.${key}`)])));
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`YouTube sync requires ${fieldName}`);
  return value.trim();
}
function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function safeTimestamp(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError('timestamp must be epoch milliseconds');
  return number;
}
function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be positive`);
  return number;
}
function chunk(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}
function dedupeBy(values, readKey) {
  return [...new Map(values.map((value) => [readKey(value), value])).values()];
}
