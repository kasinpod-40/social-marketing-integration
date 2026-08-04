import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLarkExecutiveNotificationSafeDeliveryPreview,
  validateLarkExecutiveNotificationSafeDeliveryPreview,
} from '../../packages/application/src/notifications/build-lark-executive-notification-safe-delivery-preview.js';

test('safe delivery preview closes the Base Automation dedupe blocker in repository architecture', () => {
  const preview = buildLarkExecutiveNotificationSafeDeliveryPreview();
  assert.equal(preview.ok, true);
  assert.equal(preview.contractVersion, 'lark_executive_notification_safe_delivery_v1');
  assert.equal(preview.status, 'repository_safe_delivery_ready_remote_rollout_blocked');
  assert.equal(preview.repositoryImplementationComplete, true);
  assert.equal(preview.baseAutomationDedupeBlockerResolvedByArchitecture, true);
  assert.equal(preview.notificationDeliveryAuthority, 'd1_atomic_claim_and_shared_queue');
  assert.equal(preview.blockerCount, 0);
  assert.deepEqual(preview.blockers, []);
  assert.equal(validateLarkExecutiveNotificationSafeDeliveryPreview(preview).length, 0);
});

test('preview locks exact-send and unknown-outcome policies', () => {
  const preview = buildLarkExecutiveNotificationSafeDeliveryPreview();
  assert.equal(
    preview.contract.d1Authority.atomicClaim,
    'INSERT_ON_CONFLICT_WHERE_EXPIRED_CLAIMED_ONLY',
  );
  assert.deepEqual(preview.contract.d1Authority.reclaimableStatuses, ['claimed']);
  assert.deepEqual(preview.contract.d1Authority.nonReclaimableStatuses, [
    'sending', 'sent', 'blocked', 'blocked_unknown',
  ]);
  assert.equal(
    preview.contract.d1Authority.unknownOutcomePolicy,
    'blocked_unknown_no_automatic_resend',
  );
  assert.equal(
    preview.contract.d1Authority.sentReplayPolicy,
    'dedupe_without_send_and_repair_mirror_only',
  );
});

test('preview keeps both Base Automations inactive and every live flag false', () => {
  const preview = buildLarkExecutiveNotificationSafeDeliveryPreview();
  assert.equal(preview.contract.larkBaseAutomation.aiMaterialization, 'inactive_configured');
  assert.equal(preview.contract.larkBaseAutomation.notificationAutomation, 'inactive_placeholder');
  assert.equal(preview.contract.larkBaseAutomation.notificationAutomationUsedForDelivery, false);
  assert.deepEqual(preview.contract.runtimeFlags, {
    MKT_NOTIFICATION_RUNTIME_ENABLED: false,
    MKT_NOTIFICATION_LARK_SEND_ENABLED: false,
    MKT_NOTIFICATION_LARK_MIRROR_ENABLED: false,
  });
  assert.equal(preview.safety.remoteLarkWrite, 0);
  assert.equal(preview.safety.remoteD1Write, 0);
  assert.equal(preview.safety.queueSend, 0);
  assert.equal(preview.safety.notificationSend, 0);
  assert.equal(preview.safety.scheduleEnabled, false);
  assert.equal(preview.safety.production, 'BLOCKED');
});
