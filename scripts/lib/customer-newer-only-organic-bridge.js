import { createStableFingerprint } from '../../packages/shared/src/hash/stable-fingerprint.js';

export const CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE_CONFIRMATIONS = Object.freeze({
  prepare: 'PREPARE_CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE',
  apply: 'APPLY_CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE',
  verify: 'VERIFY_CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE',
});

export const CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE_CONTRACT = 'customer_newer_only_organic_bridge_v1';
export const CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE_PERIOD_END = '2026-08-26';
export const CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE_EXPECTED_ROWS = Object.freeze({
  facebook: Object.freeze({ '2026-08-26': 95 }),
  tiktok: Object.freeze({
    '2026-08-24': 2_048,
    '2026-08-25': 2_049,
    '2026-08-26': 2_051,
  }),
});

const ALLOWED_PLATFORMS = Object.freeze(['facebook', 'tiktok']);
const CUSTOMER_KEY = 'chemistry_k';
const ACCOUNT_KEY = 'chemistry_k';
const TIME_ZONE = 'Asia/Bangkok';

export function parseCustomerNewerOnlyOrganicBridgeArgs(args = []) {
  const result = { phase: 'plan', execute: false, planPath: null };
  for (const arg of args) {
    if (arg === '--execute') result.execute = true;
    else if (arg.startsWith('--phase=')) result.phase = arg.slice('--phase='.length);
    else if (arg.startsWith('--plan=')) result.planPath = arg.slice('--plan='.length);
    else throw bridgeError(`Unsupported argument: ${arg}`, 'CUSTOMER_NEWER_ONLY_BRIDGE_ARGUMENT_INVALID');
  }
  if (!['plan', 'prepare', 'apply', 'verify'].includes(result.phase)) {
    throw bridgeError(`Unsupported phase: ${result.phase}`, 'CUSTOMER_NEWER_ONLY_BRIDGE_PHASE_INVALID');
  }
  if (['apply', 'verify'].includes(result.phase) && !hasText(result.planPath)) {
    throw bridgeError('--plan is required for apply/verify', 'CUSTOMER_NEWER_ONLY_BRIDGE_PLAN_REQUIRED');
  }
  return Object.freeze(result);
}

export function assertCustomerNewerOnlyOrganicBridgeConfirmation(phase, env = process.env) {
  const expected = CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE_CONFIRMATIONS[phase];
  const actual = env.CONFIRM_CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE;
  if (!expected || actual !== expected) {
    throw bridgeError(
      `CONFIRM_CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE must equal ${expected}`,
      'CUSTOMER_NEWER_ONLY_BRIDGE_CONFIRMATION_REQUIRED',
    );
  }
}

