import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const SCRIPT = 'scripts/lark-notification-controlled-uat-exact-terminal.mjs';

test('exact terminal is plan-only by default', () => {
  const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.executed, false);
  assert.equal(output.failSafe, 'always_read_back_and_restore_exact_source_report_settings_false');
  assert.equal(output.replayWaitMs, 30000);
  assert.equal(output.automationActivationCount, 0);
  assert.equal(output.scheduleActivationCount, 0);
  assert.equal(output.production, 'BLOCKED');
});

test('exact terminal owns one child execution and unconditional Settings restore', () => {
  const source = readFileSync(SCRIPT, 'utf8');
  assert.match(source, /lark-notification-controlled-uat\.mjs/u);
  assert.match(source, /finally|restoreExactSourceSettings/u);
  assert.match(source, /ai_enabled:\s*false/u);
  assert.match(source, /notification_enabled:\s*false/u);
  assert.match(source, /MKT_LARK_NOTIFICATION_UAT_REPLAY_WAIT_MS/u);
  assert.doesNotMatch(source, /automation.*activate/iu);
  assert.doesNotMatch(source, /schedule.*activate/iu);
  assert.doesNotMatch(source, /webhook/iu);
});

test('exact terminal rejects unknown execution arguments before Remote work', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--apply'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  const output = JSON.parse(result.stderr);
  assert.equal(output.code, 'LARK_NOTIFICATION_CONTROLLED_UAT_ARGUMENT_INVALID');
  assert.equal(output.childStarted, false);
  assert.equal(output.reportSettingsRestored, false);
});
