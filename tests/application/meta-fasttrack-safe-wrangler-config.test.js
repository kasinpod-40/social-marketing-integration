import test from 'node:test';
import assert from 'node:assert/strict';
import {
  META_END_TO_END_REQUIRED_LARK_TABLE_KEYS,
} from '../../packages/config/src/meta-end-to-end-runtime-config.js';
import {
  LARK_TABLE_ENV,
} from '../../packages/config/src/lark-table-config.js';
import {
  META_D1_ONLY_REQUIRED_FALSE_FLAGS,
} from '../../scripts/lib/meta-d1-only-rollout-operator.js';
import {
  META_FASTTRACK_SAFE_CONFIG_CONTRACT_VERSION,
  buildMetaFastTrackSafeWranglerConfig,
  buildMetaFastTrackWranglerDryRunArgs,
} from '../../scripts/lib/meta-fasttrack-safe-wrangler-config.js';
import {
  rebaseGeneratedWranglerConfigPaths,
} from '../../scripts/lib/rebase-generated-wrangler-config-paths.js';

test('Meta fast-track generator closes flags and synchronizes all required Lark mappings', () => {
  const env = createTableEnv('current');
  const result = buildMetaFastTrackSafeWranglerConfig(createSourceConfig(), env);
  const generated = JSON.parse(result.text);

  assert.equal(
    result.contractVersion,
    META_FASTTRACK_SAFE_CONFIG_CONTRACT_VERSION,
  );
  assert.equal(result.tableMappingCount, 15);
  assert.equal(result.changedTableMappingNames.length, 15);
  assert.deepEqual(result.sourceEnabledFlagNames, [
    'MKT_CONNECTOR_FACEBOOK_ENABLED',
    'MKT_SCHEDULE_WOOCOMMERCE_ENABLED',
  ]);
  assert.equal(result.secretValuesCopied, 0);
  assert.match(result.sha256, /^[0-9a-f]{64}$/u);
  assert.match(result.tableMappingFingerprint, /^[0-9a-f]{64}$/u);
  assert.match(result.d1ActiveSha256, /^[0-9a-f]{64}$/u);
  assert.match(result.larkActiveSha256, /^[0-9a-f]{64}$/u);
  assert.equal(generated.workers_dev, false);

  for (const flag of META_D1_ONLY_REQUIRED_FALSE_FLAGS) {
    assert.equal(generated.vars[flag], 'false', flag);
  }
  for (const [name, value] of Object.entries(generated.vars)) {
    if (/^MKT_[A-Z0-9_]+_ENABLED$/u.test(name)) {
      assert.equal(value, 'false', name);
    }
  }
  for (const key of META_END_TO_END_REQUIRED_LARK_TABLE_KEYS) {
    assert.equal(generated.vars[LARK_TABLE_ENV[key]], env[LARK_TABLE_ENV[key]]);
  }
});

test('Meta fast-track generator accepts omitted workers_dev but rejects enabled or invalid values', () => {
  const env = createTableEnv('current');
  const omitted = createSourceConfig().replace('    "workers_dev": false,\n', '');
  const generated = JSON.parse(buildMetaFastTrackSafeWranglerConfig(omitted, env).text);
  assert.equal(generated.workers_dev, false);

  for (const unsafeValue of ['true', '"false"', 'null']) {
    const unsafe = createSourceConfig().replace(
      '"workers_dev": false',
      `"workers_dev": ${unsafeValue}`,
    );
    assert.throws(
      () => buildMetaFastTrackSafeWranglerConfig(unsafe, env),
      (error) => (
        error.code === 'META_FASTTRACK_SAFE_CONFIG_TARGET_INVALID'
        && error.details.fieldName === 'workers_dev'
      ),
      unsafeValue,
    );
  }
});

