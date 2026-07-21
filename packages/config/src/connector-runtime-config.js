import {
  CONNECTOR_IMPLEMENTATION_STATUS,
  listConnectorCatalog,
} from './connector-catalog.js';
import { permanentError } from '../../shared/src/errors/runtime-error.js';

/**
 * สร้าง Runtime state ของ Connector ทุกช่องทางจาก Customer profile และ Environment
 *
 * Priority ของ enabled:
 * 1. Environment feature flag เช่น MKT_CONNECTOR_TIKTOK_ENABLED
 * 2. enabledByDefault ใน Customer profile
 *
 * Identity ที่เปลี่ยนตามทรัพยากรจริง เช่น TikTok handle สามารถ Override ผ่าน Environment
 * โดยไม่แก้ Source code ขณะที่ accountKey ยังคงมาจาก Customer profile เพื่อรักษา Stable key
 *
 * Connector ที่ยัง implementationStatus='planned' จะเปิดใช้งานไม่ได้แม้ตั้ง flag=true
 * เพื่อป้องกันการ Deploy โค้ดที่มีเพียงโครงแต่ยังไม่มี Integration จริง
 */
export function resolveConnectorRuntimeConfig(profileConnectors, env = {}) {
  const profileMap = requireObject(profileConnectors, 'profile.connectors');
  const runtimeEntries = listConnectorCatalog().map((definition) => {
    const profile = requireObject(profileMap[definition.key], `profile.connectors.${definition.key}`);
    const enabledOverride = readOptionalBoolean(env[definition.featureFlagEnv], definition.featureFlagEnv);
    const enabled = enabledOverride ?? (profile.enabledByDefault === true);

    if (enabled && definition.implementationStatus !== CONNECTOR_IMPLEMENTATION_STATUS.ACTIVE) {
      const uatPending = definition.implementationStatus === CONNECTOR_IMPLEMENTATION_STATUS.UAT_PENDING;
      throw permanentError(
        `${definition.displayName} connector is enabled but ${uatPending ? 'Live DEV UAT is pending' : 'its implementation is not ready'}`,
        {
          code: uatPending ? 'MKT_CONNECTOR_UAT_PENDING' : 'MKT_CONNECTOR_NOT_IMPLEMENTED',
          details: {
            connectorKey: definition.key,
            implementationStatus: definition.implementationStatus,
            featureFlagEnv: definition.featureFlagEnv,
          },
        },
      );
    }

    const sourceHandleOverride = definition.sourceHandleEnv
      ? readOptionalTextEnv(env[definition.sourceHandleEnv], definition.sourceHandleEnv)
      : null;
    const runtimeFields = {
      accountKey: normalizeOptionalText(profile.accountKey),
      sourceHandle: sourceHandleOverride ?? normalizeOptionalText(profile.sourceHandle),
    };
    validateRequiredRuntimeFields(definition, runtimeFields, enabled);

    return [definition.key, Object.freeze({
      key: definition.key,
      displayName: definition.displayName,
      capability: definition.capability,
      implementationStatus: definition.implementationStatus,
      featureFlagEnv: definition.featureFlagEnv,
      sourceHandleEnv: definition.sourceHandleEnv ?? null,
      enabled,
      enabledSource: enabledOverride === null ? 'profile' : 'environment',
      accountKey: runtimeFields.accountKey,
      sourceHandle: runtimeFields.sourceHandle,
      sourceHandleSource: sourceHandleOverride
        ? 'environment'
        : runtimeFields.sourceHandle
          ? 'profile'
          : null,
      displayLabel: normalizeOptionalText(profile.displayLabel),
    })];
  });

  return Object.freeze(Object.fromEntries(runtimeEntries));
}

/** อ่าน Boolean ที่ยอมรับเฉพาะ true/false เพื่อไม่ตีความคำคลุมเครืออย่าง yes, 1 หรือ on */
function readOptionalBoolean(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  if (value === true || value === false) return value;
  if (typeof value !== 'string') {
    throw invalidBoolean(fieldName, value);
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw invalidBoolean(fieldName, value);
}

/** อ่านข้อความ Optional จาก Environment และปฏิเสธชนิดข้อมูลที่ไม่ใช่ String */
function readOptionalTextEnv(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw permanentError(`${fieldName} must be a non-empty string`, {
      code: 'MKT_RUNTIME_CONFIG_INVALID',
      details: { fieldName, valueType: typeof value },
    });
  }
  const text = value.trim();
  if (!text) {
    throw permanentError(`${fieldName} must be a non-empty string`, {
      code: 'MKT_RUNTIME_CONFIG_INVALID',
      details: { fieldName, valueType: 'string' },
    });
  }
  return text;
}

/**
 * ตรวจ Field ที่ Catalog ระบุว่าจำเป็นต่อ Stable identity เฉพาะเมื่อ Connector ถูกเปิด
 * เพื่อให้ UAT profile เก็บ Live identity ไว้นอก Source และยังโหลดแบบ Fail-closed ได้ก่อน Preflight
 */
function validateRequiredRuntimeFields(definition, runtimeFields, enabled) {
  if (!enabled) return;
  for (const fieldName of definition.requiredRuntimeFields) {
    if (!normalizeOptionalText(runtimeFields[fieldName])) {
      throw permanentError(`Missing connector runtime field ${definition.key}.${fieldName}`, {
        code: 'MKT_RUNTIME_CONFIG_INVALID',
        details: { connectorKey: definition.key, fieldName },
      });
    }
  }
}

/** บังคับค่าเป็น Object ปกติ ไม่รับ Array/null */
function requireObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw permanentError(`${fieldName} must be an object`, {
      code: 'MKT_RUNTIME_CONFIG_INVALID',
      details: { fieldName },
    });
  }
  return value;
}

/** Normalize ข้อความ Optional โดยคืน null เมื่อไม่มีค่า */
function normalizeOptionalText(value) {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

/** สร้าง Error รูปแบบเดียวกันเมื่อ Feature flag ไม่ใช่ Boolean ที่รองรับ */
function invalidBoolean(fieldName, value) {
  return permanentError(`${fieldName} must be true or false`, {
    code: 'MKT_RUNTIME_CONFIG_INVALID',
    details: { fieldName, valueType: typeof value },
  });
}
