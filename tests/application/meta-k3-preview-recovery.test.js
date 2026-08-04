import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  META_D1_ONLY_REQUIRED_FALSE_FLAGS,
  loadMetaD1OnlyTarget,
} from '../../scripts/lib/meta-d1-only-rollout-operator.js';
import {
  buildMetaK3ExactContinuationConfig,
} from '../../scripts/lib/meta-k3-partial-staging-finalizer.js';
import {
  META_K3_PREVIEW_ENTRYPOINT,
  buildMetaK3PreviewRuntimeConfig,
  parseMetaK3PreviewUpload,
  validateMetaK3PreviewTransport,
} from '../../scripts/lib/meta-k3-preview-recovery.js';

const VERSION = '12345678-1234-4234-9234-123456789abc';
const BASELINE = '22345678-1234-4234-9234-123456789abc';
const HEAD = 'b'.repeat(40);
const OPERATION_ID =
  'meta-chemistry_k3-history-20260701-20260731-d4824a9e2ba9';

function k3Target() {
  return loadMetaD1OnlyTarget({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
    MKT_META_D1_ONLY_ACCOUNT_KEY: 'chemistry_k',
    MKT_META_D1_ONLY_TARGET: 'chemistry_k3',
    MKT_META_D1_ONLY_REPOSITORY_HEAD: HEAD,
    MKT_META_D1_ONLY_EXPECTED_ACTIVE_VERSION: VERSION,
    MKT_META_D1_ONLY_WRANGLER_CONFIG: 'wrangler.sync.jsonc',
    MKT_META_D1_ONLY_READ_ONLY_SUMMARY:
      'outputs/meta-read-only-validation/summary.json',
    MKT_META_D1_ONLY_OPERATION_ID: OPERATION_ID,
    MKT_META_D1_ONLY_ORIGINAL_REQUESTED_AT:
      Date.parse('2026-08-04T03:24:05.594Z'),
    MKT_META_D1_ONLY_PERIOD_START: '2026-07-01',
    MKT_META_D1_ONLY_PERIOD_END: '2026-07-31',
    MKT_META_D1_ONLY_WORKER_NAME: 'social-mkt-sync-worker',
    MKT_META_D1_ONLY_DATABASE_NAME: 'social-mkt-state-dev',
    MKT_META_D1_ONLY_MAIN_QUEUE: 'social-mkt-sync-jobs',
    MKT_META_D1_ONLY_DLQ: 'social-mkt-sync-dlq',
    MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY:
      'RECOVER_EXACT_PARTIAL_META_ADS_STAGING',
  });
}

function allFalseRuntimeConfig(repositoryRoot) {
  const flags = [...new Set(META_D1_ONLY_REQUIRED_FALSE_FLAGS)]
    .map((name) => `    ${JSON.stringify(name)}: "false"`)
    .join(',\n');
  return `{
  "name": "social-mkt-sync-worker",
  "main": ${JSON.stringify(resolve(repositoryRoot, 'apps/sync-worker/src/index.js'))},
  "compatibility_date": "2026-08-01",
  "workers_dev": false,
  "preview_urls": false,
  "d1_databases": [{
    "binding": "MKT_STATE_DB",
    "database_name": "social-mkt-state-dev",
    "database_id": "11111111-1111-4111-8111-111111111111"
  }],
  "queues": {
    "producers": [{
      "binding": "MKT_SYNC_QUEUE",
      "queue": "social-mkt-sync-jobs"
    }],
    "consumers": [{
      "queue": "social-mkt-sync-jobs",
      "dead_letter_queue": "social-mkt-sync-dlq"
    }]
  },
  "vars": {
    "MKT_ENV": "development",
    "MKT_CUSTOMER_PROFILE": "integration_workspace",
    "MKT_CONNECTION_CUSTOMER_KEY": "chemistry_k",
    "META_GRAPH_API_VERSION": "v25.0",
    "META_FACEBOOK_PAGE_ID": "111111111111111",
    "META_INSTAGRAM_ACCOUNT_ID": "222222222222222",
    "META_AD_ACCOUNT_MAPPINGS": "chemistry_k2=333333333333333,chemistry_k3=444444444444444",
${flags}
  },
  "routes": [{
    "pattern": "example.com/*",
    "zone_name": "example.com"
  }],
  "triggers": {"crons": ["*/5 * * * *"]}
}`;
}

