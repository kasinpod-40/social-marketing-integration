import {
  createContentKey,
  createCoverageEntityKey,
  createObservationKey,
  validateStorageRow,
} from '../storage/marketing-history-contract.js';
import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { dateOnlyInTimeZoneToEpochMilliseconds } from '../../../shared/src/date/date-time.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const CUSTOMER_KEY = 'chemistry_k';
const ACCOUNT_KEY = 'chemistry_k';
const TIME_ZONE = 'Asia/Bangkok';
const BATCH_SIZE = 50;
const FETCHED_AT = Date.parse('2026-09-14T09:30:00.000Z');
const YOUTUBE_ANALYTICS_START = '2005-04-23';

export const CUSTOMER_ORGANIC_HISTORY_REPAIR_SCOPE = Object.freeze({
  facebook: Object.freeze({
    sourceAccountId: '982406442148381',
    startDate: '2026-06-19',
    endDate: '2026-06-29',
    larkDestination: true,
  }),
  youtube: Object.freeze({
    sourceAccountId: 'UC1NVIjalyZhB2hqf3sl9GMA',
    startDate: '2026-06-19',
    endDate: '2026-07-27',
    // 39 days x ~835 videos exceeds the bounded MKT_Content_Daily cache by itself.
    // D1 is the durable history authority; normal Daily/retention owns the Lark cache.
    larkDestination: false,
  }),
});

export const YOUTUBE_D1_YEAR_PROGRAMME = 'youtube_d1_year_v1';
export const YOUTUBE_D1_YEAR_SCOPE = Object.freeze({
  ...CUSTOMER_ORGANIC_HISTORY_REPAIR_SCOPE.youtube,
  startDate: '2025-09-01', endDate: '2026-09-24',
});

export function resolveCustomerOrganicHistoryScope(platform, programme) {
  requirePlatform(platform);
  if (programme === undefined || programme === null) return CUSTOMER_ORGANIC_HISTORY_REPAIR_SCOPE[platform];
  if (programme !== YOUTUBE_D1_YEAR_PROGRAMME || platform !== 'youtube') {
    throw repairError('History programme is outside the approved D1-only YouTube scope',
      'CUSTOMER_ORGANIC_HISTORY_PROGRAMME_INVALID');
  }
  return YOUTUBE_D1_YEAR_SCOPE;
}

/**
 * ซ่อม Content Daily ทีละวันที่/ครั้งละไม่เกิน 50 Content จาก Provider history จริงเท่านั้น.
 * ไม่แก้ current state, ไม่ลบข้อมูล และใช้ Stable key เดิมเพื่อให้ rerun เป็น no-op.
 */
