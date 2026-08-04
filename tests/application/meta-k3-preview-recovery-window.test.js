import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(process.cwd());
const scriptPath = resolve(
  repositoryRoot,
  'scripts/meta-k3-partial-staging-preview-recovery.mjs',
);

test('K3 Preview recovery plan mirrors the proven K2 window', () => {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.planOnly, true);
  assert.deepEqual(plan.previewWindow, {
    baseline: { workersDev: false, previewUrls: false },
    active: { workersDev: false, previewUrls: true },
    restored: { workersDev: false, previewUrls: false },
  });
  assert.equal(plan.safePreviewBootstrapRequired, true);
  assert.equal(plan.safeRouteProbeRequiredBeforeFinalizer, true);
  assert.equal(plan.dedicatedFinalizer, true);
  assert.equal(plan.loaderUsed, false);
  assert.equal(plan.queueMessageCount, 0);
  assert.equal(plan.workerDeploymentCount, 0);
  assert.equal(plan.production, 'BLOCKED');
});

test('K3 Active finalizer is ordered after enable, Safe upload and route probe', () => {
  const source = readFileSync(scriptPath, 'utf8');
  const baselineIndex = source.indexOf("currentStage = 'preview-url-window-baseline'");
  const enableIndex = source.indexOf("currentStage = 'enable-preview-url-window'");
  const safeUploadIndex = source.indexOf("currentStage = 'upload-safe-preview-bootstrap'");
  const probeIndex = source.indexOf("currentStage = 'probe-safe-recovery-route'");
  const finalizerIndex = source.indexOf("currentStage = 'run-exact-k3-finalizer'");
  const restoreIndex = source.indexOf("currentStage = 'restore-preview-url-window'");

  for (const index of [
    baselineIndex,
    enableIndex,
    safeUploadIndex,
    probeIndex,
    finalizerIndex,
    restoreIndex,
  ]) assert.notEqual(index, -1);

  assert.ok(baselineIndex < enableIndex);
  assert.ok(enableIndex < safeUploadIndex);
  assert.ok(safeUploadIndex < probeIndex);
  assert.ok(probeIndex < finalizerIndex);
  assert.match(source, /validateMetaK3SafeRouteProbe/u);
  assert.match(source, /assertWooCommercePreviewUrlBaseline/u);
  assert.match(source, /assertWooCommercePreviewUrlActive/u);
  assert.match(source, /assertWooCommercePreviewUrlRestored/u);
  assert.match(source, /automatic-preview-safe-close/u);
  assert.doesNotMatch(source, /queue\.send\(/u);
  assert.doesNotMatch(source, /wrangler["']?,\s*["']deploy/u);
});
