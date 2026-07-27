import { CONNECTOR_KEYS } from '../../../config/src/connector-catalog.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

/** Job type กลางของ Queue ห้ามกระจาย String literal ซ้ำใน Worker/Producer/Test */
export const JOB_TYPES = Object.freeze({
  TIKTOK_CREATOR_NATIVE_PROBE: 'tiktok.creator.native.probe',
  TIKTOK_CREATOR_NATIVE_SYNC: 'tiktok.creator.native.sync',
  TIKTOK_CREATOR_NATIVE_VALIDATE: 'tiktok.creator.native.validate',
  TIKTOK_CREATOR_NATIVE_HISTORY_BOOTSTRAP: 'tiktok.creator.native.history.bootstrap',
  TIKTOK_CREATOR_NATIVE_HISTORY_RECOVER: 'tiktok.creator.native.history.recover',
  METRIC_DEFINITIONS_SEED: 'metric.definitions.seed',
  REPORT_SETTINGS_SEED: 'report.settings.seed',

  FACEBOOK_ORGANIC_SYNC: 'facebook.page.organic.sync',
  INSTAGRAM_ORGANIC_SYNC: 'instagram.business.organic.sync',
  META_ADS_SYNC: 'meta.ads.sync',
  GOOGLE_ADS_MANAGER_SIGNED_DELIVERY_PROCESS: 'google.ads.manager.signed-delivery.process',
  YOUTUBE_ORGANIC_SYNC: 'youtube.channel.organic.sync',
  WOOCOMMERCE_COMMERCE_SYNC: 'woocommerce.commerce.sync',
  CHATWOOT_CONVERSATIONS_SYNC: 'chatwoot.conversations.sync',

  SYNC_RECONCILE: 'sync.reconcile',
  DAILY_REPORT_GENERATE: 'report.daily.generate',
  WEEKLY_REPORT_GENERATE: 'report.weekly.generate',
  LARK_NOTIFICATION_SEND: 'lark.notification.send',
  DEAD_LETTER_REDRIVE: 'system.dead-letter.redrive',
  RELIABILITY_MIRROR_DELIVER: 'system.reliability-mirror.deliver',
});

export const JOB_IMPLEMENTATION_STATUS = Object.freeze({
  ACTIVE: 'active',
  UAT_PENDING: 'uat_pending',
  PLANNED: 'planned',
});