export async function repairCustomerOrganicContentHistoryBatch(input = {}) {
  const platform = requirePlatform(input.platform);
  const metricDate = requireScopedDate(platform, input.metricDate, input.programme);
  const batchIndex = nonNegativeInteger(input.batchIndex ?? 0, 'batchIndex');
  const execute = input.execute === true;
  const db = requireDb(input.db);
  const store = requireMethods(input.store, [
    'saveCoverageRun', 'saveOrganicContentObservation', 'saveCoverageEntities',
  ], 'store');
  const scope = resolveCustomerOrganicHistoryScope(platform, input.programme);
  const repository = scope.larkDestination
    ? requireMethods(input.repository, [
      'prepareRows', 'listByFieldValues', 'createMany', 'updateMany',
    ], 'repository')
    : null;
  const syncEngine = scope.larkDestination
    ? requireMethods(input.syncEngine, ['planByKey', 'executePlan'], 'syncEngine')
    : null;
  const tableId = scope.larkDestination ? requireText(input.tableId, 'tableId') : null;
  await assertNoConflictingActiveLocks(db, platform);
  let pendingCoverage = null;
  let state = await loadStateBatch(db, { platform, metricDate, batchIndex, programme: input.programme });
  if (input.programme === YOUTUBE_D1_YEAR_PROGRAMME) {
    state = await retainMissingYearStates(db, state, metricDate);
    if (state.rows.length === 0) return freezeResult({
      mode: execute ? 'execute' : 'preview', platform, metricDate, batchIndex,
      batchSize: 0, totalEligible: state.total, hasMore: state.hasMore,
      providerRows: 0, sourceMetricRows: 0, larkRequired: false,
      d1Created: 0, d1Skipped: 0, larkCreated: 0, larkSkipped: 0,
      existingDateSkipped: true,
      ...(execute ? {readback: {d1: true, lark: null, duplicateStableKeys: 0}} : {}),
    });
    const coverageId = `coverage:customer-organic-history-year-v1:${platform}:${metricDate}:batch:${batchIndex}`;
    const sealed = await readCoverage(db, coverageId);
    pendingCoverage = sealed;
    if (sealed?.completed_at !== null && sealed?.completed_at !== undefined) {
      const readback = await db.prepare('SELECT external_content_id FROM organic_content_observations WHERE coverage_run_id=?')
        .bind(coverageId).all();
      const actual = new Set((readback.results ?? readback).map(row => row.external_content_id));
      if (actual.size !== sealed.written_rows || actual.size !== state.rows.length
        || state.rows.some(row => !actual.has(row.external_content_id))) throw repairError('Sealed history readback failed',
        'CUSTOMER_ORGANIC_HISTORY_D1_READBACK_FAILED');
      return freezeResult({mode: execute ? 'execute' : 'preview', platform, metricDate, batchIndex,
        batchSize: state.rows.length, totalEligible: state.total, hasMore: state.hasMore,
        providerRows: state.rows.length, sourceMetricRows: sealed.observed_rows,
        replay: true, larkRequired: false, d1Created: 0, d1Skipped: sealed.written_rows,
        larkCreated: 0, larkSkipped: 0, sourceUnavailable: sealed.expected_rows-sealed.observed_rows,
        ...(execute ? {readback: {d1: true, lark: null, duplicateStableKeys: 0}} : {})});
    }
  }
  const metrics = platform === 'facebook'
    ? await loadFacebookMetrics(input.facebookSource, state.rows, metricDate)
    : await loadYouTubeMetrics(input.youtubeOwnerClient, state.rows, metricDate);
  if (input.programme !== YOUTUBE_D1_YEAR_PROGRAMME && state.rows.length > 0 && metrics.observed === 0) {
    throw repairError('Historical provider returned no metric rows for a non-empty D1 scope',
      'CUSTOMER_ORGANIC_HISTORY_SOURCE_METRICS_EMPTY', {
        platform, metricDate, batchIndex, scopedContent: state.rows.length,
        sourceDiagnostics: metrics.diagnostics ?? {},
      });
  }
  const rows = await buildCustomerOrganicHistoryRows({
    platform,
    metricDate,
    batchIndex,
    sourceAccountId: CUSTOMER_ORGANIC_HISTORY_REPAIR_SCOPE[platform].sourceAccountId,
    states: state.rows,
    metrics: metrics.values,
    programme: input.programme,
    fetchedAt: pendingCoverage?.started_at ?? Date.now(),
  });
  const larkPlan = scope.larkDestination
    ? await syncEngine.planByKey({
      repository,
      tableId,
      keyField: 'content_daily_key',
      rows: rows.larkRows,
    })
    : emptyLarkPlan();
  if (larkPlan.updateRows.length > 0) {
    throw repairError('Historical Lark Stable key already exists with a different payload',
      'CUSTOMER_ORGANIC_HISTORY_LARK_IDENTITY_CONFLICT', {
        platform, metricDate, batchIndex, updates: larkPlan.updateRows.length,
      });
  }

  if (!execute) {
    return freezeResult({
      mode: 'preview', platform, metricDate, batchIndex, batchSize: state.rows.length,
      totalEligible: state.total, hasMore: state.hasMore,
      providerRows: rows.larkRows.length, sourceMetricRows: metrics.observed,
      larkRequired: scope.larkDestination,
      larkCreate: larkPlan.createRows.length, larkSkip: larkPlan.skipped,
      d1Writes: 0, larkWrites: 0,
    });
  }

  const existingCoverage = await readCoverage(db, rows.coverageRun.coverage_run_id);
  if (existingCoverage?.status === 'complete') {
    await assertD1Readback(db, rows);
    if (scope.larkDestination) assertLarkReadbackPlan(larkPlan, rows.larkRows.length);
    return freezeResult({
      mode: 'execute', platform, metricDate, batchIndex, batchSize: state.rows.length,
      totalEligible: state.total, hasMore: state.hasMore, providerRows: rows.larkRows.length,
      sourceMetricRows: metrics.observed, replay: true,
      larkRequired: scope.larkDestination,
      d1Created: 0, d1Skipped: rows.observations.length,
      larkCreated: 0, larkSkipped: rows.larkRows.length,
      readback: { d1: true, lark: scope.larkDestination ? true : null, duplicateStableKeys: 0 },
    });
  }

  await assertNoConflictingActiveLocks(db, platform);
  await store.saveCoverageRun(rows.partialCoverageRun);
  let d1Created = 0;
  let d1Skipped = 0;
  for (const row of rows.observations) {
    const write = await store.saveOrganicContentObservation(row);
    if (write.status === 'created') d1Created += 1;
    else d1Skipped += 1;
  }
  await store.saveCoverageEntities(rows.coverageEntities);
  await assertD1Readback(db, rows);

  let larkWrite = { created: 0, skipped: 0 };
  if (scope.larkDestination) {
    await assertNoConflictingActiveLocks(db, platform);
    larkWrite = await syncEngine.executePlan(larkPlan);
    const readbackPlan = await syncEngine.planByKey({
      repository,
      tableId,
      keyField: 'content_daily_key',
      rows: rows.larkRows,
    });
    assertLarkReadbackPlan(readbackPlan, rows.larkRows.length);
  }
  await store.saveCoverageRun(rows.coverageRun);

  return freezeResult({
    mode: 'execute', platform, metricDate, batchIndex, batchSize: state.rows.length,
    totalEligible: state.total, hasMore: state.hasMore, providerRows: rows.larkRows.length,
    sourceMetricRows: metrics.observed, sourceUnavailable: state.rows.length-metrics.observed, replay: false,
    larkRequired: scope.larkDestination,
    d1Created, d1Skipped,
    larkCreated: larkWrite.created, larkSkipped: larkWrite.skipped,
    readback: { d1: true, lark: scope.larkDestination ? true : null, duplicateStableKeys: 0 },
  });
}

