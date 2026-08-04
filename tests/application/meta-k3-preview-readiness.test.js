import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  createMetaK3ExactRecoveryHandler,
} from '../../apps/sync-worker/src/meta-k3-exact-recovery-preview-entry.js';
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
  waitForMetaK3PreviewReadiness,
} from '../../scripts/lib/meta-k3-preview-readiness.js';
import {
  identifyMetaK3RecoveryResumeProfile,
  META_K3_RECOVERY_RESUME_PROFILES,
  validateMetaK3RecoveryResumeEvidence,
} from '../../scripts/lib/meta-k3-recovery-resume-boundary.js';

const EXACT = META_K3_EXACT_RECOVERY_IDENTITY;
const TOKEN = 'k3-preview-readiness-token-000000000000000000000000';
const TOKEN_SHA256 = createHash('sha256').update(TOKEN).digest('hex');
const ATTESTATION = 'a'.repeat(64);
const VERSION_ID = '12345678-1234-4234-9234-123456789abc';
const ORIGINAL_REQUESTED_AT = 1785815000000;

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

function evidence(phase, data) {
  return {
    status: 'passed',
    phase,
    operationId: EXACT.operationId,
    workKey: EXACT.workKey,
    syncRunId: EXACT.syncRunId,
    data,
  };
}

test('K3 HEAD readiness validates exact config without invoking business work', async () => {
  let processJobCalls = 0;
  const handler = createMetaK3ExactRecoveryHandler({
    readRuntimeVersionId: () => VERSION_ID,
    processJob: async () => {
      processJobCalls += 1;
      return { status: 'source_continuation' };
    },
  });
  const response = await handler(new Request(
    `https://preview.example${META_K3_EXACT_RECOVERY_PATH}`,
    {
      method: 'HEAD',
      headers: { authorization: `Bearer ${TOKEN}` },
    },
  ), exactEnv());

  assert.equal(response.status, 204);
  assert.equal(
    response.headers.get(META_K3_EXACT_RECOVERY_ATTESTATION_HEADER),
    ATTESTATION,
  );
  assert.equal(response.headers.get('x-mkt-worker-version-id'), VERSION_ID);
  assert.equal(processJobCalls, 0);
});

test('K3 Preview readiness retries transient 404 until exact alias version is live', async () => {
  let calls = 0;
  const result = await waitForMetaK3PreviewReadiness({
    url: `https://meta-k3.example${META_K3_EXACT_RECOVERY_PATH}`,
    token: TOKEN,
    attestation: ATTESTATION,
    activeVersion: VERSION_ID,
    maxAttempts: 3,
    intervalMs: 0,
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) return new Response(null, { status: 404 });
      return new Response(null, {
        status: 204,
        headers: {
          [META_K3_EXACT_RECOVERY_ATTESTATION_HEADER]: ATTESTATION,
          'x-mkt-worker-version-id': VERSION_ID,
        },
      });
    },
  });

  assert.equal(result.accepted, true);
  assert.equal(result.attempts, 3);
  assert.equal(result.businessInvocationCount, 0);
  assert.equal(result.queueMessageCount, 0);
});

test('K3 Preview readiness rejects a non-retryable active-route response', async () => {
  await assert.rejects(
    waitForMetaK3PreviewReadiness({
      url: `https://meta-k3.example${META_K3_EXACT_RECOVERY_PATH}`,
      token: TOKEN,
      attestation: ATTESTATION,
      activeVersion: VERSION_ID,
      maxAttempts: 2,
      intervalMs: 0,
      fetchImpl: async () => new Response(null, { status: 401 }),
    }),
    (error) => error?.code === 'META_K3_PREVIEW_READINESS_REJECTED',
  );
});

test('K3 safe-restored HTTP 404 evidence is the only accepted post-upload resume profile', () => {
  const files = META_K3_RECOVERY_RESUME_PROFILES
    .post_d1_preview_http_404_safe_restored;
  const profile = identifyMetaK3RecoveryResumeProfile(files, []);
  assert.equal(profile, 'post_d1_preview_http_404_safe_restored');

  const result = validateMetaK3RecoveryResumeEvidence(profile, {
    admission: evidence('retained-evidence-admission', {
      queueMessageCount: 0,
      workerDeploymentCount: 0,
      productionTrafficChange: false,
    }),
    stability: evidence('read-only-stability', {
      executionFlagsAllFalse: true,
      productionDeploymentUnchanged: true,
    }),
    backup: evidence('backup', {
      remoteMutationCount: 0,
    }),
    deployD1: evidence('deploy-d1-continuation', {
      executionTransport: 'preview_version_upload',
      productionDeploymentUnchanged: true,
      productionTrafficChange: false,
      workerDeploymentCount: 0,
      workerVersionUploadCount: 1,
      queueMessageCount: 0,
    }),
    verifyD1: evidence('verify-d1-continuation', {
      expectedTrueFlags: [
        'MKT_CONNECTOR_META_ADS_ENABLED',
        'MKT_META_D1_WRITE_ENABLED',
        'MKT_META_SOURCE_READ_ENABLED',
      ],
      executionTransport: 'preview_version_upload',
      productionDeploymentUnchanged: true,
      queueMessageCount: 0,
    }),
    restoreD1: evidence('restore-after-d1', {
      mode: 'safe',
      expectedTrueFlags: [],
      productionDeploymentUnchanged: true,
      productionTrafficChange: false,
      workerDeploymentCount: 0,
      workerVersionUploadCount: 1,
    }),
    verifyRestoreD1: evidence('verify-restore-after-d1', {
      mode: 'safe',
      expectedTrueFlags: [],
      executionFlagsAllFalse: true,
      productionDeploymentUnchanged: true,
    }),
  });

  assert.equal(result.accepted, true);
  assert.equal(result.businessContinuationEvidencePresent, false);
  assert.throws(
    () => identifyMetaK3RecoveryResumeProfile(
      [...files, 'continue-d1.json'],
      [],
    ),
    (error) => error?.code === 'META_K3_PRE_MUTATION_EVIDENCE_INVALID',
  );
});
