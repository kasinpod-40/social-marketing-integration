import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createStableFingerprint } from '../../packages/shared/src/hash/stable-fingerprint.js';

export const META_PAID_RECENT_MONTH_SEED_CONTRACT_VERSION = 'meta_paid_recent_month_seed_v1';
export const META_PAID_RECENT_MONTH_SEED_PERIOD = Object.freeze({
  since: '2026-07-24',
  until: '2026-08-23',
});
export const META_PAID_RECENT_MONTH_SEED_TARGETS = Object.freeze([
  'chemistry_k2',
  'chemistry_k3',
]);
export const META_PAID_RECENT_MONTH_SEED_MAX_PAGES = 100;
export const META_PAID_RECENT_MONTH_SEED_MAX_ROWS = 50_000;
export const META_PAID_RECENT_MONTH_SEED_MAX_ACTIVE_ADS = 5_000;

const ACCOUNT_DATASET = 'meta_ads.account.latest';
const DAILY_DATASET = 'meta_ads.performance.daily';
const CREATIVE_DATASET = 'meta_ads.creatives.activity_scoped';

/**
 * One-shot recent-month seed source for the customer Lark closeout.
 *
 * Order is intentionally Daily-first so we only resolve creatives for ads that actually
 * appeared in the approved reporting range. Successful Daily pages and per-ad creative
 * lookups are checkpointed privately before advancing, so a Meta BUC throttle can resume
 * without replaying completed Provider reads.
 */
export async function collectMetaPaidRecentMonthSeedSource(input = {}) {
  const target = requireTarget(input.target);
  const sourceAccountId = normalizeAdAccountId(input.sourceAccountId);
  const repositoryHead = requireSha(input.repositoryHead);
  const requestedAt = requireTimestamp(input.requestedAt, 'requestedAt');
  const adapter = requireMethods(input.adapter, [
    'fetchAccount',
    'fetchDailyInsightsPage',
  ], 'adapter');
  const lookupCreativeForAd = requireFunction(input.lookupCreativeForAd, 'lookupCreativeForAd');
  const checkpointRoot = resolve(requireText(input.checkpointRoot, 'checkpointRoot'));
  const onProgress = typeof input.onProgress === 'function' ? input.onProgress : () => undefined;
  const period = normalizePeriod(input.period ?? META_PAID_RECENT_MONTH_SEED_PERIOD);

  await mkdir(checkpointRoot, { recursive: true, mode: 0o700 });
  await chmod(checkpointRoot, 0o700);
  const targetDir = join(checkpointRoot, target);
  await mkdir(targetDir, { recursive: true, mode: 0o700 });
  await chmod(targetDir, 0o700);

  const accountResource = await loadOrFetchAccount({
    targetDir,
    target,
    sourceAccountId,
    repositoryHead,
    period,
    adapter,
    onProgress,
  });

  const daily = await collectDailyPages({
    targetDir,
    target,
    sourceAccountId,
    repositoryHead,
    period,
    adapter,
    onProgress,
    maxPages: input.maxPages,
    maxRows: input.maxRows,
  });

  const activeAdIds = uniqueSortedIds(daily.rows.map((row) => row?.ad_id));
  const maxActiveAds = boundedInteger(
    input.maxActiveAds ?? META_PAID_RECENT_MONTH_SEED_MAX_ACTIVE_ADS,
    'maxActiveAds',
    1,
    META_PAID_RECENT_MONTH_SEED_MAX_ACTIVE_ADS,
  );
  if (activeAdIds.length > maxActiveAds) {
    throw seedError(
      'Paid Meta recent-month seed exceeded the active-ad safety ceiling',
      'META_PAID_RECENT_MONTH_SEED_ACTIVE_AD_LIMIT',
      { target, observed: activeAdIds.length, maximum: maxActiveAds },
    );
  }

  const creativeResult = await collectActivityCreatives({
    targetDir,
    target,
    sourceAccountId,
    repositoryHead,
    period,
    activeAdIds,
    lookupCreativeForAd,
    onProgress,
  });

  const operationSuffix = (await createStableFingerprint({
    schemaVersion: META_PAID_RECENT_MONTH_SEED_CONTRACT_VERSION,
    repositoryHead,
    target,
    sourceAccountId,
    period,
    activeAdIds,
  })).slice(0, 12);
  const operationId = [
    `meta-${target}-recent-month-seed`,
    period.since.replaceAll('-', ''),
    period.until.replaceAll('-', ''),
    operationSuffix,
  ].join('-');

  return deepFreeze({
    target,
    sourceAccountId,
    repositoryHead,
    requestedAt,
    period,
    operationId,
    workKey: `meta_ads:${target}:${operationId}`,
    accountResource,
    creatives: creativeResult.creatives,
    dailyInsights: daily.rows,
    sourceSummary: {
      accountRows: 1,
      dailyPages: daily.pages,
      dailyRows: daily.rows.length,
      dailyResumedFromPages: daily.resumedFromPages,
      activeAdCount: activeAdIds.length,
      creativeRows: creativeResult.creatives.length,
      creativeLookupsCompleted: creativeResult.completedLookups,
      creativeLookupsResumed: creativeResult.resumedLookups,
      creativeLookupMisses: creativeResult.misses,
      period: { ...period },
      sourceMode: 'daily_first_activity_scoped_creatives',
      checkpointContractVersion: META_PAID_RECENT_MONTH_SEED_CONTRACT_VERSION,
    },
  });
}

