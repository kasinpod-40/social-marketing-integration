import { JOB_TYPES, JOB_TRIGGERS, assertJobImplemented, getJobDefinition } from '../../../packages/application/src/jobs/job-catalog.js';
import { assertConnectorRunnable, CONNECTOR_RUN_MODES } from '../../../packages/application/src/connectors/connector-registry.js';
import { resolveQueueOperation, withQueueOperation } from '../../../packages/application/src/jobs/queue-operation.js';
import { buildTikTokAdsDailyPlan, runTikTokAdsDailyWork } from '../../../packages/application/src/tiktok-ads/run-tiktok-ads-daily-work.js';
import { proveTikTokAdsDailyGrains } from '../../../packages/application/src/tiktok-ads/prove-tiktok-ads-daily-grains.js';
import { runTikTokAdsMasterSync } from '../../../packages/application/src/tiktok-ads/run-tiktok-ads-master-sync.js';
import { runTikTokAdsDailyD1Sync } from '../../../packages/application/src/tiktok-ads/run-tiktok-ads-daily-d1-sync.js';
import { projectTikTokAdsDailyLark } from '../../../packages/application/src/tiktok-ads/project-tiktok-ads-daily-lark.js';
import { projectTikTokAdsCampaignSummary } from '../../../packages/application/src/tiktok-ads/project-tiktok-ads-campaign-summary.js';
import { buildDashboardPresetJob } from '../../../packages/application/src/reports/dashboard-report-request.js';
import { createDashboardReportSettingKey } from '../../../packages/config/src/report-settings.seed.js';
import { readLarkTableIdsFromEnv } from '../../../packages/config/src/lark-table-config.js';
import { D1ReliabilityStore } from '../../../packages/reliability/src/d1-reliability-store.js';
import { permanentError, transientError } from '../../../packages/shared/src/errors/runtime-error.js';
import { loadTikTokAdsRuntimeSource } from './tiktok-ads-authorized-source.js';

export const TIKTOK_ADS_DAILY_REQUIRED_FLAGS = Object.freeze([
  'MKT_CONNECTOR_TIKTOK_ADS_ENABLED', 'MKT_TIKTOK_ADS_MASTER_WRITE_ENABLED',
  'MKT_TIKTOK_ADS_D1_WRITE_ENABLED', 'MKT_TIKTOK_ADS_MULTI_GRAIN_WRITE_ENABLED',
  'MKT_TIKTOK_ADS_CORE_METRIC_WRITE_ENABLED', 'MKT_TIKTOK_ADS_LARK_WRITE_ENABLED',
  'MKT_TIKTOK_ADS_AD_LARK_WRITE_ENABLED', 'MKT_TIKTOK_ADS_SUMMARY_WRITE_ENABLED',
  'MKT_TIKTOK_ADS_REPORT_WRITE_ENABLED',
]);

