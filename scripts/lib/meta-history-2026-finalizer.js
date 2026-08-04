import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';

export const META_HISTORY_2026_CONTRACT_VERSION = 'meta_history_2026_finalizer_v2';
export const META_HISTORY_2026_PINNED_CONTINUITY_CONTRACT_VERSION =
  'meta_history_2026_pinned_continuity_v1';
export const META_HISTORY_2026_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_META_HISTORY_2026_FINALIZER',
  value: 'RUN_META_HISTORY_2026_ONE_COMMAND',
});
export const META_HISTORY_2026_DECISION = 'META_HISTORY_2026_COMPLETED_SAFE';
export const META_HISTORY_2026_LEGACY_SESSION = Object.freeze({
  repositoryHead: 'e069380a544575ce0fc9bca53f1fb56944d26c09',
  operationId: 'meta-instagram-d1-20260729t065939687z-1ad3c9',
});
export const META_HISTORY_2026_WINDOWS = Object.freeze({
  organic: Object.freeze({ since: '2026-07-01', until: '2026-07-31' }),
  ads: Object.freeze({ since: '2026-07-01', until: '2026-07-31' }),
});

export function createMetaHistoryCloudflarePhaseEnvironment(baseEnv = {}, cloudflare = {}) {
  const accountId = requireText(cloudflare.accountId, 'cloudflare.accountId');
  const authSource = requireText(cloudflare.authSource, 'cloudflare.authSource');
  if (!['environment', 'wrangler_auth_session'].includes(authSource)) {
    throw historyError(
      'cloudflare.authSource is invalid',
      'META_HISTORY_2026_CLOUDFLARE_AUTH_SOURCE_INVALID',
    );
  }
  const env = { ...baseEnv, CLOUDFLARE_ACCOUNT_ID: accountId };
  if (authSource === 'environment') {
    env.CLOUDFLARE_API_TOKEN = requireText(cloudflare.apiToken, 'cloudflare.apiToken');
  } else {
    // Wrangler must retain its refreshable OAuth session during bounded polling.
    // Queue operators obtain a fresh bearer immediately before each REST send.
    delete env.CLOUDFLARE_API_TOKEN;
  }
  return Object.freeze(env);
}

const META_READ_ONLY_CONTRACT_VERSION = 'meta_read_only_validation_v1';
const META_READ_ONLY_IDENTITIES = Object.freeze([
  Object.freeze({ phase: 'facebook', connectorKey: 'facebook', sourceAccountKey: null }),
  Object.freeze({ phase: 'instagram', connectorKey: 'instagram', sourceAccountKey: null }),
  Object.freeze({
    phase: 'meta-ads-chemistry-k2',
    connectorKey: 'meta_ads',
    sourceAccountKey: 'chemistry_k2',
  }),
  Object.freeze({
    phase: 'meta-ads-chemistry-k3',
    connectorKey: 'meta_ads',
    sourceAccountKey: 'chemistry_k3',
  }),
]);

