import {
  META_K2_SOURCE_COMPLETE_PREVIEW_MODE,
  META_K2_SOURCE_COMPLETE_PREVIEW_MODE_ENV,
  transformMetaK2SourceCompleteController,
} from './meta-k2-source-complete-preview-recovery.js';

const FINALIZER_FILE = 'meta-k2-partial-staging-preview-finalizer.mjs';
const RETAINED_FAILED_RECOVERY_ROOT =
  'exact-source-complete-pre-d1-recovery-v1';
export const META_K2_SOURCE_COMPLETE_RETRY_RECOVERY_ROOT =
  'exact-source-complete-pre-d1-recovery-v2';
const TERMINAL_RECOVERY_LINE =
  "    MKT_META_D1_ONLY_TERMINAL_RECOVERY: 'RECOVER_EXACT_FAILED_META_OPERATION',";
const DISABLE_INHERITED_PARTIAL_RECOVERY_LINE =
  "    MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY: 'false',";

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
  const transformed = transformMetaK2SourceCompleteController(url, source);
  if (!transformed.changed) return result;
  return {
    ...result,
    source: finalizeMetaK2SourceCompleteControllerTransform(transformed),
  };
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
