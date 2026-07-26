import { mapTikTokCreatorVideoRow } from '../../../connectors/src/tiktok/creator-native.adapter.js';
import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';
import { createTikTokSourceWatermark } from './tiktok-source-watermark.js';

const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_MAX_PAGES = 1_000;
const DEFAULT_SETTLE_MS = 5_000;
const MAX_SETTLE_MS = 60_000;

/** อ่าน RAW แบบ bounded/read-only และคืนเฉพาะ Compact evidence. */
export async function probeTikTokNativeSourceWatermark(input = {}) {
  const repository = requireRepository(input.repository);
  const tableId = requireText(input.tableId, 'tableId');
  const accountKey = requireText(input.accountKey, 'accountKey');
  const expectedSourceHandle = normalizeHandle(requireText(
    input.expectedSourceHandle,
    'expectedSourceHandle',
  ));
  const pageSize = boundedPositiveInteger(
    input.pageSize ?? DEFAULT_PAGE_SIZE,
    'pageSize',
    DEFAULT_PAGE_SIZE,
  );
  const maxPages = boundedPositiveInteger(
    input.maxPages ?? DEFAULT_MAX_PAGES,
    'maxPages',
    DEFAULT_MAX_PAGES,
  );
  const fingerprint = typeof input.fingerprint === 'function'
    ? input.fingerprint
    : createStableFingerprint;

  const recordStates = [];
  const handles = new Set();
  const seenPageTokens = new Set();
  let pageToken = null;
  let pagesProcessed = 0;

  while (pagesProcessed < maxPages) {
    const page = await repository.listPage(tableId, { pageToken, pageSize });
    const records = requireArray(page?.records, 'page.records');
    for (const record of records) {
      const sourceRecordId = requireText(
        record?.recordId ?? record?.record_id,
        'sourceRecordId',
      );
      let mapped;
      try {
        mapped = mapTikTokCreatorVideoRow(record?.fields ?? {});
      } catch (cause) {
        throw permanentError(`TikTok RAW probe record is invalid: ${sourceRecordId}`, {
          code: 'TIKTOK_SOURCE_PROBE_INVALID_RECORD',
          cause,
          details: { sourceRecordId },
        });
      }
      const sourceHandle = normalizeHandle(requireText(mapped.sourceHandle, 'sourceHandle'));
      handles.add(sourceHandle);
      recordStates.push(Object.freeze({
        sourceRecordId,
        sourceModifiedAt: nullableTimestamp(
          record?.lastModifiedTime ?? record?.last_modified_time,
          'lastModifiedTime',
        ),
        sourceHash: await fingerprint(record?.fields ?? {}),
        externalContentId: requireText(mapped.externalContentId, 'externalContentId'),
      }));
    }

    pagesProcessed += 1;
    if (page?.hasMore !== true) break;
    const nextPageToken = requireText(page?.nextPageToken, 'nextPageToken');
    if (nextPageToken === pageToken || seenPageTokens.has(nextPageToken)) {
      throw permanentError('TikTok RAW probe returned a repeated page token', {
        code: 'TIKTOK_SOURCE_PROBE_CURSOR_REPEATED',
        details: { pagesProcessed },
      });
    }
    if (pageToken) seenPageTokens.add(pageToken);
    pageToken = nextPageToken;
  }

  if (pagesProcessed >= maxPages && pageToken !== null) {
    throw permanentError('TikTok RAW probe exceeded the configured page limit', {
      code: 'TIKTOK_SOURCE_PROBE_MAX_PAGES_EXCEEDED',
      details: { maxPages },
    });
  }

  const detectedHandles = [...handles].sort();
  if (detectedHandles.length !== 1 || detectedHandles[0] !== expectedSourceHandle) {
    throw permanentError('TikTok RAW probe source identity validation failed', {
      code: 'TIKTOK_SOURCE_PROBE_IDENTITY_MISMATCH',
      details: {
        expectedSourceHandle,
        detectedHandleCount: detectedHandles.length,
      },
    });
  }

  const watermark = await createTikTokSourceWatermark({
    accountKey,
    sourceHandle: expectedSourceHandle,
    recordStates,
    fingerprint,
  });
  return Object.freeze({
    sourceWatermark: watermark.sourceWatermark,
    recordCount: watermark.recordCount,
    maxModifiedAt: watermark.maxModifiedAt,
    accountKey,
    sourceHandle: expectedSourceHandle,
    pagesProcessed,
    bounded: true,
    // External IDs are approved non-secret business keys; RAW payload/caption is never exposed.
    externalContentIds: Object.freeze(
      watermark.recordStates.map((state) => state.externalContentId).sort(),
    ),
  });
}

/** ต้องได้ผล Probe สองครั้งตรงกันก่อน Admission เพื่อหลีกเลี่ยงอ่านระหว่าง Lark กำลัง Sync หลายหน้า. */
export async function settleTikTokNativeSourceWatermark(input = {}) {
  const settleMs = boundedNonNegativeInteger(
    input.settleMs ?? DEFAULT_SETTLE_MS,
    'settleMs',
    MAX_SETTLE_MS,
  );
  const sleep = typeof input.sleep === 'function'
    ? input.sleep
    : (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const probe = typeof input.probe === 'function'
    ? input.probe
    : () => probeTikTokNativeSourceWatermark(input);

  const first = await probe();
  if (settleMs > 0) await sleep(settleMs);
  const second = await probe();
  const settled = first.sourceWatermark === second.sourceWatermark
    && first.recordCount === second.recordCount
    && first.maxModifiedAt === second.maxModifiedAt;

  return Object.freeze({
    settled,
    first,
    second,
    settleMs,
    reason: settled ? 'stable_source_watermark' : 'source_changed_during_settle_window',
  });
}

function requireRepository(value) {
  if (typeof value?.listPage !== 'function') {
    throw new TypeError('TikTok RAW probe requires repository.listPage');
  }
  return value;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`TikTok RAW probe requires ${fieldName}`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw permanentError(`TikTok RAW probe requires ${fieldName}`, {
      code: 'TIKTOK_SOURCE_PROBE_INVALID',
      details: { fieldName },
    });
  }
  return value.trim();
}

function normalizeHandle(value) {
  return value.replace(/^@/u, '').trim().toLowerCase();
}

function nullableTimestamp(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw permanentError(`TikTok RAW probe ${fieldName} must be a non-negative safe integer`, {
      code: 'TIKTOK_SOURCE_PROBE_INVALID',
      details: { fieldName },
    });
  }
  return number;
}

function boundedPositiveInteger(value, fieldName, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) {
    throw permanentError(`TikTok RAW probe ${fieldName} must be from 1 to ${maximum}`, {
      code: 'TIKTOK_SOURCE_PROBE_INVALID',
      details: { fieldName },
    });
  }
  return number;
}

function boundedNonNegativeInteger(value, fieldName, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > maximum) {
    throw permanentError(`TikTok RAW probe ${fieldName} must be from 0 to ${maximum}`, {
      code: 'TIKTOK_SOURCE_PROBE_INVALID',
      details: { fieldName },
    });
  }
  return number;
}
