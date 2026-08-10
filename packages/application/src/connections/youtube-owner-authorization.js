import {
  CUSTOMER_CONNECTION_CONNECTORS,
  GOOGLE_OAUTH_SCOPES,
} from './customer-connection-contract.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const CONNECTOR = CUSTOMER_CONNECTION_CONNECTORS.YOUTUBE;
const REQUIRED_SCOPES = GOOGLE_OAUTH_SCOPES[CONNECTOR];

/** ยืนยัน D1 Customer Connection ก่อนอนุญาตให้ถอดรหัสและ Refresh Owner token */
export async function assertYouTubeOwnerAuthorization(input = {}) {
  const store = requireMethod(input.connectionStore, 'findOwnerAuthorizedConnection');
  const customerKey = requireText(input.customerKey, 'customerKey');
  const channelId = requireText(input.channelId, 'channelId');
  const connection = await store.findOwnerAuthorizedConnection({ customerKey });

  if (!connection) {
    throw permanentError('Validated YouTube customer connection is required', {
      code: 'YOUTUBE_CUSTOMER_CONNECTION_REQUIRED',
    });
  }
  if (connection.customerKey !== customerKey
    || connection.connectorKey !== CONNECTOR
    || connection.connectionStatus !== 'connected'
    || connection.accessStatus !== 'validated') {
    throw permanentError('YouTube customer connection state is inconsistent', {
      code: 'YOUTUBE_CUSTOMER_CONNECTION_STATE_INVALID',
    });
  }
  if (!REQUIRED_SCOPES.every((scope) => connection.grantedScopes?.includes(scope))) {
    throw permanentError('YouTube customer connection scope is insufficient', {
      code: 'YOUTUBE_CUSTOMER_CONNECTION_SCOPE_INSUFFICIENT',
    });
  }
  if (!connection.credentialReference
    || connection.credentialReference !== connection.activeCredentialReference) {
    throw permanentError('YouTube active encrypted credential is unavailable', {
      code: 'YOUTUBE_CUSTOMER_CREDENTIAL_UNAVAILABLE',
    });
  }
  if (connection.externalAccountId !== channelId) {
    throw permanentError('YouTube customer connection channel does not match runtime configuration', {
      code: 'YOUTUBE_CUSTOMER_CONNECTION_CHANNEL_MISMATCH',
    });
  }

  return Object.freeze({
    connectionId: requireText(connection.connectionId, 'connectionId'),
    credentialReference: connection.credentialReference,
    credentialKeyVersion: connection.credentialKeyVersion ?? null,
    customerKey,
    channelId,
    lastValidatedAt: connection.lastValidatedAt ?? null,
    authorizationSource: 'encrypted_customer_connection',
  });
}

function requireMethod(value, method) {
  if (typeof value?.[method] !== 'function') throw new TypeError(`connectionStore.${method} is required`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
