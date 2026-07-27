import {
  createAccountDailyKey,
  validateStorageRow,
} from './marketing-history-contract.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const PLATFORM = 'youtube';
const DATASET_KEY = 'organic_account_snapshot';

export async function writeYouTubeAccountSnapshot(input) {
  if (input.rawChannelRows.length !== 1) {
    throw permanentError('YouTube account snapshot requires exactly one Channel row', {
      code: 'YOUTUBE_CHANNEL_IDENTITY_MISMATCH',
      details: { channelRows: input.rawChannelRows.length },
    });
  }
  const raw = input.rawChannelRows[0];
  const coverageBase = {
    coverage_run_id: input.ids.accountCoverageRunId,
    sync_run_id: input.ids.historySyncRunId,
    customer_key: input.context.customerKey,
    platform: PLATFORM,
    account_key: input.context.accountKey,
    dataset_key: DATASET_KEY,
    metric_semantics: 'snapshot',
    scope_mode: 'exact_entities',
    period_start: input.context.metricDate,
    period_end: input.context.metricDate,
    source_timezone: input.context.sourceTimezone,
    expected_entities: 1,
    expected_rows: 1,
    source_watermark: input.ids.sourceWatermark,
    revisable_until: null,
    started_at: input.context.observedAt,
    created_at: input.context.observedAt,
  };
  const coverageStart = await beginAccountCoverage(input, coverageBase);

  const fact = validateStorageRow('organic_account_daily_facts', {
    account_daily_key: createAccountDailyKey({
      platform: PLATFORM,
      account_key: input.context.accountKey,
      metric_date: input.context.metricDate,
    }),
    customer_key: input.context.customerKey,
    platform: PLATFORM,
    account_key: input.context.accountKey,
    source_account_id: requireText(raw.channel_id, 'channel_id'),
    metric_date: input.context.metricDate,
    account_timezone: input.context.sourceTimezone,
    followers: raw.subscriber_count_hidden === true
      ? null
      : nullableNonNegativeInteger(raw.subscriber_count),
    follows: null,
    profile_views: null,
    views: nullableNonNegativeInteger(raw.view_count),
    reach: null,
    accounts_engaged: null,
    total_interactions: null,
    net_follows: null,
    data_status: 'complete',
    coverage_run_id: input.ids.accountCoverageRunId,
    source_revision: input.ids.sourceWatermark,
    fetched_at: input.context.fetchedAt,
    sync_run_id: input.ids.historySyncRunId,
    created_at: input.context.observedAt,
    updated_at: input.context.observedAt,
  });

  try {
    await assertLockActive(input.context);
    const write = await input.context.store.upsertOrganicAccountDailyFact(fact);
    await assertLockActive(input.context);
    await saveCoverage(input.context.store, coverageBase, {
      status: 'complete',
      observed_entities: 1,
      observed_rows: 1,
      written_rows: 1,
      failed_rows: 0,
      completed_at: input.context.observedAt,
      error_code: null,
    }, input.context.observedAt);
    return Object.freeze({
      ...write,
      hiddenSubscriberCount: raw.subscriber_count_hidden === true,
      coverageReplay: coverageStart.replay,
    });
  } catch (error) {
    if (!coverageStart.replay) {
      await saveCoverage(input.context.store, coverageBase, {
        status: 'partial',
        observed_entities: 0,
        observed_rows: 0,
        written_rows: 0,
        failed_rows: 1,
        completed_at: input.context.observedAt,
        error_code: error?.code ?? 'YOUTUBE_ACCOUNT_SNAPSHOT_WRITE_FAILED',
      }, input.context.observedAt);
    }
    throw error;
  }
}

async function beginAccountCoverage(input, coverageBase) {
  const existing = await input.context.gateway.readCoverageRun(input.ids.accountCoverageRunId);
  if (existing?.status === 'complete') {
    const same = existing.dataset_key === DATASET_KEY
      && existing.platform === PLATFORM
      && existing.account_key === input.context.accountKey
      && Number(existing.expected_entities) === 1
      && Number(existing.expected_rows) === 1
      && normalizeSqlText(existing.source_watermark) === input.ids.sourceWatermark;
    if (!same) {
      throw permanentError('Completed YouTube account Coverage identity was reused for different evidence', {
        code: 'YOUTUBE_ACCOUNT_COVERAGE_IDENTITY_CONFLICT',
        details: { coverageRunId: input.ids.accountCoverageRunId },
      });
    }
    return Object.freeze({ replay: true, row: existing });
  }

  await saveCoverage(input.context.store, coverageBase, {
    status: 'partial',
    observed_entities: 0,
    observed_rows: 0,
    written_rows: 0,
    failed_rows: 0,
    completed_at: null,
    error_code: null,
  }, input.context.observedAt);
  return Object.freeze({ replay: false, row: null });
}

function saveCoverage(store, base, result, updatedAt) {
  return store.saveCoverageRun(validateStorageRow('data_coverage_runs', {
    ...base,
    ...result,
    updated_at: updatedAt,
  }));
}

async function assertLockActive(context) {
  if (typeof context.assertLockActive === 'function') {
    await context.assertLockActive();
  }
}

function nullableNonNegativeInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw permanentError('YouTube account metric must be a non-negative safe integer', {
      code: 'YOUTUBE_ACCOUNT_METRIC_INVALID',
    });
  }
  return number;
}

function normalizeSqlText(value) {
  return value === null || value === undefined || value === '' ? null : String(value);
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`YouTube account snapshot requires ${fieldName}`);
  }
  return value.trim();
}
