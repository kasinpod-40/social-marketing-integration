import { createHash } from 'node:crypto';
import {
  META_K2_EXACT_RECOVERY_IDENTITY,
  META_K2_EXACT_RECOVERY_PATH,
} from '../../packages/config/src/meta-k2-exact-recovery-contract.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';
import {
  validateMetaK2RecoveryEvidenceSequence,
} from './meta-k2-partial-staging-finalizer.js';

export const META_K2_PREACTIVATION_RETRY_CONFIRMATION = Object.freeze({
  envName: 'MKT_META_K2_PREACTIVATION_RETRY',
  value: 'ARCHIVE_AND_RETRY_EXACT_PREACTIVATION_FAILURE',
});

export const META_K2_PREACTIVATION_FAILURE_FILES = Object.freeze([
  'backup.json',
  'meta-k2-before-recovery.sql',
  'read-only-stability.json',
  'retained-evidence-admission.json',
]);

/** Resolve the exact recovery route from an explicit URL or the existing customer public origin. */
export function resolveMetaK2ExactRecoveryUrl(input = {}) {
  const value = input.explicitUrl
    ? new URL(requireText(input.explicitUrl, 'MKT_META_K2_EXACT_RECOVERY_URL'))
    : new URL(
      META_K2_EXACT_RECOVERY_PATH,
      requireHttpsOrigin(input.publicOrigin, 'MKT_CONNECTION_PUBLIC_ORIGIN'),
    );
  if (value.protocol !== 'https:'
    || value.pathname !== META_K2_EXACT_RECOVERY_PATH
    || value.search !== ''
    || value.hash !== '') {
    throw launcherError(
      'Meta K2 exact recovery URL must use HTTPS and the reviewed recovery path',
      'META_K2_REVIEWED_LAUNCHER_RECOVERY_URL_INVALID',
    );
  }
  return value.toString();
}

/** Materialize only the reviewed non-secret Meta source mappings into the temporary Wrangler config. */
export function injectMetaK2ReviewedSourceMappings(configText, env = {}) {
  const input = requireText(configText, 'configText');
  const apiVersion = optionalText(env.META_GRAPH_API_VERSION)
    ?? readJsoncString(input, 'META_GRAPH_API_VERSION');
  if (!/^v\d+\.\d+$/u.test(apiVersion ?? '')) {
    throw launcherError(
      'Meta K2 reviewed launcher requires a pinned Meta Graph API version',
      'META_K2_REVIEWED_LAUNCHER_SOURCE_MAPPING_INVALID',
      { fieldName: 'META_GRAPH_API_VERSION' },
    );
  }

  const mappings = optionalText(env.META_AD_ACCOUNT_MAPPINGS)
    ?? readJsoncString(input, 'META_AD_ACCOUNT_MAPPINGS');
  const selected = parseMetaAdAccountMappings(mappings).find(
    (entry) => entry.key === META_K2_EXACT_RECOVERY_IDENTITY.sourceAccountKey,
  );
  if (!selected) {
    throw launcherError(
      'Meta K2 reviewed launcher requires the exact Chemistry K2 Meta Ads mapping',
      'META_K2_REVIEWED_LAUNCHER_SOURCE_MAPPING_INVALID',
      {
        fieldName: 'META_AD_ACCOUNT_MAPPINGS',
        sourceAccountKey: META_K2_EXACT_RECOVERY_IDENTITY.sourceAccountKey,
      },
    );
  }

  let text = upsertJsoncString(input, 'META_GRAPH_API_VERSION', apiVersion);
  text = upsertJsoncString(text, 'META_AD_ACCOUNT_MAPPINGS', mappings);
  return Object.freeze({
    configText: text,
    materializedKeys: Object.freeze([
      'META_GRAPH_API_VERSION',
      'META_AD_ACCOUNT_MAPPINGS',
    ]),
    sourceMappingFingerprint: sha256(`${apiVersion}\0${mappings}`),
  });
}

