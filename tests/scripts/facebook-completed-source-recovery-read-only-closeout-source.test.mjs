import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../../scripts/facebook-completed-source-recovery-operator.mjs', import.meta.url),
  'utf8',
);

function functionSource(name, nextName) {
  const start = source.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = source.indexOf(`\n${nextName}`, start);
  assert.notEqual(end, -1, `${name} must be followed by ${nextName}`);
  return source.slice(start, end);
}

test('post-admission --recover closeout performs read-only remote verification only', () => {
  assert.match(source, /args\.includes\('--recover'\)/u);
  const closeout = functionSource('closeoutRecoveredIncident', 'function repositorySummary');
  assert.match(closeout, /readCompletionSnapshot\(runtime\)/u);
  assert.match(closeout, /readExactDeadLetter\(runtime\)/u);
  assert.match(closeout, /READ_ONLY_CLOSEOUT/u);
  assert.doesNotMatch(closeout, /pushRedriveCommand/u);
  assert.doesNotMatch(closeout, /runCommand/u);
  assert.doesNotMatch(closeout, /wrangler.*deploy/u);
  assert.doesNotMatch(closeout, /runtime\.api/u);
  assert.doesNotMatch(closeout, /writeFile/u);
  assert.doesNotMatch(closeout, /queueMessagesByOperator/u);
});

test('completion readback uses durable completion and exact business coverage after staging cleanup', () => {
  const readback = functionSource('readCompletionSnapshot', 'async function pollForCompletion');
  assert.match(readback, /completion_json/u);
  assert.match(readback, /data_coverage_runs/u);
  assert.match(readback, /organic_account_daily_facts/u);
  assert.match(readback, /dead_letter_status/u);
  assert.match(readback, /target_day_account_daily_rows/u);
});
