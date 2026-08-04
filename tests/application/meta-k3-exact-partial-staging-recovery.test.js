import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  META_K3_EXACT_RECOVERY_ATTESTATION_ENV,
  META_K3_EXACT_RECOVERY_ATTESTATION_HEADER,
  META_K3_EXACT_RECOVERY_IDENTITY,
  META_K3_EXACT_RECOVERY_MODE,
  META_K3_EXACT_RECOVERY_MODE_ENV,
  META_K3_EXACT_RECOVERY_PATH,
  META_K3_EXACT_RECOVERY_PHASE_ENV,
  META_K3_EXACT_RECOVERY_TOKEN_SHA256_ENV,
} from '../../packages/config/src/meta-k3-exact-recovery-contract.js';
import {
  createMetaK3ExactRecoveryHandler,
} from '../../apps/sync-worker/src/meta-k3-exact-recovery-preview-entry.js';
import {
  materializeMetaK3WranglerEntrypoint,
} from '../../scripts/lib/meta-k3-wrangler-config-authority.js';

const EXACT = META_K3_EXACT_RECOVERY_IDENTITY;
const ORIGINAL_REQUESTED_AT = 1785815000000;
const TOKEN = 'k3-exact-recovery-token-000000000000000000000000';
const TOKEN_SHA256 = createHash('sha256').update(TOKEN).digest('hex');
const ATTESTATION = 'a'.repeat(64);
const VERSION_ID = '12345678-1234-4234-9234-123456789abc';

function exactEnv(overrides = {}) {
  return {
    MKT_ENV: EXACT.environment,
    MKT_CUSTOMER_PROFILE: EXACT.customerProfile,
    MKT_CONNECTION_CUSTOMER_KEY: EXACT.customerKey,
    MKT_META_D1_ONLY_TARGET: EXACT.targetKey,
    MKT_META_D1_ONLY_OPERATION_ID: EXACT.operationId,
    MKT_META_D1_ONLY_WORK_KEY: EXACT.workKey,
    MKT_META_D1_ONLY_SYNC_RUN_ID: EXACT.syncRunId,
    MKT_META_D1_ONLY_SOURCE_ACCOUNT_KEY: EXACT.sourceAccountKey,
    MKT_META_D1_ONLY_PERIOD_START: EXACT.periodStart,
    MKT_META_D1_ONLY_PERIOD_END: EXACT.periodEnd,
    MKT_META_D1_ONLY_ORIGINAL_REQUESTED_AT: String(ORIGINAL_REQUESTED_AT),
    MKT_META_D1_ONLY_MAIN_QUEUE_ATTEMPTS: String(EXACT.mainQueueAttempts),
    [META_K3_EXACT_RECOVERY_MODE_ENV]: META_K3_EXACT_RECOVERY_MODE,
    [META_K3_EXACT_RECOVERY_PHASE_ENV]: 'd1',
    [META_K3_EXACT_RECOVERY_TOKEN_SHA256_ENV]: TOKEN_SHA256,
    [META_K3_EXACT_RECOVERY_ATTESTATION_ENV]: ATTESTATION,
    MKT_CONNECTOR_META_ADS_ENABLED: 'true',
    MKT_META_D1_WRITE_ENABLED: 'true',
    MKT_META_SOURCE_READ_ENABLED: 'true',
    MKT_META_LARK_WRITE_ENABLED: 'false',
    ...overrides,
  };
}