export async function buildCustomerNewerOnlyOrganicBridgePlan(input = {}) {
  const generatedAt = requireTimestamp(input.generatedAt, 'generatedAt');
  const source = normalizeSourceTables(input.sourceTables);
  const customer = normalizeCustomerSnapshot(input.customerSnapshot);
  const sourceRows = selectSourceRows(source.contentDaily, customer.maxObservationDate);
  assertExpectedSourceRows(sourceRows);
  const accountRows = selectFacebookAccountRows(source.accountDaily, customer.maxAccountDate);
  const masterByIdentity = indexMasterRows(source.content);
  const latestByContent = latestRowsByContent(sourceRows);
  const sourceIdentities = [...new Set(sourceRows.map((row) => contentKey(row.platform, row.externalContentId)))];
  const missingStateKeys = sourceIdentities.filter((key) => !customer.stateKeys.has(key)).sort();

  for (const key of missingStateKeys) {
    if (!masterByIdentity.has(key) || !latestByContent.has(key)) {
      throw bridgeError('A missing Customer state key has no exact Dev master/daily source',
        'CUSTOMER_NEWER_ONLY_BRIDGE_MASTER_MISSING', { contentKey: key });
    }
  }

  const sourceDigest = await createStableFingerprint({
    contract: CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE_CONTRACT,
    periodEnd: CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE_PERIOD_END,
    accountRows: accountRows.map(stableAccountSource),
    contentRows: sourceRows.map(stableDailySource),
    missingStateKeys,
  });
  const observedAtByPlatformDate = buildObservedAtByPlatformDate({ generatedAt, accountRows });
  const chunks = [];
  for (const platform of ALLOWED_PLATFORMS) {
    const dates = Object.keys(CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE_EXPECTED_ROWS[platform]).sort();
    for (const metricDate of dates) {
      const rows = sourceRows.filter((row) => row.platform === platform && row.metricDate === metricDate);
      const coverage = await buildCoverageIdentity({ platform, metricDate, rows, sourceDigest, generatedAt });
      const stateKeysForChunk = metricDate === dates.at(-1)
        ? missingStateKeys.filter((key) => key.startsWith(`${platform}:`))
        : [];
      const sql = await buildSqlChunk({
        platform,
        metricDate,
        rows,
        accountRows: platform === 'facebook' && metricDate === CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE_PERIOD_END
          ? accountRows
          : [],
        stateKeys: stateKeysForChunk,
        masterByIdentity,
        latestByContent,
        coverage,
        observedAt: observedAtByPlatformDate.get(`${platform}|${metricDate}`),
        generatedAt,
      });
      chunks.push(Object.freeze({
        platform,
        metricDate,
        rowCount: rows.length,
        stateInsertCount: stateKeysForChunk.length,
        coverageRunId: coverage.coverageRunId,
        sourceWatermark: coverage.sourceWatermark,
        sql,
      }));
    }
  }

  return Object.freeze({
    contract: CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE_CONTRACT,
    periodEnd: CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE_PERIOD_END,
    generatedAt,
    sourceDigest,
    customerBoundary: Object.freeze({
      observationDates: Object.freeze(Object.fromEntries(customer.maxObservationDate)),
      accountDates: Object.freeze(Object.fromEntries(customer.maxAccountDate)),
      stateKeyCount: customer.stateKeys.size,
    }),
    sourceSummary: Object.freeze({
      rows: sourceRows.length,
      accountRows: accountRows.length,
      missingStateKeys: Object.freeze(missingStateKeys),
      byPlatformDate: Object.freeze(groupCounts(sourceRows)),
    }),
    chunks: Object.freeze(chunks),
  });
}

export function assertCustomerBoundaryUnchanged(expected = {}, actual = {}) {
  const expectedObservations = stableJson(expected.observationDates ?? {});
  const actualObservations = stableJson(actual.observationDates ?? {});
  const expectedAccounts = stableJson(expected.accountDates ?? {});
  const actualAccounts = stableJson(actual.accountDates ?? {});
  if (expectedObservations !== actualObservations || expectedAccounts !== actualAccounts) {
    throw bridgeError('Customer Production source boundary changed after plan generation',
      'CUSTOMER_NEWER_ONLY_BRIDGE_BOUNDARY_DRIFT', {
        expected: { observationDates: expected.observationDates, accountDates: expected.accountDates },
        actual: { observationDates: actual.observationDates, accountDates: actual.accountDates },
      });
  }
  return true;
}

export function buildCustomerBridgeVerificationSql(plan = {}) {
  const chunks = requireArray(plan.chunks, 'plan.chunks');
  const coverageIds = chunks.map((chunk) => sqlText(chunk.coverageRunId)).join(',');
  return `
SELECT platform, metric_date, COUNT(*) AS observation_rows,
  COUNT(DISTINCT external_content_id) AS distinct_content_rows
FROM organic_content_observations
WHERE customer_key = '${CUSTOMER_KEY}' AND account_key = '${ACCOUNT_KEY}'
  AND (platform, metric_date) IN (${chunks.map((chunk) => `(${sqlText(chunk.platform)},${sqlText(chunk.metricDate)})`).join(',')})
GROUP BY platform, metric_date ORDER BY platform, metric_date;
SELECT coverage_run_id, platform, dataset_key, period_end, status, scope_mode,
  expected_entities, observed_entities, expected_rows, observed_rows, written_rows, failed_rows,
  (SELECT COUNT(*) FROM data_coverage_entities e WHERE e.coverage_run_id = r.coverage_run_id) AS coverage_entities,
  (SELECT COUNT(*) FROM data_coverage_entities e
    LEFT JOIN organic_content_state s
      ON s.platform = r.platform AND s.account_key = r.account_key
      AND s.external_content_id = e.external_entity_id
    WHERE e.coverage_run_id = r.coverage_run_id AND s.content_key IS NULL) AS missing_state_rows
FROM data_coverage_runs r WHERE coverage_run_id IN (${coverageIds})
ORDER BY platform, period_end;
SELECT platform, metric_date, COUNT(*) AS account_rows
FROM organic_account_daily_facts
WHERE customer_key = '${CUSTOMER_KEY}' AND account_key = '${ACCOUNT_KEY}'
  AND platform = 'facebook' AND metric_date = '${CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE_PERIOD_END}'
GROUP BY platform, metric_date;
`;
}

