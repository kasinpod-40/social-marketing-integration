import test from 'node:test';
import assert from 'node:assert/strict';
import syncWorker from '../../apps/sync-worker/src/index.js';

test('sync worker rejects unsupported job types clearly', async () => {
  const message = createMessage({ type: 'unknown.job' });
  await syncWorker.queue({ messages: [message] }, minimalEnv());

  assert.equal(message.acked, false);
  assert.equal(message.retried, true);
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
  return {
    LARK_APP_ID: 'app_id',
    LARK_APP_SECRET: 'app_secret',
    LARK_APP_TOKEN: 'app_token',
  };
}
