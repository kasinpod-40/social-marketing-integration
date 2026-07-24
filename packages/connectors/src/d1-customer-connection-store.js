import {
  CUSTOMER_CONNECTION_ACCESS_STATUSES,
  CUSTOMER_CONNECTION_STATUSES,
  requireConnectionAccessStatus,
  requireConnectionStatus,
  requireCustomerConnectionConnector,
} from '../../application/src/connections/customer-connection-contract.js';
import { permanentError, transientError } from '../../shared/src/errors/runtime-error.js';

/** D1 authority สำหรับ Connection metadata, one-time invitation/state และ encrypted blobs */
export class D1CustomerConnectionStore {
  constructor(input = {}) {
    this.db = requireD1(input.db);
  }

  async createInvitation(input = {}) {
    const row = normalizeInvitation(input);
    await run(this.db.prepare(`
      INSERT INTO connection_invitations (
        invitation_id, connector_key, customer_key, environment, nonce_hash,
        redirect_uri, issued_at, expires_at, consumed_at, connection_id, created_at,
        attempt_count, max_attempts, active_attempt_id, active_attempt_expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 0, ?, NULL, NULL)
    `).bind(
      row.invitationId,
      row.connectorKey,
      row.customerKey,
      row.environment,
      row.nonceHash,
      row.redirectUri,
      row.issuedAt,
      row.expiresAt,
      row.issuedAt,
      row.maxAttempts,
    ), 'CONNECTION_INVITATION_CREATE_FAILED');
    return row;
  }

  async reserveInvitationAttempt(input = {}) {
    const value = normalizeInvitationAttempt(input);
    const result = await run(this.db.prepare(`
      UPDATE connection_invitations
      SET attempt_count = attempt_count + 1,
          active_attempt_id = ?,
          active_attempt_expires_at = ?
      WHERE invitation_id = ?
        AND connector_key = ?
        AND customer_key = ?
        AND nonce_hash = ?
        AND consumed_at IS NULL
        AND expires_at >= ?
        AND expires_at >= ?
        AND max_attempts = ?
        AND attempt_count < max_attempts
        AND (
          active_attempt_id IS NULL
          OR active_attempt_expires_at < ?
        )
    `).bind(
      value.attemptId,
      value.attemptExpiresAt,
      value.id,
      value.connectorKey,
      value.customerKey,
      value.nonceHash,
      value.now,
      value.attemptExpiresAt,
      value.maxAttempts,
      value.now,
    ), 'CONNECTION_INVITATION_RESERVE_FAILED');
    if (readChanges(result) === 1) return this.getInvitation(value.id);
    const row = await this.getInvitation(value.id);
    throw classifyInvitationAttemptFailure(row, value);
  }

  async releaseInvitationAttempt(input = {}) {
    const value = normalizeInvitationAttemptCompletion(input);
    const result = await run(this.db.prepare(`
      UPDATE connection_invitations
      SET active_attempt_id = NULL,
          active_attempt_expires_at = NULL
      WHERE invitation_id = ?
        AND connector_key = ?
        AND customer_key = ?
        AND (connection_id IS NULL OR connection_id = ?)
        AND active_attempt_id = ?
        AND consumed_at IS NULL
    `).bind(
      value.id,
      value.connectorKey,
      value.customerKey,
      value.connectionId,
      value.attemptId,
    ), 'CONNECTION_INVITATION_RELEASE_FAILED');
    if (readChanges(result) === 1) return this.getInvitation(value.id);
    const row = await this.getInvitation(value.id);
    throw classifyInvitationCompletionFailure(row, value);
  }

  async completeInvitation(input = {}) {
    const value = normalizeInvitationAttemptCompletion(input);
    const result = await run(this.db.prepare(`
      UPDATE connection_invitations
      SET consumed_at = ?,
          active_attempt_id = NULL,
          active_attempt_expires_at = NULL
      WHERE invitation_id = ?
        AND connector_key = ?
        AND customer_key = ?
        AND connection_id = ?
        AND active_attempt_id = ?
        AND consumed_at IS NULL
        AND expires_at >= ?
    `).bind(
      value.now,
      value.id,
      value.connectorKey,
      value.customerKey,
      value.connectionId,
      value.attemptId,
      value.now,
    ), 'CONNECTION_INVITATION_COMPLETE_FAILED');
    if (readChanges(result) === 1) return this.getInvitation(value.id);
    const row = await this.getInvitation(value.id);
    throw classifyInvitationCompletionFailure(row, value);
  }

