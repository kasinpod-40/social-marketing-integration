import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  compareYouTubeDryRunConfigs,
} from '../../scripts/lib/youtube-dry-run-rollout-operator.js';
import {
  normalizeWranglerVersionUnrelatedConnectorFlags,
  validateLiveRemoteYouTubeDeploymentContract,
} from '../../scripts/lib/youtube-live-remote-contract-parser.js';

const VERSION = '11111111-2222-4333-8444-555555555555';
const DATABASE_ID = '12345678-1234-4234-9234-123456789abc';
const MAIN_QUEUE = 'social-mkt-sync-jobs';
const DLQ = 'social-mkt-sync-dlq';

const UNRELATED_TRUE_FLAGS = Object.freeze([
  'MKT_CONNECTOR_WOOCOMMERCE_ENABLED',
  'MKT_META_D1_WRITE_ENABLED',
  'MKT_CHATWOOT_LARK_WRITE_ENABLED',
]);

test('YouTube fingerprint accepts known unrelated connector true flags on the shared Worker', async () => {
  const config = await configComparison();
  const versionsView = versionFixture({ config: config.safeText });
  for (const flag of UNRELATED_TRUE_FLAGS) setFlag(versionsView, flag, 'true');

  const remote = validateLiveRemoteYouTubeDeploymentContract({
    versionsView,
    deploymentStatus: deploymentStatus(),
    queueConsumerContexts: scopedConsumerResponses(),
    expectedDatabaseId: DATABASE_ID,
    expectedDatabaseName: 'social-mkt-state-dev',
    expectedFalseFlagNames: expectedFalseFlags(config.comparison),
    workerName: 'social-mkt-sync-worker',
    ...remoteTriggerState(),
    active: false,
    expectedRemoteFingerprint: config.comparison.safe.remoteContractFingerprint,
  });

  assert.equal(remote.remoteFingerprint, config.comparison.safe.remoteContractFingerprint);
  assert.equal(remote.additionalConnectorTrueFlagCount, 3);
  assert.deepEqual(remote.additionalConnectorTrueFlagNames, [...UNRELATED_TRUE_FLAGS].sort());
});

test('unrelated connector scope is comparison-only and does not mutate the source response', async () => {
  const config = await configComparison();
  const versionsView = versionFixture({ config: config.safeText });
  setFlag(versionsView, UNRELATED_TRUE_FLAGS[0], 'true');

  const normalized = normalizeWranglerVersionUnrelatedConnectorFlags(versionsView);

  assert.equal(readFlag(versionsView, UNRELATED_TRUE_FLAGS[0]), 'true');
  assert.equal(readFlag(normalized.versionsView, UNRELATED_TRUE_FLAGS[0]), 'false');
  assert.equal(normalized.additionalConnectorTrueFlagCount, 1);
});

test('YouTube-owned write and schedule gates remain fail-closed when true', async () => {
  const config = await configComparison();
  for (const flag of [
    'MKT_YOUTUBE_LARK_WRITE_ENABLED',
    'MKT_YOUTUBE_ANALYTICS_ENABLED',
    'MKT_SCHEDULE_YOUTUBE_ENABLED',
  ]) {
    const versionsView = versionFixture({ config: config.safeText });
    setFlag(versionsView, flag, 'true');

    assert.throws(
      () => validateLiveRemoteYouTubeDeploymentContract({
        versionsView,
        deploymentStatus: deploymentStatus(),
        queueConsumerContexts: scopedConsumerResponses(),
        expectedDatabaseId: DATABASE_ID,
        expectedDatabaseName: 'social-mkt-state-dev',
        expectedFalseFlagNames: expectedFalseFlags(config.comparison),
        workerName: 'social-mkt-sync-worker',
        ...remoteTriggerState(),
        active: false,
        expectedRemoteFingerprint: config.comparison.safe.remoteContractFingerprint,
      }),
      (error) => error.code === 'YOUTUBE_DRY_RUN_REMOTE_TRUE_FLAG_INVALID'
        && error.details.unexpectedTrue.includes(flag),
      flag,
    );
  }
});

