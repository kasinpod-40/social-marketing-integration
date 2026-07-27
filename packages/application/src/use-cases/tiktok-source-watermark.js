import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

export const TIKTOK_SOURCE_WATERMARK_CONTRACT = 'tiktok-native-source-watermark-v1';

/**
 * สร้าง Watermark จาก Compact source states เท่านั้น ห้ามใส่ Caption/RAW payload ลงหลักฐาน.
 */
export async function createTikTokSourceWatermark(input = {}) {
  const accountKey = requireText(input.accountKey, 'accountKey');
  const sourceHandle = normalizeHandle(requireText(input.sourceHandle, 'sourceHandle'));
  const fingerprint = typeof input.fingerprint === 'function'
    ? input.fingerprint
    : createStableFingerprint;
  const states = normalizeStates(input.recordStates);

  const sourceRecordIds = new Set();
  const externalContentIds = new Set();
  let maxModifiedAt = null;
  for (const state of states) {
    if (sourceRecordIds.has(state.sourceRecordId)) {
      throw permanentError('TikTok source watermark contains duplicate record identities', {
        code: 'TIKTOK_SOURCE_WATERMARK_DUPLICATE_RECORD',
      });
    }
    if (externalContentIds.has(state.externalContentId)) {
      throw permanentError('TikTok source watermark contains duplicate content identities', {
        code: 'TIKTOK_SOURCE_WATERMARK_DUPLICATE_CONTENT',
      });
    }
    sourceRecordIds.add(state.sourceRecordId);
    externalContentIds.add(state.externalContentId);
    if (state.sourceModifiedAt !== null) {
      maxModifiedAt = maxModifiedAt === null
        ? state.sourceModifiedAt
        : Math.max(maxModifiedAt, state.sourceModifiedAt);
    }
  }

  const sourceWatermark = await fingerprint({
    contract: TIKTOK_SOURCE_WATERMARK_CONTRACT,
    accountKey,
    sourceHandle,
    recordCount: states.length,
    maxModifiedAt,
    records: states,
  });

  return Object.freeze({
    sourceWatermark,
    accountKey,
    sourceHandle,
    recordCount: states.length,
    maxModifiedAt,
    recordStates: Object.freeze(states),
  });
}

function normalizeStates(value) {
  if (!Array.isArray(value)) {
    throw permanentError('TikTok source watermark requires recordStates', {
      code: 'TIKTOK_SOURCE_WATERMARK_INVALID',
    });
  }
  return [...value].map((state) => Object.freeze({
    sourceRecordId: requireText(state?.sourceRecordId, 'sourceRecordId'),
    sourceModifiedAt: nullableTimestamp(state?.sourceModifiedAt, 'sourceModifiedAt'),
    sourceHash: requireText(state?.sourceHash, 'sourceHash'),
    externalContentId: requireText(state?.externalContentId, 'externalContentId'),
  })).sort((left, right) => left.sourceRecordId.localeCompare(right.sourceRecordId));
}

function nullableTimestamp(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw permanentError(`TikTok source watermark ${fieldName} must be a non-negative safe integer`, {
      code: 'TIKTOK_SOURCE_WATERMARK_INVALID',
      details: { fieldName },
    });
  }
  return number;
}

function normalizeHandle(value) {
  return value.replace(/^@/u, '').trim().toLowerCase();
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw permanentError(`TikTok source watermark requires ${fieldName}`, {
      code: 'TIKTOK_SOURCE_WATERMARK_INVALID',
      details: { fieldName },
    });
  }
  return value.trim();
}