  async getInvitation(invitationId) {
    const row = await first(this.db.prepare(`
      SELECT * FROM connection_invitations WHERE invitation_id = ?
    `).bind(requireText(invitationId, 'invitationId')), 'CONNECTION_INVITATION_READ_FAILED');
    return row ? mapInvitation(row) : null;
  }

  async createConnection(input = {}) {
    const row = normalizeNewConnection(input);
    await run(this.db.prepare(`
      INSERT INTO connections (
        id, platform, account_id, account_name, status,
        encrypted_access_token, encrypted_refresh_token, token_expires_at, scopes,
        customer_key, connector_key, provider, external_account_id, external_account_name,
        credential_reference, granted_scopes_json, token_type, last_refresh_at,
        last_validated_at, connection_status, access_status, last_error_code,
        disconnected_at, created_at, updated_at
      ) VALUES (
        ?, ?, ?, NULL, ?,
        NULL, NULL, NULL, NULL,
        ?, ?, ?, NULL, NULL,
        NULL, NULL, NULL, NULL,
        NULL, ?, ?, NULL,
        NULL, ?, ?
      )
    `).bind(
      row.connectionId,
      row.connectorKey,
      `pending:${row.connectionId}`,
      CUSTOMER_CONNECTION_STATUSES.AUTHORIZATION_PENDING,
      row.customerKey,
      row.connectorKey,
      'google',
      CUSTOMER_CONNECTION_STATUSES.AUTHORIZATION_PENDING,
      CUSTOMER_CONNECTION_ACCESS_STATUSES.NOT_VALIDATED,
      row.createdAt,
      row.createdAt,
    ), 'CONNECTION_METADATA_CREATE_FAILED');
    return this.getConnection(row.connectionId);
  }

  async findConnectionByCustomerConnector(input = {}) {
    const row = await first(this.db.prepare(`
      SELECT * FROM connections
      WHERE customer_key = ? AND connector_key = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `).bind(
      requireText(input.customerKey, 'customerKey'),
      requireCustomerConnectionConnector(input.connectorKey),
    ), 'CONNECTION_METADATA_LOOKUP_FAILED');
    return row ? mapConnection(row) : null;
  }

  async attachInvitationConnection(input = {}) {
    const invitationId = requireText(input.invitationId, 'invitationId');
    const connectionId = requireText(input.connectionId, 'connectionId');
    const attemptId = requireText(input.attemptId, 'attemptId');
    const result = await run(this.db.prepare(`
      UPDATE connection_invitations
      SET connection_id = ?
      WHERE invitation_id = ?
        AND consumed_at IS NULL
        AND active_attempt_id = ?
        AND (connection_id IS NULL OR connection_id = ?)
    `).bind(
      connectionId,
      invitationId,
      attemptId,
      connectionId,
    ), 'CONNECTION_INVITATION_ATTACH_FAILED');
    if (readChanges(result) !== 1) {
      throw permanentError('Invitation cannot be attached to a connection', {
        code: 'CONNECTION_INVITATION_ATTACH_REJECTED',
      });
    }
  }

  async createOAuthState(input = {}) {
    const row = normalizeOAuthState(input);
    await run(this.db.prepare(`
      INSERT INTO oauth_state_attempts (
        attempt_id, invitation_id, connection_id, connector_key, customer_key,
        redirect_uri, nonce_hash, pkce_credential_reference, issued_at, expires_at,
        consumed_at, callback_error_code, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
    `).bind(
      row.attemptId,
      row.invitationId,
      row.connectionId,
      row.connectorKey,
      row.customerKey,
      row.redirectUri,
      row.nonceHash,
      row.pkceCredentialReference,
      row.issuedAt,
      row.expiresAt,
      row.issuedAt,
      row.issuedAt,
    ), 'CONNECTION_OAUTH_STATE_CREATE_FAILED');
    return row;
  }

  async consumeOAuthState(input = {}) {
    const value = normalizeConsume(input);
    const redirectUri = requireHttpsUrl(input.redirectUri, 'redirectUri');
    const result = await run(this.db.prepare(`
      UPDATE oauth_state_attempts
      SET consumed_at = ?, updated_at = ?
      WHERE attempt_id = ?
        AND connector_key = ?
        AND customer_key = ?
        AND redirect_uri = ?
        AND nonce_hash = ?
        AND consumed_at IS NULL
        AND expires_at >= ?
    `).bind(
      value.now,
      value.now,
      value.id,
      value.connectorKey,
      value.customerKey,
      redirectUri,
      value.nonceHash,
      value.now,
    ), 'CONNECTION_OAUTH_STATE_CONSUME_FAILED');
    if (readChanges(result) === 1) return this.getOAuthState(value.id);
    const row = await this.getOAuthState(value.id);
    throw classifyOneTimeFailure(row, { ...value, redirectUri }, 'OAUTH_STATE');
  }

