import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertGoogleAdsSigningProvisioningRequestHead,
  createGoogleAdsSigningProvisioningChallenge,
  createGoogleAdsSigningProvisioningClientNonce,
  createGoogleAdsSigningProvisioningIdentityFingerprint,
  createGoogleAdsSigningProvisioningTicket,
  hashGoogleAdsSigningProvisioningCapability,
  parseGoogleAdsSigningProvisioningBody,
  signGoogleAdsSigningProvisioningConfirmation,
  verifyGoogleAdsSigningProvisioningConfirmation,
} from '../../packages/application/src/google-ads/manager-script-signing-secret-provisioning-security.js';
import {
  GOOGLE_ADS_SIGNING_PROVISIONING_CONFIRM_PATH,
  GOOGLE_ADS_SIGNING_PROVISIONING_SCHEMA_VERSION,
} from '../../packages/config/src/google-ads-signing-secret-provisioning-contract.js';
import { stableSerialize } from '../../packages/shared/src/hash/stable-fingerprint.js';

const secret = 'fixture-signing-secret-that-is-longer-than-32-bytes';
const runtimeIdentity = Object.freeze({
  environment: 'development',
  profileKey: 'integration_workspace',
  managerCustomerId: '1111111111',
  customerId: '2222222222',
  customerKey: 'chemistry_k',
  accountKey: 'chemistry_k',
  keyId: 'fixture-key-v1',
});

test('provisioning security generates bounded capabilities and stable identity fingerprints', async () => {
  const ticket = await createGoogleAdsSigningProvisioningTicket();
  const challenge = await createGoogleAdsSigningProvisioningChallenge();
  const clientNonce = createGoogleAdsSigningProvisioningClientNonce();
  assert.match(ticket.ticket, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(ticket.ticketFingerprint, await hashGoogleAdsSigningProvisioningCapability(ticket.ticket));
  assert.match(challenge.challenge, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(challenge.challengeFingerprint, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(clientNonce, /^[A-Za-z0-9_-]{22}$/u);
  assert.match(
    await createGoogleAdsSigningProvisioningIdentityFingerprint(runtimeIdentity),
    /^[a-f0-9]{64}$/u,
  );
});

test('provisioning security accepts canonical confirmation and rejects tampered proof', async () => {
  const challenge = 'b'.repeat(43);
  const clientNonce = 'a'.repeat(22);
  const proof = await signGoogleAdsSigningProvisioningConfirmation({
    keyId: 'fixture-key-v1', clientNonce, challenge, signingSecret: secret,
  });
  assert.equal(await verifyGoogleAdsSigningProvisioningConfirmation({
    proof, keyId: 'fixture-key-v1', clientNonce, challenge, signingSecret: secret,
  }), true);
  await assert.rejects(
    verifyGoogleAdsSigningProvisioningConfirmation({
      proof, keyId: 'fixture-key-v1', clientNonce, challenge: 'c'.repeat(43), signingSecret: secret,
    }),
    (error) => error?.code === 'GOOGLE_ADS_PROVISIONING_PROOF_INVALID',
  );
});

test('provisioning request boundary requires exact HTTPS target, headers and canonical JSON', () => {
  const ticket = 't'.repeat(43);
  const proof = `sha256=${'a'.repeat(64)}`;
  assert.deepEqual(assertGoogleAdsSigningProvisioningRequestHead({
    method: 'POST',
    url: `https://api.example.test${GOOGLE_ADS_SIGNING_PROVISIONING_CONFIRM_PATH}`,
    confirmation: true,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${ticket}`,
      'x-mkt-provisioning-proof': proof,
    },
  }), { ticket, proof });
  const body = {
    schemaVersion: GOOGLE_ADS_SIGNING_PROVISIONING_SCHEMA_VERSION,
    managerCustomerId: '1111111111', customerId: '2222222222',
    customerKey: 'chemistry_k', accountKey: 'chemistry_k', keyId: 'fixture-key-v1',
    clientNonce: 'a'.repeat(22), challenge: 'b'.repeat(43),
  };
  assert.deepEqual(parseGoogleAdsSigningProvisioningBody({
    body: stableSerialize(body), confirmation: true, runtimeIdentity,
  }), body);
  assert.throws(
    () => parseGoogleAdsSigningProvisioningBody({
      body: JSON.stringify(body), confirmation: true, runtimeIdentity,
    }),
    (error) => error?.code === 'GOOGLE_ADS_PROVISIONING_BODY_INVALID',
  );
  assert.throws(
    () => assertGoogleAdsSigningProvisioningRequestHead({
      method: 'POST',
      url: `http://api.example.test${GOOGLE_ADS_SIGNING_PROVISIONING_CONFIRM_PATH}`,
      confirmation: true,
      headers: {
        'content-type': 'application/json', authorization: `Bearer ${ticket}`,
        'x-mkt-provisioning-proof': proof,
      },
    }),
    (error) => error?.code === 'GOOGLE_ADS_PROVISIONING_REQUEST_INVALID',
  );
});
