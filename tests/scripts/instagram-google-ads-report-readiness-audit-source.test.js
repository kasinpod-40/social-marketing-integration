import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const scriptUrl = new URL('../../scripts/instagram-google-ads-report-readiness-audit.mjs', import.meta.url);
const source = readFileSync(scriptUrl, 'utf8');

test('Instagram and Google Ads readiness CLI is plan-only by default', () => {
  const output = execFileSync(process.execPath, [scriptUrl.pathname], { encoding: 'utf8' });
  const plan = JSON.parse(output);
  assert.equal(plan.ok, true);
  assert.equal(plan.planOnly, true);
  assert.deepEqual(plan.channels, ['instagram_organic', 'google_ads']);
  assert.deepEqual(plan.windows, [1, 3, 7, 30]);
  assert.equal(plan.independentDecisions, true);
  assert.equal(plan.remoteCollectorImplemented, false);
  assert.equal(plan.catalogPromotionAuthorized, false);
  assert.equal(plan.remoteMutationCount, 0);
});

test('Instagram and Google Ads readiness assessor contains no Provider, delivery replay, Queue, D1/Lark mutation or deployment path', () => {
  assert.doesNotMatch(source, /['"]wrangler['"],\s*['"]deploy['"]/u);
  assert.doesNotMatch(source, /\/queues\/.*\/messages/u);
  assert.doesNotMatch(source, /method:\s*['"]POST['"]/u);
  assert.doesNotMatch(source, /executePlan\(/u);
  assert.doesNotMatch(source, /createLarkBitableClientFromEnv/u);
  assert.doesNotMatch(source, /graph\.facebook\.com|googleads\.googleapis\.com|\/v1\/google-ads\/deliveries/iu);
  assert.doesNotMatch(source, /\bINSERT\s+INTO\b|\bUPDATE\s+[A-Za-z_]|\bDELETE\s+FROM\b/iu);
  assert.match(source, /readFile/u);
  assert.match(source, /MKT_INSTAGRAM_GOOGLE_ADS_READINESS_INPUT/u);
});
