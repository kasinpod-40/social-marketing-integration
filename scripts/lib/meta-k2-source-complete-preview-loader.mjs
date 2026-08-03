import { createHash } from 'node:crypto';
import { basename } from 'node:path';

import {
  META_K2_SOURCE_COMPLETE_PREVIEW_MODE,
  META_K2_SOURCE_COMPLETE_PREVIEW_MODE_ENV,
  transformMetaK2SourceCompleteController,
} from './meta-k2-source-complete-preview-recovery.js';

const FINALIZER_FILE = 'meta-k2-partial-staging-preview-finalizer.mjs';
const PREVIEW_HELPER_FILE = 'meta-k2-preview-recovery.js';
const EXPECTED_PREVIEW_HELPER_BLOB_SHA =
  'b2ec36e745b3364b652bfd60195ebed1f4c2eaa9';
const ORIGINAL_PREVIEW_ENTRYPOINT =
  'apps/sync-worker/src/meta-k2-exact-recovery-preview-entry.js';
const SOURCE_COMPLETE_PREVIEW_ENTRYPOINT =
  'apps/sync-worker/src/meta-k2-source-complete-recovery-preview-entry.js';
const RETAINED_FAILED_RECOVERY_ROOT =
  'exact-source-complete-pre-d1-recovery-v1';
export const META_K2_SOURCE_COMPLETE_RETRY_RECOVERY_ROOT =
  'exact-source-complete-pre-d1-recovery-v3';
const TERMINAL_RECOVERY_LINE =
  "    MKT_META_D1_ONLY_TERMINAL_RECOVERY: 'RECOVER_EXACT_FAILED_META_OPERATION',";
const DISABLE_INHERITED_PARTIAL_RECOVERY_LINE =
  "    MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY: 'false',";
const HTTP_FAILURE_DETAILS_LINE =
  '        { phase: input.phase, status: response.status },';
const SANITIZED_HTTP_FAILURE_DETAILS = [
  '        {',
  '          phase: input.phase,',
  '          status: response.status,',
  "          responseCode: typeof value?.code === 'string' ? value.code : null,",
  "          responseStage: typeof value?.stage === 'string' ? value.stage : null,",
  '        },',
].join('\n');

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (process.env[META_K2_SOURCE_COMPLETE_PREVIEW_MODE_ENV]
      !== META_K2_SOURCE_COMPLETE_PREVIEW_MODE
    || result?.format !== 'module'
    || result?.source === undefined
    || result?.source === null) {
    return result;
  }

  const source = decodeSource(result.source);
  if (basename(new URL(url).pathname) === PREVIEW_HELPER_FILE) {
    return {
      ...result,
      source: transformMetaK2SourceCompletePreviewHelper(source),
    };
  }

  const transformed = transformMetaK2SourceCompleteController(url, source);
  if (!transformed.changed) return result;
  return {
    ...result,
    source: finalizeMetaK2SourceCompleteControllerTransform(transformed),
  };
}

export function transformMetaK2SourceCompletePreviewHelper(sourceInput) {
  const source = requireText(sourceInput, 'source');
  const observedBlobSha = gitBlobSha(source);
  if (observedBlobSha !== EXPECTED_PREVIEW_HELPER_BLOB_SHA) {
    throw loaderError(
      'Meta K2 Preview helper source drifted before source-complete isolation',
      'META_K2_SOURCE_COMPLETE_PREVIEW_HELPER_DRIFT',
      { observedBlobSha },
    );
  }
  return replaceExactlyOnce(
    source,
    ORIGINAL_PREVIEW_ENTRYPOINT,
    SOURCE_COMPLETE_PREVIEW_ENTRYPOINT,
    'source-complete Preview entrypoint',
  );
}

export function finalizeMetaK2SourceCompleteControllerTransform(transformed = {}) {
  if (transformed?.changed !== true || typeof transformed.source !== 'string') {
    throw loaderError(
      'Meta K2 source-complete loader requires a transformed controller source',
      'META_K2_SOURCE_COMPLETE_LOADER_INPUT_INVALID',
    );
  }
  let source = replaceExactlyOnce(
    transformed.source,
    RETAINED_FAILED_RECOVERY_ROOT,
    META_K2_SOURCE_COMPLETE_RETRY_RECOVERY_ROOT,
    'source-complete retry recovery root',
  );
  if (transformed.fileName === FINALIZER_FILE) {
    source = replaceExactlyOnce(
      source,
      TERMINAL_RECOVERY_LINE,
      `${DISABLE_INHERITED_PARTIAL_RECOVERY_LINE}\n${TERMINAL_RECOVERY_LINE}`,
      'source-complete isolated target recovery mode',
    );
    source = replaceExactlyOnce(
      source,
      HTTP_FAILURE_DETAILS_LINE,
      SANITIZED_HTTP_FAILURE_DETAILS,
      'sanitized exact HTTP failure details',
    );
  }
  return source;
}

function replaceExactlyOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  const last = source.lastIndexOf(search);
  if (first < 0 || first !== last) {
    throw loaderError(
      `Meta K2 source-complete loader anchor is invalid: ${label}`,
      'META_K2_SOURCE_COMPLETE_LOADER_ANCHOR_INVALID',
      { label, occurrenceCount: first < 0 ? 0 : 2 },
    );
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + search.length)}`;
}

function gitBlobSha(source) {
  const bytes = Buffer.from(source, 'utf8');
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex');
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.length === 0) {
    throw loaderError(
      `${fieldName} is required`,
      'META_K2_SOURCE_COMPLETE_LOADER_INPUT_INVALID',
      { fieldName },
    );
  }
  return value;
}

function decodeSource(value) {
  if (typeof value === 'string') return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString('utf8');
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('utf8');
  }
  throw new TypeError('Meta K2 source-complete loader received an unsupported module source');
}

function loaderError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaK2SourceCompletePreviewLoaderError';
  error.code = code;
  error.details = details;
  return error;
}
