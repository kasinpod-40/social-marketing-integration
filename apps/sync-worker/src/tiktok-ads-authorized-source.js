import { TikTokAdsApiClient } from '../../../packages/connectors/src/tiktok-ads/tiktok-ads-api.client.js';
import { timingSafeEqualText } from '../../../packages/shared/src/security/secure-token.js';
import {
  createCustomerConnectionRuntime,
  loadTikTokAdsRuntimeConfig,
} from './customer-connection-runtime.js';

/** Reuse the exact operator/Production/customer/advertiser/credential boundary for read and D1-only routes. */
export async function loadTikTokAdsAuthorizedSource({ request, env, dependencies = {}, validateRequest }) {
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer[ \t]+(.+)$/iu.exec(authorization);
  const valid = await timingSafeEqualText(match?.[1]?.trim() ?? '', env?.MKT_CONNECTION_OPERATOR_TOKEN);
  if (!match || !valid) return Object.freeze({ status: 401 });
  if (typeof validateRequest === 'function' && !validateRequest()) {
    return Object.freeze({ status: 400 });
  }

  // Preview entry เรียกก่อน Worker hydration ปกติ จึง hydrate หลัง auth/query guard เท่านั้น
  const runtimeEnv = dependencies.hydrateAuthorizedEnv
    ? await dependencies.hydrateAuthorizedEnv(env)
    : env;
  return loadTikTokAdsRuntimeSource({ env: runtimeEnv, dependencies });
}

/** Exact runtime/grant/credential boundary shared by authenticated HTTP and internal Queue. */
export async function loadTikTokAdsRuntimeSource({ env: runtimeEnv, dependencies = {} }) {
  const createRuntime = dependencies.createRuntime ?? createCustomerConnectionRuntime;
  const loadAdsConfig = dependencies.loadAdsConfig ?? loadTikTokAdsRuntimeConfig;
  const createClient = dependencies.createClient ?? ((config) => new TikTokAdsApiClient(config));
  const runtime = createRuntime(runtimeEnv);
  if (runtime.config.environment !== 'production'
    || runtime.config.customerProfile !== 'chemistry_k'
    || runtime.config.customerKey !== 'chemistry_k') {
    throw new Error('TikTok Ads source requires the exact customer Production runtime');
  }
  const adsConfig = loadAdsConfig(runtimeEnv);
  const connection = await runtime.store.findConnectionByCustomerConnector({
    customerKey: runtime.config.customerKey,
    connectorKey: 'tiktok_ads',
  });
  if (!connection || connection.connectionStatus !== 'connected'
    || connection.accessStatus !== 'validated'
    || !connection.credentialReference
    || !/^\d+$/u.test(connection.externalAccountId ?? '')
    || (adsConfig.approvedAdvertiserId
      && connection.externalAccountId !== adsConfig.approvedAdvertiserId)) {
    return Object.freeze({ status: 409 });
  }
  const accessToken = await runtime.credentials.read({
    credentialReference: connection.credentialReference,
    connectionId: connection.connectionId,
    connectorKey: 'tiktok_ads',
    credentialKind: 'access_token',
  });
  return Object.freeze({
    status: 200,
    runtime,
    connection,
    accessToken,
    client: createClient(adsConfig),
  });
}