async function loadOrFetchAccount(input) {
  const path = join(input.targetDir, 'account.json');
  const existing = await readOptionalJson(path);
  if (existing) {
    validateCheckpointIdentity(existing, {
      repositoryHead: input.repositoryHead,
      target: input.target,
      sourceAccountId: input.sourceAccountId,
      datasetKey: ACCOUNT_DATASET,
      period: input.period,
    });
    const resource = requireObject(existing.resource, 'checkpoint account resource');
    assertObservedAccountId(resource, input.sourceAccountId, input.target);
    input.onProgress({
      stage: 'provider-checkpoint-complete',
      target: input.target,
      datasetKey: ACCOUNT_DATASET,
      rows: 1,
      page: 1,
    });
    return deepFreeze(resource);
  }

  input.onProgress({
    stage: 'provider-read-start',
    target: input.target,
    datasetKey: ACCOUNT_DATASET,
    page: 1,
  });
  let envelope;
  try {
    envelope = await input.adapter.fetchAccount({ adAccountId: input.sourceAccountId });
  } catch (error) {
    throw translateRateLimit(error, {
      target: input.target,
      datasetKey: ACCOUNT_DATASET,
      pagesCompleted: 0,
      rowCount: 0,
    });
  }
  const resource = requireObject(envelope?.resource, 'Meta Ads account resource');
  assertObservedAccountId(resource, input.sourceAccountId, input.target);
  await writePrivateJsonAtomic(path, checkpointEnvelope({
    repositoryHead: input.repositoryHead,
    target: input.target,
    sourceAccountId: input.sourceAccountId,
    datasetKey: ACCOUNT_DATASET,
    period: input.period,
    resource,
  }));
  input.onProgress({
    stage: 'provider-read-page',
    target: input.target,
    datasetKey: ACCOUNT_DATASET,
    rows: 1,
    page: 1,
    hasMore: false,
  });
  return deepFreeze(resource);
}

