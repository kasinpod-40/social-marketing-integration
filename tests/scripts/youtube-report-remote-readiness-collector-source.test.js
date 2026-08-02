import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const scriptUrl = new URL('../../scripts/youtube-report-remote-readiness-collector.mjs', import.meta.url);
const source = readFileSync(scriptUrl, 'utf8');

test('YouTube remote readiness collector is plan-only by default', () => {
  const output = execFileSync(process.execPath, [scriptUrl.pathname], { encoding: 'utf8' });
  const plan = JSON.parse(output);
  assert.equal(plan.ok, true);
  assert.equal(plan.planOnly, true);
  assert.deepEqual(plan.windows, [1, 3, 7, 30]);
  assert.equal(plan.providerRequestCount, 0);
  assert.equal(plan.queueActionCount, 0);
  assert.equal(plan.remoteMutationCount, 0);
  assert.equal(plan.workerDeploymentCount, 0);
  assert.equal(plan.liveMaterializationAuthorized, false);
  assert.equal(plan.production, 'BLOCKED');
});

test('YouTube collector contains no Provider, Queue mutation, D1 mutation, Lark write or deployment path', () => {
  assert.doesNotMatch(source, /['"]wrangler['"],\s*['"]deploy['"]/u);
  assert.doesNotMatch(source, /['"]versions['"],\s*['"]upload['"]/u);
  assert.doesNotMatch(source, /\/queues\/.*\/messages/u);
  assert.doesNotMatch(source, /method:\s*['"]POST['"]/u);
  assert.doesNotMatch(source, /executePlan\(/u);
  assert.doesNotMatch(source, /createMany\(|updateMany\(|deleteMany\(/u);
  assert.doesNotMatch(source, /graph\.facebook|googleads|youtube\.googleapis/iu);
  assert.match(source, /assertSelectOnlySql/u);
  assert.match(source, /wrangler['"],\s*['"]d1['"],\s*['"]execute/u);
  assert.match(source, /listTables\(\)/u);
  assert.match(source, /listFields\(/u);
  assert.match(source, /searchRecords\(/u);
});
