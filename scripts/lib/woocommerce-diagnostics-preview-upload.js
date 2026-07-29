import { createHash } from 'node:crypto';

const WORKER_VERSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_FAILURE_MESSAGE_LENGTH = 2_000;

/** Parse only Wrangler's structured version-upload record; stdout is bounded fallback evidence. */
export function parseWooCommerceDiagnosticsPreviewUpload(outputText, stdoutText, expectedAlias) {
  const alias = requireText(expectedAlias, 'expectedAlias');
  const records = parseNdjson(outputText);
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

/**
 * Return bounded, redacted Wrangler command-failed evidence before temporary files are removed.
 * Raw command output is never returned or persisted.
 */
export function parseWooCommerceDiagnosticsWranglerFailure(
  outputText,
  stdoutText,
  stderrText,
  statusInput,
) {
  const records = parseNdjson(outputText);
  const failures = records.filter((record) => record?.type === 'command-failed');
  const failureRecord = failures.length === 1 ? failures[0] : null;
  const rawMessage = firstText(failureRecord, [
    'message',
    'error_message',
    'errorMessage',
    'error',
    'cause',
  ])
    ?? firstUsefulLine(stderrText)
    ?? firstUsefulLine(stdoutText)
    ?? 'Wrangler command failed without a structured message';
  const rawCode = firstPrimitive(failureRecord, [
    'code',
    'error_code',
    'errorCode',
    'status',
    'exit_code',
    'exitCode',
  ]);
  const numericStatus = Number(statusInput);
  return Object.freeze({
    commandFailedRecordCount: failures.length,
    code: normalizeCode(rawCode),
    message: redactFailureText(rawMessage).slice(0, MAX_FAILURE_MESSAGE_LENGTH),
    status: Number.isInteger(numericStatus) ? numericStatus : null,
    outputSha256: sha256(outputText ?? ''),
    stdoutSha256: sha256(stdoutText ?? ''),
    stderrSha256: sha256(stderrText ?? ''),
    messageRedacted: true,
    rawOutputPersisted: false,
  });
}

function parseNdjson(value) {
  return String(value ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? [parsed] : [];
      } catch {
        return [];
      }
    });
}

function firstText(value, preferredKeys) {
  if (!value || typeof value !== 'object') return null;
  for (const key of preferredKeys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim();
  }
  for (const nested of Object.values(value)) {
    const candidate = firstText(nested, preferredKeys);
    if (candidate) return candidate;
  }
  return null;
}

function firstPrimitive(value, preferredKeys) {
  if (!value || typeof value !== 'object') return null;
  for (const key of preferredKeys) {
    const candidate = value[key];
    if (typeof candidate === 'string' || typeof candidate === 'number') return candidate;
  }
  for (const nested of Object.values(value)) {
    const candidate = firstPrimitive(nested, preferredKeys);
    if (candidate !== null) return candidate;
  }
  return null;
}

function firstUsefulLine(value) {
  return stripAnsi(String(value ?? ''))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line !== '' && !/^🪵|^⛅|^─+$/u.test(line)) ?? null;
}

function normalizeCode(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string' || value.trim() === '') return null;
  const text = value.trim();
  return /^[A-Za-z0-9_.:-]{1,120}$/u.test(text) ? text : sha256(text);
}

function redactFailureText(value) {
  return stripAnsi(String(value ?? ''))
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [REDACTED]')
    .replace(/\bck_[A-Za-z0-9_-]+\b/giu, 'ck_[REDACTED]')
    .replace(/\bcs_[A-Za-z0-9_-]+\b/giu, 'cs_[REDACTED]')
    .replace(/https?:\/\/[^\s"'<>]+/giu, '[REDACTED_URL]')
    .replace(/\b[0-9a-f]{32}\b/giu, '[REDACTED_ACCOUNT_ID]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu, '[REDACTED_UUID]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[REDACTED_EMAIL]')
    .replace(/(?:\/Users|\/home|\/private\/var\/folders|\/tmp)\/[^\s"'<>]+/gu, '[REDACTED_PATH]')
    .replace(/\b[A-Za-z0-9_-]{48,}\b/gu, '[REDACTED_LONG_VALUE]')
    .trim();
}

function stripAnsi(value) {
  return String(value ?? '').replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '');
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
