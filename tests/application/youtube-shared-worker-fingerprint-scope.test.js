import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  compareYouTubeDryRunConfigs,
} from '../../scripts/lib/youtube-dry-run-rollout-operator.js';
import {
  normalizeWranglerVersionRequiredSecrets,
  normalizeWranglerVersionReviewedFalseFlags,
  validateLiveRemoteYouTubeDeploymentContract,
} from '../../scripts/lib/youtube-live-remote-contract-parser.js';

const VERSION = '11111111-2222-4333-8444-555555555555';
const DATABASE_ID = '12345678-1234-4234-9234-123456789abc';
const MAIN_QUEUE = 'social-mkt-sync-jobs';
const DLQ = 'social-mkt-sync-dlq';

test('shared Worker fingerprint accepts omitted false bindings and unrelated connector Secrets', async () => {
  const config = await configComparison();
  const expectedNames = expectedFalseFlags(config.comparison);
  const omittedNames = expectedNames.filter((_, index) => index % 2 === 0);
  const versionsView = versionFixture({
    config: config.safeText,
    omitPlaintextNames: omittedNames,
    extraSecretNames: [
      'META_ACCESS_TOKEN',
      'WOOCOMMERCE_CONSUMER_SECRET',
      'CHATWOOT_API_ACCESS_TOKEN',
    ],
  });

  const remote = validateLiveRemoteYouTubeDeploymentContract({
    versionsView,
    deploymentStatus: deploymentStatus(),
    queueConsumerContexts: scopedConsumerResponses(),
    expectedDatabaseId: DATABASE_ID,
    expectedDatabaseName: 'social-mkt-state-dev',
    expectedFalseFlagNames: expectedNames,
    workerName: 'social-mkt-sync-worker',
    ...remoteTriggerState(),
    active: false,
    expectedRemoteFingerprint: config.comparison.safe.remoteContractFingerprint,
  });

  assert.equal(remote.remoteFingerprint, config.comparison.safe.remoteContractFingerprint);
  assert.equal(remote.remoteFingerprintMatch, undefined);
  assert.equal(remote.materializedFalseFlagCount, omittedNames.length);
  assert.equal(remote.expectedFalseFlagCount, expectedNames.length);
  assert.equal(remote.secretNameCount, 3);
  assert.equal(remote.observedSecretNameCount, 6);
  assert.equal(remote.additionalSecretNameCount, 3);
  assert.equal(remote.queueConsumerCount, 2);
});

test('reviewed false normalizer materializes only missing names and preserves explicit false', async () => {
  const config = await configComparison();
  const expectedNames = expectedFalseFlags(config.comparison);
  const omitted = expectedNames.slice(0, 3);
  const normalized = normalizeWranglerVersionReviewedFalseFlags(versionFixture({
    config: config.safeText,
    omitPlaintextNames: omitted,
  }), {
    expectedFalseFlagNames: expectedNames,
  });

  assert.equal(normalized.materializedFalseFlagCount, omitted.length);
  for (const name of expectedNames) {
    const bindings = normalized.versionsView.bindings.filter((binding) => (
      binding.type === 'plain_text' && binding.name === name
    ));
    assert.equal(bindings.length, 1, name);
    assert.equal(String(bindings[0].text).toLowerCase(), 'false', name);
  }
});

test('reviewed false normalizer rejects invalid and duplicate bindings', async () => {
  const config = await configComparison();
  const expectedNames = expectedFalseFlags(config.comparison);

  const invalid = versionFixture({ config: config.safeText });
  invalid.bindings.find((binding) => binding.name === expectedNames[0]).text = '0';
  assert.throws(
    () => normalizeWranglerVersionReviewedFalseFlags(invalid, {
      expectedFalseFlagNames: expectedNames,
    }),
    (error) => error.code === 'YOUTUBE_DRY_RUN_REMOTE_FLAG_VALUE_INVALID',
  );

  const duplicate = versionFixture({ config: config.safeText });
  duplicate.bindings.push({ type: 'plain_text', name: expectedNames[0], text: 'false' });
  assert.throws(
    () => normalizeWranglerVersionReviewedFalseFlags(duplicate, {
      expectedFalseFlagNames: expectedNames,
    }),
    (error) => error.code === 'YOUTUBE_DRY_RUN_REMOTE_FLAG_BINDING_DUPLICATE',
  );
});