async function collectDailyPages(input) {
  const maxPages = boundedInteger(
    input.maxPages ?? META_PAID_RECENT_MONTH_SEED_MAX_PAGES,
    'maxPages',
    1,
    META_PAID_RECENT_MONTH_SEED_MAX_PAGES,
  );
  const maxRows = boundedInteger(
    input.maxRows ?? META_PAID_RECENT_MONTH_SEED_MAX_ROWS,
    'maxRows',
    1,
    META_PAID_RECENT_MONTH_SEED_MAX_ROWS,
  );
  const datasetDir = join(input.targetDir, 'daily');
  const pagesDir = join(datasetDir, 'pages');
  await mkdir(pagesDir, { recursive: true, mode: 0o700 });
  await chmod(datasetDir, 0o700);
  await chmod(pagesDir, 0o700);
  const statePath = join(datasetDir, 'state.json');
  const identity = {
    repositoryHead: input.repositoryHead,
    target: input.target,
    sourceAccountId: input.sourceAccountId,
    datasetKey: DAILY_DATASET,
    period: input.period,
  };
  const state = await readDailyState(statePath, identity);
  const resumedFromPages = state.pagesCompleted;
  const rows = await loadDailyRows({ pagesDir, state, identity, maxRows });

  if (state.completed === true) {
    input.onProgress({
      stage: 'provider-checkpoint-complete',
      target: input.target,
      datasetKey: DAILY_DATASET,
      page: state.pagesCompleted,
      rows: rows.length,
      hasMore: false,
      resumedFromPages,
    });
    return deepFreeze({ pages: state.pagesCompleted, rows, resumedFromPages });
  }

  let after = state.nextCursor;
  let visitedCursors = [...state.visitedCursors];
  for (let page = state.pagesCompleted + 1; page <= maxPages; page += 1) {
    input.onProgress({
      stage: 'provider-read-start',
      target: input.target,
      datasetKey: DAILY_DATASET,
      page,
      rows: rows.length,
      resumedFromPages,
    });
    let envelope;
    try {
      envelope = requireObject(await input.adapter.fetchDailyInsightsPage({
        adAccountId: input.sourceAccountId,
        after,
        visitedCursors: [...visitedCursors],
        since: input.period.since,
        until: input.period.until,
      }), `${DAILY_DATASET} page`);
    } catch (error) {
      throw translateRateLimit(error, {
        target: input.target,
        datasetKey: DAILY_DATASET,
        pagesCompleted: state.pagesCompleted,
        rowCount: rows.length,
      });
    }

    const pageRows = requireArray(envelope.rows, `${DAILY_DATASET}.rows`);
    if (rows.length + pageRows.length > maxRows) {
      throw seedError(
        'Paid Meta recent-month Daily exceeded the recovery row ceiling',
        'META_PAID_RECENT_MONTH_SEED_ROW_LIMIT',
        { target: input.target, maximum: maxRows, observed: rows.length + pageRows.length },
      );
    }
    const hasMore = envelope.hasMore === true;
    const nextCursor = hasMore ? requireText(envelope.nextCursor, 'daily.nextCursor') : null;
    if (nextCursor && (nextCursor === after || visitedCursors.includes(nextCursor))) {
      throw seedError(
        'Paid Meta recent-month Daily repeated a cursor',
        'META_PAID_RECENT_MONTH_SEED_CURSOR_REPEATED',
        { target: input.target, page },
      );
    }
    if (hasMore && page === maxPages) {
      throw seedError(
        'Paid Meta recent-month Daily exceeded the page ceiling',
        'META_PAID_RECENT_MONTH_SEED_PAGE_LIMIT',
        { target: input.target, maximum: maxPages },
      );
    }

    await writePrivateJsonAtomic(join(pagesDir, pageFileName(page)), checkpointEnvelope({
      ...identity,
      page,
      rows: pageRows,
    }));
    rows.push(...pageRows);
    if (after) visitedCursors.push(after);
    after = nextCursor;
    const nextState = checkpointEnvelope({
      ...identity,
      pagesCompleted: page,
      rowCount: rows.length,
      completed: !hasMore,
      nextCursor: hasMore ? nextCursor : null,
      visitedCursors,
    });
    await writePrivateJsonAtomic(statePath, nextState);
    Object.assign(state, nextState);

    input.onProgress({
      stage: 'provider-read-page',
      target: input.target,
      datasetKey: DAILY_DATASET,
      page,
      pageRows: pageRows.length,
      rows: rows.length,
      hasMore,
      resumedFromPages,
    });
    if (!hasMore) return deepFreeze({ pages: page, rows, resumedFromPages });
  }

  throw seedError(
    'Paid Meta recent-month Daily pagination ended unexpectedly',
    'META_PAID_RECENT_MONTH_SEED_PAGE_LIMIT',
    { target: input.target, maximum: maxPages },
  );
}

