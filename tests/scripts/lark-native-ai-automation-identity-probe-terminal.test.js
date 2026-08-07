import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SCRIPT = resolve('scripts/lark-native-ai-automation-identity-probe-terminal.mjs');

test('plan exposes one exact read-only Terminal command and zero mutation', () => {
  const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.planOnly, true);
  assert.equal(output.contractVersion, 'lark_native_ai_automation_identity_probe_v1');
  assert.match(output.exactCommand, /lark-native-ai-automation-identity-probe-terminal\.mjs --execute/u);
  assert.deepEqual(output.readBoundary, [
    'tenant_access_token',
    'bitable_v1_list_automations',
    'base_v3_get_exact_workflow',
  ]);
  assert.equal(output.automationCreateCount, 0);
  assert.equal(output.automationUpdateCount, 0);
  assert.equal(output.automationStatusChangeCount, 0);
  assert.equal(output.recordWriteCount, 0);
  assert.equal(output.nativeAiCallCount, 0);
  assert.equal(output.notificationCount, 0);
  assert.equal(output.scheduleEnabled, false);
  assert.equal(output.production, 'BLOCKED');
});

test('rejects unsupported arguments instead of introducing an alternate execute mode', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--apply'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  const output = JSON.parse(result.stderr);
  assert.equal(output.code, 'LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_ARGUMENT_UNSUPPORTED');
  assert.equal(output.automationUpdateCount, 0);
  assert.equal(output.notificationCount, 0);
});

test('source allows only legacy List automations plus exact v3 GET and contains no workflow mutation', () => {
  const source = readFileSync(SCRIPT, 'utf8');
  assert.match(
    source,
    /\/open-apis\/bitable\/v1\/apps\/\$\{encodeURIComponent\(rawClient\.appToken\)\}\/workflows/u,
  );
  assert.match(
    source,
    /\/open-apis\/base\/v3\/bases\/\$\{encodeURIComponent\(rawClient\.appToken\)\}\/workflows\/\$\{encodeURIComponent\(id\)\}/u,
  );
  assert.doesNotMatch(source, /workflows\/list/u);
  assert.doesNotMatch(source, /workflows\/[^`'"\s]+\/(?:enable|disable)/u);
  assert.doesNotMatch(source, /method:\s*['"](?:PUT|PATCH|DELETE)['"]/u);
  assert.doesNotMatch(source, /\/open-apis\/im\/v1\/messages/u);
  assert.doesNotMatch(source, /records\/batch_(?:create|update|delete)/u);
  assert.doesNotMatch(source, /wrangler\s+deploy/u);
});
