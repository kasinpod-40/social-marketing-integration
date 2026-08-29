import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMetaK2LocalLarkProjectionPreviewConfig,
  buildMetaK2LocalLarkProjectionUrl,
} from '../../scripts/lib/meta-k2-local-lark-projection-preview.js';

test('builds an exact trafficless local Lark Projection Preview config', () => {
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
    vars: { MKT_ENV: 'production', MKT_CUSTOMER_PROFILE: 'chemistry_k' },
  });
  const result = buildMetaK2LocalLarkProjectionPreviewConfig(source, {
    repositoryRoot: '/repo',
    operationId: 'meta-ads-chemistry-k2-scheduled-20260828',
    workKey: 'meta_ads:chemistry_k2:meta-ads-chemistry-k2-scheduled-20260828',
    generation: 1_787_938_203_000,
    tokenSha256: 'a'.repeat(64),
  });
  const parsed = JSON.parse(result.text);
  assert.equal(parsed.main, '/repo/apps/sync-worker/src/meta-k2-local-lark-projection-preview-entry.js');
  assert.equal(parsed.queues, undefined);
  assert.equal(parsed.routes, undefined);
  assert.equal(parsed.triggers, undefined);
  assert.equal(parsed.vars.MKT_META_K2_LOCAL_LARK_PROJECTION_GENERATION, '1787938203000');
  assert.equal(result.queueProducerCount, 0);
  assert.equal(result.queueConsumerCount, 0);
});

test('builds only the exact local Lark Projection Preview URL', () => {
  assert.equal(
    buildMetaK2LocalLarkProjectionUrl({
      previewAlias: 'meta-k2-local-lark-a1b2c3',
      accountWorkersDevSubdomain: 'integration-workspace',
    }),
    'https://meta-k2-local-lark-a1b2c3-social-mkt-sync-worker.integration-workspace.workers.dev/operator/meta/k2-local-lark-projection',
  );
});
