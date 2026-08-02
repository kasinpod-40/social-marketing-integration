import assert from 'node:assert/strict';
import test from 'node:test';
import {
  META_K2_EXACT_RECOVERY_PATH,
} from '../../packages/config/src/meta-k2-exact-recovery-contract.js';
import {
  resolveMetaK2ExactRecoveryUrl,
} from '../../scripts/lib/meta-k2-partial-staging-reviewed-launcher.js';

test('derives the exact recovery URL from the existing HTTPS public origin', () => {
  assert.equal(
    resolveMetaK2ExactRecoveryUrl({
      publicOrigin: 'https://worker.example.test',
    }),
    `https://worker.example.test${META_K2_EXACT_RECOVERY_PATH}`,
  );
  assert.equal(
    resolveMetaK2ExactRecoveryUrl({
      publicOrigin: 'https://worker.example.test/',
    }),
    `https://worker.example.test${META_K2_EXACT_RECOVERY_PATH}`,
  );
});

test('accepts an exact explicit recovery URL and gives it precedence over public origin', () => {
  const explicitUrl = `https://reviewed-worker.example.test${META_K2_EXACT_RECOVERY_PATH}`;
  assert.equal(
    resolveMetaK2ExactRecoveryUrl({
      explicitUrl,
      publicOrigin: 'https://ignored.example.test',
    }),
    explicitUrl,
  );
});

test('rejects missing, non-HTTPS or non-origin public origin values', () => {
  for (const publicOrigin of [
    undefined,
    '',
    'http://worker.example.test',
    'https://worker.example.test/base',
    'https://worker.example.test/?query=1',
    'https://worker.example.test/#fragment',
  ]) {
    assert.throws(
      () => resolveMetaK2ExactRecoveryUrl({ publicOrigin }),
      (error) => [
        'META_K2_REVIEWED_LAUNCHER_INPUT_INVALID',
        'META_K2_REVIEWED_LAUNCHER_PUBLIC_ORIGIN_INVALID',
      ].includes(error.code),
      String(publicOrigin),
    );
  }
});

test('rejects explicit URL protocol, path, query and fragment drift', () => {
  for (const explicitUrl of [
    `http://worker.example.test${META_K2_EXACT_RECOVERY_PATH}`,
    'https://worker.example.test/operator/meta/other-recovery',
    `https://worker.example.test${META_K2_EXACT_RECOVERY_PATH}?mode=d1`,
    `https://worker.example.test${META_K2_EXACT_RECOVERY_PATH}#fragment`,
  ]) {
    assert.throws(
      () => resolveMetaK2ExactRecoveryUrl({ explicitUrl }),
      (error) => error.code === 'META_K2_REVIEWED_LAUNCHER_RECOVERY_URL_INVALID',
      explicitUrl,
    );
  }
});
