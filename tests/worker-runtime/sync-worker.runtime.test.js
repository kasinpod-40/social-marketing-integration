import { describe, expect, it, vi } from 'vitest';
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  createScheduledController,
  env,
  getQueueResult,
} from 'cloudflare:test';
import { createSyncWorker } from '../../apps/sync-worker/src/index.js';
import diagnosticsPreviewWorker from '../../apps/sync-worker/src/woocommerce-provider-diagnostics-entry.js';
import { processYouTubeOrganicEndToEndJob } from '../../apps/sync-worker/src/youtube-organic-job-router.js';
import { buildYouTubeDryRunJob } from '../../scripts/lib/youtube-dry-run-rollout-operator.js';
import { D1ReliabilityStore } from '../../packages/reliability/src/d1-reliability-store.js';
import { D1OrganicHistoryGateway } from '../../packages/connectors/src/d1-organic-history-gateway.js';
import { D1YouTubeAnalyticsDailyStore } from '../../packages/connectors/src/youtube/d1-youtube-analytics-daily-store.js';
import { D1IncrementalStateStore } from '../../packages/sync-engine/src/d1-incremental-state-store.js';
import { D1ResumableWorkStore } from '../../packages/sync-engine/src/d1-resumable-work-store.js';
import { TableSyncEngine } from '../../packages/sync-engine/src/table-sync-engine.js';
import {
  createTikTokPostLarkAuditHttpHandler,
  TIKTOK_POST_LARK_AUDIT_PATH,
} from '../../apps/sync-worker/src/tiktok-post-lark-audit-http.js';

const MAIN_QUEUE = 'social-mkt-sync-jobs';
const DLQ = 'social-mkt-sync-dlq';

function queueEnv(extra = {}) {
  return {
    MKT_MAIN_QUEUE_NAME: MAIN_QUEUE,
    MKT_DLQ_QUEUE_NAME: DLQ,
    MKT_QUEUE_RETRY_DELAY_SECONDS: '30',
    ...extra,
  };
}

function message(body, id = 'message-1', attempts = 1) {
  return { id, timestamp: new Date('2026-07-11T00:00:00.000Z'), attempts, body };
}

function activeJob() {
  return {
    schemaVersion: 1,
    type: 'tiktok.creator.native.sync',
    requestedAt: '2026-07-11T00:00:00.000Z',
  };
}

