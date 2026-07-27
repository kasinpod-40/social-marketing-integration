import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHATWOOT_SAFE_WRANGLER_CONFIG_CONTRACT_VERSION,
  buildChatwootSafeWranglerConfig,
  parseJsoncObject,
} from '../../scripts/lib/chatwoot-safe-wrangler-config.js';
import {
  rebaseGeneratedWranglerConfigPaths,
} from '../../scripts/lib/rebase-generated-wrangler-config-paths.js';
import {
  CHATWOOT_REMOTE_REQUIRED_FALSE_FLAGS,
  validateChatwootRemoteWranglerConfig,
} from '../../scripts/lib/chatwoot-remote-readiness-operator.js';

test('Chatwoot safe generator parses JSONC and emits a minimal all-false config', () => {
  const result = buildChatwootSafeWranglerConfig(createSourceConfig());
  const generated = JSON.parse(result.text);

  assert.equal(
    result.contractVersion,
    CHATWOOT_SAFE_WRANGLER_CONFIG_CONTRACT_VERSION,
  );
  assert.equal(result.workerName, 'social-mkt-sync-worker');
  assert.equal(result.databaseName, 'social-mkt-state-dev');
  assert.equal(result.mainQueueName, 'social-mkt-sync-jobs');
  assert.equal(result.dlqName, 'social-mkt-sync-dlq');
  assert.equal(result.falseFlagCount, CHATWOOT_REMOTE_REQUIRED_FALSE_FLAGS.length);
  assert.equal(result.secretValuesCopied, 0);
  assert.equal(result.providerValuesCopied, 0);
  assert.equal(result.scheduleValuesCopied, 0);
  assert.equal(result.routeValuesCopied, 0);
  assert.match(result.sha256, /^[0-9a-f]{64}$/u);
  assert.match(result.databaseIdFingerprint, /^[0-9a-f]{64}$/u);

  assert.equal(generated.workers_dev, false);
  assert.equal(generated.triggers, undefined);
  assert.equal(generated.routes, undefined);
  assert.equal(generated.vars.CHATWOOT_BASE_URL, undefined);
  assert.equal(generated.vars.CHATWOOT_ACCOUNT_ID, undefined);
  assert.equal(generated.vars.CHATWOOT_API_ACCESS_TOKEN, undefined);
  assert.equal(generated.vars.GOOGLE_OAUTH_CLIENT_ID, undefined);
  assert.equal(generated.d1_databases[0].database_id, '11111111-1111-4111-8111-111111111111');

  for (const flag of CHATWOOT_REMOTE_REQUIRED_FALSE_FLAGS) {
    assert.equal(generated.vars[flag], 'false', flag);
  }
  assert.equal(
    validateChatwootRemoteWranglerConfig(result.text).allExecutionFlagsFalse,
    true,
  );
});

test('Chatwoot safe generator rebases config-relative paths for ignored outputs', () => {
  const result = buildChatwootSafeWranglerConfig(createSourceConfig());
  const rebased = rebaseGeneratedWranglerConfigPaths(result.text, {
    sourceDirectory: '/workspace/repository',
    outputDirectory: '/workspace/repository/outputs/chatwoot-remote-readiness',
  });
  const generated = JSON.parse(rebased.text);

  assert.equal(generated.main, '../../apps/sync-worker/src/index.js');
  assert.equal(generated.d1_databases[0].migrations_dir, '../../migrations');
  assert.equal(generated.$schema, '../../node_modules/wrangler/config-schema.json');
  assert.equal(rebased.main, '../../apps/sync-worker/src/index.js');
  assert.equal(rebased.migrationsDirectory, '../../migrations');
  assert.match(rebased.sha256, /^[0-9a-f]{64}$/u);
  assert.equal(
    validateChatwootRemoteWranglerConfig(rebased.text).allExecutionFlagsFalse,
    true,
  );
});

