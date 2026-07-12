import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveReportSchemaInstallerMode } from '../../scripts/lib/report-schema-installer-mode.js';

test('plain preview stays read-only even when CONFIRM_WRITE is exported in the shell', () => {
  const mode = resolveReportSchemaInstallerMode({ argv: [], env: { CONFIRM_WRITE: 'YES' } });
  assert.equal(mode.apply, false);
  assert.equal(mode.ignoredAmbientConfirmation, true);
});

test('apply requires both explicit --apply and CONFIRM_WRITE=YES', () => {
  assert.throws(
    () => resolveReportSchemaInstallerMode({ argv: ['--apply'], env: {} }),
    (error) => error.code === 'REPORT_SCHEMA_WRITE_CONFIRMATION_REQUIRED',
  );
  const mode = resolveReportSchemaInstallerMode({
    argv: ['--apply'], env: { CONFIRM_WRITE: 'YES' },
  });
  assert.equal(mode.apply, true);
});
