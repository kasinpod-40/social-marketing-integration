import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const SOURCE_PHASE = 'tiktok_native_source_pages';
const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_MAX_PAGES = 1_000;
const UNIT_READ_LIMIT = 100;

/**
 * เปิด Durable work สำหรับ TikTok Queue message เดิม เพื่อให้ Retry ใช้ Source pages ที่ Stage แล้วได้
 * โดย Work identity ยึด Request scope ที่ไม่เปลี่ยนระหว่าง Retry ไม่ยึดผล Full/Incremental ที่คำนวณใหม่จาก Checkpoint
 */
export async function beginTikTokResumableSource(input = {}) {
  if (!input.workStore) return null;
  const store = requireWorkStore(input.workStore);
  const workKey = requireText(input.workKey, 'workKey');
  const cursorKey = requireText(input.cursorKey, 'cursorKey');
  const requestedAt = safeTimestamp(input.requestedAt ?? input.generation, 'requestedAt');
  const generation = safeTimestamp(input.generation ?? requestedAt, 'generation');
  const operationFingerprint = await createStableFingerprint({
    contract: 'tiktok-native-resumable-v1',
    accountId: requireText(input.accountId, 'accountId'),
    sourceHandle: requireText(input.sourceHandle, 'sourceHandle'),
    metricDate: requireText(input.metricDate, 'metricDate'),
    requestedSyncMode: optionalText(input.syncMode) ?? 'auto',
    incrementalEnabled: input.incrementalEnabled === true,
    dryRun: input.dryRun === true,
    rawTableId: requireText(input.rawTableId, 'rawTableId'),
  });
  const work = await store.beginWork({
    workKey,
    cursorKey,
    workType: 'tiktok_creator_native_sync',
    operationFingerprint,
    generation,
    requestedAt,
  });
  const assertLockActive = typeof input.assertLockActive === 'function'
    ? input.assertLockActive
    : async () => undefined;
  const assertCurrent = async () => {
    await assertLockActive();
    await store.assertCurrentGeneration({ workKey, cursorKey, generation });
  };

  return Object.freeze({
    store,
    workKey,
    cursorKey,
    requestedAt,
    generation,
    work,
    assertCurrent,
  });
}

/**
 * Stage Lark RAW source ทีละหน้าแล้วคืนเฉพาะ Durable summary
 * Live business path ต้องอ่านกลับผ่าน staged-unit iterator เท่านั้น ห้ามรวม RAW ทั้งบัญชีเป็น Array
 */
export async function stageTikTokResumableSource(input = {}) {
  const context = requireContext(input.context);
  const repository = requirePagedRepository(input.repository);
  const tableId = requireText(input.tableId, 'tableId');
  const pageSize = boundedPositiveInteger(input.pageSize ?? DEFAULT_PAGE_SIZE, 'pageSize', DEFAULT_PAGE_SIZE);
  const maxPages = boundedPositiveInteger(input.maxPages ?? DEFAULT_MAX_PAGES, 'maxPages', DEFAULT_MAX_PAGES);
  const maxPagesPerInvocation = boundedPositiveInteger(
    input.maxPagesPerInvocation ?? maxPages,
    'maxPagesPerInvocation',
    DEFAULT_MAX_PAGES,
  );
  const boundedInvocation = input.maxPagesPerInvocation !== null
    && input.maxPagesPerInvocation !== undefined;
  const onProgress = typeof input.onProgress === 'function' ? input.onProgress : () => undefined;

  let progress = await context.store.loadPhase({
    workKey: context.workKey,
    phase: SOURCE_PHASE,
  });
  const resumedPages = progress?.pagesProcessed ?? 0;
  let invocationPages = 0;

  while (!progress?.complete && invocationPages < maxPagesPerInvocation) {
    const pagesProcessed = nonNegativeInteger(progress?.pagesProcessed ?? 0, 'pagesProcessed');
    if (pagesProcessed >= maxPages) {
      throw permanentError('TikTok RAW source pagination exceeded the configured maximum', {
        code: 'TIKTOK_SOURCE_MAX_PAGES_EXCEEDED',
        details: { maxPages, pagesProcessed },
      });
    }

    const state = progress?.state ?? { pageToken: null, visitedPageTokens: [] };
    const pageToken = optionalText(state.pageToken);
    const visited = new Set(Array.isArray(state.visitedPageTokens)
      ? state.visitedPageTokens.map((token) => requireText(token, 'visitedPageToken'))
      : []);
    if (pageToken && visited.has(pageToken)) {
      throw permanentError('TikTok RAW source pagination repeated a page token', {
        code: 'TIKTOK_SOURCE_CURSOR_REPEATED',
        details: { pagesProcessed },
      });
    }

    await context.assertCurrent();
    const page = await repository.listPage(tableId, { pageToken, pageSize });
    const records = requireArray(page?.records, 'page.records');
    const hasMore = page?.hasMore === true;
    const nextPageToken = optionalText(page?.nextPageToken);
    if (hasMore && !nextPageToken) {
      throw permanentError('TikTok RAW source returned hasMore without a next page token', {
        code: 'TIKTOK_SOURCE_CURSOR_MISSING',
        details: { pagesProcessed },
      });
    }
    if (nextPageToken && (nextPageToken === pageToken || visited.has(nextPageToken))) {
      throw permanentError('TikTok RAW source pagination returned a repeated next page token', {
        code: 'TIKTOK_SOURCE_CURSOR_REPEATED',
        details: { pagesProcessed },
      });
    }

    if (pageToken) visited.add(pageToken);
    const processedItems = nonNegativeInteger(progress?.processedItems ?? 0, 'processedItems') + records.length;
    const nextPagesProcessed = pagesProcessed + 1;
    progress = await context.store.savePhase({
      workKey: context.workKey,
      phase: SOURCE_PHASE,
      state: {
        pageToken: hasMore ? nextPageToken : null,
        visitedPageTokens: [...visited],
      },
      expectedItems: processedItems,
      processedItems,
      pagesProcessed: nextPagesProcessed,
      chunksProcessed: nextPagesProcessed,
      complete: !hasMore,
      unit: {
        unitKey: `page:${nextPagesProcessed}`,
        sequence: pagesProcessed,
        payload: { records },
      },
    });
    invocationPages += 1;
    onProgress({
      stage: 'tiktok_source_page_staged',
      page: nextPagesProcessed,
      pageRows: records.length,
      totalRows: processedItems,
      hasMore,
    });
  }

  return Object.freeze({
    summary: Object.freeze({
      durable: true,
      complete: progress?.complete === true,
      records: progress.processedItems,
      pagesProcessed: progress.pagesProcessed,
      resumedPages,
      pageSize,
      maxPages,
      ...(boundedInvocation ? { invocationPages, maxPagesPerInvocation } : {}),
    }),
  });
}