test('Chatwoot safe generator closes true and omitted source flags without copying business values', () => {
  const source = createSourceConfig()
    .replace(
      '"MKT_CONNECTOR_CHATWOOT_ENABLED": "true",',
      '"MKT_CONNECTOR_CHATWOOT_ENABLED": "true",\n      "MKT_META_D1_WRITE_ENABLED": "true",',
    );
  const generated = JSON.parse(buildChatwootSafeWranglerConfig(source).text);

  assert.equal(generated.vars.MKT_CONNECTOR_CHATWOOT_ENABLED, 'false');
  assert.equal(generated.vars.MKT_META_D1_WRITE_ENABLED, 'false');
  assert.equal(generated.vars.MKT_CONNECTOR_YOUTUBE_ENABLED, 'false');
  assert.equal(generated.vars.CHATWOOT_BASE_URL, undefined);
  assert.equal(generated.vars.META_FACEBOOK_PAGE_ID, undefined);
});

test('Chatwoot safe generator rejects target and Queue topology drift', () => {
  assert.throws(
    () => buildChatwootSafeWranglerConfig(createSourceConfig().replace(
      '"database_name": "social-mkt-state-dev"',
      '"database_name": "another-database"',
    )),
    (error) => error.code === 'CHATWOOT_SAFE_CONFIG_TARGET_INVALID',
  );
  assert.throws(
    () => buildChatwootSafeWranglerConfig(createSourceConfig().replace(
      '"max_retries": 5,',
      '"max_retries": 4,',
    )),
    (error) => error.code === 'CHATWOOT_SAFE_CONFIG_TOPOLOGY_INVALID',
  );
  assert.throws(
    () => buildChatwootSafeWranglerConfig(createSourceConfig().replace(
      '"database_id": "11111111-1111-4111-8111-111111111111"',
      '"database_id": "not-a-uuid"',
    )),
    (error) => error.code === 'CHATWOOT_SAFE_CONFIG_TARGET_INVALID',
  );
});

test('JSONC parser preserves comment markers inside strings and removes trailing commas', () => {
  const value = parseJsoncObject(`{
    // comment
    "url": "https://example.test/a//b",
    "pattern": "/*not-comment*/",
    "items": [1, 2,],
  }`);
  assert.deepEqual(value, {
    url: 'https://example.test/a//b',
    pattern: '/*not-comment*/',
    items: [1, 2],
  });
});

function createSourceConfig() {
  return `{
    // Local Integration Workspace config. Secret values are stored separately.
    "$schema": "./node_modules/wrangler/config-schema.json",
    "name": "social-mkt-sync-worker",
    "main": "./apps/sync-worker/src/index.js",
    "compatibility_date": "2026-07-15",
    "compatibility_flags": ["nodejs_compat",],
    "account_id": "11111111111111111111111111111111",
    "workers_dev": false,
    "triggers": { "crons": ["*/5 * * * *"] },
    "routes": [{ "pattern": "unsafe.example/*", "zone_name": "unsafe.example" }],
    "d1_databases": [{
      "binding": "MKT_STATE_DB",
      "database_name": "social-mkt-state-dev",
      "database_id": "11111111-1111-4111-8111-111111111111",
      "migrations_dir": "./migrations",
    }],
    "queues": {
      "producers": [{
        "binding": "MKT_SYNC_QUEUE",
        "queue": "social-mkt-sync-jobs",
      }],
      "consumers": [{
        "queue": "social-mkt-sync-jobs",
        "max_concurrency": 1,
        "max_batch_size": 10,
        "max_batch_timeout": 30,
        "max_retries": 5,
        "dead_letter_queue": "social-mkt-sync-dlq",
      }, {
        "queue": "social-mkt-sync-dlq",
        "max_concurrency": 1,
        "max_batch_size": 10,
        "max_batch_timeout": 30,
        "max_retries": 10,
      }],
    },
    "vars": {
      "MKT_ENV": "development",
      "MKT_CUSTOMER_PROFILE": "integration_workspace",
      "MKT_CONNECTION_CUSTOMER_KEY": "chemistry_k",
      "MKT_CONNECTOR_CHATWOOT_ENABLED": "true",
      "CHATWOOT_BASE_URL": "https://customer.example",
      "CHATWOOT_ACCOUNT_ID": "123",
      "GOOGLE_OAUTH_CLIENT_ID": "not-copied",
      "META_FACEBOOK_PAGE_ID": "not-copied",
    },
  }`;
}