export function customerBoundarySql() {
  return `
SELECT platform, MAX(metric_date) AS max_metric_date
FROM organic_content_observations
WHERE customer_key = '${CUSTOMER_KEY}' AND account_key = '${ACCOUNT_KEY}'
  AND platform IN ('facebook','tiktok')
GROUP BY platform ORDER BY platform;
SELECT platform, MAX(metric_date) AS max_metric_date
FROM organic_account_daily_facts
WHERE customer_key = '${CUSTOMER_KEY}' AND account_key = '${ACCOUNT_KEY}'
  AND platform = 'facebook'
GROUP BY platform ORDER BY platform;
SELECT content_key FROM organic_content_state
WHERE customer_key = '${CUSTOMER_KEY}' AND account_key = '${ACCOUNT_KEY}'
  AND platform IN ('facebook','tiktok')
ORDER BY content_key;
`;
}

export function parseCustomerBoundaryResults(resultSets = []) {
  const sets = requireArray(resultSets, 'resultSets');
  const observationRows = requireArray(sets[0] ?? [], 'observationRows');
  const accountRows = requireArray(sets[1] ?? [], 'accountRows');
  const stateRows = requireArray(sets[2] ?? [], 'stateRows');
  return Object.freeze({
    observationDates: Object.freeze(Object.fromEntries(observationRows.map((row) => [row.platform, row.max_metric_date]))),
    accountDates: Object.freeze(Object.fromEntries(accountRows.map((row) => [row.platform, row.max_metric_date]))),
    stateKeys: Object.freeze(stateRows.map((row) => requireText(row.content_key, 'content_key'))),
  });
}

function normalizeSourceTables(value) {
  if (!value || typeof value !== 'object') throw bridgeError('sourceTables is required', 'CUSTOMER_NEWER_ONLY_BRIDGE_SOURCE_INVALID');
  return Object.freeze({
    content: requireArray(value.content, 'sourceTables.content').map(normalizeMasterRecord),
    contentDaily: requireArray(value.contentDaily, 'sourceTables.contentDaily').map(normalizeDailyRecord),
    accountDaily: requireArray(value.accountDaily, 'sourceTables.accountDaily').map(normalizeAccountRecord),
  });
}

function normalizeCustomerSnapshot(value) {
  if (!value || typeof value !== 'object') throw bridgeError('customerSnapshot is required', 'CUSTOMER_NEWER_ONLY_BRIDGE_CUSTOMER_INVALID');
  const observations = new Map(Object.entries(value.observationDates ?? {}));
  const accounts = new Map(Object.entries(value.accountDates ?? {}));
  for (const platform of ALLOWED_PLATFORMS) requireDate(observations.get(platform), `observationDates.${platform}`);
  requireDate(accounts.get('facebook'), 'accountDates.facebook');
  return Object.freeze({
    maxObservationDate: observations,
    maxAccountDate: accounts,
    stateKeys: new Set(requireArray(value.stateKeys, 'stateKeys').map((key) => requireText(key, 'stateKey'))),
  });
}

