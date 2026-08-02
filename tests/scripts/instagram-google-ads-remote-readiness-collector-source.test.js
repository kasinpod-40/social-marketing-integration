import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const scriptUrl = new URL('../../scripts/instagram-google-ads-remote-readiness-collector.mjs', import.meta.url);
const source = readFileSync(scriptUrl, 'utf8');

test('Instagram and Google Ads remote collector is plan-only by default', () => {
  const output = execFileSync(process.execPath, [scriptUrl.pathname], { encoding: 'utf8' });
  const plan = JSON.parse(output);
  assert.equal(plan.ok, true);
  assert.equal(plan.planOnly, true);
  assert.deepEqual(plan.channels, ['instagram_organic', 'google_ads']);
  assert.equal(plan.independentDecisions, true);
  assert.deepEqual(plan.windows, [1, 3, 7, 30]);
  assert.equal(plan.providerRequestCount, 0);
  assert.equal(plan.signedDeliveryReplayCount, 0);
  assert.equal(plan.queueActionCount, 0);
  assert.equal(plan.remoteMutationCount, 0);
  assert.equal(plan.workerDeploymentCount, 0);
  assert.equal(plan.catalogPromotionAuthorized, false);
  assert.equal(plan.production, 'BLOCKED');
});

test('independent collector contains no Provider, signed delivery replay, Queue mutation, D1 mutation, Lark write or deployment path', () => {
  assert.doesNotMatch(source, /['"]wrangler['"],\s*['"]deploy['"]/u);
  assert.doesNotMatch(source, /['"]versions['"],\s*['"]upload['"]/u);
  assert.doesNotMatch(source, /\/queues\/.*\/messages/u);
  assert.doesNotMatch(source, /method:\s*['"]POST['"]/u);
  assert.doesNotMatch(source, /executePlan\(/u);
  assert.doesNotMatch(source, /createMany\(|updateMany\(|deleteMany\(/u);
  assert.doesNotMatch(source, /graph\.facebook|googleads\.googleapis|google\.ads\.googleapis/iu);
  assert.match(source, /assertIndependentSelectOnlySql/u);
  assert.match(source, /wrangler['"],\s*['"]d1['"],\s*['"]execute/u);
  assert.match(source, /searchRecords\(/u);
  assert.match(source, /readOptionalEvidence/u);
});
