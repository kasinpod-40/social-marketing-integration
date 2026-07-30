import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  FINAL_DELIVERY_META_HEAD,
  FINAL_DELIVERY_META_OPERATION_ID,
  FINAL_DELIVERY_READINESS_STATUS,
  FINAL_DELIVERY_WOO_INCIDENT_OPERATION_ID,
  assertFinalDeliveryReadinessManifest,
  buildFinalDeliveryReadinessManifest,
  inspectMetaSession,
  readinessSummary,
} from '../../scripts/lib/final-delivery-readiness.js';

const HEAD = 'a'.repeat(40);
const SHA = 'b'.repeat(64);

function validInput() {
  return {
    repositoryHead: HEAD,
    createdAt: '2026-07-30T08:00:00.000Z',
    expiresAt: '2026-07-30T08:30:00.000Z',
    local: {
      devVarsSha256: SHA,
      wranglerConfigSha256: SHA,
      packageLockSha256: SHA,
      nodeMajor: 22,
      cleanMain: true,
      privateInputsSecure: true,
    },
    cloudflare: {
      accountId: 'account-id-private',
      authType: 'oauth',
      workersDevSubdomain: 'example-subdomain',
      workerName: 'social-mkt-sync-worker',
      activeVersionId: 'version-id-private',
      executionFlagsAllFalse: true,
      previewUrlsEnabled: false,
      workersDevEnabled: false,
      queueId: 'queue-id-private',
      requiredSecretNamesPresent: true,
      secretNameFingerprint: SHA,
    },
    woo: {
      incidentOperationId: FINAL_DELIVERY_WOO_INCIDENT_OPERATION_ID,
      incidentState: 'active_recovery_required',
      syncRunStatus: 'failed',
      syncRunErrorCode: 'WOOCOMMERCE_INVALID_JSON',
      activeLockCount: 0,
      queueOperationAttempts: 1,
      coverageRunCount: 0,
      incidentBusinessRows: 0,
      retainedBusinessRows: 12,
      cleanupOldRows: 0,
      cleanupAggregateRows: 0,
      cleanupComplete: true,
    },
    lark: {
      reachable: true,
      tableCount: 14,
      schemaRepairRequired: false,
      tableIdentityFingerprint: SHA,
    },
    meta: {
      repositoryHead: FINAL_DELIVERY_META_HEAD,
      sessionCompleted: false,
      exactOperationPresent: true,
      sessionSha256: SHA,
      overlaySha256: SHA,
      finalizerSha256: SHA,
      clonePath: '/private/meta-clone',
      sessionPath: '/private/session.json',
      overlayPath: '/private/overlay.json',
      finalizerPath: '/private/meta-finalize.mjs',
    },
    safety: {
      providerRequestCount: 0,
      workerVersionUploadCount: 0,
      workerDeploymentCount: 0,
      queueMessageCount: 0,
      d1MutationCount: 0,
      larkMutationCount: 0,
      scheduleMutationCount: 0,
    },
  };
}

test('builds one expiring sealed readiness manifest without auth material', () => {
  const manifest = buildFinalDeliveryReadinessManifest(validInput());
  assert.equal(manifest.status, FINAL_DELIVERY_READINESS_STATUS);
  assert.equal(manifest.repositoryHead, HEAD);
  assert.equal(manifest.cloudflare.workersDevSubdomain, 'example-subdomain');
  assert.equal(manifest.cloudflare.previewUrlsEnabled, false);
  assert.equal(manifest.cloudflare.workersDevEnabled, false);
  assert.equal(manifest.woo.incidentState, 'active_recovery_required');
  assert.equal(manifest.meta.sessionCompleted, false);
  assert.equal(manifest.safety.providerRequestCount, 0);
  assert.equal(JSON.stringify(manifest).includes('bearer'), false);
  assert.equal(JSON.stringify(manifest).includes('authorization'), false);
});

