import test from 'node:test';
import assert from 'node:assert/strict';
import syncWorker, { createSyncWorker, processJob } from '../../apps/sync-worker/src/index.js';
import { JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';
import {
  CUSTOMER_WEEKLY_NOTIFICATION_SETTINGS_ACTIVATION_VERSION,
} from '../../packages/application/src/use-cases/seed-report-settings.js';
import {
  markReliabilityHandled,
  permanentError,
} from '../../packages/shared/src/errors/runtime-error.js';

test('sync worker acknowledges unsupported job types as permanent failures', async () => {
  const message = createMessage({ type: 'unknown.job' });
  await syncWorker.queue({ queue: 'sync-main', messages: [message] }, minimalEnv());

  assert.equal(message.acked, true);
  assert.equal(message.retried, false);
});

function createMessage(body) {
  return {
    id: 'msg_1',
    body,
    acked: false,
    retried: false,
    ack() { this.acked = true; },
    retry(options) { this.retried = true; this.retryOptions = options ?? null; },
  };
}

function minimalEnv() {
  return {
    MKT_MAIN_QUEUE_NAME: 'sync-main',
    MKT_DLQ_QUEUE_NAME: 'sync-dlq',
    MKT_STATE_DB: createFakeD1(),
    MKT_SYNC_QUEUE: { async send() {} },
  };
}

test('all supported queue jobs require a valid runtime customer profile before infrastructure starts', async () => {
  const message = createMessage({ type: 'metric.definitions.seed' });
  await syncWorker.queue({ queue: 'sync-main', messages: [message] }, {
    ...minimalEnv(),
    LARK_APP_ID: 'would-not-be-used',
    LARK_APP_SECRET: 'would-not-be-used',
    LARK_APP_TOKEN: 'would-not-be-used',
  });

  assert.equal(message.acked, true);
  assert.equal(message.retried, false);
});

test('controlled Customer Weekly Notification settings activation updates only eight 7D stable keys', async () => {
  let rows;
  const result = await processJob({
    job: {
      body: {
        type: JOB_TYPES.REPORT_SETTINGS_SEED,
        trigger: 'lark_notification_runtime',
        notificationRuntimeActivation: true,
        activationVersion: CUSTOMER_WEEKLY_NOTIFICATION_SETTINGS_ACTIVATION_VERSION,
      },
    },
    env: {
      MKT_ENV: 'production',
      MKT_CUSTOMER_PROFILE: 'chemistry_k',
      MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'true',
      MKT_SCHEDULE_WEEKLY_NOTIFICATION_ENABLED: 'true',
      MKT_REPORT_D1_READ_ENABLED: 'true',
      MKT_REPORT_PRESET_MATERIALIZATION_ENABLED: 'true',
      MKT_NOTIFICATION_RUNTIME_ENABLED: 'true',
      MKT_NOTIFICATION_LARK_SEND_ENABLED: 'true',
      MKT_NOTIFICATION_LARK_MIRROR_ENABLED: 'true',
      MKT_NOTIFICATION_RUNTIME_MODE: 'runtime',
      MKT_NOTIFICATION_DESTINATION_KEY_HASH: 'a'.repeat(64),
      MKT_NOTIFICATION_DESTINATION_CHAT_NAME: 'Chemistry K — Marketing Alerts',
      LARK_TABLE_MKT_REPORT_SETTINGS: 'tbl-settings',
      LARK_TABLE_MKT_REPORT_SNAPSHOTS: 'tbl-snapshots',
      LARK_TABLE_MKT_AI_REPORT_RUNS: 'tbl-ai',
      LARK_TABLE_MKT_NOTIFICATION_LOG: 'tbl-notification',
    },
    getRuntimeConfig() {
      return {
        environment: 'production',
        profileKey: 'chemistry_k',
        customerKey: 'chemistry_k',
        infrastructureOwner: 'customer',
      };
    },
    getInfrastructure() {
      return {
        repository: {
          async prepareRows(_tableId, inputRows) { return inputRows; },
          async listByFieldValues() { return []; },
          async createMany() { return { created: 0 }; },
          async updateMany() { return { updated: 0 }; },
        },
        syncEngine: {
          async syncByKey(input) {
            rows = input.rows;
            return { created: 0, updated: input.rows.length, skipped: 0 };
          },
        },
      };
    },
  });

  assert.equal(result.updated, 8);
  assert.equal(rows.length, 8);
  assert.equal(rows.every((row) => row.window_days === 7), true);
  assert.equal(rows.every((row) => row.ai_enabled && row.notification_enabled), true);
  assert.equal(rows.every((row) => row.group_id === null), true);
});

test('sync worker parses JSON string bodies and still acknowledges unsupported jobs', async () => {
  const message = createMessage(JSON.stringify({ type: 'unknown.job' }));
  await syncWorker.queue({ queue: 'sync-main', messages: [message] }, minimalEnv());

  assert.equal(message.acked, true);
  assert.equal(message.retried, false);
});

test('sync worker acknowledges malformed queue bodies as permanent failures without aborting the batch', async () => {
  const malformed = createMessage('{bad json');
  malformed.id = 'bad';
  const next = createMessage({ type: 'unknown.job' });
  next.id = 'next';

  await syncWorker.queue({ queue: 'sync-main', messages: [malformed, next] }, minimalEnv());

  assert.equal(malformed.acked, true);
  assert.equal(malformed.retried, false);
  assert.equal(next.acked, true);
});

for (const jobType of [
  JOB_TYPES.FACEBOOK_ORGANIC_SYNC,
  JOB_TYPES.GOOGLE_ADS_MANAGER_SIGNED_DELIVERY_PROCESS,
]) {
  test(`${jobType} is acknowledged as unfinished before runtime configuration loads`, async () => {
    const message = createMessage({ type: jobType });
    await syncWorker.queue({ queue: 'sync-main', messages: [message] }, minimalEnv());

    assert.equal(message.acked, true);
    assert.equal(message.retried, false);
  });
}

test('disabled active connector jobs are acknowledged before Lark credentials are required', async () => {
  const message = createMessage({ type: 'tiktok.creator.native.sync' });
  await syncWorker.queue({ queue: 'sync-main', messages: [message] }, {
    ...minimalEnv(),
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'dev_ft_pumkin',
    MKT_CONNECTOR_TIKTOK_ENABLED: 'false',
  });

  assert.equal(message.acked, true);
  assert.equal(message.retried, false);
});

test('unsupported queue schema versions are permanent failures and do not abort the batch', async () => {
  const unsupported = createMessage({ schemaVersion: 99, type: 'metric.definitions.seed' });
  const next = createMessage({ type: 'unknown.job' });

  await syncWorker.queue({ queue: 'sync-main', messages: [unsupported, next] }, minimalEnv());

  assert.equal(unsupported.acked, true);
  assert.equal(unsupported.retried, false);
  assert.equal(next.acked, true);
});


test('dead-letter consumer persists the message and acknowledges it even when Lark mirror config is absent', async () => {
  const message = createMessage({ type: 'tiktok.creator.native.sync' });
  message.id = 'dlq-message';
  message.attempts = 6;
  const db = createFakeD1();

  await syncWorker.queue({ queue: 'sync-dlq', messages: [message] }, {
    ...minimalEnv(),
    MKT_STATE_DB: db,
  });

  assert.equal(message.acked, true);
  assert.equal(message.retried, false);
  assert.ok(db.calls.some((call) => /lifecycle_status = 'terminal'/u.test(call.sql)));
  assert.ok(db.calls.some((call) => /INSERT INTO dead_letter_jobs/u.test(call.sql)));
  assert.ok(db.calls.some((call) => /INSERT INTO system_alerts/u.test(call.sql)));
});

test('permanent YouTube failure marks resumable work terminal before acknowledgement', async () => {
  const message = createMessage({
    type: 'youtube.channel.organic.sync',
    requestedAt: '2026-07-19T00:00:00.000Z',
  });
  message.id = 'youtube-permanent';
  const db = createFakeD1();
  const worker = createSyncWorker({
    processJob: async () => {
      throw permanentError('Synthetic permanent YouTube failure', {
        code: 'YOUTUBE_PERMANENT_API_ERROR',
      });
    },
    createOperationalStore: () => ({
      async saveDeadLetter() { return true; },
      async saveSystemAlert() { return true; },
    }),
  });

  await worker.queue({ queue: 'sync-main', messages: [message] }, {
    ...minimalEnv(),
    MKT_STATE_DB: db,
  });

  assert.equal(message.acked, true);
  const terminal = db.calls.find((call) => /lifecycle_status = 'terminal'/u.test(call.sql));
  assert.ok(terminal);
  assert.ok(terminal.bindings.includes('QUEUE_PERMANENT_FAILURE'));
});

test('reliability-handled permanent YouTube failure still marks resumable work terminal', async () => {
  const message = createMessage({
    type: 'youtube.channel.organic.sync',
    requestedAt: '2026-07-19T00:00:00.000Z',
  });
  message.id = 'youtube-handled-permanent';
  const db = createFakeD1();
  const worker = createSyncWorker({
    processJob: async () => {
      throw markReliabilityHandled(permanentError('Synthetic handled failure', {
        code: 'YOUTUBE_ANALYTICS_ROW_SCOPE_MISMATCH',
      }), 'run-handled');
    },
  });

  await worker.queue({ queue: 'sync-main', messages: [message] }, {
    ...minimalEnv(),
    MKT_STATE_DB: db,
  });

  assert.equal(message.acked, true);
  assert.ok(db.calls.some((call) => (
    /lifecycle_status = 'terminal'/u.test(call.sql)
    && call.bindings.includes('QUEUE_PERMANENT_FAILURE')
  )));
  const deadLetter = db.calls.find((call) => /INSERT INTO dead_letter_jobs/u.test(call.sql));
  assert.ok(deadLetter);
  assert.match(deadLetter.bindings[5], /youtube\.channel\.organic\.sync/u);
  assert.equal(deadLetter.bindings[7], 'YOUTUBE_ANALYTICS_ROW_SCOPE_MISMATCH');
});

for (const input of [
  {
    type: JOB_TYPES.TIKTOK_CREATOR_NATIVE_SYNC,
    trigger: 'production_connector_uat',
    operationId: 'tiktok-prod-terminal-test',
    workKey: 'tiktok:tiktok-prod-terminal-test',
  },
  {
    type: JOB_TYPES.FACEBOOK_ORGANIC_SYNC,
    operationId: 'facebook-daily-terminal-test',
    workKey: 'facebook:facebook-daily-terminal-test',
  },
  {
    type: JOB_TYPES.INSTAGRAM_ORGANIC_SYNC,
    operationId: 'instagram-daily-terminal-test',
    workKey: 'instagram:instagram-daily-terminal-test',
  },
  {
    type: JOB_TYPES.META_ADS_SYNC,
    operationId: 'meta-ads-daily-terminal-test',
    workKey: 'meta_ads:chemistry_k:meta-ads-daily-terminal-test',
    sourceAccountKey: 'chemistry_k',
  },
  {
    type: JOB_TYPES.GOOGLE_ADS_MANAGER_SIGNED_DELIVERY_PROCESS,
    operationId: 'google-ads-daily-terminal-test',
    workKey: 'google_ads:google-ads-daily-terminal-test',
  },
  {
    type: JOB_TYPES.WOOCOMMERCE_COMMERCE_SYNC,
    operationId: 'woocommerce-daily-terminal-test',
    workKey: 'woocommerce:woocommerce-daily-terminal-test',
  },
]) {
  test(`permanent ${input.type} failure marks its exact resumable work terminal`, async () => {
    const originalRequestedAt = Date.parse('2026-08-10T00:00:00.000Z');
    const message = createMessage({
      ...input,
      requestedAt: new Date(originalRequestedAt).toISOString(),
      originalRequestedAt,
      generation: originalRequestedAt,
    });
    message.id = `${input.operationId}-message`;
    const db = createFakeD1();
    const worker = createSyncWorker({
      processJob: async () => {
        throw permanentError('Synthetic permanent connector failure', {
          code: 'SYNTHETIC_PERMANENT_CONNECTOR_FAILURE',
        });
      },
      createOperationalStore: () => ({
        async saveDeadLetter() { return true; },
        async saveSystemAlert() { return true; },
      }),
    });

    await worker.queue({ queue: 'sync-main', messages: [message] }, {
      ...minimalEnv(),
      MKT_STATE_DB: db,
    });

    assert.equal(message.acked, true);
    assert.equal(message.retried, false);
    const terminal = db.calls.find((call) => /lifecycle_status = 'terminal'/u.test(call.sql));
    assert.ok(terminal);
    assert.ok(terminal.bindings.includes(input.workKey));
    assert.ok(terminal.bindings.includes('QUEUE_PERMANENT_FAILURE'));
  });
}



test('reliability mirror delivery routes before customer runtime and exposes safe counters only', async () => {
  let runtimeConfigCalls = 0;
  const delivered = [];
  const result = await processJob({
    job: {
      body: { type: 'system.reliability-mirror.deliver' },
      schemaVersion: 1,
    },
    message: { id: 'mirror-drain', attempts: 1 },
    env: {
      LARK_TABLE_MKT_SYNC_LOG: 'tbl-sync',
      LARK_TABLE_MKT_SYSTEM_ALERTS: 'tbl-alert',
      MKT_RELIABILITY_MIRROR_BATCH_SIZE: '10',
    },
    getRuntimeConfig() { runtimeConfigCalls += 1; throw new Error('must not load customer runtime'); },
    getInfrastructure() {
      return {
        getReliabilityMirrorOutbox() {
          return {
            async listPending({ limit }) {
              assert.equal(limit, 10);
              return [{ outboxId: 'internal-id', revision: 1, method: 'saveSyncRun', payload: { syncId: 'run-1' } }];
            },
            async markDelivered({ outboxId, revision }) {
              assert.equal(revision, 1);
              delivered.push(outboxId);
              return { delivered: true };
            },
            async markDeliveryFailed() {},
            async markPermanentFailed() {},
          };
        },
        getLarkReliabilityStore(tableIds) {
          assert.deepEqual(tableIds, { mktSyncLog: 'tbl-sync', mktSystemAlerts: 'tbl-alert' });
          return {
            async saveSyncRun() {},
            async saveSystemAlert() {},
          };
        },
      };
    },
  });

  assert.equal(runtimeConfigCalls, 0);
  assert.deepEqual(delivered, ['internal-id']);
  assert.deepEqual(result, {
    status: 'drained',
    pendingRead: 1,
    delivered: 1,
    failedPermanent: 0,
    superseded: 0,
    remainingUnknown: false,
    deferred: false,
    errorCode: null,
  });
  assert.equal(JSON.stringify(result).includes('run-1'), false);
});


test('empty reliability mirror drain stays lazy and does not require Lark table configuration', async () => {
  let larkStoreCalls = 0;
  const result = await processJob({
    job: {
      body: { type: 'system.reliability-mirror.deliver' },
      schemaVersion: 1,
    },
    message: { id: 'mirror-empty', attempts: 1 },
    env: {},
    getRuntimeConfig() { throw new Error('must not load customer runtime'); },
    getInfrastructure() {
      return {
        getReliabilityMirrorOutbox() {
          return {
            async listPending() { return []; },
            async markDelivered() {},
            async markDeliveryFailed() {},
            async markPermanentFailed() {},
          };
        },
        getLarkReliabilityStore() {
          larkStoreCalls += 1;
          throw new Error('must stay lazy');
        },
      };
    },
  });

  assert.equal(larkStoreCalls, 0);
  assert.equal(result.status, 'drained');
  assert.equal(result.pendingRead, 0);
});

test('mirror delivery reaching DLQ persists D1 dead letter without recursively creating a mirrored alert', async () => {
  const message = createMessage({ type: 'system.reliability-mirror.deliver' });
  message.id = 'mirror-dlq';
  message.attempts = 6;
  const db = createFakeD1();

  await syncWorker.queue({ queue: 'sync-dlq', messages: [message] }, {
    ...minimalEnv(),
    MKT_STATE_DB: db,
  });

  assert.equal(message.acked, true);
  assert.ok(db.calls.some((call) => /INSERT INTO dead_letter_jobs/u.test(call.sql)));
  assert.equal(db.calls.some((call) => /INSERT INTO system_alerts/u.test(call.sql)), false);
});

test('redrive admin job executes before customer/Lark runtime loading and uses a new requestedAt generation', async () => {
  const sent = [];
  const requestedAt = Date.parse('2026-07-19T00:00:00.000Z');
  const row = {
    dlq_id: 'dlq:message-old',
    message_id: 'message-old',
    queue_name: 'sync-main',
    job_type: 'youtube.channel.organic.sync',
    schema_version: 1,
    payload_json: JSON.stringify({ type: 'youtube.channel.organic.sync' }),
    replay_payload_json: JSON.stringify({
      schemaVersion: 1,
      type: 'youtube.channel.organic.sync',
      requestedAt: '2026-07-18T00:00:00.000Z',
      metricDate: '2026-07-18',
      syncMode: 'auto',
    }),
    error_code: 'YOUTUBE_ANALYTICS_ROW_SCOPE_MISMATCH',
    retry_count: 0,
    status: 'redrive_pending',
    redrive_requested_at: requestedAt,
    redrive_reference: 'redrive:dlq:message-old:1784419200000',
    redriven_at: null,
  };
  const db = {
    prepare(sql) {
      return {
        bind() { return this; },
        async run() { return { meta: { changes: 1 } }; },
        async first() { return row; },
      };
    },
  };

  const result = await processJob({
    job: {
      body: { type: 'system.dead-letter.redrive', dlqId: row.dlq_id },
      schemaVersion: 1,
    },
    message: { id: 'redrive-command', attempts: 1 },
    env: {
      MKT_DLQ_REDRIVE_ENABLED: 'true',
      MKT_STATE_DB: db,
      MKT_SYNC_QUEUE: { async send(body) { sent.push(body); } },
    },
    getRuntimeConfig() { throw new Error('must not load customer runtime'); },
    getInfrastructure() { throw new Error('must not create Lark infrastructure'); },
  });

  assert.equal(result.status, 'redriven');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].requestedAt, new Date(requestedAt).toISOString());
  assert.equal(sent[0].redriveOfDlqId, row.dlq_id);
});

