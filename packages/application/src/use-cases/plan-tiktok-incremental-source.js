import { mapTikTokCreatorVideoRow } from '../../../connectors/src/tiktok/creator-native.adapter.js';
import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

export const TIKTOK_SYNC_MODES = Object.freeze({
  AUTO: 'auto',
  FULL: 'full',
  INCREMENTAL: 'incremental',
});

/**
 * Compatibility wrapper สำหรับผู้เรียกเดิมที่มี RAW records อยู่ใน Array
 */
export async function planTikTokIncrementalSource(input = {}) {
  return planTikTokIncrementalSourceIterable({
    ...input,
    rawRecords: requireArray(input.rawRecords, 'rawRecords'),
  });
}

/**
 * วางแผน Full/Incremental จาก Async/Sync iterable โดยเก็บเฉพาะ Compact source states
 * ไม่เก็บ RAW payload ทั้งบัญชีซ้ำในหน่วยความจำ
 */
export async function planTikTokIncrementalSourceIterable(input = {}) {
  const rawRecords = requireIterable(input.rawRecords, 'rawRecords');
  const dictionaryRecords = requireArray(input.dictionaryRecords, 'dictionaryRecords');
  const checkpoint = normalizeCheckpoint(input.checkpoint);
  const metricDate = requireText(input.metricDate, 'metricDate');
  const syncMode = readSyncMode(input.syncMode);
  const now = safeInteger(input.now ?? Date.now(), 'now');
  const fullSyncIntervalMs = positiveInteger(input.fullSyncIntervalMs, 'fullSyncIntervalMs');
  const fingerprint = typeof input.fingerprint === 'function'
    ? input.fingerprint
    : createStableFingerprint;
  const expectedSourceHandle = optionalHandle(input.expectedSourceHandle);

  const previousById = new Map(
    checkpoint.recordStates.map((record) => [record.sourceRecordId, record]),
  );
  const scan = await scanTikTokIncrementalSourceRecords({
    rawRecords,
    previousById,
    fingerprint,
  });
  return finalizeTikTokIncrementalSourceScan({
    scans: [scan],
    dictionaryRecords,
    checkpoint,
    metricDate,
    syncMode,
    now,
    fullSyncIntervalMs,
    expectedSourceHandle,
    fingerprint,
  });
}

/** Hash และ normalize RAW หนึ่ง durable unit โดยยังไม่ตัดสิน Full/Incremental ทั้ง generation. */
export async function scanTikTokIncrementalSourceRecords(input = {}) {
  const rawRecords = requireIterable(input.rawRecords, 'rawRecords');
  const previousById = input.previousById instanceof Map
    ? input.previousById
    : new Map(normalizeCheckpoint(input.checkpoint).recordStates
      .map((record) => [record.sourceRecordId, record]));
  const fingerprint = typeof input.fingerprint === 'function'
    ? input.fingerprint
    : createStableFingerprint;
  const currentStates = [];
  const changedStates = [];
  const currentIds = new Set();
  const externalContentIds = new Set();
  const sourceHandles = new Set();
  let sourceRecords = 0;

  for await (const record of rawRecords) {
    sourceRecords += 1;
    const sourceRecordId = requireText(record?.recordId, 'rawRecord.recordId');
    if (currentIds.has(sourceRecordId)) {
      throw permanentError('TikTok RAW source contains duplicate record identities', {
        code: 'TIKTOK_SYNC_NOT_READY',
        details: { duplicateSourceRecordCount: 1 },
      });
    }
    currentIds.add(sourceRecordId);

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

    const externalContentId = requireText(mapped.externalContentId, 'externalContentId');
    if (externalContentIds.has(externalContentId)) {
      throw permanentError('TikTok RAW source contains duplicate content identities', {
        code: 'TIKTOK_SYNC_NOT_READY',
        details: { duplicateContentIdentityCount: 1 },
      });
    }
    externalContentIds.add(externalContentId);

    const sourceHandle = optionalHandle(mapped.sourceHandle);
    if (sourceHandle) sourceHandles.add(sourceHandle);

    const sourceHash = await fingerprint(record?.fields ?? {});
    const state = Object.freeze({
      sourceRecordId,
      sourceModifiedAt: nullableInteger(record?.lastModifiedTime),
      sourceHash,
      externalContentId,
    });
    currentStates.push(state);

    const previous = previousById.get(sourceRecordId);
    if (!previous || previous.sourceHash !== sourceHash) changedStates.push(state);
  }

  return Object.freeze({
    sourceRecords,
    currentStates: Object.freeze(currentStates),
    changedStates: Object.freeze(changedStates),
    sourceHandles: Object.freeze([...sourceHandles].sort()),
  });
}

