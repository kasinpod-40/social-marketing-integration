import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const internalUrl = new URL('../../scripts/chatwoot-report-remote-readiness-collector.mjs', import.meta.url);
const reviewedUrl = new URL('../../scripts/chatwoot-report-remote-readiness-reviewed-terminal.mjs', import.meta.url);
const internalSource = readFileSync(internalUrl, 'utf8');
const reviewedSource = readFileSync(reviewedUrl, 'utf8');

test('repository gate runs before the internal collector', () => {
  const repositoryStage = reviewedSource.indexOf("stage = 'repository-read-only-preflight'");
  const internalStage = reviewedSource.indexOf("stage = 'run-internal-read-only-collector'");
  assert.ok(repositoryStage >= 0);
  assert.ok(internalStage > repositoryStage);
  assert.match(reviewedSource, /branch !== 'main'/u);
  assert.match(reviewedSource, /repository\.head !== repository\.reviewedHead/u);
  assert.match(reviewedSource, /status', '--porcelain', '--untracked-files=all/u);
});

test('collector preserves read-only boundaries and accepted forensic incidents', () => {
  const source = `${internalSource}\n${reviewedSource}`;
  assert.doesNotMatch(source, /['"]wrangler['"],\s*['"]deploy['"]/u);
  assert.doesNotMatch(source, /['"]versions['"],\s*['"]upload['"]/u);
  assert.doesNotMatch(source, /\/queues\/.*\/messages/u);
  assert.doesNotMatch(source, /method:\s*['"]POST['"]/u);
  assert.doesNotMatch(source, /executePlan\(|createMany\(|updateMany\(|deleteMany\(/u);
  assert.doesNotMatch(source, /api\.chatwoot|CHATWOOT_API_ACCESS_TOKEN/iu);
  assert.match(internalSource, /assertChatwootSelectOnlySql/u);
  assert.match(internalSource, /retained_dlq_count/u);
  assert.match(internalSource, /retained_alert_count/u);
  assert.match(reviewedSource, /CHATWOOT_REPORT_REMOTE_COLLECTOR_INTERNAL_HANDOFF/u);
});
