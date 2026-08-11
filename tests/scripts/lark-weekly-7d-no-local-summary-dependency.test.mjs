import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const paths = [
  'scripts/lib/lark-weekly-7d-retained-decision-evidence.js',
  'scripts/lib/lark-weekly-7d-fresh-decision-notification-source.js',
  'scripts/lark-weekly-7d-notification-admission-exact-terminal.mjs',
];

const sources = await Promise.all(paths.map(async (path) => ({
  path,
  source: await readFile(path, 'utf8'),
})));

test('weekly admission runtime has no ignored local Fresh-summary dependency', () => {
  for (const { path, source } of sources) {
    assert.doesNotMatch(source, /decision-preview-summary\.json/u, path);
    assert.doesNotMatch(source, /MKT_LARK_WEEKLY_7D_EXECUTIVE_DECISION_EVIDENCE_ROOT/u, path);
    assert.doesNotMatch(source, /decisionEvidenceRoot/u, path);
  }
});