test('K3 Preview runtime pins the dedicated entrypoint and compiles from a nested config', () => {
  const root = mkdtempSync(join(tmpdir(), 'meta-k3-dedicated-preview-'));
  try {
    const entrypoint = join(root, META_K3_PREVIEW_ENTRYPOINT);
    const nestedConfig = join(root, 'outputs', 'incident', 'wrangler.jsonc');
    mkdirSync(join(entrypoint, '..'), { recursive: true });
    mkdirSync(join(nestedConfig, '..'), { recursive: true });
    writeFileSync(entrypoint, [
      'export default {',
      "  fetch() { return new Response('ok'); },",
      '  queue(batch) { batch.retryAll(); },',
      '};',
      '',
    ].join('\n'));

    const source = JSON.stringify({
      name: 'social-mkt-sync-worker',
      main: 'apps/sync-worker/src/index.js',
      compatibility_date: '2026-08-01',
      workers_dev: false,
      preview_urls: false,
      vars: {
        MKT_CONNECTOR_META_ADS_ENABLED: 'false',
        MKT_META_D1_WRITE_ENABLED: 'false',
      },
      routes: [{ pattern: 'example.com/*', zone_name: 'example.com' }],
      triggers: { crons: ['*/5 * * * *'] },
    }, null, 2);
    const built = buildMetaK3PreviewRuntimeConfig(source, {
      repositoryRoot: root,
    });
    assert.equal(built.previewEntrypoint, entrypoint);
    assert.equal(built.previewUrlsEnabled, true);
    assert.equal(built.workersDevEnabled, false);
    assert.equal(built.routesCopied, 0);
    assert.equal(built.scheduleTriggersCopied, 0);
    assert.deepEqual(built.trueFlags, []);
    assert.match(built.text, /meta-k3-exact-recovery-preview-entry\.js/u);
    assert.doesNotMatch(built.text, /example\.com/u);
    assert.doesNotMatch(built.text, /\*\/5 \* \* \* \*/u);
    writeFileSync(nestedConfig, built.text);

    const result = spawnSync('npx', [
      '--no-install',
      'wrangler',
      'versions',
      'upload',
      '--config',
      nestedConfig,
      '--preview-alias',
      'meta-k3-recovery',
      '--message',
      'meta-k3-dedicated-preview-dry-run',
      '--dry-run',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.equal(result.status, 0, `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exact active K3 D1 artifact retains the dedicated route and passes Wrangler dry-run', () => {
  const repositoryRoot = resolve(process.cwd());
  const root = mkdtempSync(join(tmpdir(), 'meta-k3-active-preview-'));
  try {
    const previewBase = buildMetaK3PreviewRuntimeConfig(
      allFalseRuntimeConfig(repositoryRoot),
      { repositoryRoot },
    );
    const active = buildMetaK3ExactContinuationConfig(
      previewBase.text,
      k3Target(),
      {
        phase: 'd1',
        tokenSha256: 'c'.repeat(64),
        attestation: 'd'.repeat(64),
      },
    );
    const nestedConfig = join(root, 'outputs', 'incident', 'wrangler.active.jsonc');
    mkdirSync(join(nestedConfig, '..'), { recursive: true });
    writeFileSync(nestedConfig, active.activeText);

    assert.deepEqual(active.activeTrueFlags, [
      'MKT_CONNECTOR_META_ADS_ENABLED',
      'MKT_META_D1_WRITE_ENABLED',
      'MKT_META_SOURCE_READ_ENABLED',
    ]);
    assert.match(
      active.activeText,
      /apps\/sync-worker\/src\/meta-k3-exact-recovery-preview-entry\.js/u,
    );
    assert.match(
      active.activeText,
      /meta-chemistry_k3-history-20260701-20260731-d4824a9e2ba9/u,
    );
    assert.doesNotMatch(active.activeText, /meta-k2-exact-recovery/u);
    assert.doesNotMatch(active.activeText, /example\.com/u);
    assert.doesNotMatch(active.activeText, /\*\/5 \* \* \* \*/u);

    const result = spawnSync('npx', [
      '--no-install',
      'wrangler',
      'versions',
      'upload',
      '--config',
      nestedConfig,
      '--preview-alias',
      'meta-k3-recovery',
      '--message',
      'meta-k3-exact-active-preview-dry-run',
      '--dry-run',
    ], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.equal(result.status, 0, `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K3 upload output is the recovery URL authority', () => {
  const origin =
    'https://meta-k3-recovery-social-mkt-sync-worker.example.workers.dev';
  const output = JSON.stringify({
    type: 'version-upload',
    version_id: VERSION,
    targets: [origin],
  });
  const parsed = parseMetaK3PreviewUpload(output, '', {
    previewAlias: 'meta-k3-recovery',
    accountWorkersDevSubdomain: 'example',
  });
  assert.equal(parsed.versionId, VERSION);
  assert.equal(parsed.previewOrigin, origin);
  assert.equal(
    parsed.recoveryUrl,
    `${origin}/operator/meta/k3-exact-partial-staging-continuation`,
  );
});

test('K3 Preview transport preserves Production deployment', () => {
  assert.deepEqual(validateMetaK3PreviewTransport({
    productionBaselineVersion: BASELINE,
    productionCurrentVersion: BASELINE,
    previewVersion: VERSION,
  }), {
    accepted: true,
    executionTransport: 'preview_version_upload',
    productionBaselineVersion: BASELINE,
    productionCurrentVersion: BASELINE,
    previewVersion: VERSION,
    productionDeploymentUnchanged: true,
    productionTrafficChange: false,
    workerDeploymentCount: 0,
    workerVersionUploadCount: 1,
  });
});
