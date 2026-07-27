import { syncYouTubeOrganicToLark } from './sync-youtube-organic-to-lark.js';
import { YouTubeStorageFirstSyncEngine } from '../storage/youtube-storage-first-sync-engine.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';
import { requireDateOnly, todayInTimeZone } from '../../../shared/src/date/date-only.js';

/**
 * ประกอบ YouTube Source flow เดิมเข้ากับ Storage Architecture v1 แบบ D1-first
 * โดยห่อ Existing TableSyncEngine แทนการสร้าง Connector, Reliability หรือ Lark engine ใหม่.
 */
export async function syncYouTubeOrganicEndToEnd(input = {}) {
  const gateway = requireHistoryGateway(input.historyGateway);
  await gateway.assertSchemaReady();

  const requestedAt = requiredTimestamp(input.requestedAt ?? input.generation, 'requestedAt');
  const generation = requiredTimestamp(input.generation ?? requestedAt, 'generation');
  const metricDate = requireDateOnly(input.metricDate, { label: 'metricDate' });
  const sourceTimezone = requireText(
    input.sourceTimezone ?? input.reportingTimezone ?? 'Asia/Bangkok',
    'sourceTimezone',
  );
  const observedMetricDate = todayInTimeZone(sourceTimezone, new Date(requestedAt));
  if (metricDate !== observedMetricDate) {
    throw permanentError('YouTube cumulative metricDate must match the durable observation date', {
      code: 'YOUTUBE_METRIC_DATE_GENERATION_MISMATCH',
      details: { metricDate, observedMetricDate, sourceTimezone },
    });
  }
  const dryRun = input.dryRun === true;
  const d1WriteEnabled = input.d1WriteEnabled === true;
  const larkWriteEnabled = input.larkWriteEnabled === true;
  if (!dryRun && !d1WriteEnabled) {
    throw permanentError('YouTube end-to-end D1 writing is disabled', {
      code: 'YOUTUBE_END_TO_END_D1_WRITE_DISABLED',
    });
  }
  if (!dryRun && !larkWriteEnabled) {
    throw permanentError('YouTube end-to-end Lark delivery is disabled', {
      code: 'YOUTUBE_END_TO_END_LARK_WRITE_DISABLED',
    });
  }
  if (!dryRun && larkWriteEnabled && !d1WriteEnabled) {
    throw permanentError('YouTube Lark writes require D1-first storage', {
      code: 'YOUTUBE_END_TO_END_D1_FIRST_REQUIRED',
    });
  }
  const scopeMode = await resolveYouTubeCoverageScopeMode({
    requested: input.syncMode,
    incrementalStateStore: input.incrementalStateStore,
    cursorKey: input.cursorKey,
    now: requestedAt,
    fullSyncIntervalMs: input.fullSyncIntervalMs,
  });
  const context = Object.freeze({
    gateway,
    store: requireHistoryStore(input.historyStore ?? gateway.store),
    customerProfile: requireText(input.customerProfile, 'customerProfile'),
    customerKey: requireText(input.customerKey, 'customerKey'),
    accountKey: requireText(input.accountKey, 'accountKey'),
    sourceAccountId: requireText(input.channelId, 'channelId'),
    sourceTimezone,
    metricDate,
    observedAt: requestedAt,
    fetchedAt: requestedAt,
    syncRunId: requireText(input.syncRunId, 'syncRunId'),
    workKey: requireText(input.workKey, 'workKey'),
    generation,
    scopeMode,
    assertLockActive: typeof input.assertLockActive === 'function'
      ? input.assertLockActive
      : async () => undefined,
  });
  const storageSyncEngine = new YouTubeStorageFirstSyncEngine({
    tableSyncEngine: requireSyncEngine(input.syncEngine),
    context,
    larkWriteEnabled,
    d1WriteEnabled,
  });

  const result = await syncYouTubeOrganicToLark({
    ...input,
    syncEngine: storageSyncEngine,
    // Durable generation ต้องใช้เวลาคงที่ข้าม Queue retry เพื่อไม่สร้าง Observation ใหม่จาก retry เดิม.
    now: () => requestedAt,
  });
  const storage = dryRun === true
    ? await storageSyncEngine.previewStorage()
    : storageSyncEngine.storageResult;

  return Object.freeze({
    ...result,
    endToEnd: Object.freeze({
      contract: 'youtube-organic-end-to-end-v1',
      d1WriteEnabled,
      larkWriteEnabled,
      storage,
      larkTargets: Object.freeze([
        'RAW_YouTube_Channels',
        'RAW_YouTube_Videos',
        'RAW_YouTube_Analytics_Daily',
        'MKT_Accounts',
        'MKT_Content',
        'MKT_Content_Daily',
      ]),
    }),
  });
}

export async function resolveYouTubeCoverageScopeMode(input) {
  const requested = optionalText(input.requested)?.toLowerCase() ?? 'auto';
  if (!['auto', 'full', 'incremental'].includes(requested)) {
    throw permanentError(`Unsupported YouTube syncMode: ${requested}`, {
      code: 'MKT_RUNTIME_CONFIG_INVALID',
    });
  }
  if (requested === 'full') return 'full_inventory';
  if (typeof input.incrementalStateStore?.loadCheckpoint !== 'function') {
    throw new TypeError('YouTube auto sync requires incrementalStateStore.loadCheckpoint');
  }
  const checkpoint = await input.incrementalStateStore.loadCheckpoint(
    requireText(input.cursorKey, 'cursorKey'),
  );
  const interval = positiveInteger(input.fullSyncIntervalMs ?? 86_400_000, 'fullSyncIntervalMs');
  const lastFullValue = checkpoint?.cursor?.lastFullSyncAt;
  const lastFullSyncAt = Number(lastFullValue);
  if (!checkpoint?.cursor
    || lastFullValue === null
    || !Number.isSafeInteger(lastFullSyncAt)
    || input.now - lastFullSyncAt >= interval) {
    return 'full_inventory';
  }
  return 'recent_window';
}

function requireHistoryGateway(value) {
  const methods = [
    'assertSchemaReady',
    'listOrganicContentStatesByKeys',
    'upsertOrganicContentState',
    'saveOrganicContentObservation',
    'readCoverageRun',
    'saveCoverageRun',
    'saveCoverageEntities',
  ];
  if (!value || methods.some((method) => typeof value[method] !== 'function')) {
    throw new TypeError('YouTube end-to-end requires the shared Organic history gateway');
  }
  return value;
}

function requireHistoryStore(value) {
  if (!value
    || typeof value.upsertOrganicAccountDailyFact !== 'function'
    || typeof value.saveCoverageRun !== 'function') {
    throw new TypeError('YouTube end-to-end requires the shared Marketing history store');
  }
  return value;
}

function requireSyncEngine(value) {
  if (!value
    || typeof value.planByKey !== 'function'
    || typeof value.executePlan !== 'function') {
    throw new TypeError('YouTube end-to-end requires Existing TableSyncEngine');
  }
  return value;
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${fieldName} must be a positive integer`);
  }
  return number;
}

function requiredTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${fieldName} must be a non-negative safe timestamp`);
  }
  return number;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`YouTube end-to-end requires ${fieldName}`);
  }
  return value.trim();
}

function optionalText(value) {
  if (value === undefined || value === null || value === '') return null;
  return typeof value === 'string' ? (value.trim() || null) : null;
}
