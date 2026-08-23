import { D1CustomerConnectionStore } from '../../../packages/connectors/src/d1-customer-connection-store.js';
import { EncryptedCustomerCredentialRepository } from '../../../packages/connectors/src/encrypted-customer-credential-repository.js';
import { timingSafeEqualText } from '../../../packages/shared/src/security/secure-token.js';
import { json } from '../../../packages/shared/src/http/response.js';
import {
  loadCustomerCredentialRuntimeConfig,
} from './customer-connection-runtime.js';
import {
  readBoundedConnectionJson,
  requireConnectionText,
} from './customer-connection-http-utils.js';

export const YOUTUBE_CREDENTIAL_REWRAP_PATH = '/operator/youtube/credential-rewrap';
export const YOUTUBE_CREDENTIAL_REWRAP_CONFIRMATION =
  'REWRAP_EXISTING_CUSTOMER_YOUTUBE_REFRESH_TOKEN';

/**
 * One-shot operator boundary สำหรับ rewrap Refresh Token เดิมใน Integration Worker memory.
 * ปิดโดย default และไม่คืน plaintext/ciphertext/key material ใน response หรือ log.
 */
export function createYouTubeCredentialRewrapHttpHandler(dependencies = {}) {
  const configLoader = dependencies.loadConfig ?? loadCustomerCredentialRuntimeConfig;
  const storeFactory = dependencies.createStore
    ?? ((env) => new D1CustomerConnectionStore({ db: requireD1(env) }));
  const repositoryFactory = dependencies.createRepository
    ?? ((store, config) => new EncryptedCustomerCredentialRepository({
      store,
      keyVersion: config.encryptionKeyVersion,
      keys: config.encryptionKeys,
    }));

  return async function handleYouTubeCredentialRewrap({ request, env, url }) {
    if (url.pathname !== YOUTUBE_CREDENTIAL_REWRAP_PATH) return null;
    if (!readBoolean(env?.MKT_YOUTUBE_CREDENTIAL_REWRAP_ENABLED, false)) {
      return json({ ok: false, error: 'Route not found' }, {
        status: 404,
        headers: { 'cache-control': 'no-store' },
      });
    }
    await requireOperatorAuthorization(request, env?.MKT_CONNECTION_OPERATOR_TOKEN);
    const config = configLoader(env);
    if (config.environment !== 'development' || config.customerProfile !== 'integration_workspace') {
      throw rewrapError(
        'YouTube credential rewrap is restricted to the Integration Workspace',
        'YOUTUBE_CREDENTIAL_REWRAP_ENVIRONMENT_BLOCKED',
      );
    }
    const body = await readBoundedConnectionJson(request);
    requireExact(
      body.confirmation,
      YOUTUBE_CREDENTIAL_REWRAP_CONFIRMATION,
      'confirmation',
    );
    const connectionId = requireConnectionText(body.connectionId, 'connectionId');
    const credentialReference = requireConnectionText(
      body.credentialReference,
      'credentialReference',
    );
    const sourceKeyVersion = requireConnectionText(body.sourceKeyVersion, 'sourceKeyVersion');
    const targetKeyVersion = requireConnectionText(body.targetKeyVersion, 'targetKeyVersion');
    requireExact(targetKeyVersion, config.encryptionKeyVersion, 'targetKeyVersion');
    if (!config.encryptionKeyVersions.includes(sourceKeyVersion)) {
      throw rewrapError(
        'YouTube credential source key is unavailable',
        'YOUTUBE_CREDENTIAL_REWRAP_SOURCE_KEY_UNAVAILABLE',
      );
    }

    const store = storeFactory(env);
    const connection = await store.getConnection(connectionId);
    if (
      connection?.customerKey !== 'chemistry_k'
      || connection?.connectorKey !== 'youtube'
      || connection?.connectionStatus !== 'connected'
      || connection?.accessStatus !== 'validated'
      || connection?.credentialReference !== credentialReference
    ) {
      throw rewrapError(
        'YouTube Customer Connection is not the exact active validated credential',
        'YOUTUBE_CREDENTIAL_REWRAP_CONNECTION_MISMATCH',
      );
    }
    const result = await repositoryFactory(store, config).rewrap({
      connectionId,
      connectorKey: 'youtube',
      credentialKind: 'refresh_token',
      credentialReference,
      sourceKeyVersion,
    });
    return json({
      ok: true,
      rewrap: {
        connectionId,
        previousCredentialReference: result.previousReference,
        credentialReference: result.credentialReference,
        sourceKeyVersion: result.sourceKeyVersion,
        keyVersion: result.keyVersion,
      },
    }, {
      status: 200,
      headers: {
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      },
    });
  };
}

async function requireOperatorAuthorization(request, expectedToken) {
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer[ \t]+(.+)$/iu.exec(authorization);
  const supplied = match?.[1]?.trim() ?? '';
  const expected = requireConnectionText(expectedToken, 'operatorToken');
  if (!match || !await timingSafeEqualText(supplied, expected)) {
    throw rewrapError('Operator authorization was rejected', 'CONNECTION_OPERATOR_UNAUTHORIZED');
  }
}

function requireD1(env) {
  const db = env?.MKT_STATE_DB;
  if (typeof db?.prepare !== 'function' || typeof db?.batch !== 'function') {
    throw rewrapError('MKT_STATE_DB binding is required', 'YOUTUBE_CREDENTIAL_REWRAP_CONFIG_INVALID');
  }
  return db;
}

function requireExact(value, expected, fieldName) {
  if (requireConnectionText(value, fieldName) !== expected) {
    throw rewrapError(
      `${fieldName} does not match the reviewed rewrap contract`,
      'YOUTUBE_CREDENTIAL_REWRAP_REQUEST_MISMATCH',
    );
  }
}

function readBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === false) return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw rewrapError(
    'MKT_YOUTUBE_CREDENTIAL_REWRAP_ENABLED must be true or false',
    'YOUTUBE_CREDENTIAL_REWRAP_CONFIG_INVALID',
  );
}

function rewrapError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
