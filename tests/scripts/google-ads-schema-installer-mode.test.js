import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGoogleAdsSchemaInstallerMode } from '../../scripts/lib/google-ads-schema-installer-mode.js';

test('keeps Google Ads Preview read-only with ambient confirmations', () => {
  const mode = resolveGoogleAdsSchemaInstallerMode({
    argv: [],
    env: { CONFIRM_WRITE: 'YES', CONFIRM_GOOGLE_ADS_SCHEMA: 'YES' },
  });
  assert.equal(mode.apply, false);
  assert.equal(mode.ignoredAmbientConfirmation, true);
  assert.equal(mode.ignoredAmbientSchemaConfirmation, true);
});

test('requires generic and exact Google Ads confirmations together', () => {
  assert.throws(
    () => resolveGoogleAdsSchemaInstallerMode({ argv: ['--apply'], env: {} }),
    (error) => error.code === 'GOOGLE_ADS_SCHEMA_WRITE_CONFIRMATION_REQUIRED',
  );
  assert.throws(
    () => resolveGoogleAdsSchemaInstallerMode({
      argv: ['--apply'],
      env: { CONFIRM_WRITE: 'YES' },
    }),
    (error) => error.code === 'GOOGLE_ADS_SCHEMA_EXACT_CONFIRMATION_REQUIRED',
  );
  const mode = resolveGoogleAdsSchemaInstallerMode({
    argv: ['--apply'],
    env: { CONFIRM_WRITE: 'YES', CONFIRM_GOOGLE_ADS_SCHEMA: 'YES' },
  });
  assert.equal(mode.apply, true);
});