test('explicit true reviewed YouTube flag still fails closed through strict validator', async () => {
  const config = await configComparison();
  const expectedNames = expectedFalseFlags(config.comparison);
  const versionsView = versionFixture({ config: config.safeText });
  const reviewedFalse = 'MKT_YOUTUBE_LARK_WRITE_ENABLED';
  versionsView.bindings.find((binding) => binding.name === reviewedFalse).text = 'true';

  assert.throws(
    () => validateLiveRemoteYouTubeDeploymentContract({
      versionsView,
      deploymentStatus: deploymentStatus(),
      queueConsumerContexts: scopedConsumerResponses(),
      expectedDatabaseId: DATABASE_ID,
      expectedDatabaseName: 'social-mkt-state-dev',
      expectedFalseFlagNames: expectedNames,
      workerName: 'social-mkt-sync-worker',
      ...remoteTriggerState(),
      active: false,
      expectedRemoteFingerprint: config.comparison.safe.remoteContractFingerprint,
    }),
    (error) => error.code === 'YOUTUBE_DRY_RUN_REMOTE_TRUE_FLAG_INVALID'
      && error.details.unexpectedTrue.includes(reviewedFalse),
  );
});

test('shared Worker Secret scope fails closed on missing, duplicate or exposed Secret', () => {
  const missing = versionFixture();
  missing.bindings = missing.bindings.filter((binding) => binding.name !== 'YOUTUBE_API_KEY');
  assert.throws(
    () => normalizeWranglerVersionRequiredSecrets(missing),
    (error) => error.code === 'YOUTUBE_DRY_RUN_REMOTE_REQUIRED_SECRET_MISSING'
      && error.details.missing.includes('YOUTUBE_API_KEY'),
  );

  const duplicate = versionFixture();
  duplicate.bindings.push({ type: 'secret_text', name: 'YOUTUBE_API_KEY' });
  assert.throws(
    () => normalizeWranglerVersionRequiredSecrets(duplicate),
    (error) => error.code === 'YOUTUBE_DRY_RUN_REMOTE_SECRET_BINDING_DUPLICATE',
  );

  const exposed = versionFixture({ extraSecretNames: ['META_ACCESS_TOKEN'] });
  exposed.bindings.find((binding) => binding.name === 'META_ACCESS_TOKEN').text = 'must-not-leak';
  assert.throws(
    () => normalizeWranglerVersionRequiredSecrets(exposed),
    (error) => error.code === 'YOUTUBE_DRY_RUN_REMOTE_SECRET_VALUE_EXPOSED',
  );
});

test('one-command preflight wires reviewed false names and sanitized diagnostics', async () => {
  const source = await readFile(
    new URL('../../scripts/youtube-remote-read-only-preflight.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /expectedFalseFlagNames(?:\s*:\s*expectedFalseFlagNames)?\s*,/u);
  assert.match(source, /additionalSecretNameCount:\s*contract\.additionalSecretNameCount/u);
  assert.match(source, /materializedFalseFlagCount:\s*contract\.materializedFalseFlagCount/u);
  assert.match(source, /diagnostic:\s*sanitizeDiagnostic\(error\?\.details\)/u);
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
  const omitted = new Set(input.omitPlaintextNames ?? []);
  const plaintextBindings = [...String(input.config ?? '').matchAll(
    /"(MKT_[A-Z0-9_]+_ENABLED)"\s*:\s*"?(true|false)"?/gu,
  )]
    .filter(([, name]) => !omitted.has(name))
    .map(([, name, value]) => ({ type: 'plain_text', name, text: value }));
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
      ...(input.extraSecretNames ?? []).map((name) => ({ type: 'secret_text', name })),
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