test('unknown shared true flag remains fail-closed and identifies the sanitized flag name', async () => {
  const config = await configComparison();
  const versionsView = versionFixture({ config: config.safeText });
  versionsView.bindings.push({
    type: 'plain_text',
    name: 'MKT_UNKNOWN_SHARED_WRITE_ENABLED',
    text: 'true',
  });

  assert.throws(
    () => validateLiveRemoteYouTubeDeploymentContract({
      versionsView,
      deploymentStatus: deploymentStatus(),
      queueConsumerContexts: scopedConsumerResponses(),
      expectedDatabaseId: DATABASE_ID,
      expectedDatabaseName: 'social-mkt-state-dev',
      expectedFalseFlagNames: expectedFalseFlags(config.comparison),
      workerName: 'social-mkt-sync-worker',
      ...remoteTriggerState(),
      active: false,
      expectedRemoteFingerprint: config.comparison.safe.remoteContractFingerprint,
    }),
    (error) => error.code === 'YOUTUBE_DRY_RUN_REMOTE_TRUE_FLAG_INVALID'
      && error.details.unexpectedTrue.includes('MKT_UNKNOWN_SHARED_WRITE_ENABLED'),
  );
});

test('unrelated connector flag metadata remains strict for invalid and duplicate bindings', async () => {
  const config = await configComparison();
  const invalid = versionFixture({ config: config.safeText });
  setFlag(invalid, UNRELATED_TRUE_FLAGS[0], '1');
  assert.throws(
    () => normalizeWranglerVersionUnrelatedConnectorFlags(invalid),
    (error) => error.code === 'YOUTUBE_DRY_RUN_REMOTE_FLAG_VALUE_INVALID',
  );

  const duplicate = versionFixture({ config: config.safeText });
  duplicate.bindings.push({
    type: 'plain_text',
    name: UNRELATED_TRUE_FLAGS[0],
    text: 'false',
  });
  assert.throws(
    () => normalizeWranglerVersionUnrelatedConnectorFlags(duplicate),
    (error) => error.code === 'YOUTUBE_DRY_RUN_REMOTE_FLAG_BINDING_DUPLICATE'
      && error.details.name === UNRELATED_TRUE_FLAGS[0],
  );
});

test('the executable preflight reports the scoped true-flag count without persisting Remote values', async () => {
  const source = await readFile(
    new URL('../../scripts/youtube-remote-read-only-preflight.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /additionalConnectorTrueFlagCount:\s*contract\.additionalConnectorTrueFlagCount/u);
  assert.doesNotMatch(source, /additionalConnectorTrueFlagNames:\s*contract/u);
  assert.doesNotMatch(source, /sanitizedRemoteContract:\s*error/u);
});

async function configComparison() {
  const safeText = await safeConfig();
  const activeText = safeText
    .replace('"MKT_CONNECTOR_YOUTUBE_ENABLED": "false"', '"MKT_CONNECTOR_YOUTUBE_ENABLED": "true"')
    .replace('"MKT_YOUTUBE_END_TO_END_ENABLED": "false"', '"MKT_YOUTUBE_END_TO_END_ENABLED": "true"');
  return {
    safeText,
    comparison: compareYouTubeDryRunConfigs(safeText, activeText, { channelId: 'UC_TEST' }),
  };
}

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
  const plaintextBindings = [...String(input.config ?? '').matchAll(
    /"(MKT_[A-Z0-9_]+_ENABLED)"\s*:\s*"?(true|false)"?/gu,
  )].map(([, name, value]) => ({ type: 'plain_text', name, text: value }));
  return {
    id: VERSION,
    name: 'social-mkt-sync-worker',
    bindings: [
      {
        type: 'd1',
        name: 'MKT_STATE_DB',
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

function setFlag(versionsView, name, value) {
  const binding = versionsView.bindings.find((item) => item.name === name);
  if (binding) {
    binding.text = value;
    return;
  }
  versionsView.bindings.push({ type: 'plain_text', name, text: value });
}

function readFlag(versionsView, name) {
  return versionsView.bindings.find((item) => item.name === name)?.text;
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
      response: { consumers: [{ settings: queueSettings(5, DLQ) }] },
    },
    {
      expectedQueueName: DLQ,
      response: { consumers: [{ settings: queueSettings(10) }] },
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
          { cron: '30 18 * * *' },
        ],
      },
    },
    subdomain: {
      success: true,
      result: { enabled: false, previews_enabled: false },
    },
  };
}