async function collectActivityCreatives(input) {
  const dir = join(input.targetDir, 'activity-creatives');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const byCreativeId = new Map();
  let resumedLookups = 0;
  let completedLookups = 0;
  let misses = 0;

  for (let index = 0; index < input.activeAdIds.length; index += 1) {
    const adId = input.activeAdIds[index];
    const path = join(dir, `ad-${adId}.json`);
    let stored = await readOptionalJson(path);
    if (stored) {
      validateCheckpointIdentity(stored, {
        repositoryHead: input.repositoryHead,
        target: input.target,
        sourceAccountId: input.sourceAccountId,
        datasetKey: CREATIVE_DATASET,
        period: input.period,
      });
      if (requireText(stored.adId, 'checkpoint.adId') !== adId) {
        throw checkpointInvalid('Paid Meta activity Creative checkpoint ad identity mismatch', {
          target: input.target,
        });
      }
      resumedLookups += 1;
    } else {
      input.onProgress({
        stage: 'provider-read-start',
        target: input.target,
        datasetKey: CREATIVE_DATASET,
        index: index + 1,
        total: input.activeAdIds.length,
        adId,
      });
      let lookup;
      try {
        lookup = requireObject(await input.lookupCreativeForAd({
          adAccountId: input.sourceAccountId,
          adId,
        }), 'activity Creative lookup');
      } catch (error) {
        throw translateRateLimit(error, {
          target: input.target,
          datasetKey: CREATIVE_DATASET,
          pagesCompleted: completedLookups + resumedLookups,
          rowCount: byCreativeId.size,
          activeAdIndex: index,
          activeAdCount: input.activeAdIds.length,
        });
      }
      const observedAdId = requireText(lookup.adId, 'activity Creative adId');
      if (observedAdId !== adId) {
        throw seedError(
          'Paid Meta activity Creative lookup returned another ad',
          'META_PAID_RECENT_MONTH_SEED_AD_IDENTITY_MISMATCH',
          { target: input.target },
        );
      }
      const observedAccountId = normalizeAdAccountId(lookup.accountId);
      if (observedAccountId !== input.sourceAccountId) {
        throw seedError(
          'Paid Meta activity Creative lookup returned another account',
          'META_PAID_RECENT_MONTH_SEED_ACCOUNT_IDENTITY_MISMATCH',
          { target: input.target },
        );
      }
      stored = checkpointEnvelope({
        repositoryHead: input.repositoryHead,
        target: input.target,
        sourceAccountId: input.sourceAccountId,
        datasetKey: CREATIVE_DATASET,
        period: input.period,
        adId,
        creative: lookup.creative ?? null,
      });
      await writePrivateJsonAtomic(path, stored);
      completedLookups += 1;
      input.onProgress({
        stage: 'provider-read-page',
        target: input.target,
        datasetKey: CREATIVE_DATASET,
        index: index + 1,
        total: input.activeAdIds.length,
        rows: byCreativeId.size,
        adId,
        hasMore: index + 1 < input.activeAdIds.length,
      });
    }

    if (stored.creative === null || stored.creative === undefined) {
      misses += 1;
      continue;
    }
    const creative = requireObject(stored.creative, 'activity Creative resource');
    const creativeId = requireText(creative.id, 'activity Creative id');
    if (!byCreativeId.has(creativeId)) byCreativeId.set(creativeId, creative);
  }

  return deepFreeze({
    creatives: [...byCreativeId.values()].sort((left, right) => String(left.id).localeCompare(String(right.id))),
    completedLookups,
    resumedLookups,
    misses,
  });
}

async function readDailyState(path, identity) {
  const existing = await readOptionalJson(path);
  if (!existing) {
    return checkpointEnvelope({
      ...identity,
      pagesCompleted: 0,
      rowCount: 0,
      completed: false,
      nextCursor: null,
      visitedCursors: [],
    });
  }
  validateCheckpointIdentity(existing, identity);
  const pagesCompleted = boundedInteger(
    existing.pagesCompleted,
    'pagesCompleted',
    0,
    META_PAID_RECENT_MONTH_SEED_MAX_PAGES,
  );
  const rowCount = boundedInteger(
    existing.rowCount,
    'rowCount',
    0,
    META_PAID_RECENT_MONTH_SEED_MAX_ROWS,
  );
  const completed = existing.completed === true;
  const nextCursor = completed ? null : optionalText(existing.nextCursor);
  const visitedCursors = requireArray(existing.visitedCursors, 'visitedCursors')
    .map((cursor) => requireText(cursor, 'visitedCursor'));
  if (!completed && pagesCompleted > 0 && !nextCursor) {
    throw checkpointInvalid('Incomplete paid Meta Daily checkpoint is missing its resume cursor', identity);
  }
  return checkpointEnvelope({
    ...identity,
    pagesCompleted,
    rowCount,
    completed,
    nextCursor,
    visitedCursors,
  });
}

async function loadDailyRows({ pagesDir, state, identity, maxRows }) {
  const rows = [];
  for (let page = 1; page <= state.pagesCompleted; page += 1) {
    const value = await readOptionalJson(join(pagesDir, pageFileName(page)));
    if (!value) throw checkpointInvalid('Paid Meta Daily checkpoint page is missing', identity);
    validateCheckpointIdentity(value, identity);
    if (Number(value.page) !== page) {
      throw checkpointInvalid('Paid Meta Daily checkpoint page number mismatch', identity);
    }
    rows.push(...requireArray(value.rows, 'checkpoint.rows'));
    if (rows.length > maxRows) {
      throw checkpointInvalid('Paid Meta Daily checkpoint exceeds the row ceiling', identity);
    }
  }
  if (rows.length !== Number(state.rowCount)) {
    throw checkpointInvalid('Paid Meta Daily checkpoint row count does not reconcile', identity);
  }
  return rows;
}

function checkpointEnvelope(value) {
  return {
    contractVersion: META_PAID_RECENT_MONTH_SEED_CONTRACT_VERSION,
    ...value,
  };
}

