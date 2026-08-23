import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JOB_TRIGGERS, JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';
import { LARK_NOTIFICATION_RUNTIME_MODES } from '../../packages/config/src/lark-notification-runtime-config.js';
import {
  createLarkNotificationActiveJobRouter,
  selectLarkNotificationRoute,
} from '../../apps/sync-worker/src/lark-notification-active-job-router.js';

function notificationInput(env = {}, overrides = {}) {
  return {
    job: {
      body: {
        type: JOB_TYPES.LARK_NOTIFICATION_SEND,
        aiRunKey: 'notification-uat:run-1',
        trigger: JOB_TRIGGERS.LARK_NOTIFICATION_CONTROLLED_UAT,
        ...overrides,
      },
    },
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

test('controlled-UAT mode admits only the retained UAT trigger and identity class', async () => {
  const request = { marker: 'request' };
  const store = { marker: 'store' };
  const transport = { marker: 'transport' };
  let observed = null;
  const router = createLarkNotificationActiveJobRouter({
    readConfig: () => ({
      flags: { runtimeEnabled: true, sendEnabled: true, mirrorEnabled: false },
      mode: LARK_NOTIFICATION_RUNTIME_MODES.CONTROLLED_UAT,
      tables: { aiRuns: 'ai', reportSnapshots: 'snap', reportSettings: 'settings', notificationLog: null },
      customerProfile: 'chemistry_k',
      destinationKeyHash: 'a'.repeat(64),
      destinationChatName: 'Chemistry K — Marketing Alerts',
      claimLeaseMs: 60_000,
    }),
    loadRequest: async (input) => {
      assert.equal(input.aiRunKey, 'notification-uat:run-1');
      assert.equal(input.expectedCustomerProfile, 'chemistry_k');
      assert.equal(input.expectedDestinationName, 'Chemistry K — Marketing Alerts');
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

  for (const body of [
    { aiRunKey: 'runtime:executive:1d', trigger: JOB_TRIGGERS.LARK_NOTIFICATION_CONTROLLED_UAT },
    { aiRunKey: 'notification-uat:run-1', trigger: JOB_TRIGGERS.LARK_NOTIFICATION_RUNTIME },
  ]) {
    await assert.rejects(
      () => router(notificationInput({}, body)),
      (error) => error.code === 'LARK_NOTIFICATION_TRIGGER_FORBIDDEN',
    );
  }
});

test('runtime mode rejects controlled-UAT identities and admits only reviewed runtime trigger', async () => {
  let loadCount = 0;
  let deliverCount = 0;
  const router = createLarkNotificationActiveJobRouter({
    readConfig: () => ({
      flags: { runtimeEnabled: true, sendEnabled: true, mirrorEnabled: false },
      mode: LARK_NOTIFICATION_RUNTIME_MODES.RUNTIME,
      tables: { aiRuns: 'ai', reportSnapshots: 'snap', reportSettings: 'settings', notificationLog: null },
      destinationKeyHash: 'a'.repeat(64),
      claimLeaseMs: 60_000,
    }),
    loadRequest: async () => { loadCount += 1; return { marker: 'runtime-request' }; },
    deliver: async () => { deliverCount += 1; return { ok: true }; },
  });

  await assert.rejects(
    () => router(notificationInput()),
    (error) => error.code === 'LARK_NOTIFICATION_TRIGGER_FORBIDDEN',
  );
  assert.equal(loadCount, 0);
  assert.equal(deliverCount, 0);

  const input = notificationInput({}, {
    aiRunKey: 'runtime:executive:1d:2026-08-05',
    trigger: JOB_TRIGGERS.LARK_NOTIFICATION_RUNTIME,
  });
  const result = await router(input);
  assert.deepEqual(result, { ok: true });
  assert.equal(loadCount, 1);
  assert.equal(deliverCount, 1);
});

test('non-notification jobs preserve the existing Chatwoot-first fallback chain', async () => {
  const router = createLarkNotificationActiveJobRouter({ processFallback: async () => 'fallback-ok' });
  const result = await router({ job: { body: { type: JOB_TYPES.WOOCOMMERCE_COMMERCE_SYNC } } });
  assert.equal(result, 'fallback-ok');
});

test('deployed Worker default enters through the Lark notification router', () => {
  const syncWorkerSource = readFileSync('apps/sync-worker/src/sync-worker.js', 'utf8');
  const notificationRouterSource = readFileSync(
    'apps/sync-worker/src/lark-notification-active-job-router.js',
    'utf8',
  );
  assert.match(syncWorkerSource, /import \{ processJobWithLarkNotification \}/u);
  assert.match(
    syncWorkerSource,
    /dependencies\.processJob \?\? processJobWithLarkNotification/u,
  );
  assert.match(notificationRouterSource, /processJobWithChatwootEndToEnd/u);
  assert.doesNotMatch(notificationRouterSource, /processJobWithWooCommerceEndToEnd/u);
});
