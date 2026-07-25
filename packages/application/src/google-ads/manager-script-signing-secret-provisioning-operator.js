import {
  GOOGLE_ADS_SIGNING_PROVISIONING_LIMITS,
  normalizeGoogleAdsSigningProvisioningRuntimeIdentity,
} from '../../../config/src/google-ads-signing-secret-provisioning-contract.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';
import {
  createGoogleAdsSigningProvisioningIdentityFingerprint,
  createGoogleAdsSigningProvisioningTicket,
} from './manager-script-signing-secret-provisioning-security.js';

export const GOOGLE_ADS_SIGNING_PROVISIONING_OPERATOR_SCOPE = 'create_one_ticket';

/**
 * Guarded local/operator boundary for creating exactly one five-minute Ticket.
 * It returns plaintext once to the approved caller and persists fingerprints only.
 * This module performs no HTTP, Queue, Lark, schedule or Google Ads operation.
 */
export async function createGoogleAdsSigningProvisioningTicketRecord(input = {}) {
  requireExplicitApproval(input.approval);
  const store = requireStore(input.store);
  const cryptoImpl = input.cryptoImpl ?? globalThis.crypto;
  const createdAt = timestamp(input.now ?? Date.now(), 'now');
  const runtimeIdentity = normalizeGoogleAdsSigningProvisioningRuntimeIdentity(
    input.runtimeIdentity,
  );
  const expiresAt = createdAt + GOOGLE_ADS_SIGNING_PROVISIONING_LIMITS.ticketTtlMs;

  const [{ ticket, ticketFingerprint }, identityFingerprint] = await Promise.all([
    createGoogleAdsSigningProvisioningTicket(cryptoImpl),
    createGoogleAdsSigningProvisioningIdentityFingerprint(runtimeIdentity, cryptoImpl),
  ]);

  const stored = await store.createTicket({
    ticketFingerprint,
    identityFingerprint,
    keyId: runtimeIdentity.keyId,
    createdAt,
    expiresAt,
  });
  assertStoredTicket(stored, {
    ticketFingerprint,
    identityFingerprint,
    keyId: runtimeIdentity.keyId,
    createdAt,
    expiresAt,
  });

  return Object.freeze({
    ok: true,
    status: 'active',
    ticket,
    keyId: runtimeIdentity.keyId,
    expiresAt,
  });
}

function requireExplicitApproval(value) {
  if (
    !value
    || value.approved !== true
    || value.scope !== GOOGLE_ADS_SIGNING_PROVISIONING_OPERATOR_SCOPE
  ) {
    throw permanentError('Google Ads provisioning Ticket creation requires explicit approval', {
      code: 'GOOGLE_ADS_PROVISIONING_OPERATOR_APPROVAL_REQUIRED',
    });
  }
}

function requireStore(value) {
  if (typeof value?.createTicket !== 'function') {
    throw permanentError('Google Ads provisioning Ticket store is unavailable', {
      code: 'GOOGLE_ADS_PROVISIONING_OPERATOR_STORE_UNAVAILABLE',
    });
  }
  return value;
}

function assertStoredTicket(actual, expected) {
  if (
    !actual
    || actual.status !== 'active'
    || actual.ticketFingerprint !== expected.ticketFingerprint
    || actual.identityFingerprint !== expected.identityFingerprint
    || actual.keyId !== expected.keyId
    || actual.createdAt !== expected.createdAt
    || actual.expiresAt !== expected.expiresAt
    || actual.redeemedAt !== null
    || actual.confirmedAt !== null
    || actual.challengeFingerprint !== null
  ) {
    throw permanentError('Google Ads provisioning Ticket persistence could not be verified', {
      code: 'GOOGLE_ADS_PROVISIONING_OPERATOR_PERSISTENCE_INVALID',
    });
  }
}

function timestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw permanentError(`${fieldName} is invalid`, {
      code: 'GOOGLE_ADS_PROVISIONING_OPERATOR_INPUT_INVALID',
    });
  }
  return number;
}
