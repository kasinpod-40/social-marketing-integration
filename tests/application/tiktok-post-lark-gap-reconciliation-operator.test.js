import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const scriptPath = 'scripts/tiktok-post-lark-gap-reconciliation.mjs';

test('TikTok gap reconciliation operator is plan-only by default', () => {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
  });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.executed, false);
  assert.equal(output.safety.planOnlyByDefault, true);
  assert.equal(output.safety.migrations, false);
  assert.equal(output.safety.scheduleActivation, false);
  assert.equal(output.safety.destructiveRepair, false);
  assert.equal(output.safety.emergencySafeClose, true);
  assert.deepEqual(output.sequence, [
    'deploy-and-attest-safe-404',
    'deploy-reconciliation-audit-gates-with-schedules-false',
    'read-only-audit-and-classify-exact-gaps',
    'send-one-manual-watermark-probe-only-for-additive-gaps',
    'wait-for-completed-admission',
    'verify-zero-gap-parity',
    'resend-exact-probe-and-prove-admission-idempotency',
    'deploy-and-attest-final-safe-404',
  ]);
});
