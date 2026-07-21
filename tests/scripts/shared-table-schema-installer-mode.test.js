import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSharedTableSchemaInstallerMode } from '../../scripts/lib/shared-table-schema-installer-mode.js';

test('keeps Shared-table Preview read-only even with ambient confirmations', () => {
  const mode = resolveSharedTableSchemaInstallerMode({
    argv: [],
    env: { CONFIRM_WRITE: 'YES', CONFIRM_SHARED_TABLE_SCHEMA: 'YES' },
  });
  assert.equal(mode.apply, false);
  assert.equal(mode.ignoredAmbientConfirmation, true);
  assert.equal(mode.ignoredAmbientSchemaConfirmation, true);
});

test('requires both generic and exact Shared-table confirmations', () => {
  assert.throws(
    () => resolveSharedTableSchemaInstallerMode({ argv: ['--apply'], env: {} }),
    (error) => error.code === 'SHARED_TABLE_SCHEMA_WRITE_CONFIRMATION_REQUIRED',
  );
  assert.throws(
    () => resolveSharedTableSchemaInstallerMode({
      argv: ['--apply'], env: { CONFIRM_WRITE: 'YES' },
    }),
    (error) => error.code === 'SHARED_TABLE_SCHEMA_EXACT_CONFIRMATION_REQUIRED',
  );
  const mode = resolveSharedTableSchemaInstallerMode({
    argv: ['--apply'],
    env: { CONFIRM_WRITE: 'YES', CONFIRM_SHARED_TABLE_SCHEMA: 'YES' },
  });
  assert.equal(mode.apply, true);
});
