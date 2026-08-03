import assert from 'node:assert/strict';
import test from 'node:test';

import {
  META_K2_PREVIEW_RECOVERY_CONFIRMATION,
  assertMetaK2PreviewRecoveryConfirmation,
  buildMetaK2PreviewRecoveryUrl,
  buildMetaK2PreviewRuntimeConfig,
  validateMetaK2PreviewTransport,
} from '../../scripts/lib/meta-k2-preview-recovery.js';

test('builds an isolated Preview config while retaining exact runtime bindings', () => {
  const source = JSON.stringify({
    name: 'social-mkt-sync-worker',
    main: '/repo/apps/sync-worker/src/index.js',
    compatibility_date: '2026-07-01',
    workers_dev: false,
    routes: [{ pattern: 'sync.example.com/*' }],
    triggers: { crons: ['*/5 * * * *'] },
    d1_databases: [{ binding: 'MKT_STATE_DB', database_id: 'db-id' }],
    queues: {
      producers: [{ binding: 'MKT_SYNC_QUEUE', queue: 'main' }],
      consumers: [{ queue: 'main' }],
    },
    vars: {
      MKT_ENV: 'development',
      MKT_CONNECTOR_META_ADS_ENABLED: false,
      MKT_META_D1_WRITE_ENABLED: true,
    },
    env: {
      development: {
        vars: { MKT_CONNECTOR_META_ADS_ENABLED: true },
      },
    },
  });
  const result = buildMetaK2PreviewRuntimeConfig(source, {
    repositoryRoot: '/repo',
  });
  const parsed = JSON.parse(result.text);
  assert.equal(parsed.main, '/repo/apps/sync-worker/src/meta-k2-exact-recovery-preview-entry.js');
  assert.equal(parsed.workers_dev, false);
  assert.equal(parsed.preview_urls, true);
  assert.equal(parsed.routes, undefined);
  assert.equal(parsed.triggers, undefined);
  assert.equal(parsed.env, undefined);
  assert.equal(result.d1BindingCount, 1);
  assert.equal(result.queueProducerCount, 1);
  assert.equal(result.queueConsumerCount, 1);
  assert.deepEqual(result.trueFlags, ['MKT_META_D1_WRITE_ENABLED']);
  assert.equal(result.routesCopied, 0);
  assert.equal(result.scheduleTriggersCopied, 0);
  assert.equal(result.secretValuesCopied, 0);
});

test('builds only the exact aliased Preview recovery URL', () => {
  assert.equal(
    buildMetaK2PreviewRecoveryUrl({
      previewAlias: 'meta-k2-recovery-abc123',
      accountWorkersDevSubdomain: 'integration-workspace',
    }),
    'https://meta-k2-recovery-abc123-social-mkt-sync-worker.integration-workspace.workers.dev/operator/meta/d1-only-partial-staging-continuation',
  );
});

test('requires explicit preview confirmation and unchanged production version', () => {
  assert.throws(
    () => assertMetaK2PreviewRecoveryConfirmation({}),
    (error) => error.code === 'META_K2_PREVIEW_RECOVERY_CONFIRMATION_REQUIRED',
  );
  assert.equal(
    assertMetaK2PreviewRecoveryConfirmation({
      [META_K2_PREVIEW_RECOVERY_CONFIRMATION.envName]:
        META_K2_PREVIEW_RECOVERY_CONFIRMATION.value,
    }),
    true,
  );

  const baseline = '11111111-1111-4111-8111-111111111111';
  const preview = '22222222-2222-4222-8222-222222222222';
  const result = validateMetaK2PreviewTransport({
    productionBaselineVersion: baseline,
    productionCurrentVersion: baseline,
    previewVersion: preview,
  });
  assert.equal(result.productionDeploymentUnchanged, true);
  assert.equal(result.productionTrafficChange, false);
  assert.equal(result.workerDeploymentCount, 0);
  assert.equal(result.workerVersionUploadCount, 1);

  assert.throws(
    () => validateMetaK2PreviewTransport({
      productionBaselineVersion: baseline,
      productionCurrentVersion: preview,
      previewVersion: preview,
    }),
    (error) => error.code === 'META_K2_PREVIEW_PRODUCTION_VERSION_DRIFT',
  );
});

test('rejects a wrong Worker identity', () => {
  assert.throws(
    () => buildMetaK2PreviewRuntimeConfig(JSON.stringify({
      name: 'other-worker',
      main: '/repo/apps/sync-worker/src/index.js',
      vars: {},
    }), { repositoryRoot: '/repo' }),
    (error) => error.code === 'META_K2_PREVIEW_CONFIG_INVALID',
  );
});
