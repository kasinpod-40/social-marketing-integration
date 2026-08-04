import { LARK_EXECUTIVE_DESTINATION_KEY_HASH } from './lark-notification-runtime-config.js';

export const LARK_EXECUTIVE_NOTIFICATION_SAFE_DELIVERY_VERSION =
  'lark_executive_notification_safe_delivery_v1';
export const LARK_EXECUTIVE_NOTIFICATION_SAFE_DELIVERY_STATUS =
  'repository_safe_delivery_ready_remote_rollout_blocked';
export const LARK_EXECUTIVE_NOTIFICATION_GROUP_NAME = 'Social MKT Executive Reports';
export const LARK_EXECUTIVE_NOTIFICATION_JOB_TYPE = 'lark.notification.send';
export const LARK_EXECUTIVE_NOTIFICATION_MIGRATION = '0019_lark_notification_delivery.sql';

export const LARK_EXECUTIVE_NOTIFICATION_SAFE_DELIVERY_CONTRACT = deepFreeze({
  version: LARK_EXECUTIVE_NOTIFICATION_SAFE_DELIVERY_VERSION,
  status: LARK_EXECUTIVE_NOTIFICATION_SAFE_DELIVERY_STATUS,
  architecture: Object.freeze([
    'Lark AI Run exact read',
    'Lark Snapshot exact read',
    'Lark Settings exact read and destination hash validation',
    'D1 atomic notification_attempt_key claim',
    'single-attempt Lark IM send',
    'D1 sent or blocked_unknown terminal state',
    'idempotent Lark Notification Log mirror',
  ]),
  existingSharedCore: Object.freeze({
    queueJobType: LARK_EXECUTIVE_NOTIFICATION_JOB_TYPE,
    queueFrameworkReused: true,
    retryDlqFrameworkReused: true,
    larkRepositoryReused: true,
    tableSyncEngineReused: true,
    d1RuntimeAuthorityReused: true,
    duplicateEngineCreated: false,
  }),
  larkBaseAutomation: Object.freeze({
    aiMaterialization: 'inactive_configured',
    notificationAutomation: 'inactive_placeholder',
    notificationAutomationUsedForDelivery: false,
    unsupportedFindRecordsGateBypassed: true,
  }),
  d1Authority: Object.freeze({
    migration: LARK_EXECUTIVE_NOTIFICATION_MIGRATION,
    table: 'lark_notification_deliveries',
    primaryKey: 'notification_attempt_key',
    immutableIdentity: Object.freeze([
      'ai_run_key',
      'dedupe_key',
      'report_id',
      'report_setting_key',
      'customer_profile',
      'destination_key_hash',
      'template_version',
      'payload_checksum',
    ]),
    atomicClaim: 'INSERT_ON_CONFLICT_WHERE_EXPIRED_CLAIMED_ONLY',
    reclaimableStatuses: Object.freeze(['claimed']),
    nonReclaimableStatuses: Object.freeze(['sending', 'sent', 'blocked', 'blocked_unknown']),
    unknownOutcomePolicy: 'blocked_unknown_no_automatic_resend',
    sentReplayPolicy: 'dedupe_without_send_and_repair_mirror_only',
  }),
  destination: Object.freeze({
    exactName: LARK_EXECUTIVE_NOTIFICATION_GROUP_NAME,
    destinationKeyHash: LARK_EXECUTIVE_DESTINATION_KEY_HASH,
    rawDestinationPersisted: false,
    remoteMessageIdPersisted: false,
    remoteMessageIdHashOnly: true,
  }),
  payload: Object.freeze({
    templateVersion: 'executive_report_notification_v1',
    checksumAlgorithm: 'SHA-256',
    maximumBytes: 24_000,
    larkLogChecksumSource: 'worker_canonical_payload',
  }),
  runtimeFlags: Object.freeze({
    MKT_NOTIFICATION_RUNTIME_ENABLED: false,
    MKT_NOTIFICATION_LARK_SEND_ENABLED: false,
    MKT_NOTIFICATION_LARK_MIRROR_ENABLED: false,
  }),
  rollout: Object.freeze({
    sourceMigrationAppliedRemotely: false,
    workerDeployed: false,
    queueMessageSent: false,
    larkMessageSent: false,
    controlledUatAuthorized: false,
    activationAuthorized: false,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }),
});

function deepFreeze(value, seen = new WeakSet()) {
  if (value && typeof value === 'object') {
    if (seen.has(value)) return value;
    seen.add(value);
    for (const nested of Object.values(value)) deepFreeze(nested, seen);
    Object.freeze(value);
  }
  return value;
}
