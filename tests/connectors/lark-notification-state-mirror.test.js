import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createLarkNotificationStateMirror,
} from '../../packages/connectors/src/lark/lark-notification-state-mirror.js';

function repository() {
  return {
    async listByFieldValues() { return []; },
    async prepareRows() { return []; },
    async prepareExistingRecords() { return []; },
    async createMany() { return { created: 0 }; },
    async updateMany() { return { updated: 0 }; },
  };
}

test('converts Report date-only periods to Bangkok Lark DateTime values before mirror planning', async () => {
  const plans = [];
  const syncEngine = {
    async planByKey(input) {
      plans.push(input);
      return Object.freeze({ role: plans.length === 1 ? 'log' : 'ai' });
    },
    async executePlan() {
      return Object.freeze({ created: 0, updated: 0, skipped: 1 });
    },
  };
  const mirror = createLarkNotificationStateMirror({
    repository: repository(),
    syncEngine,
    notificationLogTableId: 'notification-log',
    aiRunsTableId: 'ai-runs',
  });

  await mirror({
    notification_attempt_key: 'notification-uat:key::dedupe',
    ai_run_key: 'notification-uat:key',
    dedupe_key: 'a'.repeat(64),
    destination_key_hash: 'b'.repeat(64),
    window_days: '1',
    period_start: '2026-08-03',
    period_end: '2026-08-03',
    severity: 'warning',
    payload_checksum: 'c'.repeat(64),
    attempt_status: 'sent',
    attempted_at: 1_785_700_000_000,
    sent_at: 1_785_700_001_000,
    failure_code: null,
    redacted_failure_message: null,
    preview_mode: false,
  });

  assert.equal(plans.length, 2);
  assert.equal(plans[0].tableId, 'notification-log');
  assert.equal(plans[0].rows[0].period_start, Date.parse('2026-08-03T00:00:00+07:00'));
  assert.equal(plans[0].rows[0].period_end, Date.parse('2026-08-03T00:00:00+07:00'));
  assert.equal(plans[1].tableId, 'ai-runs');
  assert.deepEqual(plans[1].rows, [{
    ai_run_key: 'notification-uat:key',
    sent_to_group: true,
    sent_at: 1_785_700_001_000,
  }]);
});
