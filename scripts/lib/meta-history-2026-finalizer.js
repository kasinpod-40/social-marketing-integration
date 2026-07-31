import { createHash } from 'node:crypto';

export const META_HISTORY_2026_CONTRACT_VERSION = 'meta_history_2026_finalizer_v1';
export const META_HISTORY_2026_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_META_HISTORY_2026_FINALIZER',
  value: 'RUN_META_HISTORY_2026_ONE_COMMAND',
});
export const META_HISTORY_2026_DECISION = 'META_HISTORY_2026_COMPLETED_SAFE';
export const META_HISTORY_2026_WINDOWS = Object.freeze({
  organic: Object.freeze({ since: '2026-07-01', until: '2026-07-31' }),
  adsBaseline: Object.freeze({ since: '2026-05-01', until: '2026-07-31' }),
  adsExpansion: Object.freeze({ since: '2026-01-01', until: '2026-04-30' }),
});
export const META_HISTORY_2026_ADS_EXPANSION_LIMITS = Object.freeze({
  operationAdsDaily: 15_000,
  operationAdsEntities: 5_000,
  coverageEntities: 20_000,
});

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
    operation('chemistry_k2', META_HISTORY_2026_WINDOWS.adsBaseline, head, 'required'),
    operation('chemistry_k3', META_HISTORY_2026_WINDOWS.adsBaseline, head, 'required'),
    operation('chemistry_k2', META_HISTORY_2026_WINDOWS.adsExpansion, head, 'conditional'),
    operation('chemistry_k3', META_HISTORY_2026_WINDOWS.adsExpansion, head, 'conditional'),
  ];
  return deepFreeze({
    contractVersion: META_HISTORY_2026_CONTRACT_VERSION,
    repositoryHead: head,
    facebook: {
      pinnedCompletionAction: 'verify_existing_pinned_finalizer_and_lark_parity',
      supplementalHistoryAction: 'run_new_idempotent_july_operation',
      existingOperationReplay: false,
      replacementOperation: false,
    },
    operations,
    adsExpansionLimits: META_HISTORY_2026_ADS_EXPANSION_LIMITS,
    schedules: false,
    production: false,
  });
}

export function createMetaHistoryOperationId(target, range, repositoryHead) {
  const safeTarget = requireTarget(target);
  const since = requireDate(range?.since, 'since');
  const until = requireDate(range?.until, 'until');
  const digest = sha256(`${repositoryHead}:${safeTarget}:${since}:${until}`).slice(0, 12);
  return `meta-${safeTarget}-history-${since.replaceAll('-', '')}-${until.replaceAll('-', '')}-${digest}`;
}

export function shouldExpandMetaAdsHistory(summaries = []) {
  if (!Array.isArray(summaries) || summaries.length !== 2) {
    throw historyError('Meta Ads baseline requires exactly two account summaries', 'META_HISTORY_2026_ADS_BASELINE_INCOMPLETE');
  }
  const totals = summaries.reduce((result, summary) => {
    const snapshot = readD1Snapshot(summary);
    if (snapshot.invalidCoverageCount !== 0
      || snapshot.syncRunStatus !== 'success'
      || snapshot.activeLockCount !== 0) {
      throw historyError('Meta Ads baseline summary is not safe', 'META_HISTORY_2026_ADS_BASELINE_INVALID');
    }
    result.operationAdsDaily += count(snapshot.operationCounts?.adsDaily, 'operationCounts.adsDaily');
    result.operationAdsEntities += count(snapshot.operationCounts?.adsEntities, 'operationCounts.adsEntities');
    result.coverageEntities += count(snapshot.coverageEntityCount, 'coverageEntityCount');
    return result;
  }, { operationAdsDaily: 0, operationAdsEntities: 0, coverageEntities: 0 });
  const allowed = totals.operationAdsDaily <= META_HISTORY_2026_ADS_EXPANSION_LIMITS.operationAdsDaily
    && totals.operationAdsEntities <= META_HISTORY_2026_ADS_EXPANSION_LIMITS.operationAdsEntities
    && totals.coverageEntities <= META_HISTORY_2026_ADS_EXPANSION_LIMITS.coverageEntities;
  return deepFreeze({ allowed, totals, limits: META_HISTORY_2026_ADS_EXPANSION_LIMITS });
}

export function injectMetaHistoryConfig(configText, range = META_HISTORY_2026_WINDOWS.organic) {
  let text = requireText(configText, 'configText');
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
  const checks = {
    ok: value.ok === true,
    decision: value.decision === META_HISTORY_2026_DECISION,
    facebookPinnedVerified: value.facebook?.pinnedVerified === true,
    facebookHistoryCompleted: value.facebook?.historyCompleted === true,
    facebookExistingOperationReplay: value.facebook?.existingOperationReplay === false,
    facebookReplacementOperation: value.facebook?.replacementOperation === false,
    instagramCompleted: value.instagram?.completed === true,
    adsBaselineCompleted: value.metaAds?.baselineCompleted === true,
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

function operation(target, range, head, mode) {
  return deepFreeze({
    target,
    periodStart: range.since,
    periodEnd: range.until,
    operationId: createMetaHistoryOperationId(target, range, head),
    mode,
  });
}

function readD1Snapshot(summary) {
  const snapshot = summary?.data?.snapshotAfter
    ?? summary?.data?.comparison?.after
    ?? summary?.snapshotAfter
    ?? summary;
  if (!snapshot || typeof snapshot !== 'object') {
    throw historyError('Meta D1 summary snapshot is missing', 'META_HISTORY_2026_D1_SUMMARY_INVALID');
  }
  return snapshot;
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

function count(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw historyError(`${fieldName} is invalid`, 'META_HISTORY_2026_COUNT_INVALID');
  }
  return number;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw historyError(`${fieldName} is required`, 'META_HISTORY_2026_VALUE_REQUIRED', { fieldName });
  }
  return value.trim();
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