function validateCheckpointIdentity(value, expected) {
  if (value.contractVersion !== META_PAID_RECENT_MONTH_SEED_CONTRACT_VERSION
    || value.repositoryHead !== expected.repositoryHead
    || value.target !== expected.target
    || normalizeAdAccountId(value.sourceAccountId) !== expected.sourceAccountId
    || value.datasetKey !== expected.datasetKey) {
    throw checkpointInvalid('Paid Meta recent-month checkpoint identity mismatch', expected);
  }
  const period = normalizePeriod(value.period);
  if (period.since !== expected.period.since || period.until !== expected.period.until) {
    throw checkpointInvalid('Paid Meta recent-month checkpoint period mismatch', expected);
  }
}

function assertObservedAccountId(resource, expected, target) {
  const observed = normalizeAdAccountId(resource.account_id ?? resource.id);
  if (observed !== expected) {
    throw seedError(
      'Paid Meta account identity differs from the reviewed target mapping',
      'META_PAID_RECENT_MONTH_SEED_ACCOUNT_IDENTITY_MISMATCH',
      { target },
    );
  }
}

function translateRateLimit(error, details) {
  if (!isMetaAdsBusinessUseCaseRateLimit(error)) return error;
  return seedError(
    'Paid Meta provider rate limit reached; recent-month seed checkpoint is safe to resume',
    'META_PAID_PROVIDER_RATE_LIMIT_RESUMABLE',
    {
      ...details,
      resumeAvailable: true,
      graphCode: 80004,
      graphSubcode: 2446079,
    },
  );
}

export function isMetaAdsBusinessUseCaseRateLimit(error) {
  return Number(error?.details?.graphCode) === 80004
    && Number(error?.details?.graphSubcode) === 2446079;
}

function uniqueSortedIds(values) {
  return [...new Set(values
    .map((value) => optionalText(value))
    .filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function pageFileName(page) {
  return `page-${String(page).padStart(6, '0')}.json`;
}

async function readOptionalJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) {
      throw checkpointInvalid('Paid Meta recent-month checkpoint JSON is invalid', {});
    }
    throw error;
  }
}

async function writePrivateJsonAtomic(path, value) {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
  await chmod(path, 0o600);
}

function normalizePeriod(value) {
  const period = requireObject(value, 'period');
  const since = requireDate(value.since, 'period.since');
  const until = requireDate(value.until, 'period.until');
  if (since > until) throw new TypeError('period.since cannot be after period.until');
  const days = Math.floor(
    (Date.parse(`${until}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86_400_000,
  ) + 1;
  if (days > 31) throw new TypeError('recent-month seed period cannot exceed 31 days');
  return Object.freeze({ since, until });
}

function requireTarget(value) {
  const target = requireText(value, 'target');
  if (!META_PAID_RECENT_MONTH_SEED_TARGETS.includes(target)) {
    throw seedError('Paid Meta recent-month target is invalid', 'META_PAID_RECENT_MONTH_SEED_TARGET_INVALID', { target });
  }
  return target;
}

function normalizeAdAccountId(value) {
  const normalized = requireText(value, 'sourceAccountId').replace(/^act_/iu, '');
  if (!/^\d+$/u.test(normalized)) throw new TypeError('sourceAccountId must be numeric');
  return normalized;
}

function requireSha(value) {
  const text = requireText(value, 'repositoryHead');
  if (!/^[0-9a-f]{40}$/u.test(text)) throw new TypeError('repositoryHead must be a full SHA');
  return text;
}

function requireTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be a positive timestamp`);
  return number;
}

function requireDate(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new TypeError(`${fieldName} must be YYYY-MM-DD`);
  }
  return text;
}

function boundedInteger(value, fieldName, min, max) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new TypeError(`${fieldName} must be an integer from ${min} to ${max}`);
  }
  return number;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' && typeof value !== 'number') throw new TypeError(`${fieldName} must be text`);
  const text = String(value).trim();
  if (!text) throw new TypeError(`${fieldName} must be non-empty text`);
  return text;
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  return String(value).trim() || null;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${fieldName} must be an object`);
  return value;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}

function requireFunction(value, fieldName) {
  if (typeof value !== 'function') throw new TypeError(`${fieldName} must be a function`);
  return value;
}

function requireMethods(value, methods, fieldName) {
  const object = requireObject(value, fieldName);
  for (const method of methods) {
    if (typeof object[method] !== 'function') throw new TypeError(`${fieldName}.${method} must be a function`);
  }
  return object;
}

function checkpointInvalid(message, details) {
  return seedError(message, 'META_PAID_RECENT_MONTH_SEED_CHECKPOINT_INVALID', details);
}

function seedError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaPaidRecentMonthSeedError';
  error.code = code;
  error.details = details;
  return error;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
