import test from 'node:test';
import assert from 'node:assert/strict';
import syncWorker from '../../apps/sync-worker/src/index.js';

test('sync worker acknowledges unsupported job types as permanent failures', async () => {
  const message = createMessage({ type: 'unknown.job' });
  await syncWorker.queue({ messages: [message] }, minimalEnv());

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
    retry() { this.retried = true; },
  };
}

function minimalEnv() {
  return {};
}

test('all supported queue jobs require a valid runtime customer profile before infrastructure starts', async () => {
  const message = createMessage({ type: 'metric.definitions.seed' });
  await syncWorker.queue({ messages: [message] }, {
    LARK_APP_ID: 'would-not-be-used',
    LARK_APP_SECRET: 'would-not-be-used',
    LARK_APP_TOKEN: 'would-not-be-used',
  });

  assert.equal(message.acked, true);
  assert.equal(message.retried, false);
});

test('sync worker parses JSON string bodies and still acknowledges unsupported jobs', async () => {
  const message = createMessage(JSON.stringify({ type: 'unknown.job' }));
  await syncWorker.queue({ messages: [message] }, minimalEnv());

  assert.equal(message.acked, true);
  assert.equal(message.retried, false);
});

test('sync worker acknowledges malformed queue bodies as permanent failures without aborting the batch', async () => {
  const malformed = createMessage('{bad json');
  malformed.id = 'bad';
  const next = createMessage({ type: 'unknown.job' });
  next.id = 'next';

  await syncWorker.queue({ messages: [malformed, next] }, minimalEnv());

  assert.equal(malformed.acked, true);
  assert.equal(malformed.retried, false);
  assert.equal(next.acked, true);
});

test('known but unfinished connector jobs are acknowledged before runtime configuration is loaded', async () => {
  const message = createMessage({ type: 'facebook.page.organic.sync' });
  await syncWorker.queue({ messages: [message] }, minimalEnv());

  assert.equal(message.acked, true);
  assert.equal(message.retried, false);
});

test('disabled active connector jobs are acknowledged before Lark credentials are required', async () => {
  const message = createMessage({ type: 'tiktok.creator.native.sync' });
  await syncWorker.queue({ messages: [message] }, {
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

  await syncWorker.queue({ messages: [unsupported, next] }, minimalEnv());

  assert.equal(unsupported.acked, true);
  assert.equal(unsupported.retried, false);
  assert.equal(next.acked, true);
});
