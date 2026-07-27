import { mapTikTokCreatorVideoRow } from '../../../connectors/src/tiktok/creator-native.adapter.js';
import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';
import { iterateStagedRawRecords } from './tiktok-staged-business-contract.js';
import { createTikTokSourceWatermark } from './tiktok-source-watermark.js';

/** Verify the exact staged dataset before D1/Lark Business writes begin. */
export async function verifyTikTokStagedSourceWatermark(input = {}) {
  const expected = optionalText(input.expectedSourceWatermark);
  if (!expected) return null;
  const context = requireContext(input.context);
  const fingerprint = typeof input.fingerprint === 'function'
    ? input.fingerprint
    : createStableFingerprint;
  const recordStates = [];
  for await (const record of iterateStagedRawRecords(context)) {
    const mapped = mapTikTokCreatorVideoRow(record?.fields ?? {});
    recordStates.push(Object.freeze({
      sourceRecordId: requireText(record?.recordId ?? record?.record_id, 'sourceRecordId'),
      sourceModifiedAt: nullableTimestamp(
        record?.lastModifiedTime ?? record?.last_modified_time,
        'lastModifiedTime',
      ),
      sourceHash: await fingerprint(record?.fields ?? {}),
      externalContentId: requireText(mapped.externalContentId, 'externalContentId'),
    }));
  }
  const actual = await createTikTokSourceWatermark({
    accountKey: requireText(input.accountKey, 'accountKey'),
    sourceHandle: requireText(input.sourceHandle, 'sourceHandle'),
    recordStates,
    fingerprint,
  });
  if (actual.sourceWatermark !== expected) {
    throw permanentError('TikTok staged source changed after watermark admission', {
      code: 'TIKTOK_SOURCE_WATERMARK_MISMATCH',
      details: {
        expectedSourceWatermark: expected,
        actualSourceWatermark: actual.sourceWatermark,
        stagedRecordCount: actual.recordCount,
      },
    });
  }
  return actual;
}

function requireContext(value) {
  if (!value || typeof value !== 'object' || typeof value.assertCurrent !== 'function') {
    throw new TypeError('TikTok staged watermark verification requires context');
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`TikTok staged watermark verification requires ${fieldName}`);
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nullableTimestamp(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${fieldName} must be a non-negative safe integer`);
  }
  return number;
}