  async getOAuthState(attemptId) {
    const row = await first(this.db.prepare(`
      SELECT * FROM oauth_state_attempts WHERE attempt_id = ?
    `).bind(requireText(attemptId, 'attemptId')), 'CONNECTION_OAUTH_STATE_READ_FAILED');
    return row ? mapOAuthState(row) : null;
  }

  async recordCallbackError(input = {}) {
    await run(this.db.prepare(`
      UPDATE oauth_state_attempts
      SET callback_error_code = ?, updated_at = ?
      WHERE attempt_id = ?
    `).bind(
      optionalText(input.errorCode),
      requireTimestamp(input.now, 'now'),
      requireText(input.attemptId, 'attemptId'),
    ), 'CONNECTION_CALLBACK_ERROR_WRITE_FAILED');
  }

  async createIdentitySelection(input = {}) {
    const row = normalizeIdentitySelection(input);
    await run(this.db.prepare(`
      INSERT INTO connection_identity_selections (
        selection_id, connection_id, connector_key, customer_key, nonce_hash,
        candidates_json, issued_at, expires_at, consumed_at, selected_external_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
    `).bind(
      row.selectionId,
      row.connectionId,
      row.connectorKey,
      row.customerKey,
      row.nonceHash,
      JSON.stringify(row.candidates),
      row.issuedAt,
      row.expiresAt,
      row.issuedAt,
      row.issuedAt,
    ), 'CONNECTION_IDENTITY_SELECTION_CREATE_FAILED');
    return row;
  }

  async consumeIdentitySelection(input = {}) {
    const selectionId = requireText(input.selectionId, 'selectionId');
    const connectionId = requireText(input.connectionId, 'connectionId');
    const connectorKey = requireCustomerConnectionConnector(input.connectorKey);
    const customerKey = requireText(input.customerKey, 'customerKey');
    const nonceHash = requireText(input.nonceHash, 'nonceHash');
    const selectedExternalId = requireText(input.selectedExternalId, 'selectedExternalId');
    const now = requireTimestamp(input.now, 'now');
    const existing = await this.getIdentitySelection(selectionId);
    if (!existing) {
      throw permanentError('Identity selection is invalid', {
        code: 'CONNECTION_IDENTITY_SELECTION_INVALID',
      });
    }
    const candidate = existing.candidates.find(
      (item) => item.externalAccountId === selectedExternalId,
    );
    if (!candidate) {
      throw permanentError('Selected identity is not an approved candidate', {
        code: 'CONNECTION_IDENTITY_SELECTION_CANDIDATE_INVALID',
      });
    }
    const result = await run(this.db.prepare(`
      UPDATE connection_identity_selections
      SET consumed_at = ?, selected_external_id = ?, updated_at = ?
      WHERE selection_id = ?
        AND connection_id = ?
        AND connector_key = ?
        AND customer_key = ?
        AND nonce_hash = ?
        AND consumed_at IS NULL
        AND expires_at >= ?
    `).bind(
      now,
      selectedExternalId,
      now,
      selectionId,
      connectionId,
      connectorKey,
      customerKey,
      nonceHash,
      now,
    ), 'CONNECTION_IDENTITY_SELECTION_CONSUME_FAILED');
    if (readChanges(result) === 1) return candidate;
    throw classifyIdentitySelectionFailure(existing, {
      connectionId,
      connectorKey,
      customerKey,
      nonceHash,
      now,
    });
  }

  async getIdentitySelection(selectionId) {
    const row = await first(this.db.prepare(`
      SELECT * FROM connection_identity_selections WHERE selection_id = ?
    `).bind(requireText(selectionId, 'selectionId')), 'CONNECTION_IDENTITY_SELECTION_READ_FAILED');
    if (!row) return null;
    return Object.freeze({
      selectionId: row.selection_id,
      connectionId: row.connection_id,
      connectorKey: row.connector_key,
      customerKey: row.customer_key,
      nonceHash: row.nonce_hash,
      candidates: Object.freeze(parseJsonValueArray(row.candidates_json).map((item) => Object.freeze(item))),
      issuedAt: Number(row.issued_at),
      expiresAt: Number(row.expires_at),
      consumedAt: optionalTimestamp(row.consumed_at),
      selectedExternalId: optionalText(row.selected_external_id),
    });
  }

