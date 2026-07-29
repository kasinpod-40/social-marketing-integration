import { createHash } from 'node:crypto';

const WORKER_VERSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Parse only Wrangler's structured version-upload record; stdout is bounded fallback evidence. */
export function parseWooCommerceDiagnosticsPreviewUpload(outputText, stdoutText, expectedAlias) {
  const alias = requireText(expectedAlias, 'expectedAlias');
  const records = String(outputText ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  const uploads = records.filter((record) => record?.type === 'version-upload');
  if (uploads.length !== 1) {
    throw previewError(
      'Wrangler output did not contain exactly one version-upload record',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_VERSION_UPLOAD_INVALID',
      { versionUploadRecordCount: uploads.length },
    );
  }
  const upload = uploads[0];
  const versionId = requireVersionId(
    upload.version_id ?? upload.versionId,
    'version-upload.version_id',
  );
  const targets = readTargets(upload);
  const previewUrls = targets
    .map(parsePreviewUrl)
    .filter((url) => url !== null);
  const aliased = previewUrls.filter((url) => url.hostname.includes(alias));
  const selected = aliased.length === 1
    ? aliased[0]
    : previewUrls.length === 1
      ? previewUrls[0]
      : null;
  if (!selected) {
    throw previewError(
      'Wrangler version-upload record did not contain one unambiguous Preview URL',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PREVIEW_URL_INVALID',
      {
        previewUrlCount: previewUrls.length,
        aliasedPreviewUrlCount: aliased.length,
        stdoutSha256: sha256(stdoutText ?? ''),
      },
    );
  }
  return Object.freeze({
    versionId,
    previewOrigin: selected.origin,
    previewOriginFingerprint: sha256(selected.origin),
  });
}

function readTargets(upload) {
  const candidates = [
    upload.preview_urls,
    upload.previewUrls,
    upload.targets,
    upload.urls,
  ];
  const target = candidates.find(Array.isArray);
  return target ?? [];
}

function parsePreviewUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.workers.dev')) return null;
    return url;
  } catch {
    return null;
  }
}

function requireVersionId(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!WORKER_VERSION_ID_PATTERN.test(text)) {
    throw previewError(
      `${fieldName} is not a valid Worker version ID`,
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_VERSION_UPLOAD_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw previewError(
      `${fieldName} is required`,
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_VERSION_UPLOAD_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function previewError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommerceDiagnosticsPreviewUploadError';
  error.code = code;
  error.details = details;
  return error;
}
