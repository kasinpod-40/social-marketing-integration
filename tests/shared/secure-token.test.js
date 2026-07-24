import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSecureRandomToken,
  decryptSecret,
  encodeBase64Url,
  encryptSecret,
  hashSecureToken,
  signCompactPayload,
  timingSafeEqualText,
  verifyCompactPayload,
} from '../../packages/shared/src/security/secure-token.js';

const SIGNING_KEY = 'test-signing-key-with-at-least-thirty-two-bytes';
const ENCRYPTION_KEY = encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));

test('signed payload verifies independently of object insertion order and rejects tampering', async () => {
  const payload = {
    connectorKey: 'youtube',
    customerKey: 'customer',
    expiresAt: 2_000,
    issuedAt: 1_000,
  };
  const token = await signCompactPayload(payload, SIGNING_KEY);
  const verified = await verifyCompactPayload(token, SIGNING_KEY);
  assert.deepEqual(verified, payload);
  assert.equal(Object.isFrozen(verified), true);

  const [body, signature] = token.split('.');
  const replacement = body.endsWith('A') ? 'B' : 'A';
  const tampered = `${body.slice(0, -1)}${replacement}.${signature}`;
  await assert.rejects(
    () => verifyCompactPayload(tampered, SIGNING_KEY),
    (error) => error.code === 'CONNECTION_SIGNATURE_INVALID',
  );
});

test('AES-GCM round trip binds ciphertext to connection context and key version', async () => {
  const context = {
    connectionId: 'connection-1',
    connectorKey: 'youtube',
    credentialKind: 'refresh_token',
  };
  const envelope = await encryptSecret('refresh-value', ENCRYPTION_KEY, {
    keyVersion: 'v1',
    authenticatedContext: context,
  });
  assert.equal(envelope.algorithm, 'AES-256-GCM');
  assert.equal(envelope.keyVersion, 'v1');
  assert.notEqual(envelope.ciphertext, 'refresh-value');
  assert.equal(await decryptSecret(envelope, ENCRYPTION_KEY, {
    keyVersion: 'v1',
    authenticatedContext: context,
  }), 'refresh-value');

  await assert.rejects(
    () => decryptSecret(envelope, ENCRYPTION_KEY, {
      keyVersion: 'v1',
      authenticatedContext: { ...context, connectionId: 'connection-2' },
    }),
    (error) => error.code === 'CONNECTION_CREDENTIAL_DECRYPT_FAILED',
  );
});

test('AES-GCM rejects tampered ciphertext and unknown key version without plaintext fallback', async () => {
  const context = {
    connectionId: 'connection-1',
    connectorKey: 'google_ads',
    credentialKind: 'refresh_token',
  };
  const envelope = await encryptSecret('secret-value', ENCRYPTION_KEY, {
    keyVersion: 'v1',
    authenticatedContext: context,
  });
  const replacement = envelope.ciphertext.startsWith('A') ? 'B' : 'A';
  const tampered = {
    ...envelope,
    ciphertext: `${replacement}${envelope.ciphertext.slice(1)}`,
  };
  await assert.rejects(
    () => decryptSecret(tampered, ENCRYPTION_KEY, {
      keyVersion: 'v1',
      authenticatedContext: context,
    }),
    (error) => error.code === 'CONNECTION_CREDENTIAL_DECRYPT_FAILED',
  );
  await assert.rejects(
    () => decryptSecret(envelope, ENCRYPTION_KEY, {
      keyVersion: 'v2',
      authenticatedContext: context,
    }),
    (error) => error.code === 'CONNECTION_CREDENTIAL_KEY_VERSION_MISMATCH',
  );
});

test('secure random values and hashes are opaque and stable only for the same input', async () => {
  const first = createSecureRandomToken();
  const second = createSecureRandomToken();
  assert.notEqual(first, second);
  assert.equal(await hashSecureToken(first), await hashSecureToken(first));
  assert.notEqual(await hashSecureToken(first), await hashSecureToken(second));
});

test('timing-safe text comparison accepts exact secrets and rejects different values', async () => {
  assert.equal(await timingSafeEqualText('operator-secret', 'operator-secret'), true);
  assert.equal(await timingSafeEqualText('operator-secret', 'operator-secret-x'), false);
  assert.equal(await timingSafeEqualText('', 'operator-secret'), false);
});
