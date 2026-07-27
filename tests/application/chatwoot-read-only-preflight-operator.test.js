import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CHATWOOT_PREFLIGHT_CONFIRMATION,
  CHATWOOT_PREFLIGHT_CONTRACT_VERSION,
  assertChatwootPreflightConfirmation,
  createChatwootPreflightEvidence,
  extractRemotePlainTextVars,
  loadChatwootPreflightTarget,
  parseAppliedMigrations,
  parseChatwootPreflightArgs,
  parsePendingMigrations,
  parseQueueConsumers,
  parseSecretNames,
  sha256,
  validateActiveDeployment,
  validateChatwootRemoteConfig,
  validateMigrationLedger,
  validateQueueConsumers,
  validateRemoteTriggerState,
  validateSecretNames,
} from '../../scripts/lib/chatwoot-read-only-preflight-operator.js';

const HEAD = 'f3e330339b114536c3a1a9ee7567abf5a76fa78b';
const VERSION = '11111111-2222-4333-8444-555555555555';
const BASE_URL = 'https://chatwoot.example.test';
const ACCOUNT_ID = '123';

function targetEnv() {
  return {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
    MKT_CHATWOOT_PREFLIGHT_ACCOUNT_KEY: 'chemistry_k',
    MKT_CHATWOOT_PREFLIGHT_WORKER_NAME: 'social-mkt-sync-worker',
    MKT_CHATWOOT_PREFLIGHT_DATABASE_NAME: 'social-mkt-state-dev',
    MKT_CHATWOOT_PREFLIGHT_MAIN_QUEUE: 'social-mkt-sync-jobs',
    MKT_CHATWOOT_PREFLIGHT_DLQ: 'social-mkt-sync-dlq',
    MKT_CHATWOOT_PREFLIGHT_REPOSITORY_HEAD: HEAD,
    MKT_CHATWOOT_PREFLIGHT_EXPECTED_ACTIVE_VERSION: VERSION,
    MKT_CHATWOOT_PREFLIGHT_WRANGLER_CONFIG: 'wrangler.sync.jsonc',
    MKT_CHATWOOT_PREFLIGHT_EXPECTED_BASE_URL_SHA256: sha256(BASE_URL),
    MKT_CHATWOOT_PREFLIGHT_EXPECTED_ACCOUNT_ID_SHA256: sha256(ACCOUNT_ID),
  };
}

function remoteVars(overrides = {}) {
  return {
    MKT_CONNECTOR_CHATWOOT_ENABLED: 'false',
    MKT_CHATWOOT_D1_WRITE_ENABLED: 'false',
    MKT_CHATWOOT_LARK_WRITE_ENABLED: 'false',
    MKT_CHATWOOT_REPORT_WRITE_ENABLED: 'false',
    MKT_SCHEDULE_CHATWOOT_ENABLED: 'false',
    MKT_CHATWOOT_WEBHOOK_ENABLED: 'false',
    CHATWOOT_BASE_URL: BASE_URL,
    CHATWOOT_ACCOUNT_ID: ACCOUNT_ID,
    ...overrides,
  };
}

test('Chatwoot preflight defaults to plan-only and requires exact execution confirmation', () => {
  assert.deepEqual(parseChatwootPreflightArgs([]), { phase: 'plan', execute: false });
  assert.deepEqual(
    parseChatwootPreflightArgs(['--phase=preflight', '--execute']),
    { phase: 'preflight', execute: true },
  );
  assert.throws(
    () => parseChatwootPreflightArgs(['--execute']),
    (error) => error?.code === 'CHATWOOT_PREFLIGHT_PLAN_EXECUTE_INVALID',
  );
  assert.throws(
    () => assertChatwootPreflightConfirmation({}),
    (error) => error?.code === 'CHATWOOT_PREFLIGHT_CONFIRMATION_REQUIRED',
  );
  assert.equal(assertChatwootPreflightConfirmation({
    [CHATWOOT_PREFLIGHT_CONFIRMATION.envName]: CHATWOOT_PREFLIGHT_CONFIRMATION.value,
  }), true);
});