function emptyLarkPlan() {
  return Object.freeze({ createRows: Object.freeze([]), updateRows: Object.freeze([]), skipped: 0 });
}

export async function buildCustomerOrganicHistoryRows(input = {}) {
  const platform = requirePlatform(input.platform);
  const metricDate = requireScopedDate(platform, input.metricDate, input.programme);
  const batchIndex = nonNegativeInteger(input.batchIndex ?? 0, 'batchIndex');
  const sourceAccountId = requireExactSourceAccount(platform, input.sourceAccountId);
  const observedAt = dateOnlyInTimeZoneToEpochMilliseconds(metricDate, TIME_ZONE, {
    label: 'metricDate',
  });
  const year = input.programme === YOUTUBE_D1_YEAR_PROGRAMME;
  const fetchedAt = year ? input.fetchedAt ?? Date.now() : FETCHED_AT;
  const syncRunId = `${year ? 'customer-organic-history-year-v1' : 'customer-organic-history-v1'}:${platform}:${metricDate}:batch:${batchIndex}`;
  const coverageRunId = `coverage:${syncRunId}`;
  const sourceRevision = `${platform}:provider-history:${metricDate}:${year ? 'year-v1' : 'v1'}`;
  const states = requireArray(input.states, 'states');
  const metrics = input.metrics instanceof Map ? input.metrics : new Map();
  const observations = [];
  const coverageEntities = [];
  const larkRows = [];

  for (const state of states) {
    const externalContentId = requireText(state?.external_content_id, 'external_content_id');
    if (state.platform !== platform || state.account_key !== ACCOUNT_KEY
      || state.customer_key !== CUSTOMER_KEY || state.source_account_id !== sourceAccountId) {
      throw repairError('D1 Content state escaped the exact Customer identity',
        'CUSTOMER_ORGANIC_HISTORY_STATE_IDENTITY_INVALID', { platform });
    }
    const values = normalizeMetrics(metrics.get(externalContentId));
    const contentKey = createContentKey({
      platform,
      account_key: ACCOUNT_KEY,
      external_content_id: externalContentId,
    });
    const observationKey = createObservationKey({
      content_key: contentKey,
      observed_at: observedAt,
      observation_kind: 'backfill',
    });
    const metricsHash = await createStableFingerprint({
      contract: 'organic-cumulative-metrics-v1',
      ...values,
    });
    observations.push(validateStorageRow('organic_content_observations', {
      observation_key: observationKey,
      content_key: contentKey,
      customer_key: CUSTOMER_KEY,
      platform,
      account_key: ACCOUNT_KEY,
      external_content_id: externalContentId,
      observed_at: observedAt,
      metric_date: metricDate,
      source_timezone: year ? 'America/Los_Angeles' : TIME_ZONE,
      observation_kind: 'backfill',
      metric_semantics: 'cumulative',
      ...values,
      metrics_hash: metricsHash,
      source_revision: sourceRevision,
      coverage_run_id: coverageRunId,
      fetched_at: fetchedAt,
      sync_run_id: syncRunId,
      created_at: fetchedAt,
    }));
    coverageEntities.push(validateStorageRow('data_coverage_entities', {
      coverage_entity_key: createCoverageEntityKey({
        coverage_run_id: coverageRunId,
        entity_type: 'content',
        external_entity_id: externalContentId,
      }),
      coverage_run_id: coverageRunId,
      entity_type: 'content',
      external_entity_id: externalContentId,
      observation_status: year && values.views === null ? 'not_observed' : 'observed',
      source_revision: sourceRevision,
      observed_at: observedAt,
      created_at: fetchedAt,
    }));
    larkRows.push(Object.freeze({
      content_daily_key: `${platform}:${sourceAccountId}:${externalContentId}:${metricDate}`,
      metric_date: observedAt,
      platform,
      account_id: sourceAccountId,
      external_content_id: externalContentId,
      ...values,
    }));
  }

  const sourceWatermark = await createStableFingerprint({
    contract: 'customer-organic-history-backfill-v1',
    platform,
    metricDate,
    batchIndex,
    rows: observations.map((row) => ({
      observation_key: row.observation_key,
      metrics_hash: row.metrics_hash,
    })),
  });
  const baseCoverage = {
    coverage_run_id: coverageRunId,
    sync_run_id: syncRunId,
    customer_key: CUSTOMER_KEY,
    platform,
    account_key: ACCOUNT_KEY,
    dataset_key: 'organic_content_cumulative',
    metric_semantics: 'cumulative',
    scope_mode: 'report_range',
    period_start: metricDate,
    period_end: metricDate,
    source_timezone: year ? 'America/Los_Angeles' : TIME_ZONE,
    expected_entities: states.length,
    expected_rows: states.length,
    source_watermark: sourceWatermark,
    revisable_until: null,
    started_at: fetchedAt,
    created_at: fetchedAt,
  };
  const partialCoverageRun = validateStorageRow('data_coverage_runs', {
    ...baseCoverage,
    status: 'partial',
    observed_entities: 0,
    observed_rows: 0,
    written_rows: 0,
    failed_rows: 0,
    completed_at: null,
    error_code: null,
    updated_at: fetchedAt,
  });
  const coverageRun = validateStorageRow('data_coverage_runs', {
    ...baseCoverage,
    status: year && observations.some(row => row.views === null) ? 'partial' : 'complete',
    observed_entities: year ? observations.filter(row => row.views !== null).length : states.length,
    observed_rows: year ? observations.filter(row => row.views !== null).length : states.length,
    written_rows: states.length,
    failed_rows: 0,
    completed_at: fetchedAt,
    error_code: null,
    updated_at: fetchedAt,
  });
  return Object.freeze({
    observations: Object.freeze(observations),
    coverageEntities: Object.freeze(coverageEntities),
    larkRows: Object.freeze(larkRows),
    partialCoverageRun,
    coverageRun,
  });
}

