import { mapTikTokCreatorVideoRow } from '../../../connectors/src/tiktok/creator-native.adapter.js';
import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

export const TIKTOK_SYNC_MODES = Object.freeze({
  AUTO: 'auto',
  FULL: 'full',
  INCREMENTAL: 'incremental',
});

/**
 * วางแผน Full/Incremental จาก D1 checkpoint และ Fingerprint ของ RAW records
 * Safety rule จะบังคับ Full เมื่อเริ่มครั้งแรก, เปลี่ยนวัน, Dictionary เปลี่ยน,
 * Source record หาย หรือถึงรอบ Reconciliation แม้ผู้เรียกขอ incremental
 */
export async function planTikTokIncrementalSource(input = {}) {
  const rawRecords = requireArray(input.rawRecords, 'rawRecords');
  const dictionaryRecords = requireArray(input.dictionaryRecords, 'dictionaryRecords');
  const checkpoint = normalizeCheckpoint(input.checkpoint);
  const metricDate = requireText(input.metricDate, 'metricDate');
  const syncMode = readSyncMode(input.syncMode);
  const now = safeInteger(input.now ?? Date.now(), 'now');
  const fullSyncIntervalMs = positiveInteger(input.fullSyncIntervalMs, 'fullSyncIntervalMs');
  const fingerprint = typeof input.fingerprint === 'function'
    ? input.fingerprint
    : createStableFingerprint;

  const dictionaryHash = await fingerprint(sortRecordCollection(dictionaryRecords));
  const previousById = new Map(
    checkpoint.recordStates.map((record) => [record.sourceRecordId, record]),
  );
  const currentStates = [];
  const changedStates = [];
  const selectedExternalIds = [];

  for (const record of rawRecords) {
    const sourceRecordId = requireText(record?.recordId, 'rawRecord.recordId');
    let mapped;
    try {
      mapped = mapTikTokCreatorVideoRow(record?.fields ?? {});
    } catch (cause) {
      throw permanentError(`TikTok incremental source record is invalid: ${sourceRecordId}`, {
        code: 'TIKTOK_SYNC_NOT_READY',
        cause,
        details: {
          sourceRecordId,
          causeMessage: cause instanceof Error ? cause.message : String(cause),
        },
      });
    }

    const sourceHash = await fingerprint(record?.fields ?? {});
    const state = Object.freeze({
      sourceRecordId,
      sourceModifiedAt: nullableInteger(record?.lastModifiedTime),
      sourceHash,
      externalContentId: requireText(mapped.externalContentId, 'externalContentId'),
    });
    currentStates.push(state);

    const previous = previousById.get(sourceRecordId);
    if (!previous || previous.sourceHash !== sourceHash) changedStates.push(state);
  }

  const currentIds = new Set(currentStates.map((state) => state.sourceRecordId));
  const removedRecordIds = checkpoint.recordStates
    .filter((state) => !currentIds.has(state.sourceRecordId))
    .map((state) => state.sourceRecordId)
    .sort();

  const decision = decideMode({
    syncMode,
    cursor: checkpoint.cursor,
    metricDate,
    dictionaryHash,
    removedRecordIds,
    now,
    fullSyncIntervalMs,
    changedRecords: changedStates.length,
  });
  const selectedStates = decision.mode === TIKTOK_SYNC_MODES.FULL
    ? currentStates
    : changedStates;
  selectedExternalIds.push(...selectedStates.map((state) => state.externalContentId));

  const unchangedRecords = Math.max(0, rawRecords.length - changedStates.length);
  const sourceSkippedPerTable = decision.mode === TIKTOK_SYNC_MODES.INCREMENTAL
    ? unchangedRecords
    : 0;

  return Object.freeze({
    enabled: true,
    mode: decision.mode,
    reason: decision.reason,
    requestedMode: syncMode,
    sourceRecords: rawRecords.length,
    selectedRecords: selectedStates.length,
    changedRecords: changedStates.length,
    unchangedRecords,
    removedRecords: removedRecordIds.length,
    removedRecordIds: Object.freeze(removedRecordIds.slice(0, 100)),
    selectedExternalContentIds: Object.freeze([...new Set(selectedExternalIds)]),
    dictionaryHash,
    dictionaryChanged: checkpoint.cursor
      ? checkpoint.cursor.dictionaryHash !== dictionaryHash
      : true,
    metricDateChanged: checkpoint.cursor
      ? checkpoint.cursor.lastMetricDate !== metricDate
      : true,
    sourceSkippedPerTable,
    checkpointRecords: Object.freeze(
      decision.mode === TIKTOK_SYNC_MODES.FULL ? currentStates : changedStates,
    ),
    fullSnapshot: decision.mode === TIKTOK_SYNC_MODES.FULL,
    previousCursor: checkpoint.cursor,
    evaluatedAt: now,
  });
}

