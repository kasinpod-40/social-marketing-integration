import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLargeAccountReadiness,
  LARGE_ACCOUNT_REQUIRED_GATES,
  LARGE_ACCOUNT_STATUS,
} from '../../packages/config/src/large-account-readiness.js';

test('verified large-account contract requires every activation gate', () => {
  const gates = Object.fromEntries(LARGE_ACCOUNT_REQUIRED_GATES.map((gate) => [gate, true]));
  const contract = createLargeAccountReadiness({
    status: LARGE_ACCOUNT_STATUS.VERIFIED,
    primaryEntity: 'posts',
    minimumFixtureItems: 2000,
    gates,
  });
  assert.equal(contract.productionReady, true);
  assert.deepEqual(contract.missingGates, []);
  assert.equal(Object.isFrozen(contract.gates), true);
});

test('dev-ready contract allows only live account UAT to remain pending', () => {
  const gates = Object.fromEntries(LARGE_ACCOUNT_REQUIRED_GATES.map((gate) => [gate, true]));
  gates.liveAccountUat = false;
  const contract = createLargeAccountReadiness({
    status: LARGE_ACCOUNT_STATUS.DEV_READY,
    primaryEntity: 'videos',
    minimumFixtureItems: 1000,
    gates,
  });
  assert.equal(contract.productionReady, false);
  assert.deepEqual(contract.missingGates, ['liveAccountUat']);
});

test('invalid verified/dev-ready declarations fail closed', () => {
  assert.throws(
    () => createLargeAccountReadiness({
      status: LARGE_ACCOUNT_STATUS.VERIFIED,
      primaryEntity: 'posts',
      minimumFixtureItems: 1000,
      gates: {},
    }),
    (error) => error?.code === 'MKT_LARGE_ACCOUNT_CONTRACT_INVALID',
  );
  assert.throws(
    () => createLargeAccountReadiness({
      status: LARGE_ACCOUNT_STATUS.DEV_READY,
      primaryEntity: 'posts',
      minimumFixtureItems: 1000,
      gates: { liveAccountUat: false },
    }),
    (error) => error?.code === 'MKT_LARGE_ACCOUNT_CONTRACT_INVALID',
  );
});
