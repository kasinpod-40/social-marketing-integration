import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Branch Verification resolves a diff base for push, PR and manual events', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/branch-verification.yml', import.meta.url),
    'utf8',
  );

  assert.match(
    workflow,
    /DIFF_BASE_REF:\s*\$\{\{ github\.base_ref \|\| github\.event\.repository\.default_branch \}\}/u,
  );
  assert.match(workflow, /git diff --check "origin\/\$\{DIFF_BASE_REF\}\.\.\.HEAD"/u);
  assert.doesNotMatch(workflow, /git diff --check origin\/\$\{\{ github\.base_ref \}\}/u);
});
