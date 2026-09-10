import { JOB_TYPES } from '../../../packages/application/src/jobs/job-catalog.js';
import {
  MKT_ADS_DAILY_MAX_DELETE_ROWS,
  MKT_ADS_DAILY_RETENTION_DAYS,
  MKT_ADS_DAILY_SOFT_LIMIT,
  MKT_ADS_DAILY_TARGET_LIMIT,
  runMktAdsPostSyncMaintenance,
} from '../../../packages/application/src/use-cases/mkt-ads-post-sync-maintenance.js';
import { redriveDeadLetterJob } from '../../../packages/application/src/use-cases/redrive-dead-letter-job.js';
import { readLarkTableIdsFromEnv } from '../../../packages/config/src/lark-table-config.js';
import { D1GoogleAdsLiveRedriveStore } from '../../../packages/connectors/src/google-ads/d1-google-ads-live-redrive-store.js';
import { D1ReliabilityStore } from '../../../packages/reliability/src/d1-reliability-store.js';
import { permanentError } from '../../../packages/shared/src/errors/runtime-error.js';
import { D1ResumableWorkStore } from '../../../packages/sync-engine/src/queue-terminal-safe-d1-resumable-work-store.js';
import { processGoogleAdsManualUatJob } from './google-ads-job-router.js';
import { processJobWithMetaEndToEnd } from './meta-active-job-router.js';
import { readBoolean, readPositiveInteger, requireJobText } from './worker-runtime-support.js';

const ADS_MAINTENANCE_TERMINAL_STATUSES = new Set(['completed', 'completed_idempotent']);

/** Route Google Ads signed-delivery and exact redrive before the generic chain. */
export async function processJobWithGoogleAdsUat(input) {
  const type = input.job?.body?.type;
  if (type === JOB_TYPES.GOOGLE_ADS_MANAGER_SIGNED_DELIVERY_PROCESS) {
    const result = await processGoogleAdsManualUatJob(input);
    return attachAdsMaintenance(input, result, 'google_ads');
  }
  if (type === JOB_TYPES.DEAD_LETTER_REDRIVE) {
    if (!readBoolean(input.env?.MKT_DLQ_REDRIVE_ENABLED, false)) {
      throw permanentError('Dead-letter redrive is disabled for this environment', {
        code: 'MKT_DLQ_REDRIVE_DISABLED',
      });
    }
    return redriveDeadLetterJob({
      store: new D1ReliabilityStore({ db: input.env?.MKT_STATE_DB }),
      createGoogleAdsRedriveStore: () => new D1GoogleAdsLiveRedriveStore({
        db: input.env?.MKT_STATE_DB,
      }),
      createStableOperationRedriveStore: () => new D1ResumableWorkStore({
        db: input.env?.MKT_STATE_DB,
      }),
      queue: requireQueue(input.env),
      dlqId: requireJobText(input.job.body?.dlqId, 'dlqId'),
    });
  }
  const result = await processJobWithMetaEndToEnd(input);
  if (type === JOB_TYPES.META_ADS_SYNC) return attachAdsMaintenance(input, result, 'meta_ads');
  return result;
}

async function attachAdsMaintenance(input, result, platform) {
  const summaryEnabled = readBoolean(input.env?.MKT_ADS_CAMPAIGN_SUMMARY_ENABLED, false);
  const retentionEnabled = readBoolean(input.env?.MKT_ADS_DAILY_RETENTION_ENABLED, false);
  if (!summaryEnabled && !retentionEnabled) return result;
  if (!ADS_MAINTENANCE_TERMINAL_STATUSES.has(result?.status)) return result;
  if (input.job?.body?.dryRun === true || input.job?.body?.d1Only === true) return result;
  if (Array.isArray(input.job?.body?.larkTableKeys)) return result;

  const paidWritesEnabled = platform === 'meta_ads'
    ? readBoolean(input.env?.MKT_META_D1_WRITE_ENABLED, false)
      && readBoolean(input.env?.MKT_META_LARK_WRITE_ENABLED, false)
    : readBoolean(input.env?.MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED, false)
      && readBoolean(input.env?.MKT_GOOGLE_ADS_LARK_WRITE_ENABLED, false);
  if (!paidWritesEnabled) return result;

  const requiredTableKeys = [];
  if (summaryEnabled) requiredTableKeys.push('mktAdsCampaignSummary');
  if (retentionEnabled) requiredTableKeys.push('mktAdsDaily');
  const tables = readLarkTableIdsFromEnv(input.env, requiredTableKeys);
  const infrastructure = input.getInfrastructure();
  const runtimeConfig = input.getRuntimeConfig();
  const adsMaintenance = await runMktAdsPostSyncMaintenance({
    summaryEnabled,
    retentionEnabled,
    db: infrastructure.getStateDb(),
    client: infrastructure.getLarkBitableClient(),
    repository: infrastructure.repository,
    syncEngine: infrastructure.syncEngine,
    customerKey: runtimeConfig.customerKey,
    timezone: input.env?.DEFAULT_TIMEZONE ?? 'Asia/Bangkok',
    retentionDays: readPositiveInteger(
      input.env?.MKT_ADS_DAILY_RETENTION_DAYS,
      MKT_ADS_DAILY_RETENTION_DAYS,
    ),
    softLimit: readPositiveInteger(
      input.env?.MKT_ADS_DAILY_SOFT_LIMIT,
      MKT_ADS_DAILY_SOFT_LIMIT,
    ),
    targetLimit: readPositiveInteger(
      input.env?.MKT_ADS_DAILY_TARGET_LIMIT,
      MKT_ADS_DAILY_TARGET_LIMIT,
    ),
    maxDeleteRows: readPositiveInteger(
      input.env?.MKT_ADS_DAILY_MAX_DELETE_ROWS,
      MKT_ADS_DAILY_MAX_DELETE_ROWS,
    ),
    tables,
  });
  return Object.freeze({ ...result, adsMaintenance });
}

function requireQueue(env) {
  const queue = env?.MKT_SYNC_QUEUE;
  if (typeof queue?.send !== 'function') {
    throw permanentError('Dead-letter redrive Queue binding is unavailable', {
      code: 'MKT_SYNC_QUEUE_REQUIRED',
    });
  }
  return queue;
}