test('dead-letter persistence failure retries with a safe default when retry delay config is invalid', async () => {
  const message = createMessage({ type: 'tiktok.creator.native.sync' });
  const db = createFakeD1({ fail: true });

  await syncWorker.queue({ queue: 'sync-dlq', messages: [message] }, {
    ...minimalEnv(),
    MKT_QUEUE_RETRY_DELAY_SECONDS: 'not-a-number',
    MKT_STATE_DB: db,
  });

  assert.equal(message.acked, false);
  assert.equal(message.retried, true);
  assert.deepEqual(message.retryOptions, { delaySeconds: 30 });
});

function createFakeD1(input = {}) {
  const calls = [];
  return {
    calls,
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
    prepare(sql) {
      const call = { sql: String(sql), bindings: [] };
      calls.push(call);
      return {
        bind(...values) { call.bindings = values; return this; },
        async run() {
          if (input.fail) throw new Error('D1 unavailable');
          return { meta: { changes: 1 } };
        },
        async all() {
          if (input.fail) throw new Error('D1 unavailable');
          return { results: [] };
        },
        async first() {
          if (input.fail) throw new Error('D1 unavailable');
          if (/FROM system_alerts/u.test(call.sql)) {
            const insert = [...calls].reverse().find((candidate) => /INSERT INTO system_alerts/u.test(candidate.sql));
            if (!insert) return null;
            const values = insert.bindings;
            return {
              alert_id: values[0],
              sync_run_id: values[1],
              alert_type: values[2],
              severity: values[3],
              platform: values[4],
              status: values[5],
              message: values[6],
              error_code: values[7],
              created_at: values[9],
            };
          }
          return null;
        },
      };
    },
  };
}