function exactRequest() {
  return new Request(`https://preview.example${META_K3_EXACT_RECOVERY_PATH}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
    },
  });
}

test('exact K3 contract pins the retained partial-staging boundary', () => {
  assert.equal(EXACT.targetKey, 'chemistry_k3');
  assert.equal(
    EXACT.operationId,
    'meta-chemistry_k3-history-20260701-20260731-d4824a9e2ba9',
  );
  assert.equal(EXACT.sourceStage, 'daily');
  assert.equal(EXACT.sourceUnitCount, 13);
  assert.equal(EXACT.sourceRowCount, 1201);
  assert.equal(EXACT.sourcePageNumber, 13);
  assert.equal(EXACT.queueOperationAttempts, 1);
  assert.equal(EXACT.mainQueueAttempts, 14);
});

test('exact K3 Preview handler continues without a Cloudflare Queue send', async () => {
  let processJobCalls = 0;
  const handler = createMetaK3ExactRecoveryHandler({
    readRuntimeVersionId: () => VERSION_ID,
    processJob: async ({ env, operation }) => {
      processJobCalls += 1;
      await env.MKT_SYNC_QUEUE.send({
        operationId: operation.operationId,
        workKey: operation.workKey,
        generation: operation.generation,
        originalRequestedAt: operation.originalRequestedAt,
        sourceAccountKey: EXACT.sourceAccountKey,
      });
      return {
        status: 'source_continuation',
        continuationPhase: 'meta_end_to_end_source_staging_v1',
      };
    },
  });

  const response = await handler(exactRequest(), exactEnv());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get(META_K3_EXACT_RECOVERY_ATTESTATION_HEADER), ATTESTATION);
  assert.equal(body.ok, true);
  assert.equal(body.target, EXACT.targetKey);
  assert.equal(body.operationId, EXACT.operationId);
  assert.equal(body.workKey, EXACT.workKey);
  assert.equal(body.syncRunId, EXACT.syncRunId);
  assert.equal(body.continuationSuppressed, true);
  assert.equal(body.directUseCaseInvocationCount, 1);
  assert.equal(body.queueMessageCount, 0);
  assert.equal(body.queueOperationAttemptMutationCount, 0);
  assert.equal(processJobCalls, 1);
});

test('exact K3 Preview handler fails closed on identity or Queue-attempt drift', async () => {
  let processJobCalls = 0;
  const handler = createMetaK3ExactRecoveryHandler({
    readRuntimeVersionId: () => VERSION_ID,
    processJob: async () => {
      processJobCalls += 1;
      return { status: 'source_continuation' };
    },
  });

  const response = await handler(exactRequest(), exactEnv({
    MKT_META_D1_ONLY_MAIN_QUEUE_ATTEMPTS: '15',
  }));
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.equal(body.code, 'META_K3_RECOVERY_TARGET_INVALID');
  assert.equal(body.queueMessageCount, 0);
  assert.equal(processJobCalls, 0);
});

test('K3 launcher reuses the reviewed finalizer with the K3 contract', () => {
  const repositoryRoot = resolve(process.cwd());
  const result = spawnSync(
    process.execPath,
    ['scripts/meta-k3-partial-staging-preview-finalizer.mjs'],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.planOnly, true);
  assert.equal(plan.target, EXACT.targetKey);
  assert.equal(plan.operationId, EXACT.operationId);
  assert.equal(plan.workKey, EXACT.workKey);
  assert.equal(plan.syncRunId, EXACT.syncRunId);
  assert.equal(plan.retainedOperationHead, '6d82a50bc6d051cc39307254543619fcd29211b4');
  assert.equal(plan.queueMessageCount, 0);
  assert.equal(plan.productionWorkerDeployment, false);
  assert.equal(plan.productionTrafficChange, false);
});

test('K3 execute bootstrap materializes runtime authority and only resumes exact zero-mutation evidence profiles', () => {
  const repositoryRoot = resolve(process.cwd());
  const launcher = readFileSync(
    resolve(repositoryRoot, 'scripts/meta-k3-partial-staging-preview-finalizer.mjs'),
    'utf8',
  );

  assert.match(launcher, /materializeMetaHistoryLarkRuntimeConfig/u);
  assert.match(launcher, /materializeMetaK3WranglerEntrypoint/u);
  assert.match(launcher, /META_GRAPH_API_VERSION=v25\.0/u);
  assert.match(launcher, /MKT_META_K3_RESUME_PRE_MUTATION_CONFIG_FAILURE/u);
  assert.match(launcher, /RESUME_EXACT_K3_PRE_MUTATION_CONFIG_FAILURE/u);
  assert.match(launcher, /post_admission_pre_stability/u);
  assert.match(launcher, /post_backup_pre_preview/u);
  assert.match(launcher, /profile === 'post_backup_pre_preview'/u);
  assert.match(launcher, /workerVersionUploadCount:\s*0/u);
  assert.match(launcher, /queueMessageCount:\s*0/u);
  assert.match(launcher, /remoteMutationCount\)\s*===\s*0/u);
  assert.doesNotMatch(launcher, /queueSendAllowed:\s*true/u);
  assert.doesNotMatch(launcher, /lifecycleSqlRepairAllowed:\s*true/u);
});

test('nested K3 config anchors main to the Repository and passes exact Wrangler version-upload dry-run', async () => {
  const root = mkdtempSync(join(tmpdir(), 'meta-k3-wrangler-authority-'));
  try {
    const entrypoint = join(root, 'apps', 'sync-worker', 'src', 'index.js');
    const sourceConfigPath = join(root, 'wrangler.sync.jsonc');
    const nestedConfigPath = join(
      root,
      'outputs',
      'meta-d1-only-rollout',
      'chemistry_k3',
      'wrangler.meta-k3-d1.preview.jsonc',
    );
    mkdirSync(resolve(entrypoint, '..'), { recursive: true });
    mkdirSync(resolve(nestedConfigPath, '..'), { recursive: true });
    writeFileSync(entrypoint, [
      'export default {',
      '  async fetch() {',
      "    return new Response('ok');",
      '  },',
      '};',
      '',
    ].join('\n'));
    const sourceText = JSON.stringify({
      name: 'meta-k3-wrangler-path-test',
      main: 'apps/sync-worker/src/index.js',
      compatibility_date: '2026-08-01',
    }, null, 2);
    writeFileSync(sourceConfigPath, `${sourceText}\n`);

    const materialized = await materializeMetaK3WranglerEntrypoint(
      sourceText,
      {
        repositoryRoot: root,
        sourceConfigPath,
      },
    );
    const canonicalEntrypoint = realpathSync.native(entrypoint);
    assert.equal(materialized.entrypoint, canonicalEntrypoint);
    assert.equal(materialized.entrypointAnchoredToRepository, true);
    assert.match(
      materialized.configText,
      new RegExp(
        JSON.stringify(canonicalEntrypoint)
          .replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'),
        'u',
      ),
    );
    writeFileSync(nestedConfigPath, materialized.configText);

    const result = spawnSync(
      'npx',
      [
        '--no-install',
        'wrangler',
        'versions',
        'upload',
        '--config',
        nestedConfigPath,
        '--preview-alias',
        'meta-k3-recovery',
        '--message',
        'meta-k3-nested-config-dry-run',
        '--dry-run',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      },
    );

    assert.equal(
      result.status,
      0,
      `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
