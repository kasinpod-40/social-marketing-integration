import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assertStableActiveDeployment,
  classifyYouTubeRemoteReadOnlyPreflight,
  isRetryableCloudflareD1MigrationReadError,
  normalizeYouTubeRemotePreflightDecision,
  parsePendingMigrationNames,
  readYouTubeD1MigrationListWithRetry,
} from '../../scripts/lib/youtube-remote-read-only-preflight.js';

const VERSION = '11111111-2222-4333-8444-555555555555';
const OTHER_VERSION = 'aaaaaaaa-2222-4333-8444-555555555555';

function deployment(versionId = VERSION) {
  return { id: 'deployment-1', versions: [{ version_id: versionId, percentage: 100 }] };
}

function transientD1Error() {
  const error = new Error('Wrangler D1 migration list failed');
  error.code = 1;
  error.stderr = '\u001b[31mERROR\u001b[0m internal error; reference = test [code: 7500]';
  return error;
}

test('read-only preflight requires one stable active version at 100 percent', () => {
  assert.deepEqual(assertStableActiveDeployment(deployment(), deployment()), {
    versionId: VERSION,
    traffic: 100,
    stable: true,
  });
  assert.throws(
    () => assertStableActiveDeployment(deployment(), deployment(OTHER_VERSION)),
    (error) => error.code === 'BLOCKED_ACTIVE_VERSION_CHANGED',
  );
  assert.throws(
    () => assertStableActiveDeployment(
      { versions: [{ version_id: VERSION, percentage: 99 }] },
      deployment(),
    ),
    (error) => error.code === 'YOUTUBE_REMOTE_PREFLIGHT_ACTIVE_VERSION_INVALID',
  );
});

test('migration classifier fails closed for 0017, 0018 and unknown pending migrations', () => {
  assert.deepEqual(parsePendingMigrationNames('No migrations to apply'), []);
  assert.deepEqual(
    parsePendingMigrationNames('0018_chatwoot_analytics.sql\n0018_chatwoot_analytics.sql'),
    ['0018_chatwoot_analytics.sql'],
  );
  assert.equal(
    classifyYouTubeRemoteReadOnlyPreflight({ pendingMigrations: [] }).decision,
    'PASS_READ_ONLY_PREFLIGHT',
  );
  assert.equal(
    classifyYouTubeRemoteReadOnlyPreflight({
      pendingMigrations: ['0018_chatwoot_analytics.sql'],
    }).decision,
    'BLOCKED_PENDING_MIGRATION_0018',
  );
  assert.equal(
    classifyYouTubeRemoteReadOnlyPreflight({
      pendingMigrations: ['0017_woocommerce_commerce.sql'],
    }).decision,
    'BLOCKED_MIGRATION_0017_REMOTE_TRUTH',
  );
  assert.equal(
    classifyYouTubeRemoteReadOnlyPreflight({
      pendingMigrations: ['0019_unknown.sql'],
    }).decision,
    'BLOCKED_PENDING_MIGRATIONS',
  );
});

test('D1 migration reader retries only transient Cloudflare internal code 7500', async () => {
  let attempts = 0;
  const delays = [];
  const result = await readYouTubeD1MigrationListWithRetry({
    run: async () => {
      attempts += 1;
      if (attempts < 3) throw transientD1Error();
      return 'No migrations to apply';
    },
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    baseDelayMs: 10,
  });

  assert.deepEqual(result, {
    text: 'No migrations to apply',
    attempts: 3,
    transientRetries: 2,
  });
  assert.deepEqual(delays, [10, 20]);
  assert.equal(isRetryableCloudflareD1MigrationReadError(transientD1Error()), true);
});

test('D1 migration reader does not retry authentication or ordinary command failures', async () => {
  let attempts = 0;
  await assert.rejects(
    () => readYouTubeD1MigrationListWithRetry({
      run: async () => {
        attempts += 1;
        const error = new Error('Authentication failed');
        error.code = 1;
        error.stderr = 'Unauthorized [code: 10000]';
        throw error;
      },
      sleep: async () => assert.fail('non-transient failure must not sleep'),
    }),
    (error) => error.code === 'YOUTUBE_REMOTE_PREFLIGHT_D1_MIGRATION_READ_FAILED'
      && error.details.attempts === 1
      && error.details.retryable === false,
  );
  assert.equal(attempts, 1);
});

test('D1 migration reader fails with a semantic decision after bounded transient exhaustion', async () => {
  let attempts = 0;
  await assert.rejects(
    () => readYouTubeD1MigrationListWithRetry({
      run: async () => {
        attempts += 1;
        throw transientD1Error();
      },
      sleep: async () => {},
      maxAttempts: 3,
      baseDelayMs: 0,
    }),
    (error) => error.code === 'YOUTUBE_REMOTE_PREFLIGHT_D1_MIGRATION_READ_TRANSIENT_EXHAUSTED'
      && error.details.attempts === 3
      && error.details.transientRetries === 2
      && error.details.cloudflareCode === 7500,
  );
  assert.equal(attempts, 3);
});

test('numeric child-process exit codes never become public preflight decisions', () => {
  assert.equal(normalizeYouTubeRemotePreflightDecision(1), 'BLOCKED_REMOTE_CONTRACT');
  assert.equal(normalizeYouTubeRemotePreflightDecision(''), 'BLOCKED_REMOTE_CONTRACT');
  assert.equal(
    normalizeYouTubeRemotePreflightDecision(
      'YOUTUBE_REMOTE_PREFLIGHT_D1_MIGRATION_READ_TRANSIENT_EXHAUSTED',
    ),
    'YOUTUBE_REMOTE_PREFLIGHT_D1_MIGRATION_READ_TRANSIENT_EXHAUSTED',
  );
});

test('terminal operator remains read-only and uses guarded migration read compatibility', async () => {
  const source = await readFile(new URL(
    '../../scripts/youtube-remote-read-only-preflight.mjs',
    import.meta.url,
  ), 'utf8');

  assert.match(source, /validateLiveRemoteYouTubeDeploymentContract/u);
  assert.match(source, /queueConsumerContexts/u);
  assert.match(source, /assertStableActiveDeployment/u);
  assert.match(source, /readYouTubeD1MigrationListWithRetry/u);
  assert.match(source, /normalizeYouTubeRemotePreflightDecision/u);
  assert.match(source, /'d1', 'migrations', 'list'/u);
  assert.match(source, /'queues', 'consumer', 'list'/u);
  assert.match(source, /'deployments', 'status'/u);
  assert.match(source, /'versions', 'view'/u);
  assert.doesNotMatch(source, /'d1', 'execute'/u);
  assert.doesNotMatch(source, /'wrangler', 'deploy'|'deploy', '--strict'/u);
  assert.doesNotMatch(source, /\/queues\/.*\/messages/u);
  assert.doesNotMatch(source, /youtube\.googleapis\.com|open\.larksuite\.com/u);
});
