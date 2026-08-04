import {
  LARK_EXECUTIVE_NOTIFICATION_SAFE_DELIVERY_CONTRACT,
  LARK_EXECUTIVE_NOTIFICATION_SAFE_DELIVERY_STATUS,
  LARK_EXECUTIVE_NOTIFICATION_SAFE_DELIVERY_VERSION,
} from '../../../config/src/lark-executive-notification-safe-delivery-contract.js';

export function buildLarkExecutiveNotificationSafeDeliveryPreview() {
  const contract = LARK_EXECUTIVE_NOTIFICATION_SAFE_DELIVERY_CONTRACT;
  const nextGates = Object.freeze([
    Object.freeze({
      code: 'REMOTE_D1_MIGRATION_0019_NOT_AUTHORIZED',
      actionType: 'separate_approval',
      blockingRepositoryMerge: false,
    }),
    Object.freeze({
      code: 'WORKER_DEPLOYMENT_NOT_AUTHORIZED',
      actionType: 'separate_approval',
      blockingRepositoryMerge: false,
    }),
    Object.freeze({
      code: 'CONTROLLED_SINGLE_MESSAGE_UAT_NOT_AUTHORIZED',
      actionType: 'separate_approval',
      blockingRepositoryMerge: false,
    }),
    Object.freeze({
      code: 'RUNTIME_ACTIVATION_NOT_AUTHORIZED',
      actionType: 'separate_approval',
      blockingRepositoryMerge: false,
    }),
  ]);
  return deepFreeze({
    ok: true,
    contractVersion: LARK_EXECUTIVE_NOTIFICATION_SAFE_DELIVERY_VERSION,
    status: LARK_EXECUTIVE_NOTIFICATION_SAFE_DELIVERY_STATUS,
    mode: 'repository_only',
    repositoryImplementationComplete: true,
    baseAutomationDedupeBlockerResolvedByArchitecture: true,
    notificationDeliveryAuthority: 'd1_atomic_claim_and_shared_queue',
    contract,
    blockerCount: 0,
    blockers: Object.freeze([]),
    nextGateCount: nextGates.length,
    nextGates,
    safety: Object.freeze({
      remoteLarkRead: 0,
      remoteLarkWrite: 0,
      remoteD1Read: 0,
      remoteD1Write: 0,
      migrationApply: 0,
      queueSend: 0,
      workerDeployment: 0,
      notificationSend: 0,
      automationEnabled: false,
      scheduleEnabled: false,
      production: 'BLOCKED',
    }),
  });
}

export function validateLarkExecutiveNotificationSafeDeliveryPreview(preview) {
  const errors = [];
  if (preview?.contractVersion !== LARK_EXECUTIVE_NOTIFICATION_SAFE_DELIVERY_VERSION) {
    errors.push({ code: 'CONTRACT_VERSION_INVALID' });
  }
  if (preview?.status !== LARK_EXECUTIVE_NOTIFICATION_SAFE_DELIVERY_STATUS
    || preview?.mode !== 'repository_only'
    || preview?.repositoryImplementationComplete !== true
    || preview?.baseAutomationDedupeBlockerResolvedByArchitecture !== true
    || preview?.notificationDeliveryAuthority !== 'd1_atomic_claim_and_shared_queue') {
    errors.push({ code: 'REPOSITORY_READINESS_INVALID' });
  }
  if (preview?.blockerCount !== 0 || preview?.blockers?.length !== 0) {
    errors.push({ code: 'BLOCKER_STATE_INVALID' });
  }
  if (preview?.contract?.d1Authority?.atomicClaim
      !== 'INSERT_ON_CONFLICT_WHERE_EXPIRED_CLAIMED_ONLY'
    || preview?.contract?.d1Authority?.unknownOutcomePolicy
      !== 'blocked_unknown_no_automatic_resend'
    || preview?.contract?.d1Authority?.sentReplayPolicy
      !== 'dedupe_without_send_and_repair_mirror_only') {
    errors.push({ code: 'EXACT_SEND_POLICY_INVALID' });
  }
  if (preview?.contract?.larkBaseAutomation?.notificationAutomation
      !== 'inactive_placeholder'
    || preview?.contract?.larkBaseAutomation?.notificationAutomationUsedForDelivery !== false) {
    errors.push({ code: 'LARK_AUTOMATION_BOUNDARY_INVALID' });
  }
  if (preview?.contract?.runtimeFlags?.MKT_NOTIFICATION_RUNTIME_ENABLED !== false
    || preview?.contract?.runtimeFlags?.MKT_NOTIFICATION_LARK_SEND_ENABLED !== false
    || preview?.contract?.runtimeFlags?.MKT_NOTIFICATION_LARK_MIRROR_ENABLED !== false) {
    errors.push({ code: 'RUNTIME_FLAGS_INVALID' });
  }
  if (preview?.safety?.remoteLarkWrite !== 0
    || preview?.safety?.remoteD1Write !== 0
    || preview?.safety?.migrationApply !== 0
    || preview?.safety?.queueSend !== 0
    || preview?.safety?.workerDeployment !== 0
    || preview?.safety?.notificationSend !== 0
    || preview?.safety?.automationEnabled !== false
    || preview?.safety?.scheduleEnabled !== false
    || preview?.safety?.production !== 'BLOCKED') {
    errors.push({ code: 'SAFETY_BOUNDARY_INVALID' });
  }
  return Object.freeze(errors.map(Object.freeze));
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value && typeof value === 'object') {
    if (seen.has(value)) return value;
    seen.add(value);
    for (const nested of Object.values(value)) deepFreeze(nested, seen);
    Object.freeze(value);
  }
  return value;
}
