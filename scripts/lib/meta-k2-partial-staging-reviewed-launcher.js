import { createHash } from 'node:crypto';
import {
  META_K2_EXACT_RECOVERY_IDENTITY,
  META_K2_EXACT_RECOVERY_PATH,
  META_K2_EXACT_RECOVERY_TRUE_FLAGS_BY_PHASE,
} from '../../packages/config/src/meta-k2-exact-recovery-contract.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';
import {
  META_D1_ONLY_REQUIRED_FALSE_FLAGS,
} from './meta-d1-only-rollout-operator.js';
import {
  validateMetaK2ExactPartialStagingStability,
} from './meta-d1-only-partial-staging-recovery.js';
import {
  validateMetaK2RecoveryEvidenceSequence,
} from './meta-k2-partial-staging-finalizer.js';

export const META_K2_PREACTIVATION_RETRY_CONFIRMATION = Object.freeze({
  envName: 'MKT_META_K2_PREACTIVATION_RETRY',
  value: 'ARCHIVE_AND_RETRY_EXACT_PREACTIVATION_FAILURE',
});

export const META_K2_POST_ACTIVATION_RETRY_CONFIRMATION = Object.freeze({
  envName: 'MKT_META_K2_POST_ACTIVATION_RETRY',
  value: 'ARCHIVE_AND_RETRY_EXACT_POST_ACTIVATION_NO_BUSINESS_FAILURE',
});

export const META_K2_PREACTIVATION_FAILURE_FILES = Object.freeze([
  'backup.json',
  'meta-k2-before-recovery.sql',
  'read-only-stability.json',
  'retained-evidence-admission.json',
]);

export const META_K2_POST_ACTIVATION_FAILURE_FILES = Object.freeze([
  'backup.json',
  'deploy-d1-continuation.json',
  'meta-k2-before-recovery.sql',
  'read-only-stability.json',
  'restore-after-d1.json',
  'retained-evidence-admission.json',
  'verify-d1-continuation.json',
  'verify-restore-after-d1.json',
]);

const REDIRECT_URI_CONTRACTS = Object.freeze([
  Object.freeze({
    inputKey: 'googleAdsRedirectUri',
    fieldName: 'MKT_GOOGLE_ADS_REDIRECT_URI',
    expectedPath: '/oauth/google-ads/callback',
  }),
  Object.freeze({
    inputKey: 'youtubeRedirectUri',
    fieldName: 'MKT_YOUTUBE_REDIRECT_URI',
    expectedPath: '/oauth/youtube/callback',
  }),
]);

const WORKER_VERSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * Resolve the exact recovery URL only when all available authoritative origin signals agree.
 * An explicit URL is never allowed to override a conflicting public origin or OAuth callback origin.
 */
export function resolveMetaK2ExactRecoveryUrl(input = {}) {
  const origins = [];
  const explicitText = optionalText(input.explicitUrl);
  let explicitUrl = null;

  if (explicitText) {
    explicitUrl = requireExactRecoveryUrl(explicitText, 'MKT_META_K2_EXACT_RECOVERY_URL');
    origins.push({ source: 'explicit_recovery_url', origin: explicitUrl.origin });
  }

  const publicOriginText = optionalText(input.publicOrigin);
  if (publicOriginText) {
    origins.push({
      source: 'connection_public_origin',
      origin: requireHttpsOrigin(
        publicOriginText,
        'MKT_CONNECTION_PUBLIC_ORIGIN',
      ).origin,
    });
  }

  for (const contract of REDIRECT_URI_CONTRACTS) {
    const value = optionalText(input[contract.inputKey]);
    if (!value) continue;
    origins.push({
      source: contract.fieldName,
      origin: requireExactRedirectUrl(value, contract).origin,
    });
  }

  if (origins.length === 0) {
    throw launcherError(
      'Meta K2 reviewed launcher cannot resolve the Worker origin from reviewed runtime authority',
      'META_K2_REVIEWED_LAUNCHER_RECOVERY_ORIGIN_REQUIRED',
      {
        acceptedFields: [
          'MKT_CONNECTION_PUBLIC_ORIGIN',
          'MKT_GOOGLE_ADS_REDIRECT_URI',
          'MKT_YOUTUBE_REDIRECT_URI',
          'MKT_META_K2_EXACT_RECOVERY_URL',
        ],
      },
    );
  }

  const uniqueOrigins = [...new Set(origins.map((entry) => entry.origin))];
  if (uniqueOrigins.length !== 1) {
    throw launcherError(
      'Meta K2 reviewed Worker origin authorities conflict',
      'META_K2_REVIEWED_LAUNCHER_RECOVERY_ORIGIN_CONFLICT',
      { sources: origins.map((entry) => entry.source).sort() },
    );
  }

  const resolved = new URL(META_K2_EXACT_RECOVERY_PATH, uniqueOrigins[0]);
  if (explicitUrl && explicitUrl.toString() !== resolved.toString()) {
    throw launcherError(
      'Explicit Meta K2 recovery URL conflicts with reviewed Worker origin',
      'META_K2_REVIEWED_LAUNCHER_RECOVERY_ORIGIN_CONFLICT',
      { sources: origins.map((entry) => entry.source).sort() },
    );
  }
  return resolved.toString();
}