  async replaceEncryptedCredential(input = {}) {
    const row = normalizeEncryptedCredential(input);
    const statements = [];
    if (row.previousReference) {
      statements.push(this.db.prepare(`
        UPDATE encrypted_credentials
        SET status = 'replaced', updated_at = ?
        WHERE credential_reference = ?
          AND connection_id = ?
          AND credential_kind = ?
          AND status = 'active'
      `).bind(
        row.createdAt,
        row.previousReference,
        row.connectionId,
        row.credentialKind,
      ));
    }
    statements.push(
      this.db.prepare(`
        INSERT INTO encrypted_credentials (
          credential_reference, connection_id, credential_kind, ciphertext, iv,
          algorithm, key_version, status, replaced_by, created_at, updated_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?, NULL)
      `).bind(
        row.credentialReference,
        row.connectionId,
        row.credentialKind,
        row.ciphertext,
        row.iv,
        row.algorithm,
        row.keyVersion,
        row.createdAt,
        row.createdAt,
      ),
    );
    if (row.previousReference) {
      statements.push(this.db.prepare(`
        UPDATE encrypted_credentials
        SET replaced_by = ?, updated_at = ?
        WHERE credential_reference = ?
          AND connection_id = ?
          AND credential_kind = ?
          AND status = 'replaced'
      `).bind(
        row.credentialReference,
        row.createdAt,
        row.previousReference,
        row.connectionId,
        row.credentialKind,
      ));
    }
    if (row.credentialKind === 'refresh_token') {
      statements.push(this.db.prepare(`
        UPDATE connections
        SET credential_reference = ?, updated_at = ?
        WHERE id = ?
      `).bind(row.credentialReference, row.createdAt, row.connectionId));
    }
    const results = await batch(this.db, statements, 'CONNECTION_CREDENTIAL_REPLACE_FAILED');
    if (row.previousReference && readChanges(results[0]) !== 1) {
      throw permanentError('Previous active credential cannot be replaced', {
        code: 'CONNECTION_CREDENTIAL_REPLACEMENT_CONFLICT',
      });
    }
    return row;
  }

  async getEncryptedCredential(credentialReference) {
    const row = await first(this.db.prepare(`
      SELECT * FROM encrypted_credentials WHERE credential_reference = ?
    `).bind(requireText(credentialReference, 'credentialReference')), 'CONNECTION_CREDENTIAL_READ_FAILED');
    return row ? mapEncryptedCredential(row) : null;
  }

  async findActiveEncryptedCredential(input = {}) {
    const row = await first(this.db.prepare(`
      SELECT * FROM encrypted_credentials
      WHERE connection_id = ? AND credential_kind = ? AND status = 'active'
      ORDER BY updated_at DESC, credential_reference DESC
      LIMIT 1
    `).bind(
      requireText(input.connectionId, 'connectionId'),
      requireCredentialKind(input.credentialKind),
    ), 'CONNECTION_CREDENTIAL_ACTIVE_READ_FAILED');
    return row ? mapEncryptedCredential(row) : null;
  }

  async revokeEncryptedCredential(input = {}) {
    const result = await run(this.db.prepare(`
      UPDATE encrypted_credentials
      SET status = 'revoked', revoked_at = ?, updated_at = ?
      WHERE credential_reference = ?
        AND connection_id = ?
        AND credential_kind = ?
        AND status = 'active'
    `).bind(
      requireTimestamp(input.now, 'now'),
      requireTimestamp(input.now, 'now'),
      requireText(input.credentialReference, 'credentialReference'),
      requireText(input.connectionId, 'connectionId'),
      requireCredentialKind(input.credentialKind),
    ), 'CONNECTION_CREDENTIAL_REVOKE_FAILED');
    if (readChanges(result) !== 1) {
      throw permanentError('Active encrypted credential cannot be revoked', {
        code: 'CONNECTION_CREDENTIAL_REVOKE_REJECTED',
      });
    }
  }

