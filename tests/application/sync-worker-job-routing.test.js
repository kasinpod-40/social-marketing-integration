import test from 'node:test';
import assert from 'node:assert/strict';
import syncWorker, { createSyncWorker } from '../../apps/sync-worker/src/index.js';
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

test('known but unfinished connector jobs are acknowledged before runtime configuration is loaded', async () => {
  const message = createMessage({ type: 'facebook.page.organic.sync' });
  await syncWorker.queue({ queue: 'sync-main', messages: [message] }, minimalEnv());

  assert.equal(message.acked, true);
  assert.equal(message.retried, false);
});

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
