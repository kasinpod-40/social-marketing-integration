import { permanentError } from '../../shared/src/errors/runtime-error.js';

/**
 * รายชื่อ Connector กลางของระบบ
 *
 * กฎสำคัญ:
 * - key ต้องคงที่เพราะถูกใช้ใน Config, Queue job, Log และ Feature flag
 * - implementationStatus='active' หมายถึงมี Write/Validation path จริงพร้อม Test แล้ว
 * - implementationStatus='planned' หมายถึงเตรียม Contract ไว้เท่านั้นและห้าม Runtime ทำงานจริง
 */
export const CONNECTOR_KEYS = Object.freeze({
  TIKTOK: 'tiktok',
  FACEBOOK: 'facebook',
  INSTAGRAM: 'instagram',
  YOUTUBE: 'youtube',
  WOOCOMMERCE: 'woocommerce',
  CHATWOOT: 'chatwoot',
});

export const CONNECTOR_IMPLEMENTATION_STATUS = Object.freeze({
  ACTIVE: 'active',
  PLANNED: 'planned',
});

const CONNECTOR_CATALOG = Object.freeze({
  [CONNECTOR_KEYS.TIKTOK]: freezeDefinition({
    key: CONNECTOR_KEYS.TIKTOK,
    displayName: 'TikTok',
    capability: 'organic_content',
    implementationStatus: CONNECTOR_IMPLEMENTATION_STATUS.ACTIVE,
    featureFlagEnv: 'MKT_CONNECTOR_TIKTOK_ENABLED',
    sourceHandleEnv: 'TIKTOK_SOURCE_HANDLE',
    requiredRuntimeFields: ['accountKey', 'sourceHandle'],
  }),
  [CONNECTOR_KEYS.FACEBOOK]: freezeDefinition({
    key: CONNECTOR_KEYS.FACEBOOK,
    displayName: 'Facebook Page',
    capability: 'organic_content',
    implementationStatus: CONNECTOR_IMPLEMENTATION_STATUS.PLANNED,
    featureFlagEnv: 'MKT_CONNECTOR_FACEBOOK_ENABLED',
    requiredRuntimeFields: ['accountKey'],
  }),
  [CONNECTOR_KEYS.INSTAGRAM]: freezeDefinition({
    key: CONNECTOR_KEYS.INSTAGRAM,
    displayName: 'Instagram Business',
    capability: 'organic_content',
    implementationStatus: CONNECTOR_IMPLEMENTATION_STATUS.PLANNED,
    featureFlagEnv: 'MKT_CONNECTOR_INSTAGRAM_ENABLED',
    requiredRuntimeFields: ['accountKey'],
  }),
  [CONNECTOR_KEYS.YOUTUBE]: freezeDefinition({
    key: CONNECTOR_KEYS.YOUTUBE,
    displayName: 'YouTube',
    capability: 'organic_content',
    implementationStatus: CONNECTOR_IMPLEMENTATION_STATUS.PLANNED,
    featureFlagEnv: 'MKT_CONNECTOR_YOUTUBE_ENABLED',
    requiredRuntimeFields: ['accountKey'],
  }),
  [CONNECTOR_KEYS.WOOCOMMERCE]: freezeDefinition({
    key: CONNECTOR_KEYS.WOOCOMMERCE,
    displayName: 'WooCommerce',
    capability: 'commerce',
    implementationStatus: CONNECTOR_IMPLEMENTATION_STATUS.PLANNED,
    featureFlagEnv: 'MKT_CONNECTOR_WOOCOMMERCE_ENABLED',
    requiredRuntimeFields: ['accountKey'],
  }),
  [CONNECTOR_KEYS.CHATWOOT]: freezeDefinition({
    key: CONNECTOR_KEYS.CHATWOOT,
    displayName: 'Chatwoot',
    capability: 'conversations',
    implementationStatus: CONNECTOR_IMPLEMENTATION_STATUS.PLANNED,
    featureFlagEnv: 'MKT_CONNECTOR_CHATWOOT_ENABLED',
    requiredRuntimeFields: ['accountKey'],
  }),
});

/** คืน Definition ของ Connector พร้อมปฏิเสธ key ที่ไม่รู้จักแบบถาวร */
export function getConnectorCatalogEntry(connectorKey) {
  const key = normalizeConnectorKey(connectorKey);
  const definition = CONNECTOR_CATALOG[key];
  if (!definition) {
    throw permanentError(`Unknown connector key: ${key}`, {
      code: 'UNKNOWN_CONNECTOR',
      details: { connectorKey: key },
    });
  }
  return definition;
}

/** คืน Connector Definition ทั้งหมดตามลำดับคงที่สำหรับหน้า Admin, Health และ Test */
export function listConnectorCatalog() {
  return Object.freeze(Object.values(CONNECTOR_CATALOG));
}

/** คืน key ทั้งหมดโดยไม่เปิดให้ผู้เรียกแก้ไข Array กลาง */
export function listConnectorKeys() {
  return Object.freeze(Object.keys(CONNECTOR_CATALOG));
}

/** Normalize key ให้เป็นตัวพิมพ์เล็กและปฏิเสธข้อความว่าง */
function normalizeConnectorKey(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw permanentError('Connector key is required', {
      code: 'UNKNOWN_CONNECTOR',
    });
  }
  return value.trim().toLowerCase();
}

/** Freeze Definition และ Array ภายในเพื่อป้องกัน Runtime แก้ Contract กลาง */
function freezeDefinition(definition) {
  return Object.freeze({
    ...definition,
    requiredRuntimeFields: Object.freeze([...(definition.requiredRuntimeFields ?? [])]),
  });
}