async function retainMissingYearStates(db, state, metricDate) {
  if (state.rows.length === 0) return state;
  const ids = state.rows.map(row => row.external_content_id);
  const result = await db.prepare(`SELECT external_content_id, source_revision
    FROM organic_content_observations WHERE customer_key=? AND account_key=? AND platform='youtube'
    AND metric_date=? AND external_content_id IN (${ids.map(() => '?').join(',')})`)
    .bind(CUSTOMER_KEY, ACCOUNT_KEY, metricDate, ...ids).all();
  const ownRevision = `youtube:provider-history:${metricDate}:year-v1`;
  const prior = new Set((result.results ?? result).filter(row => row.source_revision !== ownRevision)
    .map(row => row.external_content_id));
  return {...state, rows: state.rows.filter(row => !prior.has(row.external_content_id))};
}

async function loadStateBatch(db, input) {
  const scope = CUSTOMER_ORGANIC_HISTORY_REPAIR_SCOPE[input.platform];
  const publicationTimeZone = input.programme === YOUTUBE_D1_YEAR_PROGRAMME ? 'America/Los_Angeles' : TIME_ZONE;
  const endExclusive = dateOnlyInTimeZoneToEpochMilliseconds(shiftDate(input.metricDate, 1), publicationTimeZone);
  const startInclusive = input.platform === 'facebook'
    ? dateOnlyInTimeZoneToEpochMilliseconds(shiftDate(input.metricDate, -29), TIME_ZONE)
    : 0;
  const bindings = [CUSTOMER_KEY, ACCOUNT_KEY, input.platform, scope.sourceAccountId,
    startInclusive, endExclusive];
  const predicate = `customer_key = ? AND account_key = ? AND platform = ?
    AND source_account_id = ? AND published_at >= ? AND published_at < ?`;
  const count = await db.prepare(`SELECT COUNT(*) AS count FROM organic_content_state WHERE ${predicate}`)
    .bind(...bindings).first();
  const total = nonNegativeInteger(Number(count?.count ?? 0), 'state count');
  const result = await db.prepare(`
    SELECT customer_key, platform, account_key, source_account_id, external_content_id, published_at
    FROM organic_content_state
    WHERE ${predicate}
    ORDER BY external_content_id ASC
    LIMIT ? OFFSET ?
  `).bind(...bindings, BATCH_SIZE, input.batchIndex * BATCH_SIZE).all();
  const rows = (Array.isArray(result) ? result : (result?.results ?? [])).map((row) => Object.freeze({ ...row }));
  return Object.freeze({ total, rows: Object.freeze(rows), hasMore: (input.batchIndex + 1) * BATCH_SIZE < total });
}

