import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const scriptUrl = new URL('../../scripts/youtube-report-live-readiness-audit.mjs', import.meta.url);
const reviewedAuditUrl = new URL(
  '../../scripts/lib/youtube-report-live-readiness-reviewed-audit.js',
  import.meta.url,
);
const source = `${readFileSync(scriptUrl, 'utf8')}\n${readFileSync(reviewedAuditUrl, 'utf8')}`;

test('YouTube Report readiness CLI is plan-only by default', () => {
  const output = execFileSync(process.execPath, [scriptUrl.pathname], { encoding: 'utf8' });
  const plan = JSON.parse(output);
  assert.equal(plan.ok, true);
  assert.equal(plan.planOnly, true);
  assert.deepEqual(plan.windows, [1, 3, 7, 30]);
  assert.equal(plan.expectedMetricRowsTotal, 68);
  assert.match(plan.inputContract, /reviewed-main Repository/u);
  assert.equal(plan.remoteCollectorImplemented, false);
  assert.equal(plan.remoteExecutionAuthorized, false);
  assert.equal(plan.liveMaterializationAuthorized, false);
  assert.equal(plan.remoteMutationCount, 0);
});

test('YouTube Report readiness assessor contains no Provider, Queue, D1/Lark mutation or deployment path', () => {
  assert.doesNotMatch(source, /['"]wrangler['"],\s*['"]deploy['"]/u);
  assert.doesNotMatch(source, /\/queues\/.*\/messages/u);
  assert.doesNotMatch(source, /method:\s*['"]POST['"]/u);
  assert.doesNotMatch(source, /executePlan\(/u);
  assert.doesNotMatch(source, /createLarkBitableClientFromEnv/u);
  assert.doesNotMatch(source, /youtube.*fetch|fetch.*youtube/iu);
  assert.doesNotMatch(source, /\bINSERT\s+INTO\b|\bUPDATE\s+[A-Za-z_]|\bDELETE\s+FROM\b/iu);
  assert.match(source, /readFile/u);
  assert.match(source, /MKT_YOUTUBE_REPORT_READINESS_INPUT/u);
  assert.match(source, /repository_head_not_reviewed/u);
});
