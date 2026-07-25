import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  D1GoogleAdsSigningSecretProvisioningStore,
} from '../../packages/connectors/src/google-ads/d1-google-ads-signing-secret-provisioning-store.js';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

const MIGRATION_URL = new URL(
  '../../migrations/0014_google_ads_signing_secret_provisioning.sql',
  import.meta.url,
);
const NOW = 1_784_977_200_000;
const ticket = Object.freeze({
  ticketFingerprint: 't'.repeat(43),
  identityFingerprint: 'a'.repeat(64),
  keyId: 'fixture-key-v1',
  challengeFingerprint: 'c'.repeat(43),
});

async function fixture() {
  const d1 = createSqliteD1();
  d1.exec(await readFile(MIGRATION_URL, 'utf8'));
  const store = new D1GoogleAdsSigningSecretProvisioningStore({ db: d1, now: () => NOW });
  await store.createTicket({
    ticketFingerprint: ticket.ticketFingerprint,
    identityFingerprint: ticket.identityFingerprint,
    keyId: ticket.keyId,
    createdAt: NOW,
    expiresAt: NOW + 300_000,
  });
  return { d1, store };
}

test('ticket store persists only fingerprints and atomically redeems once', async () => {
  const { d1, store } = await fixture();
  try {
    const results = await Promise.allSettled([
      store.redeemTicket({ ...ticket, now: NOW + 1 }),
      store.redeemTicket({ ...ticket, now: NOW + 1 }),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    const rejected = results.find((result) => result.status === 'rejected');
    assert.equal(rejected.reason.code, 'GOOGLE_ADS_PROVISIONING_TICKET_UNUSABLE');
    const row = d1.database.prepare(`
      SELECT status, challenge_fingerprint, redeemed_at
      FROM google_ads_signing_provisioning_tickets
    `).get();
    assert.deepEqual(row, {
      status: 'redeemed',
      challenge_fingerprint: ticket.challengeFingerprint,
      redeemed_at: NOW + 1,
    });
  } finally {
    d1.close();
  }
});

test('ticket store confirms exact binding, permits bounded exact retry and rejects expiry', async () => {
  const { d1, store } = await fixture();
  try {
    await store.redeemTicket({ ...ticket, now: NOW + 1 });
    assert.equal((await store.confirmTicket({ ...ticket, now: NOW + 2 })).disposition, 'confirmed');
    assert.equal((await store.confirmTicket({ ...ticket, now: NOW + 3 })).disposition, 'exact_retry');
    await assert.rejects(
      store.readTicketForConfirmation({ ...ticket, now: NOW + 300_001 }),
      (error) => error?.code === 'GOOGLE_ADS_PROVISIONING_TICKET_UNUSABLE',
    );
  } finally {
    d1.close();
  }
});

test('ticket store fails closed on identity, key and challenge mismatches', async () => {
  const { d1, store } = await fixture();
  try {
    await store.redeemTicket({ ...ticket, now: NOW + 1 });
    for (const override of [
      { identityFingerprint: 'b'.repeat(64) },
      { keyId: 'other-key' },
      { challengeFingerprint: 'd'.repeat(43) },
    ]) {
      await assert.rejects(
        store.readTicketForConfirmation({ ...ticket, ...override, now: NOW + 2 }),
        (error) => error?.code === 'GOOGLE_ADS_PROVISIONING_IDENTITY_MISMATCH',
      );
    }
  } finally {
    d1.close();
  }
});