function normalizeMasterRecord(record) {
  const fields = record?.fields ?? record;
  const platform = normalizePlatform(fields.platform);
  return Object.freeze({
    platform,
    externalContentId: requireText(scalar(fields.external_content_id), 'external_content_id'),
    contentType: optionalText(scalar(fields.content_type)),
    publishedAt: optionalTimestamp(scalar(fields.published_at), 'published_at'),
    caption: optionalText(scalar(fields.caption)),
    contentUrl: optionalText(scalar(fields.content_url)),
    thumbnailUrl: optionalText(scalar(fields.thumbnail_url)),
    durationSeconds: optionalNumber(scalar(fields.duration_seconds), 'duration_seconds'),
  });
}

function normalizeDailyRecord(record) {
  const fields = record?.fields ?? record;
  const platform = normalizePlatform(fields.platform);
  const externalContentId = requireText(scalar(fields.external_content_id), 'external_content_id');
  const metricDate = dateOnly(scalar(fields.metric_date), 'metric_date');
  const sourceKey = requireText(scalar(fields.content_daily_key), 'content_daily_key');
  const canonicalSourceAccount = platform === 'facebook' ? '982406442148381' : 'chemistry_k';
  const expectedKey = `${platform}:${canonicalSourceAccount}:${externalContentId}:${metricDate}`;
  if (ALLOWED_PLATFORMS.includes(platform) && sourceKey !== expectedKey) {
    throw bridgeError('Dev Content Daily stable key is not Customer-owned chemistry_k identity',
      'CUSTOMER_NEWER_ONLY_BRIDGE_SOURCE_IDENTITY_INVALID', { platform, sourceKey });
  }
  return Object.freeze({
    platform,
    externalContentId,
    metricDate,
    sourceKey,
    metrics: Object.freeze({
      views: optionalInteger(scalar(fields.views), 'views'),
      likes: optionalInteger(scalar(fields.likes), 'likes'),
      comments: optionalInteger(scalar(fields.comments), 'comments'),
      shares: optionalInteger(scalar(fields.shares), 'shares'),
      unique_viewers: optionalInteger(scalar(fields.unique_viewers), 'unique_viewers'),
      avg_watch_time_seconds: optionalNumber(scalar(fields.avg_watch_time_seconds), 'avg_watch_time_seconds'),
      total_watch_time_seconds: optionalNumber(scalar(fields.total_watch_time_seconds), 'total_watch_time_seconds'),
      completion_rate: optionalRate(scalar(fields.completion_rate), 'completion_rate'),
    }),
  });
}

function normalizeAccountRecord(record) {
  const fields = record?.fields ?? record;
  const platform = normalizePlatform(fields.platform);
  return Object.freeze({
    platform,
    sourceAccountId: requireText(scalar(fields.account_id), 'account_id'),
    metricDate: dateOnly(scalar(fields.metric_date), 'metric_date'),
    sourceKey: requireText(scalar(fields.account_daily_key), 'account_daily_key'),
    fetchedAt: requireTimestamp(Number(scalar(fields.fetched_at)), 'fetched_at'),
    syncRunId: requireText(scalar(fields.sync_run_id), 'sync_run_id'),
    followers: optionalInteger(scalar(fields.followers), 'followers'),
    follows: optionalInteger(scalar(fields.follows), 'follows'),
    profile_views: optionalInteger(scalar(fields.profile_views), 'profile_views'),
    views: optionalInteger(scalar(fields.views), 'views'),
    reach: optionalInteger(scalar(fields.reach), 'reach'),
    accounts_engaged: optionalInteger(scalar(fields.accounts_engaged), 'accounts_engaged'),
    total_interactions: optionalInteger(scalar(fields.total_interactions), 'total_interactions'),
    net_follows: optionalSignedInteger(scalar(fields.net_follows), 'net_follows'),
  });
}

function selectSourceRows(rows, boundaries) {
  return rows.filter((row) => ALLOWED_PLATFORMS.includes(row.platform)
    && row.metricDate > boundaries.get(row.platform)
    && row.metricDate <= CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE_PERIOD_END)
    .sort(compareDailyRows);
}

