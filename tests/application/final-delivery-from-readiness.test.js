import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('executor requires the audited manifest before any delivery child starts', async () => {
  const source = await readFile(
    new URL('../../scripts/final-delivery-from-readiness.mjs', import.meta.url),
    'utf8',
  );
  const manifestValidation = source.indexOf('assertFinalDeliveryReadinessManifest');
  const wooChild = source.indexOf("'woocommerce-invalid-json-recovery-chain'");
  const metaChild = source.indexOf("'meta-finalizer'");
  assert.ok(manifestValidation >= 0);
  assert.ok(wooChild > manifestValidation);
  assert.ok(metaChild > wooChild);
  assert.match(source, /EXECUTE_FROM_READY_MANIFEST/u);
  assert.match(source, /devVarsSha256/u);
  assert.match(source, /wranglerConfigSha256/u);
  assert.match(source, /MKT_WOOCOMMERCE_WORKERS_DEV_SUBDOMAIN/u);
  assert.match(source, /MKT_WOOCOMMERCE_FINAL_QUEUE_ID/u);
});

test('executor is checkpointed and verifies Woo before starting pinned Meta', async () => {
  const source = await readFile(
    new URL('../../scripts/final-delivery-from-readiness.mjs', import.meta.url),
    'utf8',
  );
  const wooSummary = source.indexOf('validateCompletionSummary');
  const wooCheckpoint = source.indexOf('wooCompleted: true');
  const metaStage = source.indexOf("currentStage = 'meta-pinned-session'");
  const metaSession = source.indexOf('inspectMetaSession');
  assert.ok(wooSummary >= 0);
  assert.ok(wooCheckpoint > wooSummary);
  assert.ok(metaStage > wooCheckpoint);
  assert.ok(metaSession >= 0);
  assert.match(source, /META_WIDE_COMPLETED_AND_SAFELY_CLOSED/u);
  assert.match(source, /ALL_DELIVERY_WORK_COMPLETED/u);
  assert.match(source, /readCheckpoint/u);
});

test('executor delegates mutations and contains no direct Cloudflare Provider Queue D1 or Lark write', async () => {
  const source = await readFile(
    new URL('../../scripts/final-delivery-from-readiness.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /api\.cloudflare\.com|open\.larksuite\.com|wp-json/u);
  assert.doesNotMatch(source, /queues\/.+\/messages|\.send\(/u);
  assert.doesNotMatch(source, /wrangler[^\n]*(?:deploy|versions\s+upload|d1\s+execute)/u);
  assert.doesNotMatch(
    source,
    /(?:INSERT\s+INTO|UPDATE\s+(?:sync_|raw_|commerce_)|DELETE\s+FROM|DROP\s+TABLE|ALTER\s+TABLE)/iu,
  );
  assert.match(source, /runRequiredNode/u);
  assert.match(source, /production: 'BLOCKED'/u);
  assert.match(source, /production: false/u);
});

test('Woo wrapper summary validator pins cleanup, history, parity, all-false and next step', async () => {
  const source = await readFile(
    new URL('../../scripts/final-delivery-from-readiness.mjs', import.meta.url),
    'utf8',
  );
  for (const marker of [
    'WOOCOMMERCE_2026_COMPLETED_SAFE',
    '2026-01-01T00:00:00.000Z',
    'replacedOperationClosed',
    'parityVerified',
    'idempotentRerunVerified',
    'incrementalVerified',
    'activeQueueOperations',
    'executionFlagsAllFalse',
    'scheduleExecutionFlagsFalse',
    'workerSafeAfterFinal',
    'resume_pinned_meta_finalizer',
  ]) {
    assert.ok(source.includes(marker), marker);
  }
});
