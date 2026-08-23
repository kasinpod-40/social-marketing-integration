import {
  decryptSecret,
  encryptSecret,
} from '../../shared/src/security/secure-token.js';
import { permanentError } from '../../shared/src/errors/runtime-error.js';

/** Application-level encrypted Secret boundary บน D1; ไม่เคยคืน ciphertext เป็น Token */
export class EncryptedCustomerCredentialRepository {
  constructor(input = {}) {
    if (typeof input.store?.replaceEncryptedCredential !== 'function') {
      throw new TypeError('EncryptedCustomerCredentialRepository requires a connection store');
    }
    this.store = input.store;
    this.keyVersion = requireText(input.keyVersion, 'keyVersion');
    this.keys = Object.freeze({ ...(input.keys ?? {}) });
    if (!this.keys[this.keyVersion]) {
      throw permanentError('Current credential encryption key version is unavailable', {
        code: 'CONNECTION_ENCRYPTION_KEY_VERSION_UNAVAILABLE',
      });
    }
    this.cryptoImpl = input.cryptoImpl ?? globalThis.crypto;
    this.now = typeof input.now === 'function' ? input.now : () => Date.now();
    this.createId = typeof input.createId === 'function'
      ? input.createId
      : (prefix) => `${prefix}:${crypto.randomUUID()}`;
  }

  async replace(input = {}) {
    const connectionId = requireText(input.connectionId, 'connectionId');
    const connectorKey = requireText(input.connectorKey, 'connectorKey');
    const credentialKind = requireCredentialKind(input.credentialKind);
    const credentialReference = this.createId('credential');
    const previous = input.previousReference
      ? { credentialReference: requireText(input.previousReference, 'previousReference') }
      : await this.findActive({ connectionId, credentialKind });
    const authenticatedContext = { connectionId, connectorKey, credentialKind };
    const encrypted = await encryptSecret(
      requireText(input.plaintext, 'plaintext'),
      this.keys[this.keyVersion],
      {
        keyVersion: this.keyVersion,
        authenticatedContext,
        cryptoImpl: this.cryptoImpl,
      },
    );
    await this.store.replaceEncryptedCredential({
      credentialReference,
      previousReference: previous?.credentialReference ?? null,
      connectionId,
      credentialKind,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      algorithm: encrypted.algorithm,
      keyVersion: encrypted.keyVersion,
      createdAt: requireTimestamp(this.now()),
    });
    return credentialReference;
  }

  async revoke(input = {}) {
    if (typeof this.store.revokeEncryptedCredential !== 'function') {
      throw new TypeError('Encrypted credential store does not support revoke');
    }
    await this.store.revokeEncryptedCredential({
      credentialReference: requireText(input.credentialReference, 'credentialReference'),
      connectionId: requireText(input.connectionId, 'connectionId'),
      credentialKind: requireCredentialKind(input.credentialKind),
      now: requireTimestamp(this.now()),
    });
  }

  /** ถอดและเข้ารหัส Credential เดิมใหม่ใน memory เท่านั้น โดยไม่คืน plaintext ออกจาก boundary */
  async rewrap(input = {}) {
    const connectionId = requireText(input.connectionId, 'connectionId');
    const connectorKey = requireText(input.connectorKey, 'connectorKey');
    const credentialKind = requireCredentialKind(input.credentialKind);
    const credentialReference = requireText(input.credentialReference, 'credentialReference');
    const sourceKeyVersion = requireText(input.sourceKeyVersion, 'sourceKeyVersion');
    if (sourceKeyVersion === this.keyVersion) {
      throw permanentError('Credential rewrap requires a different current key version', {
        code: 'CONNECTION_CREDENTIAL_REWRAP_TARGET_UNCHANGED',
      });
    }
    const row = await this.store.getEncryptedCredential(credentialReference);
    if (!row || row.status !== 'active') {
      throw permanentError('Encrypted customer credential is unavailable for rewrap', {
        code: 'CONNECTION_CREDENTIAL_UNAVAILABLE',
      });
    }
    if (row.connectionId !== connectionId || row.credentialKind !== credentialKind) {
      throw permanentError('Encrypted customer credential binding does not match', {
        code: 'CONNECTION_CREDENTIAL_BINDING_MISMATCH',
      });
    }
    if (row.keyVersion !== sourceKeyVersion) {
      throw permanentError('Encrypted customer credential source key version does not match', {
        code: 'CONNECTION_CREDENTIAL_REWRAP_SOURCE_MISMATCH',
      });
    }
    const plaintext = await this.read({
      credentialReference,
      connectionId,
      connectorKey,
      credentialKind,
    });
    const nextReference = await this.replace({
      connectionId,
      connectorKey,
      credentialKind,
      plaintext,
      previousReference: credentialReference,
    });
    return Object.freeze({
      previousReference: credentialReference,
      credentialReference: nextReference,
      sourceKeyVersion,
      keyVersion: this.keyVersion,
    });
  }

  async findActive(input) {
    if (typeof this.store.findActiveEncryptedCredential !== 'function') return null;
    return this.store.findActiveEncryptedCredential(input);
  }

  async read(input = {}) {
    const credentialReference = requireText(input.credentialReference, 'credentialReference');
    const row = await this.store.getEncryptedCredential(credentialReference);
    if (!row || row.status !== 'active') {
      throw permanentError('Encrypted customer credential is unavailable', {
        code: 'CONNECTION_CREDENTIAL_UNAVAILABLE',
      });
    }
    const connectionId = requireText(input.connectionId, 'connectionId');
    const connectorKey = requireText(input.connectorKey, 'connectorKey');
    const credentialKind = requireCredentialKind(input.credentialKind);
    if (
      row.connectionId !== connectionId
      || row.credentialKind !== credentialKind
    ) {
      throw permanentError('Encrypted customer credential binding does not match', {
        code: 'CONNECTION_CREDENTIAL_BINDING_MISMATCH',
      });
    }
    const keyMaterial = this.keys[row.keyVersion];
    if (!keyMaterial) {
      throw permanentError('Encrypted customer credential key version is unavailable', {
        code: 'CONNECTION_ENCRYPTION_KEY_VERSION_UNAVAILABLE',
      });
    }
    return decryptSecret({
      algorithm: row.algorithm,
      keyVersion: row.keyVersion,
      iv: row.iv,
      ciphertext: row.ciphertext,
    }, keyMaterial, {
      keyVersion: row.keyVersion,
      authenticatedContext: { connectionId, connectorKey, credentialKind },
      cryptoImpl: this.cryptoImpl,
    });
  }
}

function requireCredentialKind(value) {
  if (!new Set(['refresh_token', 'pkce_verifier']).has(value)) {
    throw new TypeError('credentialKind is unsupported');
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function requireTimestamp(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError('now must be a timestamp');
  return number;
}