function selectFacebookAccountRows(rows, boundaries) {
  const selected = rows.filter((row) => row.platform === 'facebook'
    && row.metricDate > boundaries.get('facebook')
    && row.metricDate <= CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE_PERIOD_END);
  if (selected.length !== 1 || selected[0].metricDate !== CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE_PERIOD_END) {
    throw bridgeError('Expected exactly one newer Facebook account daily row',
      'CUSTOMER_NEWER_ONLY_BRIDGE_ACCOUNT_SOURCE_INVALID', { count: selected.length });
  }
  return selected;
}

function assertExpectedSourceRows(rows) {
  const actual = groupCounts(rows);
  const expected = [];
  for (const platform of ALLOWED_PLATFORMS) {
    for (const [metricDate, count] of Object.entries(CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE_EXPECTED_ROWS[platform])) {
      expected.push({ platform, metricDate, count });
    }
  }
  if (stableJson(actual) !== stableJson(expected)) {
    throw bridgeError('Dev newer-only source counts differ from reviewed evidence',
      'CUSTOMER_NEWER_ONLY_BRIDGE_SOURCE_COUNT_DRIFT', { expected, actual });
  }
}

function indexMasterRows(rows) {
  const index = new Map();
  for (const row of rows) {
    if (!ALLOWED_PLATFORMS.includes(row.platform)) continue;
    const key = contentKey(row.platform, row.externalContentId);
    if (index.has(key)) throw bridgeError('Dev master Content contains duplicate stable identity',
      'CUSTOMER_NEWER_ONLY_BRIDGE_MASTER_DUPLICATE', { contentKey: key });
    index.set(key, row);
  }
  return index;
}

function latestRowsByContent(rows) {
  const index = new Map();
  for (const row of rows) {
    const key = contentKey(row.platform, row.externalContentId);
    const current = index.get(key);
    if (!current || row.metricDate > current.metricDate) index.set(key, row);
  }
  return index;
}

function buildObservedAtByPlatformDate(input) {
  const result = new Map();
  const accountFetchedAt = input.accountRows[0].fetchedAt;
  result.set(`facebook|${CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE_PERIOD_END}`, accountFetchedAt);
  const dates = Object.keys(CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE_EXPECTED_ROWS.tiktok).sort();
  dates.forEach((metricDate, index) => result.set(
    `tiktok|${metricDate}`,
    input.generatedAt - dates.length + index,
  ));
  return result;
}

async function buildCoverageIdentity(input) {
  const sourceWatermark = await createStableFingerprint({
    contract: 'customer-newer-only-organic-coverage-v1',
    platform: input.platform,
    metricDate: input.metricDate,
    sourceDigest: input.sourceDigest,
    rows: input.rows.map(stableDailySource),
  });
  const suffix = sourceWatermark.slice(0, 20);
  return Object.freeze({
    coverageRunId: `coverage:dev-lark-bridge:${input.platform}:${input.metricDate}:${suffix}`,
    syncRunId: `history:dev-lark-bridge:${input.platform}:${input.metricDate}:${suffix}`,
    sourceWatermark,
  });
}

async function buildSqlChunk(input) {
  const statements = [
    '-- Customer newer-only Dev Lark bridge. Append-only approved tables.',
    coverageRunInsert(input),
  ];
  for (const key of input.stateKeys) {
    statements.push(await contentStateInsert({
      master: input.masterByIdentity.get(key),
      daily: input.latestByContent.get(key),
      coverage: input.coverage,
      observedAt: input.observedAt,
      generatedAt: input.generatedAt,
    }));
  }
  for (const row of input.rows) {
    statements.push(await observationInsert({ row, coverage: input.coverage, observedAt: input.observedAt, generatedAt: input.generatedAt }));
    statements.push(coverageEntityInsert({ row, coverage: input.coverage, observedAt: input.observedAt, generatedAt: input.generatedAt }));
  }
  for (const row of input.accountRows) {
    statements.push(accountCoverageRunInsert({ row, generatedAt: input.generatedAt }));
    statements.push(accountFactInsert({ row, generatedAt: input.generatedAt }));
    statements.push(accountCoverageEntityInsert({ row, generatedAt: input.generatedAt }));
  }
  const sql = `${statements.join('\n')}\n`;
  assertInsertOnlySql(sql);
  return sql;
}

