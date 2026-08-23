import { assertYouTubeOwnerAuthorization } from '../../../packages/application/src/connections/youtube-owner-authorization.js';
import { D1CustomerConnectionStore } from '../../../packages/connectors/src/d1-customer-connection-store.js';
import { EncryptedCustomerCredentialRepository } from '../../../packages/connectors/src/encrypted-customer-credential-repository.js';
import {
  EncryptedCustomerRefreshTokenCredentialAdapter,
  GoogleRefreshTokenAccessProvider,
} from '../../../packages/connectors/src/google/google-refresh-token-provider.js';
import { GoogleOAuthClient } from '../../../packages/connectors/src/google/google-oauth.client.js';
import { D1YouTubeCustomerConnectionReadStore } from '../../../packages/connectors/src/youtube/d1-youtube-customer-connection-read-store.js';
import { YouTubeApiClient } from '../../../packages/connectors/src/youtube/youtube-api.client.js';
import { createYouTubeClientsFromEnv } from '../../../packages/connectors/src/youtube/youtube-runtime-factory.js';
import {
  loadCustomerCredentialRuntimeConfig,
  loadGoogleOAuthRuntimeConfig,
} from './customer-connection-runtime.js';

/**
 * Public reads ใช้ API key เดิม ส่วน Analytics-enabled path ต้องใช้ Dynamic Customer Connection
 * จาก D1 เท่านั้น จึงไม่มี legacy static OAuth fallback ใน Queue/Cron runtime.
 */
export async function createYouTubeRuntimeClients(env = {}, options = {}) {
  const publicApiKeyOnly = options.publicApiKeyOnly === true;
  const analyticsEnabled = options.analyticsEnabled === true;
  const publicClients = createYouTubeClientsFromEnv(env, {
    publicApiKeyOnly: true,
    fetchImpl: options.fetchImpl,
  });
  if (publicApiKeyOnly || !analyticsEnabled) return publicClients;

  const channelId = requireText(options.channelId, 'channelId');
  const requestedCustomerKey = requireText(options.customerKey, 'customerKey');
  const config = loadCustomerCredentialRuntimeConfig(env);
  if (config.customerKey !== requestedCustomerKey) {
    throw new TypeError('YouTube runtime customerKey must match Customer Connection configuration');
  }

  const db = requireD1(env);
  const connectionStore = options.connectionStore
    ?? new D1YouTubeCustomerConnectionReadStore({ db });
  const authorization = await assertYouTubeOwnerAuthorization({
    connectionStore,
    customerKey: requestedCustomerKey,
    channelId,
  });

  const credentialStore = options.credentialStore ?? new D1CustomerConnectionStore({ db });
  const credentialRepository = options.credentialRepository
    ?? new EncryptedCustomerCredentialRepository({
      store: credentialStore,
      keyVersion: config.encryptionKeyVersion,
      keys: config.encryptionKeys,
    });
  const credentialAdapter = new EncryptedCustomerRefreshTokenCredentialAdapter({
    repository: credentialRepository,
    connectionId: authorization.connectionId,
    connectorKey: 'youtube',
    credentialReference: authorization.credentialReference,
  });
  const oauthClient = options.oauthClient ?? new GoogleOAuthClient({
    ...loadGoogleOAuthRuntimeConfig(env),
    fetchImpl: options.fetchImpl,
  });
  const accessTokenProvider = new GoogleRefreshTokenAccessProvider({
    oauthClient,
    credentialAdapter,
    clock: options.clock,
  });
  const ownerClientFactory = options.ownerClientFactory
    ?? ((clientConfig) => new YouTubeApiClient(clientConfig));
  const ownerClient = ownerClientFactory({
    fetchImpl: options.fetchImpl,
    timeoutMs: readPositiveInteger(env.YOUTUBE_API_TIMEOUT_MS, 30_000),
    maxPages: readPositiveInteger(env.YOUTUBE_MAX_PAGES, 100),
    accessTokenProvider,
  });

  return Object.freeze({
    publicClient: publicClients.publicClient,
    ownerClient,
    oauthConfigured: true,
    credentialSource: authorization.authorizationSource,
  });
}

function requireD1(env) {
  const db = env?.MKT_STATE_DB;
  if (typeof db?.prepare !== 'function' || typeof db?.batch !== 'function') {
    throw new TypeError('MKT_STATE_DB binding is required for YouTube Customer OAuth');
  }
  return db;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function readPositiveInteger(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError('YouTube client limit must be positive');
  return number;
}
