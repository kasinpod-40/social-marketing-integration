import { createHash } from 'node:crypto';
import { inspectPrivateJsonFile } from './operator-terminal-reliability.js';

export const YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_ENV =
  'MKT_YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_EVIDENCE';
export const YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_CONTRACT =
  'meta_remote_lock_release_audit_v1';

const GIT_SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const BLOCKED_EVIDENCE_KEY = /(?:token|secret|authorization|cookie|password|consumer[_-]?key|consumer[_-]?secret|table.?id|database.?id|queue.?id|version.?id|uuid|raw)/iu;

export async function loadYouTubeReportRemoteLockReleaseEvidence(input = {}) {
  const env = input.env ?? {};
  const configuredPath = requireText(
    env[YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_ENV],
    YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_ENV,
  );
  let retained;
  try {
    retained = await inspectPrivateJsonFile(configuredPath, {
      field: YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_ENV,
      label: 'Retained Meta Remote lock-release evidence',
      requiredMode: 0o600,
    });
  } catch (error) {
    throw lockReleaseError(
      'Unable to load retained Meta Remote lock-release evidence',
      'YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_LOAD_FAILED',
      {
        sourceCode: error?.code ?? null,
        sourceDetails: sanitizeLockReleaseEvidence(error?.details ?? {}),
      },
    );
  }
  return assertYouTubeReportRemoteLockReleaseEvidence(retained.value, {
    expectedHead: input.expectedHead ?? null,
  });
}

export function createYouTubeReportRemoteLockReleaseEvidence(input = {}) {
  const auditHead = requireSha(input.auditHead, GIT_SHA, 'auditHead');
  const capturedAt = nonNegativeInteger(input.capturedAt, 'capturedAt');
  const repository = requireObject(input.repository, 'repository');
  const runtime = requireObject(input.runtime, 'runtime');
  const core = Object.freeze({
    contractVersion: YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_CONTRACT,
    released: true,
    auditHead,
    capturedAt,
    repository: Object.freeze({ ...repository }),
    runtime: Object.freeze({ ...runtime }),
  });
  return Object.freeze({
    ...core,
    evidenceSha256: sha256(stableJson(core)),
  });
}

export function assertYouTubeReportRemoteLockReleaseEvidence(value, options = {}) {
  const evidence = requireObject(value, 'lockReleaseEvidence');
  if (stableJson(sanitizeLockReleaseEvidence(evidence)) !== stableJson(evidence)) {
    throw lockReleaseError(
      'Retained Meta Remote lock-release evidence is not sanitized',
      'YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_NOT_SANITIZED',
    );
  }

  const repository = requireObject(evidence.repository, 'repository');
  const runtime = requireObject(evidence.runtime, 'runtime');
  const auditHead = requireSha(evidence.auditHead, GIT_SHA, 'auditHead');
  const evidenceSha256 = requireSha(evidence.evidenceSha256, SHA256, 'evidenceSha256');
  const capturedAt = nonNegativeInteger(evidence.capturedAt, 'capturedAt');
  const expectedHead = options.expectedHead === null || options.expectedHead === undefined
    ? null
    : requireSha(options.expectedHead, GIT_SHA, 'expectedHead');
  const { evidenceSha256: ignoredDigest, ...digestInput } = evidence;
  void ignoredDigest;
  const computedSha256 = sha256(stableJson(digestInput));

  if (evidence.contractVersion !== YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_CONTRACT
    || evidence.released !== true
    || repository.clean !== true
    || repository.head !== auditHead
    || repository.reviewedHead !== auditHead
    || (expectedHead !== null && auditHead !== expectedHead)
    || evidenceSha256 !== computedSha256
    || runtime.allExecutionFlagsFalse !== true
    || runtime.previewUrlsDisabled !== true
    || runtime.scheduleEnabled !== false
    || runtime.production !== 'BLOCKED'
    || Number(runtime.activeWorkCount ?? -1) !== 0
    || Number(runtime.activeLockCount ?? -1) !== 0
    || Number(runtime.uncertainQueueCount ?? -1) !== 0) {
    throw lockReleaseError(
      'Retained evidence does not prove an exact safe Meta Remote lock release',
      'YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_INVALID',
      {
        exactHeadMatch: expectedHead === null ? null : auditHead === expectedHead,
        evidenceDigestMatch: evidenceSha256 === computedSha256,
      },
    );
  }

  return Object.freeze({
    released: true,
    auditHead,
    evidenceSha256,
    capturedAt,
  });
}

export function sanitizeLockReleaseEvidence(value) {
  if (Array.isArray(value)) return value.map(sanitizeLockReleaseEvidence);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !BLOCKED_EVIDENCE_KEY.test(key))
    .map(([key, nested]) => [key, sanitizeLockReleaseEvidence(nested)]));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw lockReleaseError(
    `${field} must be an object`,
    'YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_INPUT_INVALID',
    { field },
  );
  return value;
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw lockReleaseError(
    `${field} is required`,
    'YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_EVIDENCE_REQUIRED',
    { field },
  );
  return value.trim();
}

function requireSha(value, pattern, field) {
  const text = requireText(value, field);
  if (!pattern.test(text)) throw lockReleaseError(
    `${field} has an invalid digest`,
    'YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_INPUT_INVALID',
    { field },
  );
  return text;
}

function nonNegativeInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw lockReleaseError(
    `${field} must be a non-negative integer`,
    'YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_INPUT_INVALID',
    { field },
  );
  return number;
}

function lockReleaseError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'YouTubeReportRemoteLockReleaseError';
  error.code = code;
  error.details = details;
  return error;
}
