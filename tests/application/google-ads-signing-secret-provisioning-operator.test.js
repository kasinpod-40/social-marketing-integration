import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GOOGLE_ADS_SIGNING_PROVISIONING_OPERATOR_SCOPE,
  createGoogleAdsSigningProvisioningTicketRecord,
} from '../../packages/application/src/google-ads/manager-script-signing-secret-provisioning-operator.js';
import {
  GOOGLE_ADS_SIGNING_PROVISIONING_LIMITS,
} from '../../packages/config/src/google-ads-signing-secret-provisioning-contract.js';

const NOW = 1_784_900_000_000;
const RUNTIME_IDENTITY = Object.freeze({
  environment: 'development',
  profileKey: 'integration_workspace',
  managerCustomerId: '1111111111',
  customerId: '2222222222',
  customerKey: 'chemistry_k',
  accountKey: 'chemistry_k',
  keyId: 'google-ads-v1',
});

test('operator refuses Ticket creation without exact explicit approval', async () => {
  await assert.rejects(
    createGoogleAdsSigningProvisioningTicketRecord({
      runtimeIdentity: RUNTIME_IDENTITY,
      store: { createTicket() { throw new Error('must not be called'); } },
      now: NOW,
    }),
    (error) => error?.code === 'GOOGLE_ADS_PROVISIONING_OPERATOR_APPROVAL_REQUIRED',
  );
});

test('operator returns plaintext once and persists fingerprint-only exact binding', async () => {
  let persisted = null;
  const result = await createGoogleAdsSigningProvisioningTicketRecord({
    approval: {
      approved: true,
      scope: GOOGLE_ADS_SIGNING_PROVISIONING_OPERATOR_SCOPE,
    },
    runtimeIdentity: RUNTIME_IDENTITY,
    now: NOW,
    store: {
      async createTicket(input) {
        persisted = structuredClone(input);
        return Object.freeze({
          ...input,
          status: 'active',
          redeemedAt: null,
          confirmedAt: null,
          challengeFingerprint: null,
        });
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'active');
  assert.match(result.ticket, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(result.keyId, RUNTIME_IDENTITY.keyId);
  assert.equal(result.expiresAt, NOW + GOOGLE_ADS_SIGNING_PROVISIONING_LIMITS.ticketTtlMs);

  assert.match(persisted.ticketFingerprint, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(persisted.identityFingerprint, /^[a-f0-9]{64}$/u);
  assert.notEqual(persisted.ticketFingerprint, result.ticket);
  assert.equal(persisted.createdAt, NOW);
  assert.equal(persisted.expiresAt, result.expiresAt);
  assert.equal(persisted.keyId, RUNTIME_IDENTITY.keyId);
  for (const forbidden of [
    'ticket',
    'managerCustomerId',
    'customerId',
    'customerKey',
    'accountKey',
    'profileKey',
    'environment',
  ]) assert.equal(forbidden in persisted, false, forbidden);
});

test('operator does not return plaintext when fingerprint persistence fails', async () => {
  await assert.rejects(
    createGoogleAdsSigningProvisioningTicketRecord({
      approval: {
        approved: true,
        scope: GOOGLE_ADS_SIGNING_PROVISIONING_OPERATOR_SCOPE,
      },
      runtimeIdentity: RUNTIME_IDENTITY,
      now: NOW,
      store: {
        async createTicket() {
          throw new Error('D1 unavailable');
        },
      },
    }),
    /D1 unavailable/u,
  );
});
