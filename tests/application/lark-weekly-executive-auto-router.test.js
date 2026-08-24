import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createLarkNotificationActiveJobRouter,
  selectLarkNotificationRoute,
} from '../../apps/sync-worker/src/lark-notification-active-job-router.js';

function activeConfig(overrides = {}) {
  return {
    flags: { runtimeEnabled: true, sendEnabled: true, mirrorEnabled: true },
    mode: 'runtime',
    tables: { aiRuns: 'tbl_ai', notificationLog: 'tbl_log' },
    destinationKeyHash: 'a'.repeat(64),
    claimLeaseMs: 60_000,
    ...overrides,
  };
}

test('automatic Weekly payload is routed to the Fresh-AI orchestrator, not direct send', async () => {
  const calls = [];
  const router = createLarkNotificationActiveJobRouter({
    readConfig: () => activeConfig(),
    processAutomaticWeekly: async (input) => {
      calls.push(input);
      return { ok: true, status: 'notification_queued' };
    },
    loadRequest: async () => { throw new Error('direct delivery loader must not run'); },
    deliver: async () => { throw new Error('direct delivery must not run'); },
  });
  const jobInput = {
    env: {},
    job: {
      body: {
        type: 'lark.notification.send',
        trigger: 'lark_notification_runtime',
        automaticWeekly: true,
        scheduleCadence: 'weekly',
        periodEnd: '2026-08-16',
      },
    },
  };

  assert.equal(selectLarkNotificationRoute(jobInput), 'lark_weekly_executive_auto');
  const result = await router(jobInput);
  assert.equal(result.status, 'notification_queued');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].config.mode, 'runtime');
});

test('automatic Weekly payload requires full runtime/send/mirror activation', async () => {
  const router = createLarkNotificationActiveJobRouter({
    readConfig: () => activeConfig({
      flags: { runtimeEnabled: true, sendEnabled: true, mirrorEnabled: false },
    }),
    processAutomaticWeekly: async () => ({ ok: true }),
  });
  await assert.rejects(() => router({
    env: {},
    job: {
      body: {
        type: 'lark.notification.send',
        trigger: 'lark_notification_runtime',
        automaticWeekly: true,
      },
    },
  }), (error) => error?.code === 'LARK_NOTIFICATION_RUNTIME_DISABLED');
});

test('ordinary runtime notification keeps the existing direct delivery route', () => {
  assert.equal(selectLarkNotificationRoute({
    job: { body: { type: 'lark.notification.send', aiRunKey: 'notification-weekly-7d:x' } },
  }), 'lark_notification');
  assert.equal(selectLarkNotificationRoute({
    job: { body: { type: 'report.materialization.generate' } },
  }), 'fallback');
});

test('ordinary runtime notification passes the explicit Bitable client to destination loading', async () => {
  const client = { requestBitableJson: async () => ({ data: { items: [] } }) };
  let loadedInput = null;
  const router = createLarkNotificationActiveJobRouter({
    readConfig: () => activeConfig({
      flags: { runtimeEnabled: true, sendEnabled: true, mirrorEnabled: false },
    }),
    loadRequest: async (input) => {
      loadedInput = input;
      return { aiRun: {}, settings: {}, snapshot: {} };
    },
    deliver: async () => ({ ok: true }),
  });
  await router({
    env: {},
    operation: { operationId: 'weekly-send-test' },
    job: {
      body: {
        type: 'lark.notification.send',
        trigger: 'lark_notification_runtime',
        aiRunKey: 'weekly:test',
      },
    },
    getInfrastructure: () => ({
      repository: {},
      getLarkBitableClient: () => client,
      getLarkNotificationDeliveryStore: () => ({}),
      getLarkMessageClient: () => ({}),
    }),
  });
  assert.equal(loadedInput.client, client);
});