test('Meta fast-track Wrangler dry-run uses a deterministic outfile', () => {
  const args = buildMetaFastTrackWranglerDryRunArgs(
    '/workspace/outputs/wrangler.safe.jsonc',
    '/tmp/meta-fasttrack/worker.bundle.js',
  );

  assert.deepEqual(args, [
    'wrangler',
    'deploy',
    '--dry-run',
    '--outfile',
    '/tmp/meta-fasttrack/worker.bundle.js',
    '--config',
    '/workspace/outputs/wrangler.safe.jsonc',
  ]);
  assert.equal(args.includes('--outdir'), false);
  assert.throws(
    () => buildMetaFastTrackWranglerDryRunArgs('', '/tmp/worker.js'),
    (error) => (
      error.code === 'META_FASTTRACK_SAFE_CONFIG_DRY_RUN_ARGUMENT_INVALID'
      && error.details.fieldName === 'configPath'
    ),
  );
  assert.throws(
    () => buildMetaFastTrackWranglerDryRunArgs('/tmp/wrangler.jsonc', ' '),
    (error) => (
      error.code === 'META_FASTTRACK_SAFE_CONFIG_DRY_RUN_ARGUMENT_INVALID'
      && error.details.fieldName === 'outputFile'
    ),
  );
});

test('Meta fast-track generator emits valid JSON that can be path-rebased', () => {
  const result = buildMetaFastTrackSafeWranglerConfig(
    createSourceConfig(),
    createTableEnv('current'),
  );
  const rebased = rebaseGeneratedWranglerConfigPaths(result.text, {
    sourceDirectory: '/workspace/repository',
    outputDirectory: '/workspace/repository/outputs/meta-fasttrack-config',
  });
  const generated = JSON.parse(rebased.text);

  assert.equal(generated.main, '../../apps/sync-worker/src/index.js');
  assert.equal(generated.d1_databases[0].migrations_dir, '../../migrations');
  assert.equal(generated.$schema, '../../node_modules/wrangler/config-schema.json');
  assert.match(rebased.sha256, /^[0-9a-f]{64}$/u);
});

test('Meta fast-track generator rejects malformed JSONC and secret-shaped vars', () => {
  assert.throws(
    () => buildMetaFastTrackSafeWranglerConfig(
      '{ "name": "social-mkt-sync-worker" }}',
      createTableEnv('current'),
    ),
    (error) => error.code === 'META_FASTTRACK_SAFE_CONFIG_SOURCE_INVALID',
  );

  const withSecret = createSourceConfig().replace(
    '"MKT_ENV": "development",',
    '"MKT_ENV": "development",\n      "META_ACCESS_TOKEN": "must-not-copy",',
  );
  assert.throws(
    () => buildMetaFastTrackSafeWranglerConfig(withSecret, createTableEnv('current')),
    (error) => (
      error.code === 'META_FASTTRACK_SAFE_CONFIG_SECRET_VALUE_BLOCKED'
      && error.details.secretVarNames.includes('META_ACCESS_TOKEN')
    ),
  );
});

test('Meta fast-track generator fails closed on duplicate Lark table IDs', () => {
  const env = createTableEnv('current');
  const first = META_END_TO_END_REQUIRED_LARK_TABLE_KEYS[0];
  const second = META_END_TO_END_REQUIRED_LARK_TABLE_KEYS[1];
  env[LARK_TABLE_ENV[second]] = env[LARK_TABLE_ENV[first]];

  assert.throws(
    () => buildMetaFastTrackSafeWranglerConfig(createSourceConfig(), env),
    (error) => error.code === 'LARK_TABLE_CONFIG_INVALID',
  );
});

function createTableEnv(prefix) {
  return Object.fromEntries(META_END_TO_END_REQUIRED_LARK_TABLE_KEYS.map((key, index) => [
    LARK_TABLE_ENV[key],
    `tbl_${prefix}_${String(index + 1).padStart(2, '0')}`,
  ]));
}

function createSourceConfig() {
  const staleMappings = META_END_TO_END_REQUIRED_LARK_TABLE_KEYS.map((key, index) => (
    `      "${LARK_TABLE_ENV[key]}": "tbl_stale_${String(index + 1).padStart(2, '0')}",`
  )).join('\n');

  return `{
    // Local Integration Workspace config. Credentials remain outside Wrangler vars.
    "$schema": "./node_modules/wrangler/config-schema.json",
    "name": "social-mkt-sync-worker",
    "main": "./apps/sync-worker/src/index.js",
    "compatibility_date": "2026-07-15",
    "compatibility_flags": ["nodejs_compat",],
    "account_id": "11111111111111111111111111111111",
    "workers_dev": false,
    "triggers": { "crons": ["*/5 * * * *"] },
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
      "MKT_CONNECTOR_FACEBOOK_ENABLED": "true",
      "MKT_SCHEDULE_WOOCOMMERCE_ENABLED": "true",
      "META_GRAPH_API_VERSION": "v25.0",
${staleMappings}
    },
  }`;
}
