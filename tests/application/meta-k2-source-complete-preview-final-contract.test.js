import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createMetaK2SourceCompleteRecoveryPreviewWorker,
} from '../../apps/sync-worker/src/meta-k2-source-complete-recovery-preview-entry.js';
import {
  META_K2_EXACT_RECOVERY_IDENTITY,
} from '../../packages/config/src/meta-k2-exact-recovery-contract.js';
import {
  META_K2_SOURCE_COMPLETE_RETRY_RECOVERY_ROOT,
  finalizeMetaK2SourceCompleteControllerTransform,
  transformMetaK2SourceCompletePreviewHelper,
} from '../../scripts/lib/meta-k2-source-complete-preview-loader.mjs';

const EXACT = META_K2_EXACT_RECOVERY_IDENTITY;
const TOKEN = 'meta-k2-source-complete-final-contract-token-1234567890';
const TOKEN_SHA256 = createHash('sha256').update(TOKEN).digest('hex');
const ATTESTATION = 'a'.repeat(64);
const VERSION_ID = '33333333-3333-4333-8333-333333333333';
const ORIGINAL_REQUESTED_AT = 1785728496842;

function routeEnv() {
  return {
    MKT_ENV: EXACT.environment,
    MKT_CUSTOMER_PROFILE: EXACT.customerProfile,
    MKT_CONNECTION_CUSTOMER_KEY: EXACT.customerKey,
    MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY: 'RECOVER_EXACT_PARTIAL_META_ADS_STAGING',
    MKT_META_D1_ONLY_TERMINAL_RECOVERY: 'RECOVER_EXACT_FAILED_META_OPERATION',
    MKT_META_K2_EXACT_CONTINUATION_PHASE: 'd1',
    MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY_TOKEN_SHA256: TOKEN_SHA256,
    MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY_ATTESTATION: ATTESTATION,
    MKT_META_D1_ONLY_TARGET: EXACT.targetKey,
    MKT_META_D1_ONLY_OPERATION_ID: EXACT.operationId,
    MKT_META_D1_ONLY_WORK_KEY: EXACT.workKey,
    MKT_META_D1_ONLY_SYNC_RUN_ID: EXACT.syncRunId,
    MKT_META_D1_ONLY_SOURCE_ACCOUNT_KEY: EXACT.sourceAccountKey,
    MKT_META_D1_ONLY_PERIOD_START: EXACT.periodStart,
    MKT_META_D1_ONLY_PERIOD_END: EXACT.periodEnd,
    MKT_META_D1_ONLY_ORIGINAL_REQUESTED_AT: String(ORIGINAL_REQUESTED_AT),
    MKT_META_D1_ONLY_MAIN_QUEUE_ATTEMPTS: String(EXACT.mainQueueAttempts),
    MKT_CONNECTOR_META_ADS_ENABLED: 'true',
    MKT_META_D1_WRITE_ENABLED: 'true',
    MKT_META_SOURCE_READ_ENABLED: 'true',
    MKT_META_LARK_WRITE_ENABLED: 'false',
    MKT_META_REPORT_READ_ENABLED: 'false',
  };
}

test('source-complete Preview route isolates route admission from terminal use-case recovery', async () => {
  let processCalls = 0;
  let runtimeLoads = 0;
  let infrastructureLoads = 0;
  const worker = createMetaK2SourceCompleteRecoveryPreviewWorker({
    readRuntimeVersionId: () => VERSION_ID,
    loadRuntimeConfig(env) {
      runtimeLoads += 1;
      assert.equal(env.MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY, 'false');
      assert.equal(
        env.MKT_META_D1_ONLY_TERMINAL_RECOVERY,
        'RECOVER_EXACT_FAILED_META_OPERATION',
      );
      return { isolated: true };
    },
    createInfrastructure(env) {
      infrastructureLoads += 1;
      assert.equal(env.MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY, 'false');
      assert.equal(typeof env.MKT_SYNC_QUEUE?.send, 'function');
      return { isolated: true };
    },
    async processJob(input) {
      processCalls += 1;
      assert.equal(input.env.MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY, 'false');
      assert.equal(
        input.env.MKT_META_D1_ONLY_TERMINAL_RECOVERY,
        'RECOVER_EXACT_FAILED_META_OPERATION',
      );
      assert.equal(input.operation.operationId, EXACT.operationId);
      assert.equal(input.operation.workKey, EXACT.workKey);
      assert.equal(input.job.body.operationId, EXACT.operationId);
      assert.equal(input.job.body.workKey, EXACT.workKey);
      assert.equal(typeof input.env.MKT_SYNC_QUEUE?.send, 'function');
      assert.deepEqual(input.getRuntimeConfig(), { isolated: true });
      assert.deepEqual(input.getInfrastructure(), { isolated: true });
      return { status: 'lark_gate_disabled' };
    },
  });

  const response = await worker.fetch(new Request(
    'https://preview.example.test/operator/meta/d1-only-partial-staging-continuation',
    {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
    },
  ), routeEnv());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-mkt-worker-version-id'), VERSION_ID);
  assert.equal(response.headers.get('x-mkt-meta-partial-staging-attestation'), ATTESTATION);
  assert.equal(body.ok, true);
  assert.equal(body.operationId, EXACT.operationId);
  assert.equal(body.workKey, EXACT.workKey);
  assert.equal(body.syncRunId, EXACT.syncRunId);
  assert.equal(body.directUseCaseInvocationCount, 1);
  assert.equal(body.queueMessageCount, 0);
  assert.equal(processCalls, 1);
  assert.equal(runtimeLoads, 1);
  assert.equal(infrastructureLoads, 1);
});

test('loader pins the source-complete entrypoint, v3 evidence root and sanitized HTTP code', async () => {
  const helperPath = new URL(
    '../../scripts/lib/meta-k2-preview-recovery.js',
    import.meta.url,
  );
  const helperBefore = await readFile(helperPath, 'utf8');
  const helperAfter = transformMetaK2SourceCompletePreviewHelper(helperBefore);
  assert.match(
    helperAfter,
    /apps\/sync-worker\/src\/meta-k2-source-complete-recovery-preview-entry\.js/u,
  );
  assert.doesNotMatch(
    helperAfter,
    /apps\/sync-worker\/src\/meta-k2-exact-recovery-preview-entry\.js/u,
  );
  assert.equal(await readFile(helperPath, 'utf8'), helperBefore);

  const finalizer = finalizeMetaK2SourceCompleteControllerTransform({
    changed: true,
    fileName: 'meta-k2-partial-staging-preview-finalizer.mjs',
    source: [
      "const recoveryRoot = 'exact-source-complete-pre-d1-recovery-v1';",
      "    MKT_META_D1_ONLY_TERMINAL_RECOVERY: 'RECOVER_EXACT_FAILED_META_OPERATION',",
      "        { phase: input.phase, status: response.status },",
    ].join('\n'),
  });
  assert.match(finalizer, new RegExp(META_K2_SOURCE_COMPLETE_RETRY_RECOVERY_ROOT, 'u'));
  assert.match(finalizer, /MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY: 'false'/u);
  assert.match(finalizer, /responseCode: typeof value\?\.code/u);
  assert.match(finalizer, /responseStage: typeof value\?\.stage/u);
  assert.doesNotMatch(finalizer, /exact-source-complete-pre-d1-recovery-v2/u);
});
