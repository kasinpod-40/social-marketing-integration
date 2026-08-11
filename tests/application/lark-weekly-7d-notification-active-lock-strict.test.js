import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeLarkWeekly7dNotificationAdmissionReadback,
} from '../../scripts/lib/lark-weekly-7d-notification-admission.js';

function row(overrides = {}) {
  return {
    notification_table_count: 1,
    notification_index_count: 3,
    active_locks: 0,
    total_delivery_rows: 2,
    sent_mirrored_rows: 2,
    unsafe_delivery_rows: 0,
    unrelated_unsafe_delivery_rows: 0,
    controlled_uat_rows: 1,
    controlled_uat_sent_mirrored_rows: 1,
    runtime_smoke_rows: 1,
    runtime_smoke_sent_mirrored_rows: 1,
    admission_delivery_rows: 0,
    admission_delivery_status: null,
    admission_mirror_status: null,
    admission_claim_count: null,
    admission_sent_at: null,
    admission_message_id_hash: null,
    ...overrides,
  };
}

test('strict Weekly admission readback still rejects any non-expired active lock', () => {
  assert.throws(
    () => normalizeLarkWeekly7dNotificationAdmissionReadback(row({ active_locks: 1 })),
    (error) => error?.code === 'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_REMOTE_STATE_INVALID'
      && Array.isArray(error?.details?.invalid)
      && error.details.invalid.length === 1
      && error.details.invalid[0] === 'activeLocks',
  );
});

test('strict Weekly admission readback accepts the same terminal baseline after locks reach zero', () => {
  const normalized = normalizeLarkWeekly7dNotificationAdmissionReadback(row());
  assert.equal(normalized.activeLocks, 0);
  assert.equal(normalized.totalDeliveryRows, 2);
  assert.equal(normalized.sentMirroredRows, 2);
});
