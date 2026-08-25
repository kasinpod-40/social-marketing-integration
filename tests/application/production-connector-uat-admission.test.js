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
  resolveYouTubeActiveWorkKey,
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
      youtube: {
        enabled: true,
        accountKey: 'chemistry_k',
      },
      woocommerce: {
        enabled: true,
        accountKey: 'chemistry_k',
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

test('standard Production execution admits a verified connector', () => {
  const connector = assertConnectorRunnable(productionRuntime(), 'tiktok');

  assert.equal(connector.enabled, true);
  assert.equal(connector.accountKey, 'chemistry_k');
});

test('controlled Production UAT admits a dev_ready connector missing only liveAccountUat', () => {
  const connector = assertConnectorRunnable(productionRuntime(), 'woocommerce', {
    runMode: CONNECTOR_RUN_MODES.CONTROLLED_PRODUCTION_UAT,
  });

  assert.equal(connector.enabled, true);
  assert.equal(connector.accountKey, 'chemistry_k');
});

test('controlled Production UAT does not replace normal admission for an already verified connector', () => {
  assert.throws(
    () => assertConnectorRunnable(productionRuntime(), 'instagram', {
      runMode: CONNECTOR_RUN_MODES.CONTROLLED_PRODUCTION_UAT,
    }),
    (error) => error.code === 'MKT_CONNECTOR_LARGE_ACCOUNT_UAT_PENDING'
      && error.details?.largeAccountStatus === 'verified'
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

test('worker integration admits verified YouTube through normal Production readiness', async () => {
  let infrastructureCalls = 0;
  const sentinel = new Error('VERIFIED_YOUTUBE_PASSED_READINESS');

  await assert.rejects(
    processJob({
      job: {
        schemaVersion: 1,
        body: {
          type: JOB_TYPES.YOUTUBE_ORGANIC_SYNC,
          trigger: 'scheduled',
        },
      },
      env: controlledUatEnv({ MKT_PRODUCTION_CONNECTOR_UAT_ENABLED: 'false' }),
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

test('controlled YouTube Production UAT resumes from stable operation workKey across message IDs', () => {
  const operationId = 'a97f16d52bf8d1cf89befca7fa6ed455';
  const input = {
    job: { body: { trigger: JOB_TRIGGERS.PRODUCTION_CONNECTOR_UAT } },
    message: { id: 'new-delivery-id' },
    operation: {
      stable: true,
      operationId,
      workKey: `youtube:${operationId}`,
    },
  };

  assert.equal(resolveYouTubeActiveWorkKey(input), `youtube:${operationId}`);
});

test('scheduled YouTube execution resumes from its stable daily operation identity', () => {
  assert.equal(resolveYouTubeActiveWorkKey({
    job: { body: { trigger: 'scheduled' } },
    message: { id: 'scheduled-delivery' },
    operation: {
      stable: true,
      operationId: 'youtube-scheduled-20260825',
      workKey: 'youtube:youtube-scheduled-20260825',
    },
  }), 'youtube:youtube-scheduled-20260825');
});

test('controlled YouTube Production UAT rejects unstable recovery identity', () => {
  assert.throws(() => resolveYouTubeActiveWorkKey({
    job: { body: { trigger: JOB_TRIGGERS.PRODUCTION_CONNECTOR_UAT } },
    message: { id: 'different-delivery' },
    operation: {
      stable: false,
      operationId: 'youtube-operation',
      workKey: 'youtube:youtube-operation',
    },
  }), (error) => error.code === 'YOUTUBE_PRODUCTION_UAT_OPERATION_INVALID');
});

test('worker integration admits scheduled Production TikTok after verified readiness', async () => {
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
        throw new Error('VERIFIED_TIKTOK_PASSED_READINESS');
      },
    }),
    (error) => error.message === 'VERIFIED_TIKTOK_PASSED_READINESS',
  );

  assert.equal(infrastructureCalls, 1);
});
