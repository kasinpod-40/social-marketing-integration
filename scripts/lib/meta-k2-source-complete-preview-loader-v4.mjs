import { basename } from 'node:path';

import {
  META_K2_SOURCE_COMPLETE_PREVIEW_MODE,
  META_K2_SOURCE_COMPLETE_PREVIEW_MODE_ENV,
  transformMetaK2SourceCompleteController,
} from './meta-k2-source-complete-preview-recovery.js';
import {
  finalizeMetaK2SourceCompleteControllerTransform,
  transformMetaK2SourceCompletePreviewHelper,
} from './meta-k2-source-complete-preview-loader.mjs';
import {
  META_K2_SOURCE_COMPLETE_PREVIEW_V4_MODE,
  META_K2_SOURCE_COMPLETE_PREVIEW_V4_MODE_ENV,
  finalizeMetaK2SourceCompleteV4ControllerTransform,
} from './meta-k2-source-complete-preview-recovery-v4.js';

const PREVIEW_HELPER_FILE = 'meta-k2-preview-recovery.js';

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (process.env[META_K2_SOURCE_COMPLETE_PREVIEW_MODE_ENV]
      !== META_K2_SOURCE_COMPLETE_PREVIEW_MODE
    || process.env[META_K2_SOURCE_COMPLETE_PREVIEW_V4_MODE_ENV]
      !== META_K2_SOURCE_COMPLETE_PREVIEW_V4_MODE
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

  const v3Source = finalizeMetaK2SourceCompleteControllerTransform(transformed);
  const v4 = finalizeMetaK2SourceCompleteV4ControllerTransform({
    fileName: transformed.fileName,
    source: v3Source,
  });
  if (!v4.changed) return result;

  return {
    ...result,
    source: v4.source,
  };
}

function decodeSource(value) {
  if (typeof value === 'string') return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString('utf8');
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('utf8');
  }
  throw new TypeError('Meta K2 source-complete v4 loader received an unsupported module source');
}