export function assertMetaHistory2026Confirmation(env = {}) {
  const expected = META_HISTORY_2026_CONFIRMATION;
  if (env[expected.envName] !== expected.value) {
    throw historyError(
      `Meta history execution requires ${expected.envName}=${expected.value}`,
      'META_HISTORY_2026_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function createMetaHistory2026Plan(repositoryHead) {
  const head = requireSha(repositoryHead);
  const operations = [
    operation('facebook', META_HISTORY_2026_WINDOWS.organic, head, 'required'),
    operation('instagram', META_HISTORY_2026_WINDOWS.organic, head, 'required'),
    operation('chemistry_k2', META_HISTORY_2026_WINDOWS.ads, head, 'required'),
    operation('chemistry_k3', META_HISTORY_2026_WINDOWS.ads, head, 'required'),
  ];
  return deepFreeze({
    contractVersion: META_HISTORY_2026_CONTRACT_VERSION,
    repositoryHead: head,
    facebook: {
      pinnedCompletionAction: 'verify_fresh_facebook_identity_and_no_replay_continuity',
      supplementalHistoryAction: 'run_new_idempotent_july_operation',
      existingOperationReplay: false,
      replacementOperation: false,
      legacyLocalArtifactsRequired: false,
    },
    operations,
    schedules: false,
    production: false,
  });
}

export function normalizeMetaHistoryExecutionTarget(value) {
  const target = requireTarget(value);
  if (!['chemistry_k2', 'chemistry_k3'].includes(target)) {
    throw historyError(
      'Meta history targeted execution supports only chemistry_k2 or chemistry_k3',
      'META_HISTORY_2026_EXECUTION_TARGET_INVALID',
    );
  }
  return target;
}

export function createMetaHistoryOperationId(target, range, repositoryHead) {
  const safeTarget = requireTarget(target);
  const since = requireDate(range?.since, 'since');
  const until = requireDate(range?.until, 'until');
  const digest = sha256(`${repositoryHead}:${safeTarget}:${since}:${until}`).slice(0, 12);
  return `meta-${safeTarget}-history-${since.replaceAll('-', '')}-${until.replaceAll('-', '')}-${digest}`;
}

export function createMetaHistoryPinnedContinuity(input = {}) {
  const repositoryHead = requireSha(input.repositoryHead);
  const plan = input.plan;
  const expectedPlan = createMetaHistory2026Plan(repositoryHead);
  const exactOperations = Array.isArray(plan?.operations)
    && stableJson(plan.operations.map(operationIdentity))
      === stableJson(expectedPlan.operations.map(operationIdentity));
  if (!plan || typeof plan !== 'object'
    || plan.contractVersion !== META_HISTORY_2026_CONTRACT_VERSION
    || plan.repositoryHead !== repositoryHead
    || plan.facebook?.pinnedCompletionAction
      !== expectedPlan.facebook.pinnedCompletionAction
    || plan.facebook?.supplementalHistoryAction
      !== expectedPlan.facebook.supplementalHistoryAction
    || plan.facebook?.existingOperationReplay !== false
    || plan.facebook?.replacementOperation !== false
    || plan.facebook?.legacyLocalArtifactsRequired !== false
    || exactOperations !== true
    || plan.schedules !== false
    || plan.production !== false) {
    throw historyError(
      'Meta history pinned continuity plan is invalid',
      'META_HISTORY_2026_PINNED_CONTINUITY_PLAN_INVALID',
    );
  }

  const facebookOperation = plan.operations[0];
  if (facebookOperation.operationId === META_HISTORY_2026_LEGACY_SESSION.operationId
    || plan.operations.some((item) => item?.operationId === META_HISTORY_2026_LEGACY_SESSION.operationId)) {
    throw historyError(
      'Meta history pinned continuity operation identity is invalid',
      'META_HISTORY_2026_PINNED_CONTINUITY_OPERATION_INVALID',
    );
  }

  const readOnlySummary = input.readOnlySummary;
  const details = readOnlySummary?.details;
  const validations = Array.isArray(details?.validations) ? details.validations : [];
  const validEnvelope = readOnlySummary?.phase === 'summary'
    && readOnlySummary?.status === 'passed'
    && readOnlySummary?.contractVersion === META_READ_ONLY_CONTRACT_VERSION
    && readOnlySummary?.mutationPerformed === false
    && Number(readOnlySummary?.businessWrites) === 0
    && Number(readOnlySummary?.queueMessages) === 0;
  const normalizedValidations = validations.map((item) => ({
    phase: item?.phase ?? null,
    connectorKey: item?.connectorKey ?? null,
    sourceAccountKey: item?.sourceAccountKey ?? null,
  }));
  const exactIdentities = stableJson(normalizedValidations) === stableJson(META_READ_ONLY_IDENTITIES);
  const allIdentityRequestsAccepted = validations.every((item) => item?.status === 'identity_validated'
    && Number.isSafeInteger(Number(item?.requestAttempts))
    && Number(item.requestAttempts) > 0);
  if (!validEnvelope
    || details?.accepted !== true
    || Number(details?.validationCount) !== META_READ_ONLY_IDENTITIES.length
    || validations.length !== META_READ_ONLY_IDENTITIES.length
    || exactIdentities !== true
    || allIdentityRequestsAccepted !== true) {
    throw historyError(
      'Fresh Meta identity evidence does not satisfy pinned continuity',
      'META_HISTORY_2026_PINNED_CONTINUITY_IDENTITY_INVALID',
      {
        envelopeValid: validEnvelope,
        accepted: details?.accepted === true,
        validationCount: Number(details?.validationCount ?? 0),
        exactIdentities,
        allIdentityRequestsAccepted,
      },
    );
  }

  return deepFreeze({
    contractVersion: META_HISTORY_2026_PINNED_CONTINUITY_CONTRACT_VERSION,
    repositoryHead,
    pinnedVerified: true,
    verificationMode: 'fresh_facebook_identity_and_exact_no_replay_plan',
    freshFacebookIdentityValidated: true,
    existingOperationReplay: false,
    replacementOperation: false,
    legacyLocalArtifactsRequired: false,
    legacyRepositoryHead: META_HISTORY_2026_LEGACY_SESSION.repositoryHead,
    legacyOperationIdFingerprint: sha256(META_HISTORY_2026_LEGACY_SESSION.operationId),
    supplementalOperationId: facebookOperation.operationId,
    periodStart: facebookOperation.periodStart,
    periodEnd: facebookOperation.periodEnd,
    readOnlyEvidenceFingerprint: sha256(stableJson({
      contractVersion: readOnlySummary.contractVersion,
      phase: readOnlySummary.phase,
      status: readOnlySummary.status,
      validations,
      mutationPerformed: readOnlySummary.mutationPerformed,
      businessWrites: Number(readOnlySummary.businessWrites),
      queueMessages: Number(readOnlySummary.queueMessages),
    })),
  });
}

export function validateMetaHistoryPinnedContinuity(value = {}, expectedHead) {
  const repositoryHead = requireSha(expectedHead);
  const expectedOperationId = createMetaHistoryOperationId(
    'facebook',
    META_HISTORY_2026_WINDOWS.organic,
    repositoryHead,
  );
  if (value.contractVersion !== META_HISTORY_2026_PINNED_CONTINUITY_CONTRACT_VERSION
    || value.repositoryHead !== repositoryHead
    || value.pinnedVerified !== true
    || value.verificationMode !== 'fresh_facebook_identity_and_exact_no_replay_plan'
    || value.freshFacebookIdentityValidated !== true
    || value.existingOperationReplay !== false
    || value.replacementOperation !== false
    || value.legacyLocalArtifactsRequired !== false
    || value.legacyRepositoryHead !== META_HISTORY_2026_LEGACY_SESSION.repositoryHead
    || value.legacyOperationIdFingerprint !== sha256(META_HISTORY_2026_LEGACY_SESSION.operationId)
    || value.supplementalOperationId !== expectedOperationId
    || value.periodStart !== META_HISTORY_2026_WINDOWS.organic.since
    || value.periodEnd !== META_HISTORY_2026_WINDOWS.organic.until
    || !/^[0-9a-f]{64}$/u.test(String(value.readOnlyEvidenceFingerprint ?? ''))) {
    throw historyError(
      'Meta history pinned continuity evidence is invalid',
      'META_HISTORY_2026_PINNED_CONTINUITY_INVALID',
    );
  }
  return deepFreeze(structuredClone(value));
}

export function readMetaLarkSummaryCompletion(summary = {}) {
  const data = summary?.data;
  if (data?.accepted !== true) {
    throw historyError(
      'Meta Lark summary is not accepted',
      'META_HISTORY_2026_LARK_SUMMARY_INVALID',
    );
  }
  return deepFreeze({
    larkCompleted: data.larkParityVerified === true,
    idempotentRerunVerified: data.idempotentRerunVerified === true,
    restoredAllFalse: data.restoredAllFalse === true,
  });
}

export function injectMetaHistoryConfig(
  configText,
  range = META_HISTORY_2026_WINDOWS.organic,
  options = {},
) {
  const baseDirectory = resolve(requireText(options.baseDirectory ?? process.cwd(), 'baseDirectory'));
  let text = absolutizeWranglerPath(configText, 'main', baseDirectory);
  text = absolutizeWranglerPath(text, 'migrations_dir', baseDirectory);
  for (const [key, value] of [
    ['MKT_META_INSTAGRAM_CONTENT_SINCE', requireDate(range.since, 'since')],
    ['MKT_META_INSTAGRAM_CONTENT_UNTIL', requireDate(range.until, 'until')],
  ]) {
    const pattern = new RegExp(`(["']${key}["']\\s*:\\s*)["'][^"']*["']`, 'u');
    if (pattern.test(text)) {
      text = text.replace(pattern, `$1${JSON.stringify(value)}`);
      continue;
    }
    const varsPattern = /(["']vars["']\s*:\s*\{)/u;
    if (!varsPattern.test(text)) {
      throw historyError('Wrangler config has no vars object', 'META_HISTORY_2026_CONFIG_VARS_MISSING');
    }
    text = text.replace(varsPattern, `$1\n    ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
  }
  return text;
}

export function validateMetaHistory2026Summary(value = {}) {
  const facebookOperation = completedFacebookOperation(value.operations);
  const modernPinnedContinuity = value.facebook?.pinnedVerified === true
    && value.facebook?.freshFacebookIdentityValidated === true
    && value.facebook?.existingOperationReplay === false
    && value.facebook?.replacementOperation === false
    && value.facebook?.legacyLocalArtifactsRequired === false;
  const checks = {
    ok: value.ok === true,
    decision: value.decision === META_HISTORY_2026_DECISION,
    facebookPinnedVerified: modernPinnedContinuity
      || (value.facebook?.verified === true && value.facebook?.pinnedSessionCompleted === true),
    facebookHistoryCompleted: value.facebook?.historyCompleted === true || facebookOperation !== null,
    facebookExistingOperationReplay: value.facebook?.existingOperationReplay === false
      || value.facebook?.providerReplay === false,
    facebookReplacementOperation: value.facebook?.replacementOperation !== true
      && facebookOperation !== null,
    instagramCompleted: value.instagram?.completed === true,
    adsJulyCompleted: value.metaAds?.julyCompleted === true,
    parity: value.parityVerified === true,
    idempotency: value.idempotentRerunsVerified === true,
    flags: value.executionFlagsAllFalse === true,
    activeWork: Number(value.remote?.activeWork) === 0,
    activeLocks: Number(value.remote?.activeLocks) === 0,
    activeQueue: Number(value.remote?.activeQueueOperations) === 0,
    schedule: value.scheduleEnabled === false,
    production: value.production === false,
  };
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  if (failed.length > 0) {
    throw historyError('Meta history summary is incomplete', 'META_HISTORY_2026_SUMMARY_INVALID', { failed });
  }
  return true;
}

function completedFacebookOperation(value) {
  if (!Array.isArray(value)) return null;
  const matches = value.filter((item) => item?.target === 'facebook'
    && item?.mode === 'required'
    && item?.periodStart === META_HISTORY_2026_WINDOWS.organic.since
    && item?.periodEnd === META_HISTORY_2026_WINDOWS.organic.until
    && item?.d1Completed === true
    && item?.larkCompleted === true
    && /^meta-facebook-history-20260701-20260731-[0-9a-f]{12}$/u.test(String(item?.operationId ?? '')));
  return matches.length === 1 ? matches[0] : null;
}

function operation(target, range, head, mode) {
  return deepFreeze({
    target,
    periodStart: range.since,
    periodEnd: range.until,
    operationId: createMetaHistoryOperationId(target, range, head),
    mode,
  });
}

function operationIdentity(value = {}) {
  return {
    target: value.target ?? null,
    periodStart: value.periodStart ?? null,
    periodEnd: value.periodEnd ?? null,
    operationId: value.operationId ?? null,
    mode: value.mode ?? null,
  };
}

function absolutizeWranglerPath(configText, key, baseDirectory) {
  const text = requireText(configText, 'configText');
  const pattern = new RegExp(`(["']${key}["']\\s*:\\s*)(["'])([^"']+)\\2`, 'gu');
  return text.replace(pattern, (match, prefix, quote, value) => {
    const trimmed = String(value).trim();
    if (trimmed === '' || isAbsolute(trimmed) || /^[a-z]+:\/\//iu.test(trimmed)) return match;
    return `${prefix}${quote}${resolve(baseDirectory, trimmed)}${quote}`;
  });
}

function requireTarget(value) {
  const target = requireText(value, 'target').toLowerCase();
  if (!['facebook', 'instagram', 'chemistry_k2', 'chemistry_k3'].includes(target)) {
    throw historyError('Meta history target is invalid', 'META_HISTORY_2026_TARGET_INVALID');
  }
  return target;
}

function requireSha(value) {
  const text = requireText(value, 'repositoryHead');
  if (!/^[0-9a-f]{40}$/u.test(text)) throw historyError('Repository Head is invalid', 'META_HISTORY_2026_HEAD_INVALID');
  return text;
}

function requireDate(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw historyError(`${fieldName} is invalid`, 'META_HISTORY_2026_DATE_INVALID');
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw historyError(`${fieldName} is required`, 'META_HISTORY_2026_VALUE_REQUIRED', { fieldName });
  }
  return value.trim();
}

function stableJson(value) {
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function historyError(message, code, details = undefined) {
  const error = new Error(message);
  error.name = 'MetaHistory2026FinalizerError';
  error.code = code;
  error.details = details;
  return error;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
