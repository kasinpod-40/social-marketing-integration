import assert from 'node:assert/strict';
import test from 'node:test';
import { JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';
import {
  createLarkNotificationActiveJobRouter,
  selectLarkNotificationRoute,
} from '../../apps/sync-worker/src/lark-notification-active-job-router.js';

function notificationInput(env = {}) {
  return {
    job: { body: { type: JOB_TYPES.LARK_NOTIFICATION_SEND, aiRunKey: 'run:1' } },
    message: { id: 'message:1' },
    operation: { operationId: 'operation:1' },
    env,
    getInfrastructure: () => ({
      repository: {}, syncEngine: {},
      getLarkNotificationDeliveryStore: () => ({}),
      getLarkMessageClient: () => ({}),
    }),
  };
}

test('selects only the shared Lark notification job', () => {
  assert.equal(selectLarkNotificationRoute(notificationInput()), 'lark_notification');
  assert.equal(selectLarkNotificationRoute({ job: { body: { type: 'other' } } }), 'fallback');
});

test('disabled runtime fails before Lark read, D1 claim or message transport', async () => {
  let loadCount = 0;
  let deliverCount = 0;
  const router = createLarkNotificationActiveJobRouter({
    loadRequest: async () => { loadCount += 1; },
    deliver: async () => { deliverCount += 1; },
    processFallback: async () => 'fallback',
  });
  await assert.rejects(
    () => router(notificationInput({
      MKT_NOTIFICATION_RUNTIME_ENABLED: 'false',
      MKT_NOTIFICATION_LARK_SEND_ENABLED: 'false',
    })),
    (error) => error.code === 'LARK_NOTIFICATION_RUNTIME_DISABLED',
  );
  assert.equal(loadCount, 0);
  assert.equal(deliverCount, 0);
});

test('enabled route loads exact Lark inputs and delegates to safe delivery', async () => {
  const request = { marker: 'request' };
  const store = { marker: 'store' };
  const transport = { marker: 'transport' };
  let observed = null;
  const router = createLarkNotificationActiveJobRouter({
    readConfig: () => ({
      flags: { runtimeEnabled: true, sendEnabled: true, mirrorEnabled: false },
      tables: { aiRuns: 'ai', reportSnapshots: 'snap', reportSettings: 'settings', notificationLog: null },
      destinationKeyHash: 'a'.repeat(64),
      claimLeaseMs: 60_000,
    }),
    loadRequest: async (input) => {
      assert.equal(input.aiRunKey, 'run:1');
      return request;
    },
    deliver: async (input) => { observed = input; return { ok: true }; },
  });
  const input = notificationInput();
  input.getInfrastructure = () => ({
    repository: {
      listByFieldValues() {}, prepareRows() {}, prepareExistingRecords() {}, createMany() {}, updateMany() {},
    },
    syncEngine: {},
    getLarkNotificationDeliveryStore: () => store,
    getLarkMessageClient: () => transport,
  });
  const result = await router(input);
  assert.deepEqual(result, { ok: true });
  assert.equal(observed.request, request);
  assert.equal(observed.ownerId, 'operation:1');
  assert.equal(observed.store, store);
  assert.equal(observed.transport, transport);
  assert.equal(observed.mirrorDelivery, null);
});

test('non-notification jobs preserve the existing fallback chain', async () => {
  const router = createLarkNotificationActiveJobRouter({ processFallback: async () => 'fallback-ok' });
  const result = await router({ job: { body: { type: JOB_TYPES.WOOCOMMERCE_COMMERCE_SYNC } } });
  assert.equal(result, 'fallback-ok');
});