function coverageRunInsert(input) {
  const count = input.rows.length;
  const dataset = input.platform === 'facebook' ? 'facebook.content.cumulative' : 'organic_content_cumulative';
  return insert('data_coverage_runs', {
    coverage_run_id: input.coverage.coverageRunId,
    sync_run_id: input.coverage.syncRunId,
    customer_key: CUSTOMER_KEY,
    platform: input.platform,
    account_key: ACCOUNT_KEY,
    dataset_key: dataset,
    metric_semantics: 'cumulative',
    scope_mode: 'full_inventory',
    period_start: input.metricDate,
    period_end: input.metricDate,
    source_timezone: TIME_ZONE,
    status: 'complete',
    expected_entities: count,
    observed_entities: count,
    expected_rows: count,
    observed_rows: count,
    written_rows: count,
    failed_rows: 0,
    source_watermark: input.coverage.sourceWatermark,
    revisable_until: null,
    started_at: input.observedAt,
    completed_at: input.generatedAt,
    error_code: null,
    created_at: input.generatedAt,
    updated_at: input.generatedAt,
  });
}

async function contentStateInsert(input) {
  const contentMetricsHash = await metricsHash(input.daily.metrics);
  const sourceAccountId = input.master.platform === 'facebook' ? '982406442148381' : null;
  const metadata = {
    source_account_id: sourceAccountId,
    content_type: input.master.contentType,
    published_at: input.master.publishedAt,
    caption: input.master.caption,
    content_url: input.master.contentUrl,
    thumbnail_url: input.master.thumbnailUrl,
    duration_seconds: input.master.durationSeconds,
  };
  const metadataHash = await createStableFingerprint({ contract: 'organic-content-metadata-v1', ...metadata });
  return insert('organic_content_state', {
    content_key: contentKey(input.master.platform, input.master.externalContentId),
    customer_profile: 'chemistry_k',
    customer_key: CUSTOMER_KEY,
    platform: input.master.platform,
    account_key: ACCOUNT_KEY,
    source_account_id: sourceAccountId,
    external_content_id: input.master.externalContentId,
    content_type: input.master.contentType,
    published_at: input.master.publishedAt,
    first_seen_at: input.observedAt,
    last_observed_at: input.observedAt,
    last_changed_at: input.observedAt,
    source_availability_status: 'available',
    ...input.daily.metrics,
    metrics_hash: contentMetricsHash,
    metadata_hash: metadataHash,
    last_coverage_run_id: input.coverage.coverageRunId,
    last_sync_run_id: input.coverage.syncRunId,
    created_at: input.generatedAt,
    updated_at: input.generatedAt,
  });
}

async function observationInsert(input) {
  const key = contentKey(input.row.platform, input.row.externalContentId);
  const hash = await metricsHash(input.row.metrics);
  return insert('organic_content_observations', {
    observation_key: `${key}:${input.observedAt}:backfill:v1`,
    content_key: key,
    customer_key: CUSTOMER_KEY,
    platform: input.row.platform,
    account_key: ACCOUNT_KEY,
    external_content_id: input.row.externalContentId,
    observed_at: input.observedAt,
    metric_date: input.row.metricDate,
    source_timezone: TIME_ZONE,
    observation_kind: 'backfill',
    metric_semantics: 'cumulative',
    ...input.row.metrics,
    metrics_hash: hash,
    source_revision: input.row.sourceKey,
    coverage_run_id: input.coverage.coverageRunId,
    fetched_at: input.generatedAt,
    sync_run_id: input.coverage.syncRunId,
    created_at: input.generatedAt,
  });
}

function coverageEntityInsert(input) {
  return insert('data_coverage_entities', {
    coverage_entity_key: `${input.coverage.coverageRunId}:content:${input.row.externalContentId}`,
    coverage_run_id: input.coverage.coverageRunId,
    entity_type: 'content',
    external_entity_id: input.row.externalContentId,
    observation_status: 'observed',
    source_revision: input.row.sourceKey,
    observed_at: input.observedAt,
    created_at: input.generatedAt,
  });
}