/** Validate a read-only probe against the exact recovery handler while the Worker is all-false. */
export function validateMetaK2SafeRouteProbe(input = {}) {
  const body = requireObject(input.body, 'body');
  const accepted = Number(input.status) === 400
    && input.redirected !== true
    && body.ok === false
    && body.stage === 'meta-exact-operation-continuation'
    && (body.phase ?? null) === null
    && body.code === 'META_PARTIAL_STAGING_RECOVERY_CONFIG_INVALID'
    && Number(body.directUseCaseInvocationCount) === 0
    && Number(body.queueMessageCount) === 0
    && Number(body.queueOperationAttemptMutationCount) === 0
    && body.larkWriteEnabled === false
    && body.scheduleEnabled === false
    && body.production === false;
  if (!accepted) {
    throw launcherError(
      'Meta K2 recovery URL does not resolve to the exact all-false recovery handler',
      'META_K2_REVIEWED_LAUNCHER_SAFE_ROUTE_PROBE_INVALID',
      {
        status: Number(input.status ?? 0),
        redirected: input.redirected === true,
        stage: body.stage ?? null,
        code: body.code ?? null,
      },
    );
  }
  return Object.freeze({
    accepted: true,
    status: 400,
    directUseCaseInvocationCount: 0,
    queueMessageCount: 0,
    queueOperationAttemptMutationCount: 0,
    remoteMutationCount: 0,
    routeResponseFingerprint: sha256(stableJson({
      status: 400,
      stage: body.stage,
      phase: body.phase ?? null,
      code: body.code,
      directUseCaseInvocationCount: Number(body.directUseCaseInvocationCount),
      queueMessageCount: Number(body.queueMessageCount),
      queueOperationAttemptMutationCount:
        Number(body.queueOperationAttemptMutationCount),
      larkWriteEnabled: body.larkWriteEnabled,
      scheduleEnabled: body.scheduleEnabled,
      production: body.production,
    })),
  });
}

