import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfirmedApplyMode } from '../../scripts/lib/confirmed-apply-mode.js';

test('generic apply guard keeps preview read-only with ambient confirmation', () => {
  const mode = resolveConfirmedApplyMode({ argv: [], env: { CONFIRM_WRITE: 'YES' } });
  assert.equal(mode.apply, false);
  assert.equal(mode.ignoredAmbientConfirmation, true);
});

test('generic apply guard requires explicit flag and confirmation', () => {
  assert.throws(
    () => resolveConfirmedApplyMode({
      argv: ['--apply'], env: {}, operationName: 'Views',
      confirmationErrorCode: 'VIEW_CONFIRMATION_REQUIRED', applyCommand: 'CONFIRM_WRITE=YES views --apply',
    }),
    (error) => error.code === 'VIEW_CONFIRMATION_REQUIRED'
      && error.details.command === 'CONFIRM_WRITE=YES views --apply',
  );
});