  async updateConnection(input = {}) {
    const connectionId = requireText(input.connectionId, 'connectionId');
    const connectorKey = requireCustomerConnectionConnector(input.connectorKey);
    const status = requireConnectionStatus(input.connectionStatus);
    const accessStatus = requireConnectionAccessStatus(input.accessStatus);
    const grantedScopes = normalizeTextArray(input.grantedScopes ?? []);
    const externalId = optionalText(input.externalAccountId);
    await run(this.db.prepare(`
      UPDATE connections
      SET account_id = COALESCE(?, account_id),
          account_name = ?,
          status = ?,
          external_account_id = ?,
          external_account_name = ?,
          granted_scopes_json = ?,
          scopes = ?,
          token_type = ?,
          token_expires_at = ?,
          last_refresh_at = ?,
          last_validated_at = ?,
          connection_status = ?,
          access_status = ?,
          last_error_code = ?,
          provider_metadata_json = ?,
          updated_at = ?
      WHERE id = ? AND connector_key = ?
    `).bind(
      externalId,
      optionalText(input.externalAccountName),
      status,
      externalId,
      optionalText(input.externalAccountName),
      JSON.stringify(grantedScopes),
      JSON.stringify(grantedScopes),
      optionalText(input.tokenType),
      optionalTimestamp(input.tokenExpiresAt),
      optionalTimestamp(input.lastRefreshAt),
      optionalTimestamp(input.lastValidatedAt),
      status,
      accessStatus,
      optionalText(input.lastErrorCode),
      normalizeJsonObject(input.providerMetadata),
      requireTimestamp(input.updatedAt, 'updatedAt'),
      connectionId,
      connectorKey,
    ), 'CONNECTION_METADATA_UPDATE_FAILED');
    return this.getConnection(connectionId);
  }

  async getConnection(connectionId) {
    const row = await first(this.db.prepare(`
      SELECT * FROM connections WHERE id = ?
    `).bind(requireText(connectionId, 'connectionId')), 'CONNECTION_METADATA_READ_FAILED');
    return row ? mapConnection(row) : null;
  }

  async disconnect(input = {}) {
    const connectionId = requireText(input.connectionId, 'connectionId');
    const now = requireTimestamp(input.now, 'now');
    const statements = [
      this.db.prepare(`
        UPDATE encrypted_credentials
        SET status = 'revoked', revoked_at = ?, updated_at = ?
        WHERE connection_id = ? AND status = 'active'
      `).bind(now, now, connectionId),
      this.db.prepare(`
        UPDATE connections
        SET status = 'disconnected',
            connection_status = 'disconnected',
            access_status = 'revoked',
            disconnected_at = ?,
            updated_at = ?
        WHERE id = ?
      `).bind(now, now, connectionId),
    ];
    await batch(this.db, statements, 'CONNECTION_DISCONNECT_FAILED');
    return this.getConnection(connectionId);
  }
}

function normalizeInvitation(input) {
  const issuedAt = requireTimestamp(input.issuedAt, 'issuedAt');
  const expiresAt = requireTimestamp(input.expiresAt, 'expiresAt');
  if (expiresAt <= issuedAt) throw new TypeError('expiresAt must be after issuedAt');
  return Object.freeze({
    invitationId: requireText(input.invitationId, 'invitationId'),
    connectorKey: requireCustomerConnectionConnector(input.connectorKey),
    customerKey: requireText(input.customerKey, 'customerKey'),
    environment: requireText(input.environment, 'environment'),
    nonceHash: requireText(input.nonceHash, 'nonceHash'),
    redirectUri: requireHttpsUrl(input.redirectUri, 'redirectUri'),
    issuedAt,
    expiresAt,
    maxAttempts: requireBoundedInteger(input.maxAttempts, 'maxAttempts', 1, 5),
  });
}

function normalizeNewConnection(input) {
  return Object.freeze({
    connectionId: requireText(input.connectionId, 'connectionId'),
    connectorKey: requireCustomerConnectionConnector(input.connectorKey),
    customerKey: requireText(input.customerKey, 'customerKey'),
    createdAt: requireTimestamp(input.createdAt, 'createdAt'),
  });
}