function accountCoverageIdentity(row) {
  const suffix = row.sourceKey.replaceAll(/[^a-zA-Z0-9]/gu, '-').slice(-64);
  return Object.freeze({
    coverageRunId: `coverage:dev-lark-bridge:facebook:account:${suffix}`,
    syncRunId: `history:dev-lark-bridge:facebook:account:${suffix}`,
  });
}

function accountCoverageRunInsert(input) {
  const identity = accountCoverageIdentity(input.row);
  return insert('data_coverage_runs', {
    coverage_run_id: identity.coverageRunId,
    sync_run_id: identity.syncRunId,
    customer_key: CUSTOMER_KEY,
    platform: 'facebook',
    account_key: ACCOUNT_KEY,
    dataset_key: 'facebook.account.daily',
    metric_semantics: 'snapshot',
    scope_mode: 'report_range',
    period_start: input.row.metricDate,
    period_end: input.row.metricDate,
    source_timezone: TIME_ZONE,
    status: 'complete',
    expected_entities: 1,
    observed_entities: 1,
    expected_rows: 1,
    observed_rows: 1,
    written_rows: 1,
    failed_rows: 0,
    source_watermark: input.row.sourceKey,
    revisable_until: null,
    started_at: input.row.fetchedAt,
    completed_at: input.generatedAt,
    error_code: null,
    created_at: input.generatedAt,
    updated_at: input.generatedAt,
  });
}

function accountFactInsert(input) {
  const identity = accountCoverageIdentity(input.row);
  return insert('organic_account_daily_facts', {
    account_daily_key: `facebook:${ACCOUNT_KEY}:${input.row.metricDate}`,
    customer_key: CUSTOMER_KEY,
    platform: 'facebook',
    account_key: ACCOUNT_KEY,
    source_account_id: input.row.sourceAccountId,
    metric_date: input.row.metricDate,
    account_timezone: TIME_ZONE,
    followers: input.row.followers,
    follows: input.row.follows,
    profile_views: input.row.profile_views,
    views: input.row.views,
    reach: input.row.reach,
    accounts_engaged: input.row.accounts_engaged,
    total_interactions: input.row.total_interactions,
    net_follows: input.row.net_follows,
    data_status: 'complete',
    coverage_run_id: identity.coverageRunId,
    source_revision: input.row.sourceKey,
    fetched_at: input.row.fetchedAt,
    sync_run_id: identity.syncRunId,
    created_at: input.generatedAt,
    updated_at: input.generatedAt,
  });
}

function accountCoverageEntityInsert(input) {
  const identity = accountCoverageIdentity(input.row);
  const externalId = `${input.row.sourceAccountId}:${input.row.metricDate}`;
  return insert('data_coverage_entities', {
    coverage_entity_key: `${identity.coverageRunId}:account_daily:${externalId}`,
    coverage_run_id: identity.coverageRunId,
    entity_type: 'account_daily',
    external_entity_id: externalId,
    observation_status: 'observed',
    source_revision: input.row.sourceKey,
    observed_at: input.row.fetchedAt,
    created_at: input.generatedAt,
  });
}

async function metricsHash(metrics) {
  return createStableFingerprint({ contract: 'organic-cumulative-metrics-v1', ...metrics });
}

function insert(table, row) {
  const columns = Object.keys(row);
  return `INSERT OR IGNORE INTO ${table} (${columns.join(',')}) VALUES (${columns.map((column) => sqlValue(row[column])).join(',')});`;
}

function assertInsertOnlySql(sql) {
  if (/\b(?:UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|ATTACH|DETACH)\b/iu.test(sql)) {
    throw bridgeError('Generated SQL is not insert-only', 'CUSTOMER_NEWER_ONLY_BRIDGE_SQL_UNSAFE');
  }
  const tables = [...sql.matchAll(/INSERT OR IGNORE INTO\s+([a-z0-9_]+)/giu)].map((match) => match[1]);
  const allowed = new Set([
    'organic_content_state', 'organic_content_observations',
    'organic_account_daily_facts', 'data_coverage_runs', 'data_coverage_entities',
  ]);
  if (tables.length === 0 || tables.some((table) => !allowed.has(table))) {
    throw bridgeError('Generated SQL references a non-approved table', 'CUSTOMER_NEWER_ONLY_BRIDGE_SQL_UNSAFE');
  }
}

