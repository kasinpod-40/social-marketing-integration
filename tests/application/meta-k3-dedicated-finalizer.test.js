import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  META_K3_EXACT_RECOVERY_IDENTITY,
} from '../../packages/config/src/meta-k3-exact-recovery-contract.js';

const repositoryRoot = resolve(process.cwd());

test('K3 finalizer is dedicated and contains no runtime source rewriting', () => {
  const source = readFileSync(
    resolve(repositoryRoot, 'scripts/meta-k3-partial-staging-preview-finalizer.mjs'),
    'utf8',
  );
  assert.match(source, /meta-k3-partial-staging-finalizer\.js/u);
  assert.match(source, /meta-k3-preview-recovery\.js/u);
  assert.match(source, /meta-k3-exact-recovery-preview-entry\.js/u);
  assert.match(source, /deployed\.recoveryUrl/u);
  assert.match(source, /previewUrlAuthority: 'wrangler_version_upload_record'/u);
  assert.doesNotMatch(source, /experimental-loader/u);
  assert.doesNotMatch(source, /meta-k3-exact-recovery-loader/u);
  assert.doesNotMatch(source, /meta-k2-partial-staging-preview-finalizer/u);
  assert.doesNotMatch(source, /waitForMetaK3PreviewReadiness/u);
  assert.doesNotMatch(source, /MKT_META_K3_EXACT_RECOVERY_URL/u);
});

test('K3 dedicated finalizer plan is exact and mutation-free', () => {
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
  assert.equal(plan.target, META_K3_EXACT_RECOVERY_IDENTITY.targetKey);
  assert.equal(plan.operationId, META_K3_EXACT_RECOVERY_IDENTITY.operationId);
  assert.equal(plan.executionModel,
    'dedicated_k3_exact_direct_continuation_without_loader_or_queue');
  assert.equal(plan.previewUrlAuthority, 'wrangler_version_upload_record');
  assert.equal(plan.queueMessageCount, 0);
  assert.equal(plan.lifecycleSqlRepairCount, 0);
  assert.equal(plan.productionWorkerDeployment, false);
  assert.equal(plan.productionTrafficChange, false);
  assert.equal(plan.remoteActionsPerformed, false);
});