function normalizeOAuthState(input) {
  const issuedAt = requireTimestamp(input.issuedAt, 'issuedAt');
  const expiresAt = requireTimestamp(input.expiresAt, 'expiresAt');
  if (expiresAt <= issuedAt) throw new TypeError('expiresAt must be after issuedAt');
  return Object.freeze({
    attemptId: requireText(input.attemptId, 'attemptId'),
    invitationId: requireText(input.invitationId, 'invitationId'),
    connectionId: requireText(input.connectionId, 'connectionId'),
    connectorKey: requireCustomerConnectionConnector(input.connectorKey),
    customerKey: requireText(input.customerKey, 'customerKey'),
    redirectUri: requireHttpsUrl(input.redirectUri, 'redirectUri'),
    nonceHash: requireText(input.nonceHash, 'nonceHash'),
    pkceCredentialReference: optionalText(input.pkceCredentialReference),
    issuedAt,
    expiresAt,
  });
}

function normalizeConsume(input) {
  return Object.freeze({
    id: requireText(input.id, 'id'),
    connectorKey: requireCustomerConnectionConnector(input.connectorKey),
    customerKey: requireText(input.customerKey, 'customerKey'),
    nonceHash: requireText(input.nonceHash, 'nonceHash'),
    now: requireTimestamp(input.now, 'now'),
  });
}

function normalizeInvitationAttempt(input) {
  const now = requireTimestamp(input.now, 'now');
  const attemptExpiresAt = requireTimestamp(input.attemptExpiresAt, 'attemptExpiresAt');
  if (attemptExpiresAt <= now) {
    throw new TypeError('attemptExpiresAt must be after now');
  }
  return Object.freeze({
    ...normalizeConsume(input),
    attemptId: requireText(input.attemptId, 'attemptId'),
    attemptExpiresAt,
    maxAttempts: requireBoundedInteger(input.maxAttempts, 'maxAttempts', 1, 5),
  });
}

function normalizeInvitationAttemptCompletion(input) {
  return Object.freeze({
    id: requireText(input.id, 'id'),
    attemptId: requireText(input.attemptId, 'attemptId'),
    connectionId: requireText(input.connectionId, 'connectionId'),
    connectorKey: requireCustomerConnectionConnector(input.connectorKey),
    customerKey: requireText(input.customerKey, 'customerKey'),
    now: requireTimestamp(input.now, 'now'),
  });
}

function normalizeEncryptedCredential(input) {
  const credentialKind = requireCredentialKind(input.credentialKind);
  if (input.algorithm !== 'AES-256-GCM') throw new TypeError('algorithm is unsupported');
  return Object.freeze({
    credentialReference: requireText(input.credentialReference, 'credentialReference'),
    previousReference: optionalText(input.previousReference),
    connectionId: requireText(input.connectionId, 'connectionId'),
    credentialKind,
    ciphertext: requireText(input.ciphertext, 'ciphertext'),
    iv: requireText(input.iv, 'iv'),
    algorithm: input.algorithm,
    keyVersion: requireText(input.keyVersion, 'keyVersion'),
    createdAt: requireTimestamp(input.createdAt, 'createdAt'),
  });
}

function requireCredentialKind(value) {
  if (!new Set(['refresh_token', 'pkce_verifier']).has(value)) {
    throw new TypeError('credentialKind is unsupported');
  }
  return value;
}

function normalizeIdentitySelection(input) {
  const issuedAt = requireTimestamp(input.issuedAt, 'issuedAt');
  const expiresAt = requireTimestamp(input.expiresAt, 'expiresAt');
  if (expiresAt <= issuedAt) throw new TypeError('expiresAt must be after issuedAt');
  if (!Array.isArray(input.candidates) || input.candidates.length < 2) {
    throw new TypeError('identity selection requires at least two candidates');
  }
  const candidates = input.candidates.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new TypeError('identity selection candidate must be an object');
    }
    return Object.freeze({
      ...candidate,
      externalAccountId: requireText(candidate.externalAccountId, 'externalAccountId'),
    });
  });
  if (new Set(candidates.map((item) => item.externalAccountId)).size !== candidates.length) {
    throw new TypeError('identity selection candidates must be unique');
  }
  return Object.freeze({
    selectionId: requireText(input.selectionId, 'selectionId'),
    connectionId: requireText(input.connectionId, 'connectionId'),
    connectorKey: requireCustomerConnectionConnector(input.connectorKey),
    customerKey: requireText(input.customerKey, 'customerKey'),
    nonceHash: requireText(input.nonceHash, 'nonceHash'),
    candidates: Object.freeze(candidates),
    issuedAt,
    expiresAt,
  });
}