/** Materialize the reviewed non-secret source mappings and the complete all-false safety baseline. */
export function injectMetaK2ReviewedRuntimeConfig(configText, env = {}) {
  const source = injectMetaK2ReviewedSourceMappings(configText, env);
  let text = source.configText;
  for (const flag of META_D1_ONLY_REQUIRED_FALSE_FLAGS) {
    text = upsertJsoncBoolean(text, flag, false);
  }
  const invalidFlags = META_D1_ONLY_REQUIRED_FALSE_FLAGS.filter((flag) => {
    const values = readJsoncBooleans(text, flag);
    return values.length === 0 || values.some((value) => value !== false);
  });
  if (invalidFlags.length > 0) {
    throw launcherError(
      'Meta K2 reviewed launcher could not materialize the complete all-false baseline',
      'META_K2_REVIEWED_LAUNCHER_SAFE_BASELINE_INVALID',
      { invalidFlags },
    );
  }
  return Object.freeze({
    configText: text,
    sourceMappingKeys: source.materializedKeys,
    sourceMappingFingerprint: source.sourceMappingFingerprint,
    allFalseFlagCount: META_D1_ONLY_REQUIRED_FALSE_FLAGS.length,
    allFalseFlagFingerprint: sha256(stableJson(META_D1_ONLY_REQUIRED_FALSE_FLAGS)),
    materializedKeys: Object.freeze([
      ...source.materializedKeys,
      ...META_D1_ONLY_REQUIRED_FALSE_FLAGS,
    ]),
  });
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
  requireRetryConfirmation(
    env,
    META_K2_PREACTIVATION_RETRY_CONFIRMATION,
    'META_K2_REVIEWED_LAUNCHER_PREACTIVATION_RETRY_CONFIRMATION_REQUIRED',
  );
  const fileNames = exactFileNames(
    input.fileNames,
    META_K2_PREACTIVATION_FAILURE_FILES,
    'META_K2_REVIEWED_LAUNCHER_PREACTIVATION_RETRY_INVALID',
  );

  const retained = requireObject(input.retainedEvidence, 'retainedEvidence');
  const stability = requireObject(input.stabilityEvidence, 'stabilityEvidence');
  const backup = requireObject(input.backupEvidence, 'backupEvidence');
  const backupValidation = validateBackup({
    backup,
    backupBytes: input.backupBytes,
    expectedBackupFile: input.expectedBackupFile,
  });
  const anchor = requireFingerprint(
    retained.previousEvidenceSha256,
    'retained.previousEvidenceSha256',
  );
  const sequence = validateMetaK2RecoveryEvidenceSequence(
    [retained, stability, backup],
    anchor,
  );
  const accepted = retained.phase === 'retained-evidence-admission'
    && retained.data?.queueMessageCount === 0
    && retained.data?.lifecycleSqlRepairCount === 0
    && stability.phase === 'read-only-stability'
    && stability.data?.executionFlagsAllFalse === true;
  if (!accepted) {
    throw launcherError(
      'Meta K2 existing recovery evidence does not prove a pre-activation failure',
      'META_K2_REVIEWED_LAUNCHER_PREACTIVATION_RETRY_INVALID',
    );
  }

  return Object.freeze({
    accepted: true,
    retryClass: 'preactivation_no_mutation',
    fileCount: fileNames.length,
    remoteMutationCount: 0,
    activeDeploymentCount: 0,
    safeRestoreDeploymentCount: 0,
    continuationHttpAttemptCount: 0,
    directUseCaseInvocationCount: 0,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    backupBytes: backupValidation.backupBytes,
    backupSha256: backupValidation.backupSha256,
    evidenceChainHeadSha256: sequence.evidenceChainHeadSha256,
  });
}

/**
 * Validate the exact post-activation failure footprint.
 * One active D1 deployment and one safe restore are retained, while the current D1 snapshot proves that
 * no direct use-case invocation, Business write, Coverage write or Queue attempt change occurred.
 */
