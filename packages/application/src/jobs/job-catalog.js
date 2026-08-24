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
  REPORT_MATERIALIZATION_GENERATE: 'report.materialization.generate',
  MKT_CONTENT_DAILY_RETENTION: 'lark.mkt-content-daily.retention',
  LARK_BASE_VIEW_HYGIENE: 'lark.base.view.hygiene',
  LARK_BASE_VIEW_FIELD_ORDER: 'lark.base.view.field-order',
  LARK_NOTIFICATION_SEND: 'lark.notification.send',
  DEAD_LETTER_REDRIVE: 'system.dead-letter.redrive',
  RELIABILITY_MIRROR_DELIVER: 'system.reliability-mirror.deliver',
});

/** Trigger กลางที่เปลี่ยน Queue identity หรือสิทธิ์ Runtime ห้ามกระจาย String literal */
export const JOB_TRIGGERS = Object.freeze({
  PRODUCTION_CONNECTOR_UAT: 'production_connector_uat',
  TIKTOK_POST_LARK_WATERMARK: 'post_lark_watermark',
  META_MANUAL_UAT: 'manual_uat',
  META_ORGANIC_SCHEDULED: 'scheduled',
  DASHBOARD_PRESET: 'dashboard_preset',
  DASHBOARD_CUSTOM_RANGE: 'dashboard_custom_range',
  DASHBOARD_SCHEDULED: 'dashboard_scheduled',
  MKT_CONTENT_DAILY_RETENTION_SCHEDULED: 'mkt_content_daily_retention_scheduled',
  CUSTOMER_LARK_EMPTY_FIELDS: 'customer_lark_empty_fields',
  CUSTOMER_LARK_FIELD_ORDER: 'customer_lark_field_order',
  YOUTUBE_WORKER_DRY_RUN: 'youtube_worker_dry_run',
  YOUTUBE_LARK_FULL_SYNC_UAT: 'youtube_lark_full_sync_uat',
  WOOCOMMERCE_MANUAL_UAT: 'manual_uat',
  WOOCOMMERCE_SCHEDULED: 'scheduled',
  CHATWOOT_LEGACY_MANUAL_UAT: 'manual_uat',
  CHATWOOT_INITIAL_30_DAY_UAT: 'chatwoot_initial_30_day_uat',
  CHATWOOT_DAILY_INCREMENTAL: 'chatwoot_daily_incremental',
  CHATWOOT_SCHEDULED_DAILY: 'chatwoot_scheduled_daily',
  LARK_NOTIFICATION_CONTROLLED_UAT: 'lark_notification_controlled_uat',
  LARK_NOTIFICATION_RUNTIME: 'lark_notification_runtime',
});