async function loadFacebookMetrics(source, states, metricDate) {
  requireMethods(source, ['fetchContentInsightsPage'], 'facebookSource');
  const metrics = new Map();
  const returnedDates = new Map();
  const returnedPeriods = new Map();
  let observed = 0;
  for (const state of states) {
    const externalContentId = requireText(state.external_content_id, 'external_content_id');
    const response = await source.fetchContentInsightsPage({
      pageId: CUSTOMER_ORGANIC_HISTORY_REPAIR_SCOPE.facebook.sourceAccountId,
      contentId: externalContentId,
      since: metricDate,
      // Graph Insights treats `until` as an exclusive boundary for day-period values.
      until: shiftDate(metricDate, 1),
    });
    const row = emptyMetrics();
    for (const insight of response?.rows ?? []) {
      const name = String(insight?.name ?? '').toLowerCase();
      const period = String(insight?.period ?? 'unknown');
      returnedPeriods.set(period, (returnedPeriods.get(period) ?? 0) + 1);
      for (const value of insight?.values ?? []) {
        const returnedDate = dateFromMetaEndTime(value?.end_time);
        if (returnedDate) returnedDates.set(returnedDate, (returnedDates.get(returnedDate) ?? 0) + 1);
      }
      if (period !== 'day') continue;
      const target = (insight?.values ?? []).find((value) => (
        dateFromMetaEndTime(value?.end_time) === metricDate
      ));
      if (!target) continue;
      if (name === 'post_media_view') row.views = nullableCount(target.value, 'facebook views');
      if (name === 'post_total_media_view_unique') {
        row.unique_viewers = nullableCount(target.value, 'facebook unique viewers');
      }
    }
    if (row.views !== null || row.unique_viewers !== null) observed += 1;
    metrics.set(externalContentId, Object.freeze(row));
  }
  return Object.freeze({
    values: metrics,
    observed,
    diagnostics: Object.freeze({
      returnedDates: Object.freeze([...returnedDates.entries()].slice(0, 10)),
      returnedPeriods: Object.freeze([...returnedPeriods.entries()].slice(0, 10)),
    }),
    get size() { return metrics.size; },
  });
}

