import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  YOUTUBE_DRY_RUN_OPERATOR_CONTRACT_VERSION,
  compareYouTubeDryRunConfigs,
} from '../../scripts/lib/youtube-dry-run-rollout-operator.js';
import {
  normalizeScopedWranglerQueueConsumers,
  normalizeWranglerVersionD1Binding,
  validateLiveRemoteYouTubeDeploymentContract,
} from '../../scripts/lib/youtube-live-remote-contract-parser.js';

const HEAD = '7f06ae8729dd24c3bd6f548332bfe17ba374c8ab';
const VERSION = '11111111-2222-4333-8444-555555555555';
const DATABASE_ID = '12345678-1234-4234-9234-123456789abc';
const MAIN_QUEUE = 'social-mkt-sync-jobs';
const DLQ = 'social-mkt-sync-dlq';

test('scoped Queue parser restores omitted Queue name from reviewed command context', () => {
  const normalized = normalizeScopedWranglerQueueConsumers({
    consumers: [{
      settings: {
        max_concurrency: 1,
        batch_size: 10,
        max_wait_time_ms: 30000,
        max_retries: 5,
        dead_letter_queue: DLQ,
      },
    }],
  }, { expectedQueueName: MAIN_QUEUE });

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].queue_name, MAIN_QUEUE);
  assert.equal(normalized[0].settings.max_wait_time_ms, 30000);
  assert.equal(normalized[0].settings.max_batch_timeout, 30);
  assert.equal(normalized[0].settings.dead_letter_queue, DLQ);
});

test('scoped Queue parser rejects explicit response or consumer name drift', () => {
  for (const response of [
    {
      queue_name: DLQ,
      consumers: [{ settings: queueSettings(5, DLQ) }],
    },
    [{
      queue_name: DLQ,
      settings: queueSettings(5, DLQ),
    }],
  ]) {
    assert.throws(
      () => normalizeScopedWranglerQueueConsumers(response, {
        expectedQueueName: MAIN_QUEUE,
      }),
      (error) => error.code === 'YOUTUBE_DRY_RUN_REMOTE_QUEUE_CONTEXT_MISMATCH',
    );
  }
});

test('D1 parser accepts omitted display name only after exact UUID verification', () => {
  const normalized = normalizeWranglerVersionD1Binding(versionFixture({
    includeDatabaseName: false,
  }), {
    expectedDatabaseId: DATABASE_ID,
    expectedDatabaseName: 'social-mkt-state-dev',
  });
  const binding = normalized.bindings.find((item) => item.name === 'MKT_STATE_DB');
  assert.equal(binding.database_id, DATABASE_ID);
  assert.equal(binding.database_name, 'social-mkt-state-dev');
});

test('D1 parser fails closed on missing UUID, UUID drift or explicit name drift', () => {
  const missingUuid = versionFixture({ includeDatabaseName: false });
  delete missingUuid.bindings.find((item) => item.name === 'MKT_STATE_DB').database_id;
  assert.throws(
    () => normalizeWranglerVersionD1Binding(missingUuid, {
      expectedDatabaseId: DATABASE_ID,
      expectedDatabaseName: 'social-mkt-state-dev',
    }),
    (error) => error.code === 'YOUTUBE_DRY_RUN_REMOTE_D1_UUID_REQUIRED',
  );

  const wrongUuid = versionFixture({ includeDatabaseName: false });
  wrongUuid.bindings.find((item) => item.name === 'MKT_STATE_DB').database_id
    = '87654321-4321-4321-9234-cba987654321';
  assert.throws(
    () => normalizeWranglerVersionD1Binding(wrongUuid, {
      expectedDatabaseId: DATABASE_ID,
      expectedDatabaseName: 'social-mkt-state-dev',
    }),
    (error) => error.code === 'YOUTUBE_DRY_RUN_REMOTE_D1_UUID_MISMATCH',
  );

  const wrongName = versionFixture({ includeDatabaseName: true });
  wrongName.bindings.find((item) => item.name === 'MKT_STATE_DB').database_name = 'other-db';
  assert.throws(
    () => normalizeWranglerVersionD1Binding(wrongName, {
      expectedDatabaseId: DATABASE_ID,
      expectedDatabaseName: 'social-mkt-state-dev',
    }),
    (error) => error.code === 'YOUTUBE_DRY_RUN_REMOTE_D1_NAME_MISMATCH',
  );
});

test('live compatibility adapter preserves the reviewed deterministic Remote fingerprint', async () => {
  const safe = await safeConfig();
  const active = safe
    .replace('"MKT_CONNECTOR_YOUTUBE_ENABLED": "false"', '"MKT_CONNECTOR_YOUTUBE_ENABLED": "true"')
    .replace('"MKT_YOUTUBE_END_TO_END_ENABLED": "false"', '"MKT_YOUTUBE_END_TO_END_ENABLED": "true"');
  const comparison = compareYouTubeDryRunConfigs(safe, active, { channelId: 'UC_TEST' });
  const versionsView = versionFixture({
    config: safe,
    includeDatabaseName: false,
  });
  const triggerState = remoteTriggerState();

  const first = validateLiveRemoteYouTubeDeploymentContract({
    versionsView,
    deploymentStatus: deploymentStatus(),
    queueConsumerContexts: scopedConsumerResponses(),
    expectedDatabaseId: DATABASE_ID,
    expectedDatabaseName: 'social-mkt-state-dev',
    expectedFalseFlagNames: expectedFalseFlags(comparison),
    workerName: 'social-mkt-sync-worker',
    ...triggerState,
    active: false,
    expectedRemoteFingerprint: comparison.safe.remoteContractFingerprint,
  });
  const second = validateLiveRemoteYouTubeDeploymentContract({
    versionsView: structuredClone(versionsView),
    deploymentStatus: deploymentStatus(),
    queueConsumerContexts: structuredClone(scopedConsumerResponses()),
    expectedDatabaseId: DATABASE_ID,
    expectedDatabaseName: 'social-mkt-state-dev',
    expectedFalseFlagNames: expectedFalseFlags(comparison),
    workerName: 'social-mkt-sync-worker',
    ...structuredClone(triggerState),
    active: false,
    expectedRemoteFingerprint: comparison.safe.remoteContractFingerprint,
  });

  assert.equal(first.remoteFingerprint, comparison.safe.remoteContractFingerprint);
  assert.equal(second.remoteFingerprint, first.remoteFingerprint);
  assert.equal(first.queueConsumerCount, 2);
});