test('permanent failure is retried instead of acknowledged when D1 source of truth is unavailable', async () => {
  const message = createMessage({ type: 'unknown.job' });

  await syncWorker.queue({ queue: 'sync-main', messages: [message] }, {
    ...minimalEnv(),
    MKT_STATE_DB: createFakeD1({ fail: true }),
  });

  assert.equal(message.acked, false);
  assert.equal(message.retried, true);
  assert.deepEqual(message.retryOptions, { delaySeconds: 30 });
});

test('sync worker structured logs redact external identity from failures', async () => {
  const message = createMessage({ type: 'youtube.channel.organic.sync' });
  const logs = [];
  const originalLog = console.log;
  const worker = createSyncWorker({
    processJob: async () => {
      throw permanentError(
        'YouTube channel identity mismatch: expected=channel_A, actual=channel_B',
        {
          code: 'YOUTUBE_CHANNEL_IDENTITY_MISMATCH',
          details: { requestedChannelId: 'channel_A', mismatchedVideos: ['video_A'] },
        },
      );
    },
    createOperationalStore: () => ({
      async saveDeadLetter() { return true; },
      async saveSystemAlert() { return true; },
    }),
  });

  console.log = (value) => logs.push(String(value));
  try {
    await worker.queue({ queue: 'sync-main', messages: [message] }, minimalEnv());
  } finally {
    console.log = originalLog;
  }

  const output = logs.join('\n');
  assert.equal(message.acked, true);
  assert.match(output, /Source identity validation failed/u);
  assert.doesNotMatch(output, /channel_A|channel_B|video_A/u);
});

test('sync worker structured success logs keep counts but redact reconciliation identities', async () => {
  const message = createMessage({ type: 'youtube.channel.organic.sync' });
  const logs = [];
  const originalLog = console.log;
  const worker = createSyncWorker({
    processJob: async () => ({
      platform: 'youtube',
      source: 'youtube_data_api',
      reconciliation: {
        required: true,
        missingVideoIds: ['video_A'],
        missingAnalyticsStableKeys: ['youtube:channel_A:video_A:2026-07-14'],
      },
      sourceSummary: { playlistVideoIds: 1, missingVideos: 1, missingAnalyticsRows: 1 },
    }),
  });

  console.log = (value) => logs.push(String(value));
  try {
    await worker.queue({ queue: 'sync-main', messages: [message] }, minimalEnv());
  } finally {
    console.log = originalLog;
  }

  const output = logs.join('\n');
  assert.equal(message.acked, true);
  assert.match(output, /\[REDACTED\]/u);
  assert.match(output, /"playlistVideoIds":1/u);
  assert.doesNotMatch(output, /channel_A|video_A/u);
});
