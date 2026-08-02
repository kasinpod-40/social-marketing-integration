import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const scriptUrl = new URL(
  '../../scripts/chatwoot-report-remote-readiness-reviewed-terminal.mjs',
  import.meta.url,
);

test('reviewed Chatwoot Report terminal is plan-only by default', () => {
  const output = execFileSync(process.execPath, [scriptUrl.pathname], { encoding: 'utf8' });
  const plan = JSON.parse(output);
  assert.equal(plan.ok, true);
  assert.equal(plan.planOnly, true);
  assert.deepEqual(plan.repositoryGate, {
    branch: 'main',
    clean: true,
    headEqualsReviewedHead: true,
  });
  assert.equal(plan.internalCollectorDirectExecutionBlocked, true);
  assert.equal(plan.remoteMutationCount, 0);
  assert.equal(plan.catalogPromotionAuthorized, false);
  assert.equal(plan.production, 'BLOCKED');
});
