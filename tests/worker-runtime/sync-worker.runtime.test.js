import { describe, expect, it, vi } from 'vitest';
import {
  createExecutionContext,
  createMessageBatch,
  createScheduledController,
  getQueueResult,
} from 'cloudflare:test';
import { createSyncWorker } from '../../apps/sync-worker/src/index.js';

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

  it('DLQ หลัง retry exhaustion ถูก persist อย่างเดียวและไม่ execute งานเดิมซ้ำ', async () => {
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
      retryCount: 6,
    });
    expect(store.saveSystemAlert).toHaveBeenCalledTimes(1);
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

  it('Scheduled handler เป็น Producer และ enqueue TikTok Sync job', async () => {
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
      MKT_SYNC_QUEUE: { send },
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toMatchObject({
      schemaVersion: 1,
      type: 'tiktok.creator.native.sync',
      trigger: 'scheduled',
      syncMode: 'auto',
      requestedAt: '2026-07-11T01:00:00.000Z',
      metricDate: '2026-07-11',
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
      MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'true',
      MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'true',
      MKT_SCHEDULE_YOUTUBE_ENABLED: 'true',
      MKT_YOUTUBE_ANALYTICS_ENABLED: 'true',
      MKT_SYNC_QUEUE: { send },
    });

    expect(send).not.toHaveBeenCalled();
  });

  it('Scheduled handler enqueue Daily report หลัง TikTok sync เมื่อถึงเวลา Bangkok', async () => {
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
      MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'true',
      MKT_DAILY_REPORT_TIME: '08:10',
      MKT_DAILY_REPORT_SETTING_KEY: 'dev_ft_pumkin:tiktok:daily',
      MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'false',
      MKT_SYNC_QUEUE: { send },
    });

    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.map(([job]) => job.type)).toEqual([
      'tiktok.creator.native.sync',
      'report.daily.generate',
      'system.reliability-mirror.deliver',
    ]);
    expect(send.mock.calls[0][0].metricDate).toBe('2026-07-13');
    expect(send.mock.calls[1][0].periodEnd).toBe('2026-07-12');
  });

  it('YouTube cron enqueue เฉพาะ YouTube job พร้อมช่วง Analytics ที่ล็อกจาก Pacific day', async () => {
    const send = vi.fn(async () => undefined);
    const worker = createSyncWorker();
    const controller = createScheduledController({
      scheduledTime: Date.parse('2026-07-19T00:50:00.000Z'),
      cron: '50 0,6,12,18 * * *',
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