export function validateMetaK2PostActivationRetry(input = {}, env = {}) {
  requireRetryConfirmation(
    env,
    META_K2_POST_ACTIVATION_RETRY_CONFIRMATION,
    'META_K2_REVIEWED_LAUNCHER_POST_ACTIVATION_RETRY_CONFIRMATION_REQUIRED',
  );
  const fileNames = exactFileNames(
    input.fileNames,
    META_K2_POST_ACTIVATION_FAILURE_FILES,
    'META_K2_REVIEWED_LAUNCHER_POST_ACTIVATION_RETRY_INVALID',
  );

  const retained = requireObject(input.retainedEvidence, 'retainedEvidence');
  const stability = requireObject(input.stabilityEvidence, 'stabilityEvidence');
  const backup = requireObject(input.backupEvidence, 'backupEvidence');
  const deploy = requireObject(input.deployEvidence, 'deployEvidence');
  const verifyDeploy = requireObject(input.verifyDeployEvidence, 'verifyDeployEvidence');
  const restore = requireObject(input.restoreEvidence, 'restoreEvidence');
  const verifyRestore = requireObject(input.verifyRestoreEvidence, 'verifyRestoreEvidence');
  const safeRouteProbe = requireObject(input.safeRouteProbe, 'safeRouteProbe');

  const backupValidation = validateBackup({
    backup,
    backupBytes: input.backupBytes,
    expectedBackupFile: input.expectedBackupFile,
  });
  const anchor = requireFingerprint(
    retained.previousEvidenceSha256,
    'retained.previousEvidenceSha256',
  );
  const sequence = validateMetaK2RecoveryEvidenceSequence([
    retained,
    stability,
    backup,
    deploy,
    verifyDeploy,
    restore,
    verifyRestore,
  ], anchor);

  const priorSnapshot = stability.data?.stability?.snapshot;
  const unchanged = validateMetaK2ExactPartialStagingStability(
    priorSnapshot,
    input.currentSnapshot,
  );
  const expectedD1Flags = [...META_K2_EXACT_RECOVERY_TRUE_FLAGS_BY_PHASE.d1].sort();
  const deployVersion = requireWorkerVersion(
    deploy.data?.activeVersion,
    'deploy.data.activeVersion',
  );
  const restoreVersion = requireWorkerVersion(
    restore.data?.activeVersion,
    'restore.data.activeVersion',
  );
  const currentActiveTrueFlags = Array.isArray(input.currentActiveTrueFlags)
    ? [...input.currentActiveTrueFlags].sort()
    : null;

  const accepted = retained.phase === 'retained-evidence-admission'
    && retained.data?.queueMessageCount === 0
    && retained.data?.lifecycleSqlRepairCount === 0
    && stability.phase === 'read-only-stability'
    && stability.data?.executionFlagsAllFalse === true
    && deploy.phase === 'deploy-d1-continuation'
    && Number(deploy.data?.commandExitCode) === 0
    && stableJson([...(deploy.data?.trueFlags ?? [])].sort()) === stableJson(expectedD1Flags)
    && Number(deploy.data?.queueMessageCount) === 0
    && verifyDeploy.phase === 'verify-d1-continuation'
    && verifyDeploy.data?.activeVersion === deployVersion
    && stableJson([...(verifyDeploy.data?.expectedTrueFlags ?? [])].sort())
      === stableJson(expectedD1Flags)
    && Number(verifyDeploy.data?.queueMessageCount) === 0
    && restore.phase === 'restore-after-d1'
    && Number(restore.data?.commandExitCode) === 0
    && restore.data?.mode === 'safe'
    && stableJson(restore.data?.expectedTrueFlags ?? []) === '[]'
    && verifyRestore.phase === 'verify-restore-after-d1'
    && verifyRestore.data?.activeVersion === restoreVersion
    && verifyRestore.data?.mode === 'safe'
    && stableJson(verifyRestore.data?.expectedTrueFlags ?? []) === '[]'
    && verifyRestore.data?.executionFlagsAllFalse === true
    && currentActiveTrueFlags !== null
    && stableJson(currentActiveTrueFlags) === '[]'
    && safeRouteProbe.accepted === true
    && Number(safeRouteProbe.directUseCaseInvocationCount) === 0
    && Number(safeRouteProbe.queueMessageCount) === 0
    && unchanged.accepted === true;
  if (!accepted) {
    throw launcherError(
      'Meta K2 existing recovery evidence does not prove an exact post-activation no-Business failure',
      'META_K2_REVIEWED_LAUNCHER_POST_ACTIVATION_RETRY_INVALID',
    );
  }

  return Object.freeze({
    accepted: true,
    retryClass: 'postactivation_no_business_after_verified_restore',
    fileCount: fileNames.length,
    remoteMutationCount: 0,
    activeDeploymentCount: 1,
    safeRestoreDeploymentCount: 1,
    continuationHttpAttemptCount: 1,
    directUseCaseInvocationCount: 0,
    d1BusinessWriteCount: 0,
    coverageWriteCount: 0,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    deployVersionFingerprint: sha256(deployVersion),
    restoreVersionFingerprint: sha256(restoreVersion),
    currentSnapshot: unchanged.snapshot,
    backupBytes: backupValidation.backupBytes,
    backupSha256: backupValidation.backupSha256,
    evidenceChainHeadSha256: sequence.evidenceChainHeadSha256,
  });
}