test('live compatibility adapter keeps Main Queue and DLQ contexts distinct', async () => {
  const safe = await safeConfig();
  const active = safe
    .replace('"MKT_CONNECTOR_YOUTUBE_ENABLED": "false"', '"MKT_CONNECTOR_YOUTUBE_ENABLED": "true"')
    .replace('"MKT_YOUTUBE_END_TO_END_ENABLED": "false"', '"MKT_YOUTUBE_END_TO_END_ENABLED": "true"');
  const comparison = compareYouTubeDryRunConfigs(safe, active, { channelId: 'UC_TEST' });
  const contexts = scopedConsumerResponses();
  contexts[1].expectedQueueName = MAIN_QUEUE;

  assert.throws(
    () => validateLiveRemoteYouTubeDeploymentContract({
      versionsView: versionFixture({ config: safe, includeDatabaseName: false }),
      deploymentStatus: deploymentStatus(),
      queueConsumerContexts: contexts,
      expectedDatabaseId: DATABASE_ID,
      expectedDatabaseName: 'social-mkt-state-dev',
      expectedFalseFlagNames: expectedFalseFlags(comparison),
      workerName: 'social-mkt-sync-worker',
      ...remoteTriggerState(),
      active: false,
      expectedRemoteFingerprint: comparison.safe.remoteContractFingerprint,
    }),
    (error) => error.code === 'YOUTUBE_DRY_RUN_REMOTE_FINGERPRINT_MISMATCH',
  );
});

function expectedFalseFlags(comparison) {
  return [...new Set([
    ...comparison.safe.falseFlags,
    ...comparison.active.trueFlags,
  ])].sort();
}

async function safeConfig() {
  const source = await readFile(
    new URL('../../wrangler.sync.example.jsonc', import.meta.url),
    'utf8',
  );
  return source
    .replace(
      '"database_name": "replace-with-environment-specific-d1-name"',
      '"database_name": "social-mkt-state-dev"',
    )
    .replace(
      '"database_id": "00000000-0000-0000-0000-000000000000"',
      `"database_id": "${DATABASE_ID}"`,
    )
    .replace(
      '"YOUTUBE_CHANNEL_ID": "replace-with-youtube-channel-id"',
      '"YOUTUBE_CHANNEL_ID": "UC_TEST"',
    )
    .replaceAll('"replace-with-table-id"', '"tbl_real_mapping"');
}

function versionFixture(input = {}) {
  const config = input.config ?? '';
  const plaintextBindings = [...config.matchAll(
    /"(MKT_[A-Z0-9_]+_ENABLED)"\s*:\s*"?(true|false)"?/gu,
  )].map(([, name, value]) => ({
    type: 'plain_text',
    name,
    text: value,
  }));
  return {
    id: VERSION,
    name: 'social-mkt-sync-worker',
    message: `${YOUTUBE_DRY_RUN_OPERATOR_CONTRACT_VERSION} phase=deploy-safe-baseline git=${HEAD}`,
    bindings: [
      {
        type: 'd1',
        name: 'MKT_STATE_DB',
        ...(input.includeDatabaseName === false
          ? {}
          : { database_name: 'social-mkt-state-dev' }),
        database_id: DATABASE_ID,
      },
      {
        type: 'queue',
        name: 'MKT_SYNC_QUEUE',
        queue_name: MAIN_QUEUE,
      },
      ...plaintextBindings,
      { type: 'secret_text', name: 'LARK_APP_ID' },
      { type: 'secret_text', name: 'LARK_APP_SECRET' },
      { type: 'secret_text', name: 'YOUTUBE_API_KEY' },
    ],
  };
}

function deploymentStatus() {
  return {
    id: 'deployment-live-shape',
    versions: [{ version_id: VERSION, percentage: 100 }],
  };
}

function scopedConsumerResponses() {
  return [
    {
      expectedQueueName: MAIN_QUEUE,
      response: {
        consumers: [{ settings: queueSettings(5, DLQ) }],
      },
    },
    {
      expectedQueueName: DLQ,
      response: {
        consumers: [{ settings: queueSettings(10) }],
      },
    },
  ];
}

function queueSettings(maxRetries, deadLetterQueue = undefined) {
  return {
    max_concurrency: 1,
    batch_size: 10,
    max_wait_time_ms: 30000,
    max_retries: maxRetries,
    ...(deadLetterQueue ? { dead_letter_queue: deadLetterQueue } : {}),
  };
}

function remoteTriggerState() {
  return {
    scriptList: {
      success: true,
      result: [{ id: 'social-mkt-sync-worker', routes: [] }],
    },
    schedules: {
      success: true,
      result: {
        schedules: [
          { cron: '*/5 * * * *' },
          { cron: '50 0 * * *' },
        ],
      },
    },
    subdomain: {
      success: true,
      result: { enabled: false, previews_enabled: false },
    },
  };
}
