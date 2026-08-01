import assert from 'node:assert/strict';
import test from 'node:test';

import {
  META_HISTORY_EXACT_CONTINUATION_ALLOWED_DELTA,
  validateMetaHistoryExactContinuationDelta,
} from '../../scripts/lib/meta-history-exact-plan-continuation.js';

const MULTICHANNEL_AUDIT_PATHS = Object.freeze([
  'docs/project-brain/multichannel-report-coverage.md',
  'docs/tasks/multichannel-report-coverage-v1.md',
]);

test('exact continuation includes only the reviewed multichannel audit documents', () => {
  for (const path of MULTICHANNEL_AUDIT_PATHS) {
    assert.equal(META_HISTORY_EXACT_CONTINUATION_ALLOWED_DELTA.includes(path), true, path);
  }

  assert.doesNotThrow(() => validateMetaHistoryExactContinuationDelta([
    ...META_HISTORY_EXACT_CONTINUATION_ALLOWED_DELTA,
  ]));

  for (const omitted of MULTICHANNEL_AUDIT_PATHS) {
    const missing = META_HISTORY_EXACT_CONTINUATION_ALLOWED_DELTA.filter(
      (path) => path !== omitted,
    );
    assert.throws(
      () => validateMetaHistoryExactContinuationDelta(missing),
      (error) => error?.code === 'META_HISTORY_EXACT_CONTINUATION_REPOSITORY_DELTA_INVALID'
        && error?.details?.missing?.includes(omitted),
    );
  }
});