function mapInvitation(row) {
  return Object.freeze({
    invitationId: row.invitation_id,
    connectorKey: row.connector_key,
    customerKey: row.customer_key,
    environment: row.environment,
    nonceHash: row.nonce_hash,
    redirectUri: row.redirect_uri,
    issuedAt: Number(row.issued_at),
    expiresAt: Number(row.expires_at),
    consumedAt: optionalTimestamp(row.consumed_at),
    connectionId: optionalText(row.connection_id),
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    activeAttemptId: optionalText(row.active_attempt_id),
    activeAttemptExpiresAt: optionalTimestamp(row.active_attempt_expires_at),
  });
}

function mapOAuthState(row) {
  return Object.freeze({
    attemptId: row.attempt_id,
    invitationId: row.invitation_id,
    connectionId: row.connection_id,
    connectorKey: row.connector_key,
    customerKey: row.customer_key,
    redirectUri: row.redirect_uri,
    nonceHash: row.nonce_hash,
    pkceCredentialReference: optionalText(row.pkce_credential_reference),
    issuedAt: Number(row.issued_at),
    expiresAt: Number(row.expires_at),
    consumedAt: optionalTimestamp(row.consumed_at),
    callbackErrorCode: optionalText(row.callback_error_code),
  });
}

function mapEncryptedCredential(row) {
  return Object.freeze({
    credentialReference: row.credential_reference,
    connectionId: row.connection_id,
    credentialKind: row.credential_kind,
    ciphertext: row.ciphertext,
    iv: row.iv,
    algorithm: row.algorithm,
    keyVersion: row.key_version,
    status: row.status,
    replacedBy: optionalText(row.replaced_by),
  });
}

