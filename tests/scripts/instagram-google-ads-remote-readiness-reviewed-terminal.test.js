import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const reviewedTerminalUrl = new URL(
  '../../scripts/instagram-google-ads-remote-readiness-reviewed-terminal.mjs',
  import.meta.url,
);
const internalCollectorUrl = new URL(
  '../../scripts/instagram-google-ads-remote-readiness-collector.mjs',
  import.meta.url,
);
const reviewedSource = readFileSync(reviewedTerminalUrl, 'utf8');
const internalSource = readFileSync(internalCollectorUrl, 'utf8');

test('reviewed Instagram Google Ads terminal is plan-only by default', () => {
  const output = execFileSync(process.execPath, [reviewedTerminalUrl.pathname], { encoding: 'utf8' });
  const plan = JSON.parse(output);
  assert.equal(plan.ok, true);
  assert.equal(plan.planOnly, true);
  assert.deepEqual(plan.repositoryGate, {
    branch: 'main',
    clean: true,
    headEqualsReviewedHead: true,
  });
  assert.equal(plan.independentDecisions, true);
  assert.equal(plan.internalCollectorDirectExecutionBlocked, true);
  assert.equal(plan.remoteMutationCount, 0);
  assert.equal(plan.catalogPromotionAuthorized, false);
  assert.equal(plan.production, 'BLOCKED');
});

test('reviewed terminal validates repository before invoking the internal collector', () => {
  const repositoryStage = reviewedSource.indexOf("stage = 'repository-read-only-preflight'");
  const internalStage = reviewedSource.indexOf("stage = 'run-internal-read-only-collector'");
  assert.ok(repositoryStage >= 0);
  assert.ok(internalStage > repositoryStage);
  assert.match(reviewedSource, /branch !== 'main'/u);
  assert.match(reviewedSource, /repository\.head !== repository\.reviewedHead/u);
  assert.match(reviewedSource, /status', '--porcelain', '--untracked-files=all/u);
});

test('reviewed terminal and internal collector preserve read-only boundaries', () => {
  const source = `${reviewedSource}\n${internalSource}`;
  assert.doesNotMatch(source, /['"]wrangler['"],\s*['"]deploy['"]/u);
  assert.doesNotMatch(source, /['"]versions['"],\s*['"]upload['"]/u);
  assert.doesNotMatch(source, /\/queues\/.*\/messages/u);
  assert.doesNotMatch(source, /method:\s*['"]POST['"]/u);
  assert.doesNotMatch(source, /createMany\(|updateMany\(|deleteMany\(/u);
  assert.doesNotMatch(source, /graph\.facebook|googleads\.googleapis/iu);
  assert.match(reviewedSource, /INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_INTERNAL_HANDOFF/u);
  assert.match(internalSource, /assertIndependentSelectOnlySql/u);
});
