import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GOOGLE_ADS_SIGNING_PROVISIONING_SCHEMA_VERSION,
  createGoogleAdsSigningProvisioningConfirmationInput,
  normalizeGoogleAdsSigningProvisioningRuntimeIdentity,
  validateGoogleAdsSigningProvisioningConfirm,
  validateGoogleAdsSigningProvisioningRedeem,
} from '../../packages/config/src/google-ads-signing-secret-provisioning-contract.js';

const runtimeIdentity = Object.freeze({
  environment: 'development',
  profileKey: 'integration_workspace',
  managerCustomerId: '1111111111',
  customerId: '2222222222',
  customerKey: 'chemistry_k',
  accountKey: 'chemistry_k',
  keyId: 'fixture-key-v1',
});

function redeem(overrides = {}) {
  return {
    schemaVersion: GOOGLE_ADS_SIGNING_PROVISIONING_SCHEMA_VERSION,
    managerCustomerId: '1111111111',
    customerId: '2222222222',
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    keyId: 'fixture-key-v1',
    clientNonce: 'a'.repeat(22),
    ...overrides,
  };
}

test('provisioning contract normalizes exact runtime identity and redeem/confirm bodies', () => {
  assert.deepEqual(
    normalizeGoogleAdsSigningProvisioningRuntimeIdentity(runtimeIdentity),
    runtimeIdentity,
  );
  assert.deepEqual(validateGoogleAdsSigningProvisioningRedeem(redeem(), runtimeIdentity), redeem());
  assert.deepEqual(
    validateGoogleAdsSigningProvisioningConfirm(
      { ...redeem(), challenge: 'b'.repeat(43) },
      runtimeIdentity,
    ),
    { ...redeem(), challenge: 'b'.repeat(43) },
  );
  assert.equal(
    createGoogleAdsSigningProvisioningConfirmationInput({
      keyId: 'fixture-key-v1',
      clientNonce: 'a'.repeat(22),
      challenge: 'b'.repeat(43),
    }),
    `MKT-GOOGLE-ADS-PROVISIONING-CONFIRM-V1\nfixture-key-v1\n${'a'.repeat(22)}\n${'b'.repeat(43)}`,
  );
});

test('provisioning contract rejects extra fields and every runtime identity mismatch', () => {
  assert.throws(
    () => validateGoogleAdsSigningProvisioningRedeem({ ...redeem(), signingSecret: 'forbidden' }, runtimeIdentity),
    (error) => error?.code === 'GOOGLE_ADS_PROVISIONING_CONTRACT_INVALID',
  );
  for (const [fieldName, value] of [
    ['managerCustomerId', '3333333333'],
    ['customerId', '3333333333'],
    ['customerKey', 'other'],
    ['accountKey', 'other'],
    ['keyId', 'other-key'],
  ]) {
    assert.throws(
      () => validateGoogleAdsSigningProvisioningRedeem(redeem({ [fieldName]: value }), runtimeIdentity),
      (error) => error?.code === 'GOOGLE_ADS_PROVISIONING_CONTRACT_INVALID',
      fieldName,
    );
  }
});