/**
 * Compatibility wrapper สำหรับ Validation/ผู้เรียกเดิมที่ยังต้องการ Array
 * Production resumable write path ห้ามเรียกฟังก์ชันนี้
 */
export async function loadTikTokResumableSource(input = {}) {
  const context = requireContext(input.context);
  const staged = await stageTikTokResumableSource(input);
  if (!staged.summary.complete) {
    throw permanentError('TikTok staged source phase did not reach completion', {
      code: 'TIKTOK_SOURCE_STAGING_INCOMPLETE',
    });
  }
  const records = [];
  let afterSequence = 0;
  let unitPages = 0;

  while (afterSequence !== null) {
    unitPages += 1;
    if (unitPages > DEFAULT_MAX_PAGES) {
      throw permanentError('TikTok staged source units exceeded the read safety limit', {
        code: 'TIKTOK_SOURCE_STAGING_INVALID',
      });
    }
    const page = await context.store.listPhaseUnits({
      workKey: context.workKey,
      phase: SOURCE_PHASE,
      afterSequence,
      limit: UNIT_READ_LIMIT,
    });
    for (const unit of page.units) {
      records.push(...requireArray(unit?.payload?.records, 'unit.payload.records'));
    }
    afterSequence = page.nextSequence;
  }

  if (records.length !== staged.summary.records) {
    throw permanentError('TikTok staged source completeness check failed', {
      code: 'TIKTOK_SOURCE_STAGING_INCOMPLETE',
      details: {
        expectedRecords: staged.summary.records,
        stagedRecords: records.length,
        pagesProcessed: staged.summary.pagesProcessed,
      },
    });
  }

  return Object.freeze({
    records: Object.freeze(records),
    summary: staged.summary,
  });
}

export async function completeTikTokResumableSource(context, completion) {
  if (!context) return false;
  await context.assertCurrent();
  await context.store.completeWork({ workKey: context.workKey, completion });
  return true;
}

export function replayTikTokCompletedWork(context, syncRunId) {
  const completion = context?.work?.completion && typeof context.work.completion === 'object'
    ? context.work.completion
    : {};
  return Object.freeze({
    ...completion,
    syncRunId: syncRunId ?? null,
    platform: 'tiktok',
    source: 'lark_native_tiktok_for_creator',
    mode: 'already_completed',
    resumableWork: Object.freeze({
      resumed: true,
      complete: true,
      cleared: true,
      completionReplay: true,
    }),
  });
}

export function supersededTikTokResult(syncRunId, generation) {
  return Object.freeze({
    syncRunId: syncRunId ?? null,
    platform: 'tiktok',
    source: 'lark_native_tiktok_for_creator',
    mode: 'skipped',
    status: 'superseded',
    code: 'SYNC_WORK_SUPERSEDED',
    generation,
    resumableWork: Object.freeze({
      resumed: false,
      complete: false,
      cleared: false,
      superseded: true,
    }),
  });
}

function requireContext(value) {
  if (!value || typeof value !== 'object' || typeof value.assertCurrent !== 'function') {
    throw new TypeError('TikTok resumable source requires context');
  }
  return value;
}
function requireWorkStore(value) {
  for (const method of [
    'beginWork',
    'assertCurrentGeneration',
    'loadPhase',
    'savePhase',
    'listPhaseUnits',
    'completeWork',
  ]) {
    if (typeof value?.[method] !== 'function') {
      throw new TypeError(`TikTok resumable source requires workStore.${method}`);
    }
  }
  return value;
}
function requirePagedRepository(value) {
  if (typeof value?.listPage !== 'function') {
    throw new TypeError('TikTok resumable source requires repository.listPage');
  }
  return value;
}
function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`TikTok resumable source requires ${fieldName}`);
  return value;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`TikTok resumable source requires ${fieldName}`);
  }
  return value.trim();
}
function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function safeTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`TikTok resumable source ${fieldName} must be a non-negative safe integer`);
  }
  return number;
}
function nonNegativeInteger(value, fieldName) {
  return safeTimestamp(value, fieldName);
}
function boundedPositiveInteger(value, fieldName, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) {
    throw new TypeError(`TikTok resumable source ${fieldName} must be from 1 to ${maximum}`);
  }
  return number;
}
