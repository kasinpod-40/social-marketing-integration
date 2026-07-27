import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assertStableActiveDeployment,
  classifyYouTubeRemoteReadOnlyPreflight,
  parsePendingMigrationNames,
} from '../../scripts/lib/youtube-remote-read-only-preflight.js';

const VERSION = '11111111-2222-4333-8444-555555555555';
const OTHER_VERSION = 'aaaaaaaa-2222-4333-8444-555555555555';

function deployment(versionId = VERSION) {
  return { id: 'deployment-1', versions: [{ version_id: versionId, percentage: 100 }] };
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

test('terminal operator remains read-only and uses the merged compatibility adapter', async () => {
  const source = await readFile(new URL(
    '../../scripts/youtube-remote-read-only-preflight.mjs',
    import.meta.url,
  ), 'utf8');

  assert.match(source, /validateLiveRemoteYouTubeDeploymentContract/u);
  assert.match(source, /queueConsumerContexts/u);
  assert.match(source, /assertStableActiveDeployment/u);
  assert.match(source, /'d1', 'migrations', 'list'/u);
  assert.match(source, /'queues', 'consumer', 'list'/u);
  assert.match(source, /'deployments', 'status'/u);
  assert.match(source, /'versions', 'view'/u);
  assert.doesNotMatch(source, /'d1', 'execute'/u);
  assert.doesNotMatch(source, /'wrangler', 'deploy'|'deploy', '--strict'/u);
  assert.doesNotMatch(source, /\/queues\/.*\/messages/u);
  assert.doesNotMatch(source, /youtube\.googleapis\.com|open\.larksuite\.com/u);
});
