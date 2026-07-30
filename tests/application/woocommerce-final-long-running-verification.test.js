import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Woo final public entry provides a bounded three-hour verification budget by default', async () => {
  const source = await readFile(
    new URL('../../scripts/woocommerce-final-rollout-operator.mjs', import.meta.url),
    'utf8',
  );

  assert.match(source, /const DEFAULT_VERIFY_MAX_POLLS = '2160'/u);
  assert.match(source, /const DEFAULT_VERIFY_INTERVAL_MS = '5000'/u);
  assert.match(source, /buildVerificationEnvironment\(process\.env\)/u);
  assert.match(source, /MKT_WOOCOMMERCE_FINAL_VERIFY_MAX_POLLS/u);
  assert.match(source, /MKT_WOOCOMMERCE_FINAL_VERIFY_INTERVAL_MS/u);
  assert.match(source, /if \(!optionalText\(output\.MKT_WOOCOMMERCE_FINAL_VERIFY_MAX_POLLS\)\)/u);
  assert.match(source, /if \(!optionalText\(output\.MKT_WOOCOMMERCE_FINAL_VERIFY_INTERVAL_MS\)\)/u);
});

test('Woo final verification budget remains operator-overridable and delegates to immutable core', async () => {
  const source = await readFile(
    new URL('../../scripts/woocommerce-final-rollout-operator.mjs', import.meta.url),
    'utf8',
  );

  const environment = source.indexOf('...buildVerificationEnvironment(process.env)');
  const coreSpawn = source.indexOf('[corePath, ...process.argv.slice(2)]');
  assert.ok(coreSpawn >= 0);
  assert.ok(environment > coreSpawn);
  assert.match(source, /const output = \{ \.\.\.env \}/u);
  assert.match(source, /return output/u);
  assert.doesNotMatch(source, /process\.env\.MKT_WOOCOMMERCE_FINAL_VERIFY_MAX_POLLS\s*=/u);
  assert.doesNotMatch(source, /process\.env\.MKT_WOOCOMMERCE_FINAL_VERIFY_INTERVAL_MS\s*=/u);
});

test('reviewed core keeps terminal failure classification and automatic Safe restore', async () => {
  const core = await readFile(
    new URL('../../scripts/woocommerce-final-rollout-operator-core.mjs', import.meta.url),
    'utf8',
  );

  assert.match(core, /classification\.terminalFailure/u);
  assert.match(core, /WOOCOMMERCE_FINAL_OPERATION_TERMINAL_FAILURE/u);
  assert.match(core, /automatic-safe-restore/u);
  assert.match(core, /MKT_WOOCOMMERCE_FINAL_VERIFY_MAX_POLLS/u);
  assert.match(core, /MKT_WOOCOMMERCE_FINAL_VERIFY_INTERVAL_MS/u);
});
