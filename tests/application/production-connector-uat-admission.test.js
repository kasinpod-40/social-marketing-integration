import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONNECTOR_RUN_MODES,
  assertConnectorRunnable,
} from '../../packages/application/src/connectors/connector-registry.js';
import {
  JOB_TRIGGERS,
  JOB_TYPES,
} from '../../packages/application/src/jobs/job-catalog.js';
import {
  processJob,
  resolveConnectorRunMode,
} from '../../apps/sync-worker/src/active-job-router.js';

function productionRuntime(overrides = {}) {
  return {
    environment: 'production',
    profileKey: 'chemistry_k',
    customerKey: 'chemistry_k',
    connectors: {
      tiktok: {
        enabled: true,
        accountKey: 'chemistry_k',
        sourceHandle: 'chemistry_k',
      },
      instagram: {
        enabled: true,
        accountKey: 'instagram-account',
      },
    },
    ...overrides,
  };
}

function controlledUatEnv(overrides = {}) {
  return {
    MKT_PRODUCTION_CONNECTOR_UAT_ENABLED: 'true',
    MKT_PRODUCTION_CONNECTOR_UAT_CONNECTOR: 'tiktok',
    ...overrides,
  };
}

test('job catalog centralizes the controlled Production connector UAT trigger', () => {
  assert.equal(JOB_TRIGGERS.PRODUCTION_CONNECTOR_UAT, 'production_connector_uat');
});

test('standard Production execution still rejects a dev_ready connector', () => {
  assert.throws(
    () => assertConnectorRunnable(productionRuntime(), 'tiktok'),
    (error) => error.code === 'MKT_CONNECTOR_LARGE_ACCOUNT_UAT_PENDING',
  );
});

test('controlled Production UAT admits a dev_ready connector missing only liveAccountUat', () => {
  const connector = assertConnectorRunnable(productionRuntime(), 'tiktok', {
    runMode: CONNECTOR_RUN_MODES.CONTROLLED_PRODUCTION_UAT,
  });

  assert.equal(connector.enabled, true);
  assert.equal(connector.accountKey, 'chemistry_k');
});

test('controlled Production UAT does not admit a planned connector', () => {
  assert.throws(
    () => assertConnectorRunnable(productionRuntime(), 'instagram', {
      runMode: CONNECTOR_RUN_MODES.CONTROLLED_PRODUCTION_UAT,
    }),
    (error) => error.code === 'MKT_CONNECTOR_LARGE_ACCOUNT_UAT_PENDING'
      && error.details?.largeAccountStatus === 'planned'
      && error.details?.controlledProductionUatEligible === false,
  );
});

test('controlled Production UAT run mode is rejected outside Production', () => {
  assert.throws(
    () => assertConnectorRunnable({
      ...productionRuntime(),
      environment: 'development',
    }, 'tiktok', {
      runMode: CONNECTOR_RUN_MODES.CONTROLLED_PRODUCTION_UAT,
    }),
    (error) => error.code === 'MKT_PRODUCTION_CONNECTOR_UAT_ENV_INVALID',
  );
});

test('unknown connector run modes fail closed', () => {
  assert.throws(
    () => assertConnectorRunnable(productionRuntime(), 'tiktok', {
      runMode: 'bypass',
    }),
    (error) => error.code === 'MKT_CONNECTOR_RUN_MODE_INVALID',
  );
});

test('worker resolves exact Production UAT trigger and selector to controlled mode', () => {
  const mode = resolveConnectorRunMode({
    runtimeConfig: productionRuntime(),
    connectorKey: 'tiktok',
    trigger: JOB_TRIGGERS.PRODUCTION_CONNECTOR_UAT,
    env: controlledUatEnv(),
  });

  assert.equal(mode, CONNECTOR_RUN_MODES.CONTROLLED_PRODUCTION_UAT);
});

test('Production UAT trigger fails closed when the dedicated flag is disabled', () => {
  assert.throws(
    () => resolveConnectorRunMode({
      runtimeConfig: productionRuntime(),
      connectorKey: 'tiktok',
      trigger: JOB_TRIGGERS.PRODUCTION_CONNECTOR_UAT,
      env: controlledUatEnv({ MKT_PRODUCTION_CONNECTOR_UAT_ENABLED: 'false' }),
    }),
    (error) => error.code === 'MKT_PRODUCTION_CONNECTOR_UAT_DISABLED',
  );
});

test('Production UAT trigger fails closed when connector selector does not match', () => {
  assert.throws(
    () => resolveConnectorRunMode({
      runtimeConfig: productionRuntime(),
      connectorKey: 'tiktok',
      trigger: JOB_TRIGGERS.PRODUCTION_CONNECTOR_UAT,
      env: controlledUatEnv({ MKT_PRODUCTION_CONNECTOR_UAT_CONNECTOR: 'youtube' }),
    }),
    (error) => error.code === 'MKT_PRODUCTION_CONNECTOR_UAT_CONNECTOR_MISMATCH',
  );
});

test('scheduled trigger never consumes the Production UAT exception even when UAT env is enabled', () => {
  const mode = resolveConnectorRunMode({
    runtimeConfig: productionRuntime(),
    connectorKey: 'tiktok',
    trigger: 'scheduled',
    env: controlledUatEnv(),
  });

  assert.equal(mode, CONNECTOR_RUN_MODES.STANDARD);
});

test('Production UAT trigger is invalid for Development runtime', () => {
  assert.throws(
    () => resolveConnectorRunMode({
      runtimeConfig: {
        ...productionRuntime(),
        environment: 'development',
        profileKey: 'integration_workspace',
      },
      connectorKey: 'tiktok',
      trigger: JOB_TRIGGERS.PRODUCTION_CONNECTOR_UAT,
      env: controlledUatEnv(),
    }),
    (error) => error.code === 'MKT_PRODUCTION_CONNECTOR_UAT_ENV_INVALID',
  );
});

test('worker integration passes exact controlled UAT through readiness before infrastructure starts', async () => {
  let infrastructureCalls = 0;
  const sentinel = new Error('CONTROLLED_UAT_PASSED_READINESS');

  await assert.rejects(
    processJob({
      job: {
        schemaVersion: 1,
        body: {
          type: JOB_TYPES.TIKTOK_CREATOR_NATIVE_SYNC,
          trigger: JOB_TRIGGERS.PRODUCTION_CONNECTOR_UAT,
        },
      },
      env: controlledUatEnv(),
      getRuntimeConfig: () => productionRuntime(),
      getInfrastructure() {
        infrastructureCalls += 1;
        throw sentinel;
      },
    }),
    (error) => error === sentinel,
  );

  assert.equal(infrastructureCalls, 1);
});

test('worker integration keeps scheduled Production TikTok behind large-account readiness', async () => {
  let infrastructureCalls = 0;

  await assert.rejects(
    processJob({
      job: {
        schemaVersion: 1,
        body: {
          type: JOB_TYPES.TIKTOK_CREATOR_NATIVE_SYNC,
          trigger: 'scheduled',
        },
      },
      env: controlledUatEnv(),
      getRuntimeConfig: () => productionRuntime(),
      getInfrastructure() {
        infrastructureCalls += 1;
        throw new Error('must not start infrastructure');
      },
    }),
    (error) => error.code === 'MKT_CONNECTOR_LARGE_ACCOUNT_UAT_PENDING',
  );

  assert.equal(infrastructureCalls, 0);
});