test('rejects any failed readiness gate instead of creating an execute manifest', () => {
  const input = validInput();
  input.cloudflare.executionFlagsAllFalse = false;
  assert.throws(
    () => buildFinalDeliveryReadinessManifest(input),
    (error) => error.code === 'FINAL_DELIVERY_READINESS_GATES_FAILED'
      && error.details.failed.includes('cloudflare.executionFlagsAllFalse'),
  );
});

test('executor validation rejects expired or changed local inputs', () => {
  const manifest = buildFinalDeliveryReadinessManifest(validInput());
  assert.throws(
    () => assertFinalDeliveryReadinessManifest(manifest, {
      repositoryHead: HEAD,
      now: Date.parse(manifest.expiresAt),
    }),
    (error) => error.code === 'FINAL_DELIVERY_READINESS_MANIFEST_EXPIRED',
  );
  assert.throws(
    () => assertFinalDeliveryReadinessManifest(manifest, {
      repositoryHead: HEAD,
      now: Date.parse(manifest.createdAt) + 1,
      devVarsSha256: 'c'.repeat(64),
    }),
    (error) => error.code === 'FINAL_DELIVERY_READINESS_LOCAL_INPUT_CHANGED',
  );
});

test('Meta session remains pinned to exact head and Instagram operation', () => {
  const inspected = inspectMetaSession({
    repositoryHead: FINAL_DELIVERY_META_HEAD,
    completed: false,
    lanes: [{ operationId: FINAL_DELIVERY_META_OPERATION_ID }],
  }, {
    repositoryHead: FINAL_DELIVERY_META_HEAD,
    operationId: FINAL_DELIVERY_META_OPERATION_ID,
  });
  assert.deepEqual(inspected, {
    repositoryHead: FINAL_DELIVERY_META_HEAD,
    sessionCompleted: false,
    exactOperationPresent: true,
  });
  assert.throws(
    () => inspectMetaSession({
      repositoryHead: FINAL_DELIVERY_META_HEAD,
      lanes: [],
    }, {
      repositoryHead: FINAL_DELIVERY_META_HEAD,
      operationId: FINAL_DELIVERY_META_OPERATION_ID,
    }),
    (error) => error.code === 'FINAL_DELIVERY_READINESS_META_OPERATION_INVALID',
  );
});

test('public summary is sanitized and reports zero mutation counters', () => {
  const summary = readinessSummary(buildFinalDeliveryReadinessManifest(validInput()));
  assert.equal(summary.status, FINAL_DELIVERY_READINESS_STATUS);
  assert.equal(summary.workersDevSubdomainResolved, true);
  assert.equal(summary.providerRequestCount, 0);
  assert.equal(summary.workerDeploymentCount, 0);
  assert.equal(summary.queueMessageCount, 0);
  assert.equal(summary.d1MutationCount, 0);
  assert.equal(summary.larkMutationCount, 0);
  assert.equal(JSON.stringify(summary).includes('example-subdomain'), false);
  assert.equal(JSON.stringify(summary).includes('account-id-private'), false);
  assert.equal(JSON.stringify(summary).includes('/private/'), false);
});

test('readiness audit source aggregates blockers and contains no remote mutation command', async () => {
  const source = await readFile(
    new URL('../../scripts/final-delivery-readiness-audit.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /collectGate\('local'/u);
  assert.match(source, /collectGate\('cloudflare'/u);
  assert.match(source, /collectGate\('woocommerce'/u);
  assert.match(source, /collectGate\('lark'/u);
  assert.match(source, /collectGate\('meta'/u);
  assert.match(source, /readAccountWorkersDevSubdomain/u);
  assert.match(source, /discoverWooCommerceQueueId/u);
  assert.match(source, /FINAL_DELIVERY_READINESS_BLOCKED/u);
  assert.doesNotMatch(source, /wrangler[^\n]*(?:deploy|versions\s+upload)/u);
  assert.doesNotMatch(source, /queues\/.+\/messages|\.send\(/u);
  assert.doesNotMatch(source, /method:\s*'(?:POST|PUT|PATCH|DELETE)'/u);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER)\b/iu);
});