/** Queue ใช้ credential boundary เดิมโดยไม่สร้าง HTTP request หรือส่ง Token ใน payload */
export async function processTikTokAdsDailyJob(input, dependencies = {}) {
  const body = input.job.body;
  const definition = assertJobImplemented(getJobDefinition(body.type));
  if (body.schemaVersion !== 1 || ![JOB_TRIGGERS.PRODUCTION_CONNECTOR_UAT, JOB_TRIGGERS.META_ORGANIC_SCHEDULED].includes(body.trigger)
    || TIKTOK_ADS_DAILY_REQUIRED_FLAGS.some(flag => input.env[flag] !== 'true')) {
    throw permanentError('TikTok daily job gate or schema is invalid', { code: 'TIKTOK_ADS_DAILY_JOB_DISABLED' });
  }
  const runtime = input.getRuntimeConfig();
  assertConnectorRunnable(runtime, definition.connectorKey, { runMode: body.trigger === JOB_TRIGGERS.PRODUCTION_CONNECTOR_UAT
    ? CONNECTOR_RUN_MODES.CONTROLLED_PRODUCTION_UAT : CONNECTOR_RUN_MODES.STANDARD });
  const source = await (dependencies.loadSource ?? loadTikTokAdsRuntimeSource)({ env: input.env });
  if (source.status !== 200) throw permanentError('Validated TikTok advertiser is required', { code: 'TIKTOK_ADS_DAILY_CONNECTION_UNAVAILABLE' });
  const plan = buildTikTokAdsDailyPlan({ periodEnd: body.periodEnd, timezone: source.connection.providerMetadata?.timezone });
  const operation = resolveQueueOperation(input);
  const infrastructure = input.getInfrastructure();
  const common = { db: input.env.MKT_STATE_DB, customerKey: runtime.customerKey, accountKey: runtime.connectors.tiktok_ads.accountKey,
    advertiserId: source.connection.externalAccountId, accessToken: source.accessToken,
    currency: source.connection.providerMetadata?.currency, timezone: source.connection.providerMetadata?.timezone,
    historyStore: infrastructure.getMarketingHistoryStore(), lockStore: new D1ReliabilityStore({ db: input.env.MKT_STATE_DB }),
    execute: true, writeEnabled: true };
  try {
    return await runTikTokAdsDailyWork({ operation, plan, jobType: JOB_TYPES.TIKTOK_ADS_DAILY_SYNC,
      accountKey: common.accountKey, periodEnd: body.periodEnd, unitIndex: body.unitIndex,
      store: infrastructure.getResumableWorkStore(),
      enqueueContinuation: async unitIndex => {
        if (typeof input.env.MKT_SYNC_QUEUE?.send !== 'function') throw transientError('Daily continuation Queue unavailable', { code: 'TIKTOK_ADS_DAILY_QUEUE_UNAVAILABLE' });
        await input.env.MKT_SYNC_QUEUE.send(withQueueOperation({ ...body, unitIndex }, operation));
      },
      runUnit: async (unit, assertCurrent) => {
        await assertCurrent();
        if (unit.kind === 'proof') {
          const proof = await (dependencies.prove ?? proveTikTokAdsDailyGrains)({ ...common, client: source.client, date: unit.date, coreMetrics: true });
          if (!proof.identityReconciled || Object.keys(proof.totalsMatch ?? {}).length !== 7
            || !Object.values(proof.totalsMatch).every(value => value === true)) {
            throw transientError('TikTok daily grain totals do not reconcile', { code: 'TIKTOK_ADS_DAILY_CORE_PARITY_FAILED' });
          }
          return;
        }
        if (unit.kind === 'd1') return (dependencies.daily ?? runTikTokAdsDailyD1Sync)({ ...common, client: source.client,
          date: unit.date, grain: unit.grain, allStatuses: true, coreMetrics: true,
          businessWriteEnabled: true, multiGrainWriteEnabled: true, coreMetricWriteEnabled: true,
          syncRunId: `${operation.workKey}:${unit.grain}:${unit.date}` });
        if (unit.kind === 'report') {
          const report = buildDashboardPresetJob({ trigger: JOB_TRIGGERS.DASHBOARD_SCHEDULED, requestedAt: operation.originalRequestedAt,
            windowDays: unit.days, periodEnd: unit.date, timeZone: common.timezone, platformScope: 'tiktok_ads',
            reportSettingKey: createDashboardReportSettingKey({ profileKey: runtime.profileKey, platformScope: 'tiktok_ads', windowDays: unit.days }) });
          const result = await dependencies.processReport({ ...input, job: { schemaVersion: 1, body: report } });
          if (result?.lark?.readback?.reconciled !== true) throw transientError('TikTok Report readback incomplete', { code: 'TIKTOK_ADS_DAILY_REPORT_READBACK_FAILED' });
          return;
        }
        const client = infrastructure.getLarkBitableClient();
        const lark = { ...common, client, repository: infrastructure.repository, syncEngine: infrastructure.syncEngine };
        if (unit.kind === 'master') return (dependencies.master ?? runTikTokAdsMasterSync)({ ...lark, client: source.client, larkClient: client,
          tables: readLarkTableIdsFromEnv(input.env, ['mktAdsAccounts','mktAdsCampaigns','mktAdsAdGroups','mktAdsAds','mktAdsCreatives']) });
        if (unit.kind === 'lark') return (dependencies.project ?? projectTikTokAdsDailyLark)({ ...lark, date: unit.date,
          grain: unit.grain, adWriteEnabled: true, tables: readLarkTableIdsFromEnv(input.env, ['mktAdsCampaigns','mktAdsDaily']) });
        return (dependencies.summary ?? projectTikTokAdsCampaignSummary)({ ...lark, month: unit.month,
          tables: readLarkTableIdsFromEnv(input.env, ['mktAdsCampaignSummary']) });
      },
    });
  } catch (error) {
    if (error.code === 'MKT_ADS_DAILY_RETENTION_ACTIVE_LOCK') throw transientError('TikTok daily unit waits for active maintenance', { code: error.code });
    throw error;
  }
}
