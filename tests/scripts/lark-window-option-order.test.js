import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIRMATION,
  TARGET_FIELD,
  assertConfirmation,
  planWindowOptionOrder,
} from '../../scripts/lib/lark-window-option-order-v1.js';

function fieldWith(options) {
  return {
    ...TARGET_FIELD,
    property: {
      options: options.map((option) => ({ ...option, color: 0 })),
    },
  };
}

const reviewed = [
  { id: 'optGqbHePA', name: '3' },
  { id: 'optaGcj0mG', name: '7' },
  { id: 'opt38OJLF0', name: '1' },
  { id: 'optmG5Z7M0', name: '30' },
];

test('plans one metadata-only reorder while preserving all option IDs', () => {
  const plan = planWindowOptionOrder(fieldWith(reviewed));
  assert.deepEqual(plan.currentOrder, ['3', '7', '1', '30']);
  assert.deepEqual(plan.desiredOrder, ['1', '3', '7', '30']);
  assert.deepEqual(plan.desiredOptionIds, [
    'opt38OJLF0',
    'optGqbHePA',
    'optaGcj0mG',
    'optmG5Z7M0',
  ]);
  assert.equal(plan.optionIdentityPreserved, true);
  assert.equal(plan.pendingFieldMetadataUpdateCount, 1);
  assert.equal(plan.alreadyConverged, false);
  assert.deepEqual(
    plan.desiredField.property.options.map(({ id, name }) => ({ id, name })),
    [
      { id: 'opt38OJLF0', name: '1' },
      { id: 'optGqbHePA', name: '3' },
      { id: 'optaGcj0mG', name: '7' },
      { id: 'optmG5Z7M0', name: '30' },
    ],
  );
});

test('recognizes converged order without another mutation', () => {
  const plan = planWindowOptionOrder(fieldWith([
    reviewed[2], reviewed[0], reviewed[1], reviewed[3],
  ]));
  assert.equal(plan.alreadyConverged, true);
  assert.equal(plan.pendingFieldMetadataUpdateCount, 0);
});

test('fails closed when an option ID/name mapping changes', () => {
  assert.throws(
    () => planWindowOptionOrder(fieldWith([
      { id: 'different', name: '3' }, reviewed[1], reviewed[2], reviewed[3],
    ])),
    { code: 'LARK_WINDOW_OPTION_SET_DRIFT' },
  );
});

test('requires exact execution confirmation', () => {
  assert.throws(() => assertConfirmation('wrong'), {
    code: 'LARK_WINDOW_OPTION_ORDER_CONFIRMATION_REQUIRED',
  });
  assert.doesNotThrow(() => assertConfirmation(CONFIRMATION));
});