function stableDailySource(row) {
  return { platform: row.platform, externalContentId: row.externalContentId, metricDate: row.metricDate, sourceKey: row.sourceKey, metrics: row.metrics };
}

function stableAccountSource(row) {
  return { platform: row.platform, sourceAccountId: row.sourceAccountId, metricDate: row.metricDate, sourceKey: row.sourceKey, fetchedAt: row.fetchedAt };
}

function groupCounts(rows) {
  const counts = new Map();
  for (const row of rows) {
    const key = `${row.platform}|${row.metricDate}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, count]) => {
    const [platform, metricDate] = key.split('|');
    return Object.freeze({ platform, metricDate, count });
  });
}

function compareDailyRows(left, right) {
  return left.platform.localeCompare(right.platform)
    || left.metricDate.localeCompare(right.metricDate)
    || left.externalContentId.localeCompare(right.externalContentId);
}

function contentKey(platform, externalContentId) {
  return `${platform}:${ACCOUNT_KEY}:${externalContentId}`;
}

function scalar(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.length === 1 ? scalar(value[0]) : value.map(scalar).join(',');
  if (typeof value === 'object') return scalar(value.text ?? value.name ?? value.value ?? value.option ?? value.label ?? value.link ?? null);
  return String(value);
}

function dateOnly(value, fieldName) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)) return requireDate(value, fieldName);
  const number = Number(value);
  if (!Number.isFinite(number)) throw bridgeError(`${fieldName} is invalid`, 'CUSTOMER_NEWER_ONLY_BRIDGE_SOURCE_INVALID');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(number));
  return requireDate(parts, fieldName);
}

function normalizePlatform(value) {
  const platform = requireText(scalar(value), 'platform').toLowerCase();
  if (!ALLOWED_PLATFORMS.includes(platform)) return platform;
  return platform;
}

function sqlValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw bridgeError('SQL value is not finite', 'CUSTOMER_NEWER_ONLY_BRIDGE_SQL_UNSAFE');
    return String(value);
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlText(value) {
  return sqlValue(requireText(value, 'sqlText'));
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw bridgeError(`${fieldName} must be an array`, 'CUSTOMER_NEWER_ONLY_BRIDGE_INPUT_INVALID');
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw bridgeError(`${fieldName} is required`, 'CUSTOMER_NEWER_ONLY_BRIDGE_INPUT_INVALID');
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireDate(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw bridgeError(`${fieldName} must be YYYY-MM-DD`, 'CUSTOMER_NEWER_ONLY_BRIDGE_INPUT_INVALID');
  }
  return text;
}

function requireTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < Date.UTC(2020, 0, 1)) throw bridgeError(`${fieldName} is invalid`, 'CUSTOMER_NEWER_ONLY_BRIDGE_INPUT_INVALID');
  return number;
}

function optionalTimestamp(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw bridgeError(`${fieldName} is invalid`, 'CUSTOMER_NEWER_ONLY_BRIDGE_INPUT_INVALID');
  }
  return number;
}

function optionalInteger(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw bridgeError(`${fieldName} is invalid`, 'CUSTOMER_NEWER_ONLY_BRIDGE_SOURCE_INVALID');
  return number;
}

function optionalSignedInteger(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw bridgeError(`${fieldName} is invalid`, 'CUSTOMER_NEWER_ONLY_BRIDGE_SOURCE_INVALID');
  return number;
}

function optionalNumber(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw bridgeError(`${fieldName} is invalid`, 'CUSTOMER_NEWER_ONLY_BRIDGE_SOURCE_INVALID');
  return number;
}

function optionalRate(value, fieldName) {
  const number = optionalNumber(value, fieldName);
  if (number !== null && number > 1) throw bridgeError(`${fieldName} must be <= 1`, 'CUSTOMER_NEWER_ONLY_BRIDGE_SOURCE_INVALID');
  return number;
}

function hasText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function bridgeError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