describe('Sync Worker ใน Workers runtime จริง', () => {
  it('WooCommerce diagnostics Preview Queue sentinel retries the whole batch without ack', async () => {
    const batch = createMessageBatch(MAIN_QUEUE, [
      message({ privateBusinessPayload: 'must-not-be-processed' }, 'preview-sentinel-1'),
    ]);
    const ctx = createExecutionContext();

    await diagnosticsPreviewWorker.queue(batch, {}, ctx);
    const result = await getQueueResult(batch, ctx);

    expect(result.retryBatch.retry).toBe(true);
    expect(result.explicitAcks).toEqual([]);
    expect(result.retryMessages).toEqual([]);
  });

  it('รัน YouTube dry-run ผ่าน Queue, Reliability และ D1 resumable replay จริง', async () => {
    await applyD1Migrations(env.MKT_STATE_DB, env.TEST_D1_MIGRATIONS);
    const observations = {
      providerRequests: 0,
      larkPlanningGets: 0,
      larkWrites: 0,
      warningDrains: 0,
      expiredWorkCleanups: 0,
      results: [],
    };
    const infrastructureFactory = () => createYouTubeDryRunInfrastructure(
      env.MKT_STATE_DB,
      observations,
    );
    const worker = createSyncWorker({
      createInfrastructure: infrastructureFactory,
      createOperationalStore: () => new D1ReliabilityStore({ db: env.MKT_STATE_DB }),
      async processJob(input) {
        const result = await processYouTubeOrganicEndToEndJob({
          ...input,
          dependencies: {
            createYouTubeRuntimeClients: () => createPublicYouTubeFixture(observations),
          },
        });
        observations.results.push(result);
        return result;
      },
    });
    const operationId = 'workers-runtime-youtube-dry-run';
    const job = buildYouTubeDryRunJob({
      operationId,
      originalRequestedAt: Date.parse('2026-07-27T04:00:00.000Z'),
    });
    const first = createMessageBatch(MAIN_QUEUE, [message(job, 'delivery-a')]);
    const replay = createMessageBatch(MAIN_QUEUE, [message(job, 'delivery-b')]);
    const firstContext = createExecutionContext();
    const replayContext = createExecutionContext();
    const runtimeEnv = youtubeDryRunRuntimeEnv(env);

    await worker.queue(first, runtimeEnv, firstContext);
    await worker.queue(replay, runtimeEnv, replayContext);

    expect((await getQueueResult(first, firstContext)).explicitAcks).toEqual(['delivery-a']);
    expect((await getQueueResult(replay, replayContext)).explicitAcks).toEqual(['delivery-b']);
    expect(observations.results).toHaveLength(2);
    expect(observations.results[0]).toMatchObject({
      mode: 'dry_run',
      syncRunId: `youtube-dry-run:${operationId}`,
      checkpointSaved: false,
      providerRequestCount: 3,
    });
    expect(observations.results[1]).toMatchObject({
      mode: 'already_completed',
      syncRunId: `youtube-dry-run:${operationId}`,
      checkpointSaved: false,
      providerRequestCount: 0,
    });
    expect(observations.results[1].warnings).toEqual(observations.results[0].warnings);
    expect(observations.results[1].sourceSummary)
      .toEqual(observations.results[0].sourceSummary);
    expect(observations.providerRequests).toBe(3);
    expect(observations.larkPlanningGets).toBeGreaterThan(0);
    expect(observations.larkWrites).toBe(0);
    expect(observations.warningDrains).toBe(0);
    expect(observations.expiredWorkCleanups).toBe(0);

    const counts = await readYouTubeDryRunD1Counts(env.MKT_STATE_DB, operationId);
    expect(counts.sync_run_id).toBe(`youtube-dry-run:${operationId}`);
    expect(counts.work_key).toBe(`youtube:${operationId}`);
    expect(counts.main_queue_attempts).toBe(2);
    expect(counts.work_lifecycle_status).toBe('completed');
    expect(counts.completion_dry_run).toBe(1);
    expect(counts.business_rows).toBe(0);
    expect(counts.coverage_rows).toBe(0);
    expect(counts.checkpoint_rows).toBe(0);
    expect(counts.dlq_records).toBe(0);
    expect(counts.active_locks).toBe(0);
  });

  it('TikTok Audit HTTP fallback stays sanitized and performs no Queue write', async () => {
    const send = vi.fn(async () => undefined);
    const handler = createTikTokPostLarkAuditHttpHandler({
      loadRuntimeConfig() {
        return {
          environment: 'development',
          profileKey: 'integration_workspace',
          customerKey: 'chemistry_k',
          connectors: {
            tiktok: {
              accountKey: 'chemistry_k',
              sourceHandle: 'chemistry_k',
            },
          },
        };
      },
      createInfrastructure() {
        return { repository: {} };
      },
      createAuditStore() {
        return {};
      },
      async audit() {
        throw new Error('simulated internal failure with private-token');
      },
    });
    const request = new Request(`https://example.com${TIKTOK_POST_LARK_AUDIT_PATH}`, {
      method: 'GET',
      headers: { authorization: 'Bearer operator-secret' },
    });
    const response = await handler({
      request,
      url: new URL(request.url),
      env: {
        MKT_TIKTOK_AUDIT_HTTP_ENABLED: 'true',
        MKT_CONNECTION_OPERATOR_TOKEN: 'operator-secret',
        MKT_TIKTOK_SOURCE_PAGE_SIZE: '500',
        MKT_TIKTOK_SOURCE_MAX_PAGES: '1000',
        LARK_TABLE_RAW_TIKTOK_CREATOR_VIDEOS: 'raw',
        LARK_TABLE_MKT_CONTENT: 'content',
        LARK_TABLE_MKT_CONTENT_DAILY: 'daily',
        MKT_SYNC_QUEUE: { send },
      },
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      ok: false,
      error: 'TikTok audit failed',
      code: 'TIKTOK_POST_LARK_AUDIT_FAILED',
    });
    expect(JSON.stringify(body)).not.toMatch(/simulated internal failure|private-token/iu);
    expect(send).not.toHaveBeenCalled();
  });

  it('ack งานจาก Main Queue เมื่อ use case สำเร็จ', async () => {
    const processJob = vi.fn(async () => ({ ok: true }));
    const worker = createSyncWorker({ processJob });
    const batch = createMessageBatch(MAIN_QUEUE, [message(activeJob())]);
    const ctx = createExecutionContext();

    await worker.queue(batch, queueEnv(), ctx);
    const result = await getQueueResult(batch, ctx);

    expect(processJob).toHaveBeenCalledTimes(1);
    expect(result.explicitAcks).toEqual(['message-1']);
    expect(result.retryMessages).toEqual([]);
  });

  it('DLQ persist โดยแยก Main Queue attempts ออกจาก DLQ delivery attempts', async () => {
    const processJob = vi.fn();
    const store = {
      saveDeadLetter: vi.fn(async () => true),
      saveSystemAlert: vi.fn(async () => true),
    };
    const worker = createSyncWorker({
      processJob,
      createOperationalStore: () => store,
    });
    const batch = createMessageBatch(DLQ, [message(activeJob(), 'dlq-1', 6)]);
    const ctx = createExecutionContext();

    await worker.queue(batch, queueEnv(), ctx);
    const result = await getQueueResult(batch, ctx);

    expect(processJob).not.toHaveBeenCalled();
    expect(store.saveDeadLetter).toHaveBeenCalledTimes(1);
    expect(store.saveDeadLetter.mock.calls[0][0]).toMatchObject({
      errorCode: 'QUEUE_RETRY_EXHAUSTED',
      retryCount: 0,
    });
    expect(store.saveSystemAlert).toHaveBeenCalledTimes(1);
    expect(store.saveSystemAlert.mock.calls[0][0]).toMatchObject({
      details: {
        mainQueueAttempts: 0,
        dlqDeliveryAttempts: 6,
      },
    });
    expect(result.explicitAcks).toEqual(['dlq-1']);
  });

  it('Queue ที่ไม่อยู่ใน whitelist ถูก quarantine โดยไม่ route เข้า Main handler', async () => {
    const processJob = vi.fn();
    const store = {
      saveDeadLetter: vi.fn(async () => true),
      saveSystemAlert: vi.fn(async () => true),
    };
    const worker = createSyncWorker({
      processJob,
      createOperationalStore: () => store,
    });
    const batch = createMessageBatch('unexpected-queue', [message(activeJob(), 'unknown-1')]);
    const ctx = createExecutionContext();

    await worker.queue(batch, queueEnv(), ctx);
    const result = await getQueueResult(batch, ctx);

    expect(processJob).not.toHaveBeenCalled();
    expect(store.saveDeadLetter.mock.calls[0][0].errorCode).toBe('UNKNOWN_QUEUE_ROUTING');
    expect(result.explicitAcks).toEqual(['unknown-1']);
  });


  it('รัน Active routing จริงสำหรับ metric seed ภายใน Workers runtime', async () => {
    const syncByKey = vi.fn(async (input) => ({
      created: input.rows.length,
      updated: 0,
      skipped: 0,
      duplicateInputRows: 0,
    }));
    const infrastructure = {
      repository: {
        async prepareRows(_tableId, rows) { return rows; },
        async listByFieldValues() { return []; },
        async createMany(_tableId, rows) { return { created: rows.length }; },
        async updateMany(_tableId, rows) { return { updated: rows.length }; },
      },
      syncEngine: { syncByKey },
    };
    const worker = createSyncWorker({ createInfrastructure: () => infrastructure });
    const batch = createMessageBatch(MAIN_QUEUE, [message({
      schemaVersion: 1,
      type: 'metric.definitions.seed',
      requestedAt: '2026-07-11T00:00:00.000Z',
    }, 'metric-1')]);
    const ctx = createExecutionContext();

    await worker.queue(batch, queueEnv({
      MKT_ENV: 'development',
      MKT_CUSTOMER_PROFILE: 'dev_ft_pumkin',
      LARK_TABLE_MKT_METRIC_DEFINITIONS: 'tbl_metric_definitions',
    }), ctx);
    const result = await getQueueResult(batch, ctx);

    expect(syncByKey).toHaveBeenCalledTimes(1);
    expect(syncByKey.mock.calls[0][0]).toMatchObject({
      tableId: 'tbl_metric_definitions',
      keyField: 'metric_key',
    });
    expect(result.explicitAcks).toEqual(['metric-1']);
  });

  it('Scheduled handler เป็น Producer และ enqueue TikTok watermark probe job', async () => {
    const send = vi.fn(async () => undefined);
    const worker = createSyncWorker();
    const controller = createScheduledController({
      scheduledTime: Date.parse('2026-07-11T01:00:00.000Z'),
      cron: '*/5 * * * *',
    });

    await worker.scheduled(controller, {
      MKT_ENV: 'development',
      MKT_CUSTOMER_PROFILE: 'dev_ft_pumkin',
      MKT_CONNECTOR_TIKTOK_ENABLED: 'true',
      MKT_SCHEDULE_TIKTOK_ENABLED: 'true',
      MKT_TIKTOK_SYNC_TIME: '08:00',
      MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED: 'true',
      MKT_SYNC_QUEUE: { send },
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toEqual({
      schemaVersion: 1,
      type: 'tiktok.creator.native.probe',
      trigger: 'scheduled',
      requestedAt: '2026-07-11T01:00:00.000Z',
      metricDate: '2026-07-10',
    });
    expect(send.mock.calls[1][0]).toEqual({
      schemaVersion: 1,
      type: 'system.reliability-mirror.deliver',
      trigger: 'scheduled',
      requestedAt: '2026-07-11T01:00:00.000Z',
    });
  });


  it('Primary cron queues mirror recovery even when no customer profile or connector schedule is configured', async () => {
    const send = vi.fn(async () => undefined);
    const worker = createSyncWorker();
    const controller = createScheduledController({
      scheduledTime: Date.parse('2026-07-19T00:55:00.000Z'),
      cron: '*/5 * * * *',
    });

    await worker.scheduled(controller, {
      MKT_SYNC_QUEUE: { send },
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual({
      schemaVersion: 1,
      type: 'system.reliability-mirror.deliver',
      trigger: 'scheduled',
      requestedAt: '2026-07-19T00:55:00.000Z',
    });
  });

  it('Unknown Cron ไม่ enqueue TikTok, YouTube หรือ Report', async () => {
    const send = vi.fn(async () => undefined);
    const worker = createSyncWorker();
    const controller = createScheduledController({
      scheduledTime: Date.parse('2026-07-19T00:50:00.000Z'),
      cron: '0 * * * *',
    });

    await worker.scheduled(controller, {
      MKT_ENV: 'development',
      MKT_CUSTOMER_PROFILE: 'dev_ft_pumkin',
      MKT_CONNECTOR_TIKTOK_ENABLED: 'true',
      MKT_CONNECTOR_YOUTUBE_ENABLED: 'true',
      MKT_SCHEDULE_TIKTOK_ENABLED: 'true',
      MKT_TIKTOK_SYNC_TIME: '08:10',
      MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'true',
      MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'true',
      MKT_SCHEDULE_YOUTUBE_ENABLED: 'true',
      MKT_YOUTUBE_ANALYTICS_ENABLED: 'true',
      MKT_SYNC_QUEUE: { send },
    });

    expect(send).not.toHaveBeenCalled();
  });

  it('Scheduled handler enqueue multichannel Dashboard materializations หลัง TikTok probe', async () => {
    const send = vi.fn(async () => undefined);
    const worker = createSyncWorker();
    const controller = createScheduledController({
      scheduledTime: Date.parse('2026-07-13T01:10:00.000Z'),
      cron: '*/5 * * * *',
    });

    await worker.scheduled(controller, {
      MKT_ENV: 'development',
      MKT_CUSTOMER_PROFILE: 'dev_ft_pumkin',
      MKT_CONNECTOR_TIKTOK_ENABLED: 'true',
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_TIKTOK_ENABLED: 'true',
      MKT_TIKTOK_SYNC_TIME: '08:10',
      MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED: 'true',
      MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'true',
      MKT_DAILY_REPORT_TIME: '08:10',
      MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'false',
      MKT_REPORT_D1_READ_ENABLED: 'true',
      MKT_REPORT_PRESET_MATERIALIZATION_ENABLED: 'true',
      MKT_META_REPORT_READ_ENABLED: 'true',
      MKT_WOOCOMMERCE_REPORT_READ_ENABLED: 'true',
      MKT_SYNC_QUEUE: { send },
    });

    expect(send).toHaveBeenCalledTimes(34);
    expect(send.mock.calls[0][0].type).toBe('tiktok.creator.native.probe');
    expect(send.mock.calls.slice(1, -1).map(([job]) => job.type)).toEqual(
      Array(32).fill('report.materialization.generate'),
    );
    expect(send.mock.calls.at(-1)[0].type).toBe('system.reliability-mirror.deliver');
    expect(send.mock.calls[0][0].metricDate).toBe('2026-07-12');
    expect(send.mock.calls[1][0].periodEnd).toBe('2026-07-12');
    expect(send.mock.calls[1][0].reportSettingKey).toBe(
      'integration_workspace:facebook:rolling:1d',
    );
  });

  it('Scheduled handler batches a multichannel fan-out when Queue sendBatch is available', async () => {
    const sendBatch = vi.fn(async () => undefined);
    const worker = createSyncWorker();
    const controller = createScheduledController({
      scheduledTime: Date.parse('2026-07-13T01:10:00.000Z'),
      cron: '*/5 * * * *',
    });

    await worker.scheduled(controller, {
      MKT_ENV: 'development',
      MKT_CUSTOMER_PROFILE: 'integration_workspace',
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'true',
      MKT_DAILY_REPORT_TIME: '08:10',
      MKT_REPORT_D1_READ_ENABLED: 'true',
      MKT_REPORT_PRESET_MATERIALIZATION_ENABLED: 'true',
      MKT_META_REPORT_READ_ENABLED: 'true',
      MKT_WOOCOMMERCE_REPORT_READ_ENABLED: 'true',
      MKT_SYNC_QUEUE: { sendBatch },
    });

    expect(sendBatch).toHaveBeenCalledTimes(1);
    expect(sendBatch.mock.calls[0][0]).toHaveLength(33);
    expect(sendBatch.mock.calls[0][0][0].body.type).toBe('report.materialization.generate');
    expect(sendBatch.mock.calls[0][0].at(-1).body.type).toBe('system.reliability-mirror.deliver');
  });

  it('YouTube cron enqueue เฉพาะ YouTube job พร้อมช่วง Analytics ที่ล็อกจาก Pacific day', async () => {
    const send = vi.fn(async () => undefined);
    const worker = createSyncWorker();
    const controller = createScheduledController({
      scheduledTime: Date.parse('2026-07-19T00:50:00.000Z'),
      cron: '50 0 * * *',
    });

    await worker.scheduled(controller, {
      MKT_ENV: 'development',
      MKT_CUSTOMER_PROFILE: 'dev_ft_pumkin',
      MKT_CONNECTOR_TIKTOK_ENABLED: 'false',
      MKT_CONNECTOR_YOUTUBE_ENABLED: 'true',
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_TIKTOK_ENABLED: 'true',
      MKT_SCHEDULE_YOUTUBE_ENABLED: 'true',
      MKT_YOUTUBE_ANALYTICS_ENABLED: 'true',
      MKT_YOUTUBE_ANALYTICS_TIME: '07:50',
      MKT_YOUTUBE_ANALYTICS_LOOKBACK_DAYS: '7',
      MKT_SYNC_QUEUE: { send },
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({
      schemaVersion: 1,
      type: 'youtube.channel.organic.sync',
      trigger: 'scheduled',
      syncMode: 'auto',
      metricDate: '2026-07-19',
      analyticsEnabled: true,
      analyticsStartDate: '2026-07-11',
      analyticsEndDate: '2026-07-17',
    });
  });

});

function createYouTubeDryRunInfrastructure(db, observations) {
  const reliability = new D1ReliabilityStore({ db });
  const baseWorkStore = new D1ResumableWorkStore({ db });
  const resumableWorkStore = new Proxy(baseWorkStore, {
    get(target, property) {
      if (property === 'cleanupExpiredWork') {
        return async (...args) => {
          observations.expiredWorkCleanups += 1;
          return target.cleanupExpiredWork(...args);
        };
      }
      if (property === 'listPendingWarnings') {
        return async (...args) => {
          observations.warningDrains += 1;
          return target.listPendingWarnings(...args);
        };
      }
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const repository = {
    async prepareRows(_tableId, rows) {
      observations.larkPlanningGets += 1;
      return rows;
    },
    async listByFieldValues() {
      observations.larkPlanningGets += 1;
      return [];
    },
    async createMany(_tableId, rows) {
      observations.larkWrites += rows.length;
      return { created: rows.length };
    },
    async updateMany(_tableId, rows) {
      observations.larkWrites += rows.length;
      return { updated: rows.length };
    },
  };
  const historyGateway = new D1OrganicHistoryGateway({ db });
  return {
    repository,
    syncEngine: new TableSyncEngine(),
    getReliability() {
      return { store: reliability, lockManager: reliability };
    },
    getResumableWorkStore() {
      return resumableWorkStore;
    },
    getOrganicHistoryGateway() {
      return historyGateway;
    },
    getYouTubeAnalyticsDailyStore() {
      return new D1YouTubeAnalyticsDailyStore({ db });
    },
    getIncrementalStateStore() {
      return new D1IncrementalStateStore({ db });
    },
  };
}

function createPublicYouTubeFixture(observations) {
  const requestMetrics = { publicRequests: 0 };
  const count = () => {
    requestMetrics.publicRequests += 1;
    observations.providerRequests += 1;
  };
  return {
    requestMetrics,
    ownerClient: null,
    oauthConfigured: false,
    publicClient: {
      async getChannel() {
        count();
        return {
          id: 'UC_TEST',
          snippet: { title: 'Integration fixture' },
          contentDetails: { relatedPlaylists: { uploads: 'UU_TEST' } },
          statistics: { viewCount: '10', subscriberCount: '2', videoCount: '1' },
        };
      },
      async listUploadVideoIdsPage() {
        count();
        return { videoIds: ['video_fixture'], nextPageToken: null };
      },
      async listVideos() {
        count();
        return [{
          id: 'video_fixture',
          snippet: {
            channelId: 'UC_TEST',
            title: 'Fixture video',
            description: 'Repository-only integration fixture',
            publishedAt: '2026-07-27T00:00:00Z',
          },
          contentDetails: { duration: 'PT1M' },
          statistics: { viewCount: '10', likeCount: '2', commentCount: '1' },
          status: { privacyStatus: 'public' },
        }];
      },
    },
  };
}

function youtubeDryRunRuntimeEnv(base) {
  return {
    ...base,
    MKT_MAIN_QUEUE_NAME: MAIN_QUEUE,
    MKT_DLQ_QUEUE_NAME: DLQ,
    MKT_QUEUE_RETRY_DELAY_SECONDS: '30',
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
    TIKTOK_SOURCE_HANDLE: 'chemistry_k',
    MKT_CONNECTOR_YOUTUBE_ENABLED: 'true',
    MKT_YOUTUBE_END_TO_END_ENABLED: 'true',
    MKT_TIME_SERIES_D1_WRITE_ENABLED: 'false',
    MKT_YOUTUBE_LARK_WRITE_ENABLED: 'false',
    MKT_YOUTUBE_ANALYTICS_ENABLED: 'false',
    MKT_SCHEDULE_YOUTUBE_ENABLED: 'false',
    DEFAULT_TIMEZONE: 'Asia/Bangkok',
    YOUTUBE_CHANNEL_ID: 'UC_TEST',
    LARK_TABLE_MKT_ACCOUNTS: 'tbl_accounts',
    LARK_TABLE_RAW_YOUTUBE_CHANNELS: 'tbl_raw_channels',
    LARK_TABLE_RAW_YOUTUBE_VIDEOS: 'tbl_raw_videos',
    LARK_TABLE_RAW_YOUTUBE_ANALYTICS_DAILY: 'tbl_raw_analytics',
    LARK_TABLE_MKT_CONTENT: 'tbl_content',
    LARK_TABLE_MKT_CONTENT_DAILY: 'tbl_content_daily',
    LARK_TABLE_MKT_SYNC_LOG: 'tbl_sync_log',
    LARK_TABLE_MKT_SYSTEM_ALERTS: 'tbl_system_alerts',
  };
}

async function readYouTubeDryRunD1Counts(db, operationId) {
  return db.prepare(`
    SELECT
      (SELECT sync_run_id FROM sync_runs
        WHERE sync_run_id = ?) AS sync_run_id,
      (SELECT work_key FROM sync_work_runs
        WHERE work_key = ?) AS work_key,
      (SELECT main_queue_attempts FROM queue_operation_attempts
        WHERE operation_id = ?) AS main_queue_attempts,
      (SELECT lifecycle_status FROM sync_work_runs
        WHERE work_key = ?) AS work_lifecycle_status,
      COALESCE((SELECT json_extract(completion_json, '$.dryRun')
        FROM sync_work_runs WHERE work_key = ?), 0) AS completion_dry_run,
      (
        (SELECT COUNT(*) FROM organic_content_state)
        + (SELECT COUNT(*) FROM organic_content_observations)
        + (SELECT COUNT(*) FROM organic_account_daily_facts)
      ) AS business_rows,
      (
        (SELECT COUNT(*) FROM data_coverage_runs)
        + (SELECT COUNT(*) FROM data_coverage_entities)
      ) AS coverage_rows,
      (
        (SELECT COUNT(*) FROM sync_cursors)
        + (SELECT COUNT(*) FROM source_record_states)
      ) AS checkpoint_rows,
      (SELECT COUNT(*) FROM dead_letter_operation_metadata
        WHERE operation_id = ?) AS dlq_records,
      (SELECT COUNT(*) FROM sync_locks WHERE owner_id = ?)
        AS active_locks
  `).bind(
    `youtube-dry-run:${operationId}`,
    `youtube:${operationId}`,
    operationId,
    `youtube:${operationId}`,
    `youtube:${operationId}`,
    operationId,
    `youtube-dry-run:${operationId}`,
  ).first();
}