test('target loader locks Integration Workspace and keeps customer identities fingerprinted', () => {
  const target = loadChatwootPreflightTarget(targetEnv());
  assert.equal(target.environment, 'development');
  assert.equal(target.customerProfile, 'integration_workspace');
  assert.equal(target.customerKey, 'chemistry_k');
  assert.equal(target.accountKey, 'chemistry_k');
  assert.match(target.targetFingerprint, /^[0-9a-f]{64}$/u);
  assert.throws(
    () => loadChatwootPreflightTarget({ ...targetEnv(), MKT_ENV: 'production' }),
    (error) => error?.code === 'CHATWOOT_PREFLIGHT_TARGET_INVALID',
  );
});

test('active deployment requires the reviewed version at exactly 100 percent traffic', () => {
  assert.equal(validateActiveDeployment({
    id: 'deployment-1',
    versions: [{ version_id: VERSION, percentage: 100 }],
  }, VERSION).versionId, VERSION);
  for (const invalid of [
    { versions: [{ version_id: VERSION, percentage: 99 }] },
    { versions: [{ version_id: 'aaaaaaaa-2222-4333-8444-555555555555', percentage: 100 }] },
    { versions: [
      { version_id: VERSION, percentage: 50 },
      { version_id: 'aaaaaaaa-2222-4333-8444-555555555555', percentage: 50 },
    ] },
  ]) {
    assert.throws(
      () => validateActiveDeployment(invalid, VERSION),
      (error) => error?.code === 'CHATWOOT_PREFLIGHT_ACTIVE_VERSION_MISMATCH',
    );
  }
});

test('remote version metadata extracts plain vars and requires every Chatwoot gate false', () => {
  const extracted = extractRemotePlainTextVars({
    result: {
      bindings: Object.entries(remoteVars()).map(([name, text]) => ({
        name,
        type: 'plain_text',
        text,
      })),
    },
  });
  const result = validateChatwootRemoteConfig(extracted, loadChatwootPreflightTarget(targetEnv()));
  assert.equal(result.baseUrlSha256, sha256(BASE_URL));
  assert.equal(result.externalAccountIdSha256, sha256(ACCOUNT_ID));
  assert.match(result.flagFingerprint, /^[0-9a-f]{64}$/u);
  assert.throws(
    () => validateChatwootRemoteConfig(
      remoteVars({ MKT_CONNECTOR_CHATWOOT_ENABLED: 'true' }),
      loadChatwootPreflightTarget(targetEnv()),
    ),
    (error) => error?.code === 'CHATWOOT_PREFLIGHT_UNSAFE_FLAG',
  );
  assert.throws(
    () => validateChatwootRemoteConfig(
      remoteVars({ CHATWOOT_ACCOUNT_ID: '999' }),
      loadChatwootPreflightTarget(targetEnv()),
    ),
    (error) => error?.code === 'CHATWOOT_PREFLIGHT_IDENTITY_MISMATCH',
  );
});

test('Secret inspection uses names only and requires the Chatwoot token name', () => {
  const names = parseSecretNames(JSON.stringify([
    { name: 'CHATWOOT_API_ACCESS_TOKEN', type: 'secret_text' },
    { name: 'LARK_APP_ID', type: 'secret_text' },
  ]));
  const result = validateSecretNames(names);
  assert.equal(result.requiredPresent, 1);
  assert.equal(result.optionalPresent, 1);
  assert.match(result.secretNameFingerprint, /^[0-9a-f]{64}$/u);
  assert.throws(
    () => validateSecretNames(['LARK_APP_ID']),
    (error) => error?.code === 'CHATWOOT_PREFLIGHT_REQUIRED_SECRET_MISSING',
  );
});