async function loadYouTubeMetrics(ownerClient, states, metricDate) {
  requireMethods(ownerClient, ['getChannel', 'queryAnalytics'], 'youtubeOwnerClient');
  const sourceAccountId = CUSTOMER_ORGANIC_HISTORY_REPAIR_SCOPE.youtube.sourceAccountId;
  const owner = await ownerClient.getChannel({ mine: true });
  if (String(owner?.id ?? '') !== sourceAccountId) {
    throw repairError('YouTube Owner identity differs from Customer authority',
      'CUSTOMER_ORGANIC_HISTORY_YOUTUBE_IDENTITY_INVALID');
  }
  const ids = states.map((state) => requireText(state.external_content_id, 'external_content_id'));
  const values = new Map(ids.map((id) => [id, Object.freeze(emptyMetrics())]));
  if (ids.length === 0) return Object.freeze({ values, observed: 0 });
  const response = await ownerClient.queryAnalytics({
    channelId: sourceAccountId,
    startDate: YOUTUBE_ANALYTICS_START,
    endDate: metricDate,
    dimensions: 'video',
    metrics: 'views',
    filters: `video==${ids.join(',')}`,
    sort: 'video',
    maxResults: 200,
    startIndex: 1,
  });
  const headers = Array.isArray(response?.columnHeaders) ? response.columnHeaders : [];
  const videoIndex = headers.findIndex((header) => header?.name === 'video');
  const viewsIndex = headers.findIndex((header) => header?.name === 'views');
  if (videoIndex < 0 || viewsIndex < 0) {
    throw repairError('YouTube cumulative report omitted required columns',
      'CUSTOMER_ORGANIC_HISTORY_YOUTUBE_SHAPE_INVALID');
  }
  const allowed = new Set(ids);
  let observed = 0;
  for (const row of response?.rows ?? []) {
    const id = String(row?.[videoIndex] ?? '');
    if (!allowed.has(id)) {
      throw repairError('YouTube cumulative report returned an out-of-scope video',
        'CUSTOMER_ORGANIC_HISTORY_YOUTUBE_SCOPE_INVALID');
    }
    if (values.get(id)?.views !== null) {
      throw repairError('YouTube cumulative report returned a duplicate video',
        'CUSTOMER_ORGANIC_HISTORY_YOUTUBE_SCOPE_INVALID');
    }
    values.set(id, Object.freeze({ ...emptyMetrics(), views: nullableCount(row[viewsIndex], 'youtube views') }));
    observed += 1;
  }
  return Object.freeze({ values, observed });
}

async function assertD1Readback(db, rows) {
  const result = await db.prepare(`
    SELECT observation_key, metrics_hash, source_revision
    FROM organic_content_observations
    WHERE coverage_run_id = ? ORDER BY observation_key ASC
  `).bind(rows.coverageRun.coverage_run_id).all();
  const actual = Array.isArray(result) ? result : (result?.results ?? []);
  // SQLite uses binary text ordering while localeCompare can reorder mixed-case/
  // punctuation-heavy Provider IDs. Reconcile by Stable key, never by position.
  const expected = new Map(rows.observations.map((row) => [row.observation_key, row]));
  if (actual.length !== expected.size || actual.some((row) => (
    !expected.has(row.observation_key)
    || row.metrics_hash !== expected.get(row.observation_key).metrics_hash
    || row.source_revision !== expected.get(row.observation_key).source_revision
  ))) {
    throw repairError('D1 historical readback differs from the exact source projection',
      'CUSTOMER_ORGANIC_HISTORY_D1_READBACK_FAILED');
  }
  const duplicates = await db.prepare(`
    SELECT COUNT(*) AS count FROM (
      SELECT observation_key FROM organic_content_observations
      WHERE coverage_run_id = ? GROUP BY observation_key HAVING COUNT(*) > 1
    )
  `).bind(rows.coverageRun.coverage_run_id).first();
  if (Number(duplicates?.count ?? 0) !== 0) {
    throw repairError('D1 historical readback contains duplicate Stable keys',
      'CUSTOMER_ORGANIC_HISTORY_D1_DUPLICATE');
  }
}

async function readCoverage(db, coverageRunId) {
  return db.prepare('SELECT * FROM data_coverage_runs WHERE coverage_run_id = ?')
    .bind(coverageRunId).first();
}

async function assertNoConflictingActiveLocks(db, platform) {
  // Lock keys are created by the shared Reliability runner as
  // customerProfile:platform:accountKey:syncType. History repair writes only
  // the exact platform partition, so unrelated channel/report locks are not a
  // conflict and must not starve this bounded operator between cron ticks.
  const prefix = `${CUSTOMER_KEY}:${platform}:${ACCOUNT_KEY}:`;
  const row = await db.prepare(
    `SELECT COUNT(*) AS count FROM sync_locks
     WHERE expires_at > unixepoch()*1000
       AND substr(lock_key, 1, length(?)) = ?`,
  ).bind(prefix, prefix).first();
  if (Number(row?.count ?? -1) !== 0) {
    throw repairError('An active same-platform Production sync lock blocks the bounded history repair',
      'CUSTOMER_ORGANIC_HISTORY_ACTIVE_LOCK', { platform });
  }
}

