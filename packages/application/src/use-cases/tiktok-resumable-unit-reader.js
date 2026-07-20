import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const SOURCE_PHASE = 'tiktok_native_source_pages';
const DEFAULT_UNIT_PAGE_LIMIT = 25;
const DEFAULT_MAX_UNIT_PAGES = 10_000;

/**
 * อ่าน TikTok source units จาก Durable store ทีละ Unit โดยไม่รวม Records ทุกหน้ากลับเป็น Array เดียว
 */
export async function* iterateTikTokStagedSourceUnits(input = {}) {
  const context = requireContext(input.context);
  const limit = boundedPositiveInteger(
    input.limit ?? DEFAULT_UNIT_PAGE_LIMIT,
    'limit',
    500,
  );
  const maxUnitPages = boundedPositiveInteger(
    input.maxUnitPages ?? DEFAULT_MAX_UNIT_PAGES,
    'maxUnitPages',
    100_000,
  );
  let afterSequence = nonNegativeInteger(input.afterSequence ?? 0, 'afterSequence');
  let unitPagesRead = 0;

  while (afterSequence !== null) {
    unitPagesRead += 1;
    if (unitPagesRead > maxUnitPages) {
      throw permanentError('TikTok staged source units exceeded the read safety limit', {
        code: 'TIKTOK_SOURCE_STAGING_INVALID',
        details: { maxUnitPages },
      });
    }

    await context.assertCurrent();
    const page = await context.store.listPhaseUnits({
      workKey: context.workKey,
      phase: SOURCE_PHASE,
      afterSequence,
      limit,
    });
    const units = requireArray(page?.units, 'page.units');

    for (const unit of units) {
      const sequence = nonNegativeInteger(unit?.sequence, 'unit.sequence');
      const records = requireArray(unit?.payload?.records, 'unit.payload.records');
      yield Object.freeze({
        unitKey: requireText(unit?.unitKey, 'unit.unitKey'),
        sequence,
        records: Object.freeze([...records]),
      });
    }

    afterSequence = page?.nextSequence === null
      ? null
      : nonNegativeInteger(page?.nextSequence, 'page.nextSequence');
  }
}

/**
 * Consume staged units ทีละ Unit และตรวจ Completeness จาก Counter ที่ Persist ใน Phase
 * Callback ต้องจบ Normalize/Plan/Write/Checkpoint ของ Unit ก่อน resolve
 */
export async function consumeTikTokStagedSourceUnits(input = {}) {
  const context = requireContext(input.context);
  const consumeUnit = requireFunction(input.consumeUnit, 'consumeUnit');
  const onProgress = typeof input.onProgress === 'function' ? input.onProgress : () => undefined;
  const progress = await context.store.loadPhase({
    workKey: context.workKey,
    phase: SOURCE_PHASE,
  });
  if (!progress?.complete) {
    throw permanentError('TikTok staged source phase is not complete', {
      code: 'TIKTOK_SOURCE_STAGING_INCOMPLETE',
    });
  }

  let unitsProcessed = 0;
  let recordsProcessed = 0;
  let maxUnitRecords = 0;

  for await (const unit of iterateTikTokStagedSourceUnits(input)) {
    await context.assertCurrent();
    await consumeUnit(unit);
    unitsProcessed += 1;
    recordsProcessed += unit.records.length;
    maxUnitRecords = Math.max(maxUnitRecords, unit.records.length);
    onProgress(Object.freeze({
      stage: 'tiktok_staged_unit_consumed',
      unitKey: unit.unitKey,
      sequence: unit.sequence,
      unitRecords: unit.records.length,
      recordsProcessed,
    }));
  }

  if (recordsProcessed !== progress.processedItems) {
    throw permanentError('TikTok staged source completeness check failed', {
      code: 'TIKTOK_SOURCE_STAGING_INCOMPLETE',
      details: {
        expectedRecords: progress.processedItems,
        processedRecords: recordsProcessed,
        pagesProcessed: progress.pagesProcessed,
      },
    });
  }

  return Object.freeze({
    unitsProcessed,
    recordsProcessed,
    maxUnitRecords,
    expectedRecords: progress.processedItems,
    pagesProcessed: progress.pagesProcessed,
  });
}

function requireContext(value) {
  if (!value || typeof value !== 'object'
    || typeof value.assertCurrent !== 'function'
    || typeof value.store?.listPhaseUnits !== 'function'
    || typeof value.store?.loadPhase !== 'function') {
    throw new TypeError('TikTok staged source reader requires a resumable context');
  }
  return value;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`TikTok staged source reader requires ${fieldName}`);
  return value;
}

function requireFunction(value, fieldName) {
  if (typeof value !== 'function') throw new TypeError(`TikTok staged source reader requires ${fieldName}`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`TikTok staged source reader requires ${fieldName}`);
  }
  return value.trim();
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`TikTok staged source reader ${fieldName} must be a non-negative integer`);
  }
  return number;
}

function boundedPositiveInteger(value, fieldName, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) {
    throw new TypeError(`TikTok staged source reader ${fieldName} must be from 1 to ${maximum}`);
  }
  return number;
}