/** รวม compact scans ทุก unit แล้วตัดสิน immutable plan หนึ่งครั้งก่อน Business preflight. */
export async function finalizeTikTokIncrementalSourceScan(input = {}) {
  const scans = requireArray(input.scans, 'scans');
  const dictionaryRecords = requireArray(input.dictionaryRecords, 'dictionaryRecords');
  const checkpoint = normalizeCheckpoint(input.checkpoint);
  const metricDate = requireText(input.metricDate, 'metricDate');
  const syncMode = readSyncMode(input.syncMode);
  const now = safeInteger(input.now ?? Date.now(), 'now');
  const fullSyncIntervalMs = positiveInteger(input.fullSyncIntervalMs, 'fullSyncIntervalMs');
  const fingerprint = typeof input.fingerprint === 'function'
    ? input.fingerprint
    : createStableFingerprint;
  const expectedSourceHandle = optionalHandle(input.expectedSourceHandle);
  const dictionaryHash = await createTikTokDictionaryHash(dictionaryRecords, fingerprint);
  const currentStates = [];
  const changedStates = [];
  const currentIds = new Set();
  const externalContentIds = new Set();
  const sourceHandles = new Set();
  let sourceRecords = 0;

  for (const scan of scans) {
    const states = requireArray(scan?.currentStates, 'scan.currentStates');
    sourceRecords += states.length;
    for (const state of states) {
      if (currentIds.has(state.sourceRecordId)) {
        throw permanentError('TikTok RAW source contains duplicate record identities', {
          code: 'TIKTOK_SYNC_NOT_READY',
          details: { duplicateSourceRecordCount: 1 },
        });
      }
      if (externalContentIds.has(state.externalContentId)) {
        throw permanentError('TikTok RAW source contains duplicate content identities', {
          code: 'TIKTOK_SYNC_NOT_READY',
          details: { duplicateContentIdentityCount: 1 },
        });
      }
      currentIds.add(state.sourceRecordId);
      externalContentIds.add(state.externalContentId);
      currentStates.push(state);
    }
    for (const handle of requireArray(scan?.sourceHandles, 'scan.sourceHandles')) {
      sourceHandles.add(optionalHandle(handle));
    }
  }
  const previousById = new Map(
    checkpoint.recordStates.map((record) => [record.sourceRecordId, record]),
  );
  for (const state of currentStates) {
    const previous = previousById.get(state.sourceRecordId);
    if (!previous || previous.sourceHash !== state.sourceHash) changedStates.push(state);
  }

  const detectedHandles = [...sourceHandles].filter(Boolean).sort();
  const sourceIdentity = Object.freeze({
    ok: expectedSourceHandle
      ? detectedHandles.length === 1 && detectedHandles[0] === expectedSourceHandle
      : detectedHandles.length <= 1,
    expectedHandle: expectedSourceHandle,
    detectedHandles: Object.freeze(detectedHandles),
  });
  if (!sourceIdentity.ok) {
    throw permanentError('TikTok source identity validation failed', {
      code: 'TIKTOK_SYNC_NOT_READY',
      details: {
        expectedSourceCount: expectedSourceHandle ? 1 : null,
        detectedSourceCount: detectedHandles.length,
      },
    });
  }

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
  const selectedExternalIds = selectedStates.map((state) => state.externalContentId);
  const unchangedRecords = Math.max(0, sourceRecords - changedStates.length);
  const sourceSkippedPerTable = decision.mode === TIKTOK_SYNC_MODES.INCREMENTAL
    ? unchangedRecords
    : 0;

  return Object.freeze({
    enabled: true,
    mode: decision.mode,
    reason: decision.reason,
    requestedMode: syncMode,
    sourceRecords,
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
    sourceIdentity,
  });
}

/** Stable hash กลางสำหรับตรวจว่า Dictionary ไม่เปลี่ยนระหว่าง durable continuations */
export async function createTikTokDictionaryHash(records, fingerprint = createStableFingerprint) {
  return fingerprint(sortRecordCollection(requireArray(records, 'dictionaryRecords')));
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

function requireIterable(value, fieldName) {
  if (!value || (typeof value[Symbol.asyncIterator] !== 'function'
    && typeof value[Symbol.iterator] !== 'function')) {
    throw new TypeError(`TikTok incremental plan requires iterable ${fieldName}`);
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`TikTok incremental plan requires ${fieldName}`);
  }
  return value.trim();
}

function optionalHandle(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new TypeError('TikTok incremental source handle must be a string');
  const handle = value.replace(/^@/u, '').trim().toLowerCase();
  return handle || null;
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
