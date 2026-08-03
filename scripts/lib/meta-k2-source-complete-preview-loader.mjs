import {
  META_K2_SOURCE_COMPLETE_PREVIEW_MODE,
  META_K2_SOURCE_COMPLETE_PREVIEW_MODE_ENV,
  transformMetaK2SourceCompleteController,
} from './meta-k2-source-complete-preview-recovery.js';

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
    source: transformed.source,
  };
}

function decodeSource(value) {
  if (typeof value === 'string') return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString('utf8');
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('utf8');
  }
  throw new TypeError('Meta K2 source-complete loader received an unsupported module source');
}