function mapConnection(row) {
  return Object.freeze({
    connectionId: row.id,
    customerKey: optionalText(row.customer_key),
    connectorKey: optionalText(row.connector_key) ?? row.platform,
    provider: optionalText(row.provider),
    externalAccountId: optionalText(row.external_account_id) ?? optionalText(row.account_id),
    externalAccountName: optionalText(row.external_account_name) ?? optionalText(row.account_name),
    credentialReference: optionalText(row.credential_reference),
    grantedScopes: parseJsonArray(row.granted_scopes_json ?? row.scopes),
    tokenType: optionalText(row.token_type),
    tokenExpiresAt: optionalTimestamp(row.token_expires_at),
    lastRefreshAt: optionalTimestamp(row.last_refresh_at),
    lastValidatedAt: optionalTimestamp(row.last_validated_at),
    connectionStatus: optionalText(row.connection_status) ?? row.status,
    accessStatus: optionalText(row.access_status),
    lastErrorCode: optionalText(row.last_error_code),
    providerMetadata: parseJsonObject(row.provider_metadata_json),
    disconnectedAt: optionalTimestamp(row.disconnected_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function classifyOneTimeFailure(row, input, prefix) {
  if (!row) return permanentError(`${prefix} is invalid`, { code: `CONNECTION_${prefix}_INVALID` });
  if (row.consumedAt !== null) {
    return permanentError(`${prefix} was already consumed`, { code: `CONNECTION_${prefix}_REPLAYED` });
  }
  if (row.expiresAt < input.now) {
    return permanentError(`${prefix} has expired`, { code: `CONNECTION_${prefix}_EXPIRED` });
  }
  return permanentError(`${prefix} binding validation failed`, {
    code: `CONNECTION_${prefix}_MISMATCH`,
  });
}

function classifyInvitationAttemptFailure(row, input) {
  if (!row) {
    return permanentError('Invitation is invalid', {
      code: 'CONNECTION_INVITATION_INVALID',
    });
  }
  if (
    row.connectorKey !== input.connectorKey
    || row.customerKey !== input.customerKey
    || row.nonceHash !== input.nonceHash
    || row.maxAttempts !== input.maxAttempts
  ) {
    return permanentError('Invitation binding validation failed', {
      code: 'CONNECTION_INVITATION_MISMATCH',
    });
  }
  if (row.consumedAt !== null) {
    return permanentError('Invitation was already completed', {
      code: 'CONNECTION_INVITATION_REPLAYED',
    });
  }
  if (row.expiresAt < input.now) {
    return permanentError('Invitation has expired', {
      code: 'CONNECTION_INVITATION_EXPIRED',
    });
  }
  if (row.attemptCount >= row.maxAttempts) {
    return permanentError('Invitation retry limit was reached', {
      code: 'CONNECTION_INVITATION_ATTEMPTS_EXHAUSTED',
    });
  }
  if (
    row.activeAttemptId
    && row.activeAttemptExpiresAt !== null
    && row.activeAttemptExpiresAt >= input.now
  ) {
    return permanentError('Invitation already has an active OAuth attempt', {
      code: 'CONNECTION_INVITATION_ATTEMPT_ACTIVE',
      details: { retryAt: row.activeAttemptExpiresAt },
    });
  }
  return permanentError('Invitation attempt cannot be reserved', {
    code: 'CONNECTION_INVITATION_RESERVATION_REJECTED',
  });
}

function classifyInvitationCompletionFailure(row, input) {
  if (!row) {
    return permanentError('Invitation is invalid', {
      code: 'CONNECTION_INVITATION_INVALID',
    });
  }
  if (
    row.connectorKey !== input.connectorKey
    || row.customerKey !== input.customerKey
    || (row.connectionId !== null && row.connectionId !== input.connectionId)
    || (row.activeAttemptId !== null && row.activeAttemptId !== input.attemptId)
  ) {
    return permanentError('Invitation attempt binding validation failed', {
      code: 'CONNECTION_INVITATION_MISMATCH',
    });
  }
  if (row.consumedAt !== null) {
    return permanentError('Invitation was already completed', {
      code: 'CONNECTION_INVITATION_REPLAYED',
    });
  }
  if (row.expiresAt < input.now) {
    return permanentError('Invitation has expired', {
      code: 'CONNECTION_INVITATION_EXPIRED',
    });
  }
  return permanentError('Invitation attempt is no longer active', {
    code: 'CONNECTION_INVITATION_ATTEMPT_INACTIVE',
  });
}

function classifyIdentitySelectionFailure(row, input) {
  if (row.consumedAt !== null) {
    return permanentError('Identity selection was already consumed', {
      code: 'CONNECTION_IDENTITY_SELECTION_REPLAYED',
    });
  }
  if (row.expiresAt < input.now) {
    return permanentError('Identity selection has expired', {
      code: 'CONNECTION_IDENTITY_SELECTION_EXPIRED',
    });
  }
  return permanentError('Identity selection binding validation failed', {
    code: 'CONNECTION_IDENTITY_SELECTION_MISMATCH',
  });
}

async function run(statement, code) {
  try {
    return await statement.run();
  } catch (cause) {
    throw transientError('Customer connection D1 write failed', { code, cause });
  }
}

async function first(statement, code) {
  try {
    return await statement.first();
  } catch (cause) {
    throw transientError('Customer connection D1 read failed', { code, cause });
  }
}

async function batch(db, statements, code) {
  try {
    return await db.batch(statements);
  } catch (cause) {
    throw transientError('Customer connection D1 transaction failed', { code, cause });
  }
}

function readChanges(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

function requireD1(value) {
  if (
    typeof value?.prepare !== 'function'
    || typeof value?.batch !== 'function'
  ) throw new TypeError('D1CustomerConnectionStore requires D1 prepare() and batch()');
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = typeof value === 'string' ? value.trim() : String(value).trim();
  return text || null;
}

function requireHttpsUrl(value, fieldName) {
  const url = new URL(requireText(value, fieldName));
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new TypeError(`${fieldName} must use HTTPS`);
  }
  return url.toString();
}

function requireTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be a timestamp`);
  return number;
}

function requireBoundedInteger(value, fieldName, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new TypeError(`${fieldName} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}

function optionalTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  return requireTimestamp(value, 'timestamp');
}

function normalizeJsonObject(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('providerMetadata must be an object');
  }
  return JSON.stringify(value);
}

function parseJsonObject(value) {
  if (!value) return Object.freeze({});
  try {
    const parsed = JSON.parse(value);
    return Object.freeze(
      parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {},
    );
  } catch {
    return Object.freeze({});
  }
}

function normalizeTextArray(value) {
  if (!Array.isArray(value)) throw new TypeError('grantedScopes must be an array');
  return [...new Set(value.map((item) => requireText(item, 'grantedScope')))].sort();
}

function parseJsonArray(value) {
  if (!value) return Object.freeze([]);
  try {
    const parsed = JSON.parse(value);
    return Object.freeze(normalizeTextArray(parsed));
  } catch {
    return Object.freeze([]);
  }
}

function parseJsonValueArray(value) {
  if (!value) return Object.freeze([]);
  try {
    const parsed = JSON.parse(value);
    return Object.freeze(Array.isArray(parsed) ? parsed : []);
  } catch {
    return Object.freeze([]);
  }
}
