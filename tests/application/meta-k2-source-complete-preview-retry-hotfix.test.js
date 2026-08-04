import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  META_K2_SOURCE_COMPLETE_RETRY_RECOVERY_ROOT,
  finalizeMetaK2SourceCompleteControllerTransform,
} from '../../scripts/lib/meta-k2-source-complete-preview-loader.mjs';
import {
  transformMetaK2SourceCompleteController,
} from '../../scripts/lib/meta-k2-source-complete-preview-recovery.js';

const RETAINED_FAILED_ROOT = 'exact-source-complete-pre-d1-recovery-v1';
const TERMINAL_MODE =
  "    MKT_META_D1_ONLY_TERMINAL_RECOVERY: 'RECOVER_EXACT_FAILED_META_OPERATION',";
const PARTIAL_DISABLED =
  "    MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY: 'false',";

test('source-complete retry uses a new retained evidence root without deleting v1', async () => {
  const outerUrl = new URL(
    '../../scripts/meta-k2-partial-staging-preview-recovery.mjs',
    import.meta.url,
  );
  const source = await readFile(outerUrl, 'utf8');
  const transformed = transformMetaK2SourceCompleteController(outerUrl.href, source);
  const retrySource = finalizeMetaK2SourceCompleteControllerTransform(transformed);

  assert.match(retrySource, new RegExp(META_K2_SOURCE_COMPLETE_RETRY_RECOVERY_ROOT, 'u'));
  assert.doesNotMatch(retrySource, new RegExp(RETAINED_FAILED_ROOT, 'u'));
  assert.equal(source.includes(RETAINED_FAILED_ROOT), false);
});

test('source-complete target admission disables inherited partial mode before terminal mode', async () => {
  const finalizerUrl = new URL(
    '../../scripts/meta-k2-partial-staging-preview-finalizer.mjs',
    import.meta.url,
  );
  const source = await readFile(finalizerUrl, 'utf8');
  const transformed = transformMetaK2SourceCompleteController(finalizerUrl.href, source);
  const retrySource = finalizeMetaK2SourceCompleteControllerTransform(transformed);
  const isolatedModeBlock = `${PARTIAL_DISABLED}\n${TERMINAL_MODE}`;

  assert.equal(retrySource.split(PARTIAL_DISABLED).length - 1, 1);
  assert.equal(retrySource.split(TERMINAL_MODE).length - 1, 1);
  assert.match(retrySource, new RegExp(
    isolatedModeBlock.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'),
    'u',
  ));
  assert.match(retrySource, new RegExp(META_K2_SOURCE_COMPLETE_RETRY_RECOVERY_ROOT, 'u'));
  assert.doesNotMatch(retrySource, new RegExp(RETAINED_FAILED_ROOT, 'u'));
});

test('retry transform fails closed on missing or duplicate exact anchors', () => {
  assert.throws(
    () => finalizeMetaK2SourceCompleteControllerTransform({
      changed: true,
      fileName: 'meta-k2-partial-staging-preview-recovery.mjs',
      source: 'no retained recovery root',
    }),
    (error) => error?.code === 'META_K2_SOURCE_COMPLETE_LOADER_ANCHOR_INVALID',
  );

  assert.throws(
    () => finalizeMetaK2SourceCompleteControllerTransform({
      changed: true,
      fileName: 'meta-k2-partial-staging-preview-finalizer.mjs',
      source: [
        RETAINED_FAILED_ROOT,
        TERMINAL_MODE,
        TERMINAL_MODE,
      ].join('\n'),
    }),
    (error) => error?.code === 'META_K2_SOURCE_COMPLETE_LOADER_ANCHOR_INVALID',
  );
});

test('retry hotfix contains no direct Remote mutation implementation', async () => {
  const source = await readFile(new URL(
    '../../scripts/lib/meta-k2-source-complete-preview-loader.mjs',
    import.meta.url,
  ), 'utf8');
  assert.doesNotMatch(source, /wrangler[\s\S]{0,80}\bdeploy\b/iu);
  assert.doesNotMatch(source, /['"`]\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/iu);
  assert.doesNotMatch(source, /\bd1\s+execute\b/iu);
  assert.doesNotMatch(source, /queue\s*\.\s*send\s*\(/iu);
  assert.doesNotMatch(source, /fetch\s*\(/iu);
});
