import { mapTikTokCreatorVideoRow } from '../../../connectors/src/tiktok/creator-native.adapter.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';
import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { iterateTikTokStagedSourceUnits } from './tiktok-resumable-unit-reader.js';

export const TIKTOK_STAGED_BUSINESS_PHASES = Object.freeze({
  PLAN_SCAN: 'tiktok_native_business_plan_scan_v1',
  PLAN: 'tiktok_native_business_plan_v1',
  PREFLIGHT: 'tiktok_native_business_preflight_v1',
  WRITE: 'tiktok_native_business_write_v1',
  COMPLETION: 'tiktok_native_business_completion_v1',
});

export const DEFAULT_TIKTOK_FULL_SYNC_INTERVAL_MS = 86_400_000;

export async function* iterateStagedRawRecords(context) {
  for await (const unit of iterateTikTokStagedSourceUnits({ context })) {
    for (const record of unit.records) yield record;
  }
}

export function selectUnitExternalContentIds(records, selectedExternalIds) {
  const selected = [];
  for (const record of records) {
    const mapped = mapTikTokCreatorVideoRow(record?.fields ?? {});
    if (selectedExternalIds.has(mapped.externalContentId)) selected.push(mapped.externalContentId);
  }
  return selected;
}

export async function createBusinessPlanFingerprint(plan, metricDate) {
  return createStableFingerprint({
    contract: 'tiktok-staged-business-v1',
    metricDate,
    mode: plan.mode,
    reason: plan.reason,
    dictionaryHash: plan.dictionaryHash,
    sourceRecords: plan.sourceRecords,
    selectedExternalContentIds: plan.selectedExternalContentIds,
    checkpointRecords: plan.checkpointRecords.map((record) => ({
      sourceRecordId: record.sourceRecordId,
      sourceHash: record.sourceHash,
      externalContentId: record.externalContentId,
    })),
  });
}

export function disableIncremental(plan) {
  return Object.freeze({
    ...plan,
    enabled: false,
    mode: 'full',
    reason: 'incremental_disabled',
    requestedMode: 'full',
    sourceSkippedPerTable: 0,
  });
}

export function assertSourceCompleteness(plan, sourceSummary) {
  if (plan.sourceRecords !== sourceSummary.records) {
    throw permanentError('TikTok staged source analysis completeness check failed', {
      code: 'TIKTOK_SOURCE_STAGING_INCOMPLETE',
      details: {
        expectedRecords: sourceSummary.records,
        analyzedRecords: plan.sourceRecords,
      },
    });
  }
}

export function assertDictionaryReady(value) {
  if (!Array.isArray(value?.rules) || value.rules.length === 0) {
    throw permanentError('TikTok classification dictionary has no enabled valid rules', {
      code: 'TIKTOK_SYNC_NOT_READY',
    });
  }
  if (Array.isArray(value.invalidRows) && value.invalidRows.length > 0) {
    throw permanentError('TikTok classification dictionary contains invalid enabled rows', {
      code: 'TIKTOK_SYNC_NOT_READY',
      details: { invalidDictionaryRows: value.invalidRows.length },
    });
  }
}

export function assertPhasePlanCompatible(phase, planFingerprint) {
  if (!phase) return;
  const persisted = optionalText(phase.state?.planFingerprint);
  if (persisted && persisted !== planFingerprint) {
    throw permanentError('TikTok staged business plan changed within the same work generation', {
      code: 'TIKTOK_STAGED_PLAN_CHANGED',
      details: {
        processedItems: phase.processedItems ?? 0,
        pagesProcessed: phase.pagesProcessed ?? 0,
      },
    });
  }
}

export function requireContext(value) {
  for (const method of ['assertCurrent']) {
    if (typeof value?.[method] !== 'function') {
      throw new TypeError(`TikTok staged business sync requires context.${method}`);
    }
  }
  for (const method of ['loadPhase', 'savePhase', 'listPhaseUnits']) {
    if (typeof value?.store?.[method] !== 'function') {
      throw new TypeError(`TikTok staged business sync requires context.store.${method}`);
    }
  }
  requireText(value.workKey, 'context.workKey');
  nonNegativeInteger(value.generation);
  nonNegativeInteger(value.requestedAt);
  return value;
}

export function requireRepository(value) {
  for (const method of ['listAll', 'prepareRows', 'createMany', 'updateMany']) {
    if (typeof value?.[method] !== 'function') {
      throw new TypeError(`TikTok staged business sync requires repository.${method}`);
    }
  }
  return value;
}

export function requireSyncEngine(value) {
  for (const method of ['planByKey', 'executePlan']) {
    if (typeof value?.[method] !== 'function') {
      throw new TypeError(`TikTok staged business sync requires syncEngine.${method}`);
    }
  }
  return value;
}

export function requireIncrementalStateStore(value) {
  if (typeof value?.loadCheckpoint !== 'function' || typeof value?.saveCheckpoint !== 'function') {
    throw new TypeError('TikTok staged business sync requires incrementalStateStore');
  }
  return value;
}

export function requireTables(value) {
  return Object.freeze({
    rawTikTokCreatorVideos: requireText(value?.rawTikTokCreatorVideos, 'tables.rawTikTokCreatorVideos'),
    mktAccounts: requireText(value?.mktAccounts, 'tables.mktAccounts'),
    mktContent: requireText(value?.mktContent, 'tables.mktContent'),
    mktContentDaily: requireText(value?.mktContentDaily, 'tables.mktContentDaily'),
    mktClassificationDictionary: requireText(
      value?.mktClassificationDictionary,
      'tables.mktClassificationDictionary',
    ),
  });
}

export function requireSourceSummary(value) {
  if (!isPlainObject(value) || value.complete !== true || value.durable !== true) {
    throw new TypeError('TikTok staged business sync requires a complete durable source summary');
  }
  return Object.freeze({
    ...value,
    records: nonNegativeInteger(value.records),
    pagesProcessed: nonNegativeInteger(value.pagesProcessed),
  });
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`TikTok staged business sync requires ${fieldName}`);
  }
  return value.trim();
}

export function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function nonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError('TikTok staged business sync requires a non-negative safe integer');
  }
  return number;
}