const JOB_CATALOG = Object.freeze({
  [JOB_TYPES.TIKTOK_CREATOR_NATIVE_PROBE]: freezeJob({
    type: JOB_TYPES.TIKTOK_CREATOR_NATIVE_PROBE,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.ACTIVE,
    connectorKey: CONNECTOR_KEYS.TIKTOK,
  }),
  [JOB_TYPES.TIKTOK_CREATOR_NATIVE_SYNC]: freezeJob({
    type: JOB_TYPES.TIKTOK_CREATOR_NATIVE_SYNC,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.ACTIVE,
    connectorKey: CONNECTOR_KEYS.TIKTOK,
  }),
  [JOB_TYPES.TIKTOK_CREATOR_NATIVE_VALIDATE]: freezeJob({
    type: JOB_TYPES.TIKTOK_CREATOR_NATIVE_VALIDATE,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.ACTIVE,
    connectorKey: CONNECTOR_KEYS.TIKTOK,
  }),
  [JOB_TYPES.TIKTOK_CREATOR_NATIVE_HISTORY_BOOTSTRAP]: freezeJob({
    type: JOB_TYPES.TIKTOK_CREATOR_NATIVE_HISTORY_BOOTSTRAP,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.ACTIVE,
    connectorKey: CONNECTOR_KEYS.TIKTOK,
    manualOnly: true,
  }),
  [JOB_TYPES.TIKTOK_CREATOR_NATIVE_HISTORY_RECOVER]: freezeJob({
    type: JOB_TYPES.TIKTOK_CREATOR_NATIVE_HISTORY_RECOVER,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.ACTIVE,
    connectorKey: CONNECTOR_KEYS.TIKTOK,
    manualOnly: true,
    recoveryOnly: true,
  }),
  [JOB_TYPES.METRIC_DEFINITIONS_SEED]: freezeJob({
    type: JOB_TYPES.METRIC_DEFINITIONS_SEED,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.ACTIVE,
    connectorKey: null,
  }),
  [JOB_TYPES.REPORT_SETTINGS_SEED]: freezeJob({
    type: JOB_TYPES.REPORT_SETTINGS_SEED,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.ACTIVE,
    connectorKey: null,
  }),

  [JOB_TYPES.FACEBOOK_ORGANIC_SYNC]: freezeJob({
    type: JOB_TYPES.FACEBOOK_ORGANIC_SYNC,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.UAT_PENDING,
    connectorKey: CONNECTOR_KEYS.FACEBOOK,
    manualOnly: true,
  }),
  [JOB_TYPES.INSTAGRAM_ORGANIC_SYNC]: freezeJob({
    type: JOB_TYPES.INSTAGRAM_ORGANIC_SYNC,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.UAT_PENDING,
    connectorKey: CONNECTOR_KEYS.INSTAGRAM,
    manualOnly: true,
  }),
  [JOB_TYPES.META_ADS_SYNC]: freezeJob({
    type: JOB_TYPES.META_ADS_SYNC,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.UAT_PENDING,
    connectorKey: CONNECTOR_KEYS.META_ADS,
    manualOnly: true,
  }),
  [JOB_TYPES.GOOGLE_ADS_MANAGER_SIGNED_DELIVERY_PROCESS]: freezeJob({
    type: JOB_TYPES.GOOGLE_ADS_MANAGER_SIGNED_DELIVERY_PROCESS,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.UAT_PENDING,
    connectorKey: CONNECTOR_KEYS.GOOGLE_ADS,
    manualOnly: true,
  }),
  [JOB_TYPES.YOUTUBE_ORGANIC_SYNC]: freezeJob({
    type: JOB_TYPES.YOUTUBE_ORGANIC_SYNC,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.ACTIVE,
    connectorKey: CONNECTOR_KEYS.YOUTUBE,
  }),
  [JOB_TYPES.WOOCOMMERCE_COMMERCE_SYNC]: freezeJob({
    type: JOB_TYPES.WOOCOMMERCE_COMMERCE_SYNC,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.PLANNED,
    connectorKey: CONNECTOR_KEYS.WOOCOMMERCE,
  }),
  [JOB_TYPES.CHATWOOT_CONVERSATIONS_SYNC]: freezeJob({
    type: JOB_TYPES.CHATWOOT_CONVERSATIONS_SYNC,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.PLANNED,
    connectorKey: CONNECTOR_KEYS.CHATWOOT,
  }),

  [JOB_TYPES.SYNC_RECONCILE]: freezeJob({
    type: JOB_TYPES.SYNC_RECONCILE,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.PLANNED,
    connectorKey: null,
  }),
  [JOB_TYPES.DAILY_REPORT_GENERATE]: freezeJob({
    type: JOB_TYPES.DAILY_REPORT_GENERATE,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.ACTIVE,
    connectorKey: CONNECTOR_KEYS.TIKTOK,
  }),
  [JOB_TYPES.WEEKLY_REPORT_GENERATE]: freezeJob({
    type: JOB_TYPES.WEEKLY_REPORT_GENERATE,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.ACTIVE,
    connectorKey: CONNECTOR_KEYS.TIKTOK,
  }),
  [JOB_TYPES.LARK_NOTIFICATION_SEND]: freezeJob({
    type: JOB_TYPES.LARK_NOTIFICATION_SEND,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.PLANNED,
    connectorKey: null,
  }),
  [JOB_TYPES.DEAD_LETTER_REDRIVE]: freezeJob({
    type: JOB_TYPES.DEAD_LETTER_REDRIVE,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.ACTIVE,
    connectorKey: null,
  }),
  [JOB_TYPES.RELIABILITY_MIRROR_DELIVER]: freezeJob({
    type: JOB_TYPES.RELIABILITY_MIRROR_DELIVER,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.ACTIVE,
    connectorKey: null,
  }),
});

/** คืน Job definition หรือปฏิเสธ Job ไม่รู้จักแบบ Permanent เพื่อไม่ Retry วน */
export function getJobDefinition(type) {
  const normalizedType = requireJobType(type);
  const definition = JOB_CATALOG[normalizedType];
  if (!definition) {
    throw permanentError(`Unsupported sync job type: ${normalizedType}`, {
      code: 'UNSUPPORTED_SYNC_JOB',
      details: { type: normalizedType },
    });
  }
  return definition;
}

/** ป้องกัน Job ที่เตรียมชื่อไว้แต่ Use case จริงยังไม่พร้อมถูก Route เข้า Runtime */
export function assertJobImplemented(definition) {
  if (definition?.implementationStatus !== JOB_IMPLEMENTATION_STATUS.ACTIVE) {
    const uatPending = definition?.implementationStatus === JOB_IMPLEMENTATION_STATUS.UAT_PENDING;
    throw permanentError(`Sync job is registered but ${uatPending ? 'Live DEV UAT is pending' : 'not implemented'}: ${definition?.type ?? 'unknown'}`, {
      code: uatPending ? 'SYNC_JOB_UAT_PENDING' : 'SYNC_JOB_NOT_IMPLEMENTED',
      details: {
        type: definition?.type ?? null,
        connectorKey: definition?.connectorKey ?? null,
      },
    });
  }
  return definition;
}

/** คืน Job catalog ทั้งหมดสำหรับ Test/เอกสาร/หน้า Admin โดยไม่เปิดให้แก้ Registry */
export function listJobDefinitions() {
  return Object.freeze(Object.values(JOB_CATALOG));
}

/** บังคับ Job type เป็นข้อความไม่ว่าง */
function requireJobType(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw permanentError('Sync worker requires job.type', {
      code: 'INVALID_SYNC_JOB',
      details: { fieldName: 'job.type' },
    });
  }
  return value.trim();
}

/** Freeze Job definition เพื่อป้องกัน Test หรือ Runtime แก้ Registry กลาง */
function freezeJob(definition) {
  return Object.freeze({ ...definition });
}