function requireExactRecoveryUrl(value, fieldName) {
  const url = new URL(requireText(value, fieldName));
  if (url.protocol !== 'https:'
    || url.pathname !== META_K2_EXACT_RECOVERY_PATH
    || url.search !== ''
    || url.hash !== '') {
    throw launcherError(
      'Meta K2 exact recovery URL must use HTTPS and the reviewed recovery path',
      'META_K2_REVIEWED_LAUNCHER_RECOVERY_URL_INVALID',
      { fieldName },
    );
  }
  return url;
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

function requireExactRedirectUrl(value, contract) {
  const url = new URL(requireText(value, contract.fieldName));
  if (url.protocol !== 'https:'
    || url.pathname !== contract.expectedPath
    || url.search !== ''
    || url.hash !== '') {
    throw launcherError(
      `${contract.fieldName} must use the reviewed HTTPS callback path`,
      'META_K2_REVIEWED_LAUNCHER_REDIRECT_URI_INVALID',
      { fieldName: contract.fieldName },
    );
  }
  return url;
}

function requireRetryConfirmation(env, expected, code) {
  if (env?.[expected.envName] !== expected.value) {
    throw launcherError(
      `Meta K2 retry requires ${expected.envName}=${expected.value}`,
      code,
      { fieldName: expected.envName },
    );
  }
}

function exactFileNames(input, expected, code) {
  const fileNames = Array.isArray(input)
    ? [...input].map((value) => requireText(value, 'fileName')).sort()
    : [];
  if (stableJson(fileNames) !== stableJson(expected)) {
    throw launcherError(
      'Meta K2 existing recovery root is not an exact retryable failure footprint',
      code,
      { fileNames },
    );
  }
  return fileNames;
}

function validateBackup(input = {}) {
  const backup = requireObject(input.backup, 'backup');
  const backupBytes = Buffer.isBuffer(input.backupBytes)
    ? input.backupBytes
    : Buffer.from(input.backupBytes ?? '');
  const expectedBackupFile = requireText(
    input.expectedBackupFile,
    'expectedBackupFile',
  );
  const backupData = requireObject(backup.data, 'backup.data');
  const accepted = backup.phase === 'backup'
    && Number(backupData.remoteMutationCount) === 0
    && backupData.backupFile === expectedBackupFile
    && Number(backupData.backupBytes) === backupBytes.length
    && backupBytes.length > 0
    && backupData.backupSha256 === sha256(backupBytes);
  if (!accepted) {
    throw launcherError(
      'Meta K2 recovery backup evidence is invalid',
      'META_K2_REVIEWED_LAUNCHER_BACKUP_INVALID',
    );
  }
  return Object.freeze({
    backupBytes: backupBytes.length,
    backupSha256: backupData.backupSha256,
  });
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

function readJsoncBooleans(text, key) {
  const pattern = new RegExp(
    `["']?${escapeRegex(key)}["']?\\s*:\\s*(true|false)`,
    'gu',
  );
  return [...text.matchAll(pattern)].map((match) => match[1] === 'true');
}

function upsertJsoncString(text, key, value) {
  const pattern = new RegExp(
    `(["']?${escapeRegex(key)}["']?\\s*:\\s*)["'][^"']*["']`,
    'gu',
  );
  if (pattern.test(text)) {
    return text.replace(pattern, (_match, prefix) => `${prefix}${JSON.stringify(value)}`);
  }
  return insertIntoVars(text, key, JSON.stringify(value));
}

function upsertJsoncBoolean(text, key, value) {
  const pattern = new RegExp(
    `(["']?${escapeRegex(key)}["']?\\s*:\\s*)(true|false)`,
    'gu',
  );
  if (pattern.test(text)) {
    return text.replace(pattern, (_match, prefix) => `${prefix}${value}`);
  }
  return insertIntoVars(text, key, String(value));
}

function insertIntoVars(text, key, serializedValue) {
  const varsPattern = /(["']?vars["']?\s*:\s*\{)/u;
  if (!varsPattern.test(text)) {
    throw launcherError(
      'Wrangler config has no vars object',
      'META_K2_REVIEWED_LAUNCHER_CONFIG_VARS_MISSING',
    );
  }
  return text.replace(
    varsPattern,
    (_match, prefix) => `${prefix}\n    ${JSON.stringify(key)}: ${serializedValue},`,
  );
}

function requireWorkerVersion(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!WORKER_VERSION_ID.test(text)) {
    throw launcherError(
      `${fieldName} must be a Worker version UUID`,
      'META_K2_REVIEWED_LAUNCHER_POST_ACTIVATION_RETRY_INVALID',
      { fieldName },
    );
  }
  return text;
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
      'META_K2_REVIEWED_LAUNCHER_INPUT_INVALID',
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
      'META_K2_REVIEWED_LAUNCHER_INPUT_INVALID',
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
