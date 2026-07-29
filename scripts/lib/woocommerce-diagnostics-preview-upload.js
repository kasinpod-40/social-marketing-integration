import { createHash } from 'node:crypto';

const WORKER_VERSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const MAX_FAILURE_MESSAGE_LENGTH = 2_000;

/**
 * Accept the structured upload record as version authority and derive the Preview origin from
 * validated inputs. Wrangler URLs are an optional, fail-closed cross-check only.
 */
export function parseWooCommerceDiagnosticsPreviewUpload(outputText, stdoutText, input) {
  const previewOrigin = buildWooCommerceDiagnosticsPreviewOrigin(input);
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
  const urlCandidates = readUrlCandidates(upload);
  const parsedUrls = [];
  for (const candidate of urlCandidates) {
    const parsed = parsePreviewUrl(candidate);
    if (!parsed) {
      throw previewError(
        'Wrangler version-upload Preview URL cross-check was invalid',
        'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PREVIEW_URL_INVALID',
        {
          previewUrlCandidateCount: urlCandidates.length,
          parsedPreviewUrlCount: parsedUrls.length,
          stdoutSha256: sha256(stdoutText ?? ''),
        },
      );
    }
    parsedUrls.push(parsed);
  }
  const distinctOrigins = [...new Set(parsedUrls.map((url) => url.origin))];
  if (distinctOrigins.length > 1) {
    throw previewError(
      'Wrangler version-upload Preview URL cross-check was ambiguous',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PREVIEW_URL_INVALID',
      {
        previewUrlCandidateCount: urlCandidates.length,
        distinctPreviewUrlCount: distinctOrigins.length,
        stdoutSha256: sha256(stdoutText ?? ''),
      },
    );
  }
  if (distinctOrigins.length === 1 && distinctOrigins[0] !== previewOrigin) {
    throw previewError(
      'Wrangler version-upload Preview URL did not match the deterministic origin',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PREVIEW_URL_MISMATCH',
      {
        previewUrlCandidateCount: urlCandidates.length,
        constructedOriginSha256: sha256(previewOrigin),
        observedOriginSha256: sha256(distinctOrigins[0]),
        stdoutSha256: sha256(stdoutText ?? ''),
      },
    );
  }
  return Object.freeze({
    versionId,
    previewOrigin,
    previewOriginFingerprint: sha256(previewOrigin),
    wranglerPreviewUrlCrossCheckCount: parsedUrls.length,
  });
}

export function buildWooCommerceDiagnosticsPreviewOrigin(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw previewError(
      'Deterministic Preview origin input is required',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PREVIEW_ORIGIN_INVALID',
    );
  }
  const alias = requireDnsLabel(input.previewAlias, 'previewAlias');
  const workerName = requireDnsLabel(input.workerName, 'workerName');
  const accountSubdomain = requireDnsLabel(
    input.accountWorkersDevSubdomain,
    'accountWorkersDevSubdomain',
  );
  const previewLabel = `${alias}-${workerName}`;
  if (previewLabel.length > 63 || !DNS_LABEL_PATTERN.test(previewLabel)) {
    throw previewError(
      'Combined Preview alias and Worker name exceed the DNS label contract',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PREVIEW_ORIGIN_INVALID',
      {
        fieldName: 'previewAlias-workerName',
        labelLength: previewLabel.length,
        maximumLabelLength: 63,
      },
    );
  }
  return `https://${previewLabel}.${accountSubdomain}.workers.dev`;
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

export function summarizeWooCommerceDiagnosticsWranglerEvidence(
  outputTexts,
  stderrText,
  statusInput,
) {
  if (!Array.isArray(outputTexts)) {
    throw new TypeError('outputTexts must be an array');
  }
  const parsed = outputTexts.map((outputText) => (
    parseWooCommerceDiagnosticsWranglerFailure(
      outputText,
      '',
      stderrText,
      statusInput,
    )
  ));
  return Object.freeze({
    capturedOutputFileCount: outputTexts.length,
    failures: Object.freeze(
      parsed.filter((failure) => failure.commandFailedRecordCount >= 1),
    ),
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

function readUrlCandidates(upload) {
  const candidates = [
    upload.preview_url,
    upload.previewUrl,
    upload.preview_urls,
    upload.previewUrls,
    upload.targets,
    upload.urls,
  ];
  const declared = candidates.flatMap((candidate) => collectUrlCandidateStrings(candidate));
  const additional = collectStructuredHttpUrlStrings(upload)
    .filter((candidate) => !declared.includes(candidate));
  return [...declared, ...additional];
}

function collectUrlCandidateStrings(value) {
  if (typeof value === 'string') return value.trim() === '' ? [] : [value.trim()];
  if (Array.isArray(value)) return value.flatMap(collectUrlCandidateStrings);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, nested]) => {
    if (typeof nested === 'string') {
      return /url/iu.test(key) || /^https?:\/\//iu.test(nested.trim())
        ? collectUrlCandidateStrings(nested)
        : [];
    }
    return collectUrlCandidateStrings(nested);
  });
}

function collectStructuredHttpUrlStrings(value) {
  if (typeof value === 'string') {
    return /^https?:\/\//iu.test(value.trim()) ? [value.trim()] : [];
  }
  if (Array.isArray(value)) return value.flatMap(collectStructuredHttpUrlStrings);
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(collectStructuredHttpUrlStrings);
}

function parsePreviewUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:'
      || !url.hostname.endsWith('.workers.dev')
      || url.username !== ''
      || url.password !== ''
      || url.port !== ''
      || url.pathname !== '/'
      || url.search !== ''
      || url.hash !== '') return null;
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

function requireDnsLabel(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw previewError(
      `${fieldName} is required`,
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PREVIEW_ORIGIN_INVALID',
      { fieldName },
    );
  }
  const text = value.trim();
  if (!DNS_LABEL_PATTERN.test(text)) {
    throw previewError(
      `${fieldName} must be a lowercase DNS-safe label`,
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PREVIEW_ORIGIN_INVALID',
      { fieldName },
    );
  }
  return text;
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