/** Schema version ของ Job payload ที่มี Contract เฉพาะ Connector */
export const JOB_SCHEMA_VERSIONS = Object.freeze({
  CURRENT: 1,
  CHATWOOT_RUNTIME: 1,
  LARK_NOTIFICATION_RUNTIME: 1,
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
    implementationStatus: JOB_IMPLEMENTATION_STATUS.ACTIVE,
    connectorKey: CONNECTOR_KEYS.FACEBOOK,
    allowedTriggers: [
      JOB_TRIGGERS.META_MANUAL_UAT,
      JOB_TRIGGERS.META_ORGANIC_SCHEDULED,
    ],
  }),
  [JOB_TYPES.INSTAGRAM_ORGANIC_SYNC]: freezeJob({
    type: JOB_TYPES.INSTAGRAM_ORGANIC_SYNC,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.ACTIVE,
    connectorKey: CONNECTOR_KEYS.INSTAGRAM,
    allowedTriggers: [
      JOB_TRIGGERS.META_MANUAL_UAT,
      JOB_TRIGGERS.META_ORGANIC_SCHEDULED,
    ],
  }),
  [JOB_TYPES.META_ADS_SYNC]: freezeJob({
    type: JOB_TYPES.META_ADS_SYNC,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.ACTIVE,
    connectorKey: CONNECTOR_KEYS.META_ADS,
    allowedTriggers: [
      JOB_TRIGGERS.META_MANUAL_UAT,
      JOB_TRIGGERS.META_ORGANIC_SCHEDULED,
    ],
  }),
  [JOB_TYPES.GOOGLE_ADS_MANAGER_SIGNED_DELIVERY_PROCESS]: freezeJob({
    type: JOB_TYPES.GOOGLE_ADS_MANAGER_SIGNED_DELIVERY_PROCESS,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.ACTIVE,
    connectorKey: CONNECTOR_KEYS.GOOGLE_ADS,
  }),
  [JOB_TYPES.YOUTUBE_ORGANIC_SYNC]: freezeJob({
    type: JOB_TYPES.YOUTUBE_ORGANIC_SYNC,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.ACTIVE,
    connectorKey: CONNECTOR_KEYS.YOUTUBE,
  }),
  [JOB_TYPES.WOOCOMMERCE_COMMERCE_SYNC]: freezeJob({
    type: JOB_TYPES.WOOCOMMERCE_COMMERCE_SYNC,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.ACTIVE,
    connectorKey: CONNECTOR_KEYS.WOOCOMMERCE,
    allowedTriggers: [
      JOB_TRIGGERS.WOOCOMMERCE_MANUAL_UAT,
      JOB_TRIGGERS.WOOCOMMERCE_SCHEDULED,
      JOB_TRIGGERS.PRODUCTION_CONNECTOR_UAT,
    ],
  }),
  [JOB_TYPES.CHATWOOT_CONVERSATIONS_SYNC]: freezeJob({
    type: JOB_TYPES.CHATWOOT_CONVERSATIONS_SYNC,
    schemaVersion: JOB_SCHEMA_VERSIONS.CHATWOOT_RUNTIME,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.ACTIVE,
    connectorKey: CONNECTOR_KEYS.CHATWOOT,
    allowedTriggers: [
      JOB_TRIGGERS.CHATWOOT_INITIAL_30_DAY_UAT,
      JOB_TRIGGERS.CHATWOOT_DAILY_INCREMENTAL,
      JOB_TRIGGERS.CHATWOOT_SCHEDULED_DAILY,
    ],
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
  [JOB_TYPES.REPORT_MATERIALIZATION_GENERATE]: freezeJob({
    type: JOB_TYPES.REPORT_MATERIALIZATION_GENERATE,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.ACTIVE,
    connectorKey: null,
    allowedTriggers: [
      JOB_TRIGGERS.DASHBOARD_PRESET,
      JOB_TRIGGERS.DASHBOARD_CUSTOM_RANGE,
      JOB_TRIGGERS.DASHBOARD_SCHEDULED,
    ],
  }),
  [JOB_TYPES.MKT_CONTENT_DAILY_RETENTION]: freezeJob({
    type: JOB_TYPES.MKT_CONTENT_DAILY_RETENTION,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.ACTIVE,
    connectorKey: null,
    allowedTriggers: [JOB_TRIGGERS.MKT_CONTENT_DAILY_RETENTION_SCHEDULED],
  }),
  [JOB_TYPES.LARK_BASE_VIEW_HYGIENE]: freezeJob({
    type: JOB_TYPES.LARK_BASE_VIEW_HYGIENE,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.ACTIVE,
    connectorKey: null,
    manualOnly: true,
    allowedTriggers: [JOB_TRIGGERS.CUSTOMER_LARK_EMPTY_FIELDS],
  }),
  [JOB_TYPES.LARK_BASE_VIEW_FIELD_ORDER]: freezeJob({
    type: JOB_TYPES.LARK_BASE_VIEW_FIELD_ORDER,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.ACTIVE,
    connectorKey: null,
    manualOnly: true,
    allowedTriggers: [JOB_TRIGGERS.CUSTOMER_LARK_FIELD_ORDER],
  }),
  [JOB_TYPES.LARK_NOTIFICATION_SEND]: freezeJob({
    type: JOB_TYPES.LARK_NOTIFICATION_SEND,
    schemaVersion: JOB_SCHEMA_VERSIONS.LARK_NOTIFICATION_RUNTIME,
    implementationStatus: JOB_IMPLEMENTATION_STATUS.ACTIVE,
    connectorKey: null,
    manualOnly: true,
    allowedTriggers: [
      JOB_TRIGGERS.LARK_NOTIFICATION_CONTROLLED_UAT,
      JOB_TRIGGERS.LARK_NOTIFICATION_RUNTIME,
    ],
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

/** Freeze Job definition เพื่อป้องกัน Test หรือ Runtime แก้ Registry */
function freezeJob(definition) {
  return Object.freeze({
    ...definition,
    ...(Array.isArray(definition.allowedTriggers)
      ? { allowedTriggers: Object.freeze([...definition.allowedTriggers]) }
      : {}),
  });
}
