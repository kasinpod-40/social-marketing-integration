import {
  CONNECTOR_IMPLEMENTATION_STATUS,
  getConnectorCatalogEntry,
  listConnectorCatalog,
} from '../../../config/src/connector-catalog.js';
import { LARGE_ACCOUNT_STATUS } from '../../../config/src/large-account-readiness.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

export const CONNECTOR_RUN_MODES = Object.freeze({
  STANDARD: 'standard',
  CONTROLLED_PRODUCTION_UAT: 'controlled_production_uat',
});

/**
 * ตรวจว่า Connector พร้อมให้ Runtime เรียกจริง
 *
 * การมีชื่ออยู่ใน Catalog ไม่ได้แปลว่าใช้งานได้ทันที:
 * - implementationStatus ต้องเป็น active
 * - Customer profile/feature flag ต้องเปิด enabled=true
 * - Production ปกติต้องผ่าน large-account gate ครบ
 * - Production UAT ชั่วคราวรับได้เฉพาะ dev_ready ที่ขาด liveAccountUat เพียง Gate เดียว
 */
export function assertConnectorRunnable(runtimeConfig, connectorKey, options = {}) {
  const definition = getConnectorCatalogEntry(connectorKey);
  const runMode = readConnectorRunMode(options.runMode);
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

  if (runMode === CONNECTOR_RUN_MODES.CONTROLLED_PRODUCTION_UAT) {
    assertControlledProductionUatEligible(runtimeConfig, definition);
    return connector;
  }

  if (runtimeConfig?.environment === 'production'
    && definition.largeAccount?.productionReady !== true) {
    throwLargeAccountProductionPending(definition);
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

function assertControlledProductionUatEligible(runtimeConfig, definition) {
  if (runtimeConfig?.environment !== 'production') {
    throw permanentError('Controlled connector Production UAT is valid only in Production', {
      code: 'MKT_PRODUCTION_CONNECTOR_UAT_ENV_INVALID',
      details: {
        connectorKey: definition.key,
        environment: runtimeConfig?.environment ?? null,
      },
    });
  }

  const missingGates = definition.largeAccount?.missingGates ?? [];
  const eligible = definition.largeAccount?.status === LARGE_ACCOUNT_STATUS.DEV_READY
    && definition.largeAccount?.productionReady !== true
    && missingGates.length === 1
    && missingGates[0] === 'liveAccountUat';
  if (!eligible) {
    throwLargeAccountProductionPending(definition, {
      controlledProductionUatEligible: false,
    });
  }
}

function throwLargeAccountProductionPending(definition, extraDetails = {}) {
  throw permanentError(`${definition.displayName} connector has not passed the large-account Production gate`, {
    code: 'MKT_CONNECTOR_LARGE_ACCOUNT_UAT_PENDING',
    details: {
      connectorKey: definition.key,
      largeAccountStatus: definition.largeAccount?.status ?? null,
      minimumFixtureItems: definition.largeAccount?.minimumFixtureItems ?? null,
      missingGates: definition.largeAccount?.missingGates ?? [],
      ...extraDetails,
    },
  });
}

function readConnectorRunMode(value) {
  const runMode = value ?? CONNECTOR_RUN_MODES.STANDARD;
  if (!Object.values(CONNECTOR_RUN_MODES).includes(runMode)) {
    throw permanentError(`Unsupported connector run mode: ${String(runMode)}`, {
      code: 'MKT_CONNECTOR_RUN_MODE_INVALID',
      details: { runMode: String(runMode) },
    });
  }
  return runMode;
}