/** Validate that an existing recovery root stopped before any active deployment or continuation call. */
export function validateMetaK2PreactivationRetry(input = {}, env = {}) {
  const expected = META_K2_PREACTIVATION_RETRY_CONFIRMATION;
  if (env?.[expected.envName] !== expected.value) {
    throw launcherError(
      `Meta K2 pre-activation retry requires ${expected.envName}=${expected.value}`,
      'META_K2_REVIEWED_LAUNCHER_PREACTIVATION_RETRY_CONFIRMATION_REQUIRED',
      { fieldName: expected.envName },
    );
  }

  const fileNames = Array.isArray(input.fileNames)
    ? [...input.fileNames].map((value) => requireText(value, 'fileName')).sort()
    : [];
  if (stableJson(fileNames) !== stableJson(META_K2_PREACTIVATION_FAILURE_FILES)) {
    throw launcherError(
      'Meta K2 existing recovery root is not an exact pre-activation failure footprint',
      'META_K2_REVIEWED_LAUNCHER_PREACTIVATION_RETRY_INVALID',
      { fileNames },
    );
  }

  const retained = requireObject(input.retainedEvidence, 'retainedEvidence');
  const stability = requireObject(input.stabilityEvidence, 'stabilityEvidence');
  const backup = requireObject(input.backupEvidence, 'backupEvidence');
  const backupBytes = Buffer.isBuffer(input.backupBytes)
    ? input.backupBytes
    : Buffer.from(input.backupBytes ?? '');
  const expectedBackupFile = requireText(input.expectedBackupFile, 'expectedBackupFile');
  const anchor = requireFingerprint(retained.previousEvidenceSha256, 'retained.previousEvidenceSha256');
  const sequence = validateMetaK2RecoveryEvidenceSequence(
    [retained, stability, backup],
    anchor,
  );
  const backupData = requireObject(backup.data, 'backup.data');
  const accepted = retained.phase === 'retained-evidence-admission'
    && retained.data?.queueMessageCount === 0
    && retained.data?.lifecycleSqlRepairCount === 0
    && stability.phase === 'read-only-stability'
    && stability.data?.executionFlagsAllFalse === true
    && backup.phase === 'backup'
    && Number(backupData.remoteMutationCount) === 0
    && backupData.backupFile === expectedBackupFile
    && Number(backupData.backupBytes) === backupBytes.length
    && backupBytes.length > 0
    && backupData.backupSha256 === sha256(backupBytes);
  if (!accepted) {
    throw launcherError(
      'Meta K2 existing recovery evidence does not prove a pre-activation failure',
      'META_K2_REVIEWED_LAUNCHER_PREACTIVATION_RETRY_INVALID',
    );
  }

  return Object.freeze({
    accepted: true,
    remoteMutationCount: 0,
    activeDeploymentCount: 0,
    continuationCallCount: 0,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    backupBytes: backupBytes.length,
    backupSha256: backupData.backupSha256,
    evidenceChainHeadSha256: sequence.evidenceChainHeadSha256,
  });
}

function requireHttpsOrigin(value, fieldName) {
  const url = new URL(requireText(value, fieldName));
  if (url.protocol !== 'https:'
    || url.pathname !== '/'
    || url.search !== ''
    || url.hash !== '') {
    throw launcherError(
      `${fieldName} must be an HTTPS origin`,
      'META_K2_REVIEWED_LAUNCHER_PUBLIC_ORIGIN_INVALID',
      { fieldName },
    );
  }
  return url;
}

function parseMetaAdAccountMappings(value) {
  const text = requireText(value, 'META_AD_ACCOUNT_MAPPINGS');
  const entries = text.split(',').map((raw) => {
    const separator = raw.indexOf('=');
    const key = separator >= 0 ? raw.slice(0, separator).trim() : '';
    const accountId = separator >= 0 ? raw.slice(separator + 1).trim() : '';
    return { key, accountId };
  });
  if (entries.length === 0
    || entries.some((entry) => entry.key === '' || entry.accountId === '')) {
    throw launcherError(
      'META_AD_ACCOUNT_MAPPINGS is invalid',
      'META_K2_REVIEWED_LAUNCHER_SOURCE_MAPPING_INVALID',
      { fieldName: 'META_AD_ACCOUNT_MAPPINGS' },
    );
  }
  return entries;
}

function readJsoncString(text, key) {
  const pattern = new RegExp(
    `["']?${escapeRegex(key)}["']?\\s*:\\s*["']([^"']+)["']`,
    'u',
  );
  return text.match(pattern)?.[1]?.trim() ?? null;
}

function upsertJsoncString(text, key, value) {
  const pattern = new RegExp(
    `(["']?${escapeRegex(key)}["']?\\s*:\\s*)["'][^"']*["']`,
    'u',
  );
  if (pattern.test(text)) {
    return text.replace(pattern, (_match, prefix) => `${prefix}${JSON.stringify(value)}`);
  }
  const varsPattern = /(["']?vars["']?\s*:\s*\{)/u;
  if (!varsPattern.test(text)) {
    throw launcherError(
      'Wrangler config has no vars object',
      'META_K2_REVIEWED_LAUNCHER_CONFIG_VARS_MISSING',
    );
  }
  return text.replace(
    varsPattern,
    (_match, prefix) => `${prefix}\n    ${JSON.stringify(key)}: ${JSON.stringify(value)},`,
  );
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw launcherError(
      `${fieldName} is required`,
      'META_K2_REVIEWED_LAUNCHER_INPUT_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw launcherError(
      `${fieldName} must be an object`,
      'META_K2_REVIEWED_LAUNCHER_PREACTIVATION_RETRY_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireFingerprint(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^[0-9a-f]{64}$/u.test(text)) {
    throw launcherError(
      `${fieldName} must be a SHA-256 fingerprint`,
      'META_K2_REVIEWED_LAUNCHER_PREACTIVATION_RETRY_INVALID',
      { fieldName },
    );
  }
  return text;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function launcherError(message, code, details = {}) {
  return permanentError(message, { code, details });
}