test('migration ledger requires applied 0017 and exactly pending 0018', () => {
  const applied = parseAppliedMigrations([{
    results: [
      { name: '0016_tiktok_post_lark_pipeline.sql' },
      { name: '0017_woocommerce_commerce.sql' },
    ],
  }]);
  const pending = parsePendingMigrations('Migrations to be applied:\n0018_chatwoot_analytics.sql');
  assert.equal(validateMigrationLedger({ applied, pending }).pendingMigration, '0018_chatwoot_analytics.sql');
  assert.throws(
    () => validateMigrationLedger({ applied: ['0017_woocommerce_commerce.sql'], pending: [] }),
    (error) => error?.code === 'CHATWOOT_PREFLIGHT_MIGRATION_0018_NOT_PENDING',
  );
  assert.throws(
    () => validateMigrationLedger({
      applied: ['0017_woocommerce_commerce.sql'],
      pending: ['0018_chatwoot_analytics.sql', '0019_unrelated.sql'],
    }),
    (error) => error?.code === 'CHATWOOT_PREFLIGHT_UNEXPECTED_PENDING_MIGRATIONS',
  );
});

test('Queue and Worker trigger validation are read-only and exact', () => {
  const target = loadChatwootPreflightTarget(targetEnv());
  const mainConsumers = parseQueueConsumers({ result: [{
    queue_name: 'social-mkt-sync-jobs',
    service_name: 'social-mkt-sync-worker',
    dead_letter_queue: 'social-mkt-sync-dlq',
  }] });
  const dlqConsumers = parseQueueConsumers({ result: [{
    queue_name: 'social-mkt-sync-dlq',
    service_name: 'social-mkt-sync-worker',
  }] });
  assert.equal(validateQueueConsumers({ mainConsumers, dlqConsumers, target }).mainConsumerCount, 1);
  const trigger = validateRemoteTriggerState({
    target,
    scriptList: { result: [{ id: 'social-mkt-sync-worker' }] },
    schedules: { result: [
      { cron: '*/5 * * * *' },
      { cron: '50 0,6,12,18 * * *' },
    ] },
    subdomain: { result: { enabled: false } },
  });
  assert.equal(trigger.workersDevEnabled, false);
  assert.equal(trigger.cronCount, 2);
  assert.throws(
    () => validateRemoteTriggerState({
      target,
      scriptList: { result: [{ id: 'social-mkt-sync-worker' }] },
      schedules: { result: [] },
      subdomain: { result: { enabled: false } },
    }),
    (error) => error?.code === 'CHATWOOT_PREFLIGHT_CRON_MISMATCH',
  );
});

test('evidence is deterministic, sanitized and records zero mutations/provider requests', () => {
  const data = {
    activeVersion: VERSION,
    chatwootBaseUrlSha256: sha256(BASE_URL),
    chatwootExternalAccountIdSha256: sha256(ACCOUNT_ID),
    remoteMutationCount: 0,
    providerRequestCount: 0,
    secretValueReadCount: 0,
  };
  const first = createChatwootPreflightEvidence({
    repositoryHead: HEAD,
    targetFingerprint: 'a'.repeat(64),
    createdAt: '2026-07-27T15:00:00.000Z',
    data,
  });
  const second = createChatwootPreflightEvidence({
    repositoryHead: HEAD,
    targetFingerprint: 'a'.repeat(64),
    createdAt: '2026-07-27T15:00:00.000Z',
    data,
  });
  assert.equal(first.contractVersion, CHATWOOT_PREFLIGHT_CONTRACT_VERSION);
  assert.equal(first.evidenceSha256, second.evidenceSha256);
  const serialized = JSON.stringify(first);
  assert.equal(serialized.includes(BASE_URL), false);
  assert.equal(serialized.includes(ACCOUNT_ID), false);
  assert.equal(first.data.remoteMutationCount, 0);
  assert.equal(first.data.providerRequestCount, 0);
});

test('operator source contains no Provider call, migration apply, deployment or Queue send path', async () => {
  const source = await readFile(
    new URL('../../scripts/chatwoot-read-only-preflight-operator.mjs', import.meta.url),
    'utf8',
  );
  assert.equal(source.includes('/api/v1/accounts/'), false);
  assert.equal(source.includes('d1 migrations apply'), false);
  assert.equal(source.includes("'deploy', '--config'"), false);
  assert.equal(source.includes('/queues/'), false);
  assert.equal(source.includes('method: \'POST\''), false);
  assert.match(source, /'deploy', '--dry-run', '--strict'/u);
  assert.match(source, /SELECT name FROM d1_migrations ORDER BY id;/u);
});