function assertLarkReadbackPlan(plan, expectedRows) {
  if (plan.createRows.length !== 0 || plan.updateRows.length !== 0 || plan.skipped !== expectedRows) {
    throw repairError('Lark historical readback did not reconcile after write',
      'CUSTOMER_ORGANIC_HISTORY_LARK_READBACK_FAILED', {
        expectedRows,
        createRows: plan.createRows.length,
        updateRows: plan.updateRows.length,
        skipped: plan.skipped,
      });
  }
}

function normalizeMetrics(value) {
  const row = value && typeof value === 'object' ? value : {};
  return Object.freeze({
    views: nullableCount(row.views, 'views'),
    likes: nullableCount(row.likes, 'likes'),
    comments: nullableCount(row.comments, 'comments'),
    shares: nullableCount(row.shares, 'shares'),
    unique_viewers: nullableCount(row.unique_viewers, 'unique_viewers'),
    avg_watch_time_seconds: nullableNumber(row.avg_watch_time_seconds, 'avg_watch_time_seconds'),
    total_watch_time_seconds: nullableNumber(row.total_watch_time_seconds, 'total_watch_time_seconds'),
    completion_rate: nullableNumber(row.completion_rate, 'completion_rate'),
  });
}

function emptyMetrics() {
  return {
    views: null, likes: null, comments: null, shares: null, unique_viewers: null,
    avg_watch_time_seconds: null, total_watch_time_seconds: null, completion_rate: null,
  };
}

function requireExactSourceAccount(platform, value) {
  const text = requireText(value, 'sourceAccountId');
  if (text !== CUSTOMER_ORGANIC_HISTORY_REPAIR_SCOPE[platform].sourceAccountId) {
    throw repairError('Source account differs from Customer authority',
      'CUSTOMER_ORGANIC_HISTORY_SOURCE_IDENTITY_INVALID', { platform });
  }
  return text;
}

function requirePlatform(value) {
  const platform = requireText(value, 'platform');
  if (!Object.hasOwn(CUSTOMER_ORGANIC_HISTORY_REPAIR_SCOPE, platform)) {
    throw repairError('Historical repair platform is unsupported',
      'CUSTOMER_ORGANIC_HISTORY_PLATFORM_INVALID');
  }
  return platform;
}

function requireScopedDate(platform, value, programme) {
  const date = requireText(value, 'metricDate');
  const scope = resolveCustomerOrganicHistoryScope(platform, programme);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || date < scope.startDate || date > scope.endDate) {
    throw repairError('Historical repair date escapes the reviewed missing range',
      'CUSTOMER_ORGANIC_HISTORY_DATE_INVALID', { platform });
  }
  return date;
}

function dateFromMetaEndTime(value) {
  if (typeof value !== 'string') return null;
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return null;
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function shiftDate(value, days) {
  return new Date(Date.parse(`${value}T00:00:00.000Z`) + days * 86_400_000)
    .toISOString().slice(0, 10);
}

function nullableCount(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw repairError(`${fieldName} must be a non-negative integer`,
      'CUSTOMER_ORGANIC_HISTORY_METRIC_INVALID', { fieldName });
  }
  return number;
}

function nullableNumber(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw repairError(`${fieldName} must be a non-negative number`,
      'CUSTOMER_ORGANIC_HISTORY_METRIC_INVALID', { fieldName });
  }
  return number;
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw repairError(`${fieldName} must be a non-negative integer`,
      'CUSTOMER_ORGANIC_HISTORY_INPUT_INVALID', { fieldName });
  }
  return number;
}

function requireDb(value) {
  if (!value || typeof value.prepare !== 'function') {
    throw new TypeError('Customer Organic history repair requires db.prepare');
  }
  return value;
}

function requireMethods(value, methods, label) {
  for (const method of methods) {
    if (typeof value?.[method] !== 'function') {
      throw new TypeError(`Customer Organic history repair requires ${label}.${method}`);
    }
  }
  return value;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${fieldName} is required`);
  }
  return value.trim();
}

function freezeResult(value) {
  return Object.freeze({ ok: true, ...value });
}

function repairError(message, code, details = {}) {
  return permanentError(message, { code, details });
}