/** สร้าง Cursor ใหม่หลัง Lark business writes สำเร็จแล้วเท่านั้น */
export function buildTikTokIncrementalCheckpoint(input = {}) {
  const plan = requirePlan(input.plan);
  const previous = plan.previousCursor;
  const completedAt = safeInteger(input.completedAt ?? Date.now(), 'completedAt');
  const syncRunId = requireText(input.syncRunId, 'syncRunId');
  const cursorKey = requireText(input.cursorKey, 'cursorKey');

  return Object.freeze({
    cursor: Object.freeze({
      cursorKey,
      customerProfile: requireText(input.customerProfile, 'customerProfile'),
      platform: 'tiktok',
      accountKey: requireText(input.accountKey, 'accountKey'),
      source: 'lark_native_tiktok_for_creator',
      syncType: 'native_import',
      lastMetricDate: requireText(input.metricDate, 'metricDate'),
      dictionaryHash: plan.dictionaryHash,
      lastFullSyncAt: plan.fullSnapshot
        ? completedAt
        : (previous?.lastFullSyncAt ?? null),
      lastSuccessfulSyncAt: completedAt,
      incrementalRunCount: plan.fullSnapshot
        ? 0
        : nonNegativeInteger(previous?.incrementalRunCount ?? 0) + 1,
      lastSyncRunId: syncRunId,
    }),
    records: plan.checkpointRecords,
    fullSnapshot: plan.fullSnapshot,
  });
}

function decideMode(input) {
  if (input.syncMode === TIKTOK_SYNC_MODES.FULL) {
    return { mode: TIKTOK_SYNC_MODES.FULL, reason: 'manual_full' };
  }
  if (!input.cursor) return { mode: TIKTOK_SYNC_MODES.FULL, reason: 'initial_checkpoint' };
  if (input.cursor.dictionaryHash !== input.dictionaryHash) {
    return { mode: TIKTOK_SYNC_MODES.FULL, reason: 'classification_dictionary_changed' };
  }
  if (input.cursor.lastMetricDate !== input.metricDate) {
    return { mode: TIKTOK_SYNC_MODES.FULL, reason: 'metric_date_changed' };
  }
  if (input.removedRecordIds.length > 0) {
    return { mode: TIKTOK_SYNC_MODES.FULL, reason: 'source_records_removed' };
  }
  if (
    input.cursor.lastFullSyncAt === null
    || input.now - input.cursor.lastFullSyncAt >= input.fullSyncIntervalMs
  ) {
    return { mode: TIKTOK_SYNC_MODES.FULL, reason: 'periodic_reconciliation' };
  }
  return {
    mode: TIKTOK_SYNC_MODES.INCREMENTAL,
    reason: input.changedRecords > 0 ? 'source_records_changed' : 'no_source_changes',
  };
}

function sortRecordCollection(records) {
  return [...records]
    .map((record) => ({
      recordId: record?.recordId ?? null,
      fields: record?.fields ?? {},
    }))
    .sort((left, right) => String(left.recordId).localeCompare(String(right.recordId)));
}

function normalizeCheckpoint(value) {
  const cursor = value?.cursor ?? null;
  const recordStates = Array.isArray(value?.recordStates) ? value.recordStates : [];
  return Object.freeze({ cursor, recordStates });
}

function readSyncMode(value) {
  if (value === null || value === undefined || value === '') return TIKTOK_SYNC_MODES.AUTO;
  const mode = requireText(value, 'syncMode').toLowerCase();
  if (!Object.values(TIKTOK_SYNC_MODES).includes(mode)) {
    throw permanentError(`Unsupported TikTok syncMode: ${mode}`, {
      code: 'MKT_RUNTIME_CONFIG_INVALID',
      details: { syncMode: mode },
    });
  }
  return mode;
}

function requirePlan(value) {
  if (!value || value.enabled !== true || !Array.isArray(value.checkpointRecords)) {
    throw new TypeError('Incremental checkpoint requires a valid plan');
  }
  return value;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`TikTok incremental plan requires ${fieldName}`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`TikTok incremental plan requires ${fieldName}`);
  }
  return value.trim();
}

function nullableInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  return safeInteger(value, 'integer');
}

function safeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new TypeError(`TikTok incremental ${fieldName} must be a safe integer`);
  }
  return number;
}

function positiveInteger(value, fieldName) {
  const number = safeInteger(value, fieldName);
  if (number <= 0) throw new TypeError(`TikTok incremental ${fieldName} must be positive`);
  return number;
}

function nonNegativeInteger(value) {
  const number = safeInteger(value, 'incrementalRunCount');
  if (number < 0) throw new TypeError('TikTok incremental run count must be non-negative');
  return number;
}
