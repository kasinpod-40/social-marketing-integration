import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const recoveryScript = new URL(
  '../../scripts/meta-k2-partial-staging-preview-recovery.mjs',
  import.meta.url,
);
const finalizerScript = new URL(
  '../../scripts/meta-k2-partial-staging-preview-finalizer.mjs',
  import.meta.url,
);
const entrypoint = new URL(
  '../../apps/sync-worker/src/meta-k2-exact-recovery-preview-entry.js',
  import.meta.url,
);

test('Preview recovery path uploads versions and never deploys Production Worker traffic', async () => {
  const [recovery, finalizer] = await Promise.all([
    readFile(recoveryScript, 'utf8'),
    readFile(finalizerScript, 'utf8'),
  ]);
  for (const source of [recovery, finalizer]) {
    assert.doesNotMatch(source, /['"]wrangler['"],\s*['"]deploy['"]/u);
    assert.match(source, /['"]wrangler['"],\s*['"]versions['"],\s*['"]upload['"]/u);
    assert.match(source, /--preview-alias/u);
    assert.match(source, /productionTrafficChange:\s*false/u);
    assert.match(source, /workerDeploymentCount:\s*0/u);
  }
  assert.match(recovery, /writePreviewState\(true,\s*['"]enable['"]\)/u);
  assert.match(recovery, /buildWooCommercePreviewUrlMutation\(previewsEnabled\)/u);
  assert.match(recovery, /automatic-preview-safe-close/u);
  assert.match(recovery, /assertProductionVersionUnchanged/u);
  assert.match(finalizer, /preview_version_upload/u);
  assert.match(finalizer, /MKT_META_K2_PRODUCTION_BASELINE_VERSION/u);
});

test('Preview entrypoint exposes only the exact POST recovery route and lazy-loads its delegate', async () => {
  const source = await readFile(entrypoint, 'utf8');
  assert.doesNotMatch(source, /^import worker from ['"]\.\/index\.js['"];?$/mu);
  assert.match(source, /import\(['"]\.\/index\.js['"]\)/u);
  assert.match(source, /request\.method !== 'POST'/u);
  assert.match(source, /url\.pathname !== META_K2_EXACT_RECOVERY_PATH/u);
  assert.match(source, /const worker = await loadRecoveryWorker\(\)/u);
  assert.match(source, /META_K2_PREVIEW_ROUTE_NOT_FOUND/u);
  assert.match(source, /batch\.retryAll\(\)/u);
  assert.match(source, /Preview-only entrypoint: schedules are intentionally disabled/u);
});
