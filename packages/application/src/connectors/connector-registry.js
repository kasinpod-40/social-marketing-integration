import {
  CONNECTOR_IMPLEMENTATION_STATUS,
  getConnectorCatalogEntry,
  listConnectorCatalog,
} from '../../../config/src/connector-catalog.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

/**
 * ตรวจว่า Connector พร้อมให้ Runtime เรียกจริง
 *
 * การมีชื่ออยู่ใน Catalog ไม่ได้แปลว่าใช้งานได้ทันที:
 * - implementationStatus ต้องเป็น active
 * - Customer profile/feature flag ต้องเปิด enabled=true
 */
export function assertConnectorRunnable(runtimeConfig, connectorKey) {
  const definition = getConnectorCatalogEntry(connectorKey);
  if (definition.implementationStatus !== CONNECTOR_IMPLEMENTATION_STATUS.ACTIVE) {
    const uatPending = definition.implementationStatus === CONNECTOR_IMPLEMENTATION_STATUS.UAT_PENDING;
    throw permanentError(`${definition.displayName} connector is ${uatPending ? 'waiting for Live DEV UAT' : 'not implemented'}`, {
      code: uatPending ? 'MKT_CONNECTOR_UAT_PENDING' : 'MKT_CONNECTOR_NOT_IMPLEMENTED',
      details: { connectorKey: definition.key },
    });
  }

  const connector = runtimeConfig?.connectors?.[definition.key];
  if (!connector) {
    throw permanentError(`Runtime profile does not contain connector ${definition.key}`, {
      code: 'MKT_RUNTIME_CONFIG_INVALID',
      details: { connectorKey: definition.key },
    });
  }
  if (connector.enabled !== true) {
    throw permanentError(`${definition.displayName} connector is disabled`, {
      code: 'MKT_CONNECTOR_DISABLED',
      details: {
        connectorKey: definition.key,
        featureFlagEnv: definition.featureFlagEnv,
      },
    });
  }
  return connector;
}


/** เปิด Connector ที่ยัง uat_pending เฉพาะ Manual UAT ที่มี Flag แยกและห้ามตั้ง active flag */
export function assertConnectorManualUatRunnable(runtimeConfig, connectorKey, input = {}) {
  const definition = getConnectorCatalogEntry(connectorKey);
  if (definition.implementationStatus !== CONNECTOR_IMPLEMENTATION_STATUS.UAT_PENDING) {
    throw permanentError(`${definition.displayName} connector is not in UAT-pending state`, {
      code: 'MKT_CONNECTOR_UAT_MODE_INVALID',
      details: { connectorKey: definition.key, implementationStatus: definition.implementationStatus },
    });
  }
  if (input.trigger !== 'manual_uat') {
    throw permanentError(`${definition.displayName} UAT route requires trigger=manual_uat`, {
      code: 'MKT_CONNECTOR_UAT_TRIGGER_REQUIRED',
      details: { connectorKey: definition.key },
    });
  }
  if (input.uatEnabled !== true) {
    throw permanentError(`${definition.displayName} manual UAT is disabled`, {
      code: 'MKT_CONNECTOR_UAT_DISABLED',
      details: { connectorKey: definition.key, featureFlagEnv: input.featureFlagEnv ?? null },
    });
  }
  const connector = runtimeConfig?.connectors?.[definition.key];
  if (!connector) {
    throw permanentError(`Runtime profile does not contain connector ${definition.key}`, {
      code: 'MKT_RUNTIME_CONFIG_INVALID',
      details: { connectorKey: definition.key },
    });
  }
  if (connector.enabled === true) {
    throw permanentError(`${definition.displayName} active flag must remain false during manual UAT`, {
      code: 'MKT_CONNECTOR_UAT_ACTIVE_FLAG_CONFLICT',
      details: { connectorKey: definition.key, activeFeatureFlagEnv: definition.featureFlagEnv },
    });
  }
  return connector;
}

/** คืน Readiness summary ที่ปลอดภัยต่อการแสดงใน Health/Admin โดยไม่มี Secret */
export function listConnectorReadiness(runtimeConfig) {
  return Object.freeze(listConnectorCatalog().map((definition) => {
    const runtime = runtimeConfig?.connectors?.[definition.key] ?? null;
    return Object.freeze({
      key: definition.key,
      displayName: definition.displayName,
      capability: definition.capability,
      implementationStatus: definition.implementationStatus,
      enabled: runtime?.enabled === true,
      runnable: definition.implementationStatus === CONNECTOR_IMPLEMENTATION_STATUS.ACTIVE
        && runtime?.enabled === true,
    });
  }));
}
