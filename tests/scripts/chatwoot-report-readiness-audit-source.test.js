import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const scriptUrl = new URL('../../scripts/chatwoot-report-readiness-audit.mjs', import.meta.url);
const source = readFileSync(scriptUrl, 'utf8');

test('Chatwoot readiness audit is plan-only by default', () => {
  const output = execFileSync(process.execPath, [scriptUrl.pathname], { encoding: 'utf8' });
  const plan = JSON.parse(output);
  assert.equal(plan.ok, true);
  assert.equal(plan.planOnly, true);
  assert.deepEqual(plan.windows, [1, 3, 7, 30]);
  assert.equal(plan.expectedMetricCount, 139);
  assert.equal(plan.remoteMutationCount, 0);
  assert.equal(plan.catalogPromotionAuthorized, false);
});

test('evidence audit contains no remote execution or mutation path', () => {
  assert.doesNotMatch(source, /wrangler|searchRecords|deployments|versions view/u);
  assert.doesNotMatch(source, /executePlan\(|createMany\(|updateMany\(|deleteMany\(/u);
  assert.doesNotMatch(source, /method:\s*['"]POST['"]/u);
});
