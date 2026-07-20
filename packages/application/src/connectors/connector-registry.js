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
  if (runtimeConfig?.environment === 'production'
    && definition.largeAccount?.productionReady !== true) {
    throw permanentError(`${definition.displayName} connector has not passed the large-account Production gate`, {
      code: 'MKT_CONNECTOR_LARGE_ACCOUNT_UAT_PENDING',
      details: {
        connectorKey: definition.key,
        largeAccountStatus: definition.largeAccount?.status ?? null,
        minimumFixtureItems: definition.largeAccount?.minimumFixtureItems ?? null,
        missingGates: definition.largeAccount?.missingGates ?? [],
      },
    });
  }
  return connector;
}

/** คืน Readiness summary ที่ปลอดภัยต่อการแสดงใน Health/Admin โดยไม่มี Secret */
export function listConnectorReadiness(runtimeConfig) {
  return Object.freeze(listConnectorCatalog().map((definition) => {
    const runtime = runtimeConfig?.connectors?.[definition.key] ?? null;
    const implementationRunnable = definition.implementationStatus === CONNECTOR_IMPLEMENTATION_STATUS.ACTIVE
      && runtime?.enabled === true;
    const productionRunnable = implementationRunnable
      && definition.largeAccount.productionReady === true;
    return Object.freeze({
      key: definition.key,
      displayName: definition.displayName,
      capability: definition.capability,
      implementationStatus: definition.implementationStatus,
      enabled: runtime?.enabled === true,
      largeAccountStatus: definition.largeAccount.status,
      largeAccountPrimaryEntity: definition.largeAccount.primaryEntity,
      minimumFixtureItems: definition.largeAccount.minimumFixtureItems,
      missingLargeAccountGates: definition.largeAccount.missingGates,
      productionReady: definition.largeAccount.productionReady,
      runnable: implementationRunnable
        && (runtimeConfig?.environment !== 'production' || productionRunnable),
      productionRunnable,
    });
  }));
}
