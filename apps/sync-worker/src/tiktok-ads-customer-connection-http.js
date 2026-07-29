import { TikTokAdsCustomerOAuthFlow } from '../../../packages/application/src/connections/tiktok-ads-customer-oauth-flow.js';
import { TikTokAdsOAuthClient } from '../../../packages/connectors/src/tiktok-ads/tiktok-ads-oauth.client.js';
import { TikTokAdsApiClient } from '../../../packages/connectors/src/tiktok-ads/tiktok-ads-api.client.js';
import { json } from '../../../packages/shared/src/http/response.js';
import {
  createCustomerConnectionRuntime,
  loadTikTokAdsRuntimeConfig,
} from './customer-connection-runtime.js';
import {
  connectionConfirmationPage,
  connectionSecurityHeaders,
  requireConnectionConfirmation,
  requireConnectionQuery,
} from './customer-connection-http-utils.js';

export const TIKTOK_ADS_CONNECTION_PATHS = Object.freeze({
  connect: '/connect/tiktok-ads',
  callback: '/oauth/tiktok-ads/callback',
});

/** TikTok Ads consent/callback adapter only. No Queue, Lark, schedule or Business write. */
export function createTikTokAdsCustomerConnectionHttpHandler(dependencies = {}) {
  const runtimeFactory = dependencies.createRuntime ?? createCustomerConnectionRuntime;
  const flowFactory = dependencies.createFlow ?? createFlow;

  return async function handleTikTokAdsConnection({ request, env, url }) {
    if (request.method === 'GET' && url.pathname === TIKTOK_ADS_CONNECTION_PATHS.connect) {
      const preview = await flowFactory(runtimeFactory(env), env).preview(
        requireConnectionQuery(url, 'invitation'),
      );
      return connectionConfirmationPage({ connectorLabel: 'TikTok Ads', preview });
    }
    if (request.method === 'POST' && url.pathname === TIKTOK_ADS_CONNECTION_PATHS.connect) {
      await requireConnectionConfirmation(request);
      const location = await flowFactory(runtimeFactory(env), env).begin(
        requireConnectionQuery(url, 'invitation'),
      );
      return new Response(null, {
        status: 303,
        headers: connectionSecurityHeaders({ location }),
      });
    }
    if (request.method === 'GET' && url.pathname === TIKTOK_ADS_CONNECTION_PATHS.callback) {
      const result = await flowFactory(runtimeFactory(env), env).complete({
        state: requireConnectionQuery(url, 'state'),
        code: url.searchParams.get('auth_code') ?? url.searchParams.get('code') ?? undefined,
        oauthError: url.searchParams.get('error') ?? undefined,
      });
      return json({ ok: true, connection: result }, {
        status: 200,
        headers: connectionSecurityHeaders(),
      });
    }
    return null;
  };
}

function createFlow(runtime, env) {
  const config = loadTikTokAdsRuntimeConfig(env);
  return new TikTokAdsCustomerOAuthFlow({
    shared: runtime.service,
    oauthClient: new TikTokAdsOAuthClient({
      appId: config.appId,
      appSecret: config.appSecret,
    }),
    adsClient: new TikTokAdsApiClient(),
    credentials: runtime.credentials,
    store: runtime.store,
    redirectUri: config.redirectUri,
    environment: runtime.config.environment,
    approvedAdvertiserId: config.advertiserId,
  });
}
