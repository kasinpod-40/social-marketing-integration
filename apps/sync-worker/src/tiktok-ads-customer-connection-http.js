import {
  TikTokAdsCustomerOAuthFlow,
} from '../../../packages/application/src/connections/tiktok-ads-customer-oauth-flow.js';
import {
  TikTokAdsApiClient,
} from '../../../packages/connectors/src/tiktok-ads/tiktok-ads-api.client.js';
import {
  TikTokAdsOAuthClient,
} from '../../../packages/connectors/src/tiktok-ads/tiktok-ads-oauth.client.js';
import {
  createCustomerConnectionRuntime,
  loadTikTokAdsRuntimeConfig,
} from './customer-connection-runtime.js';
import { json } from '../../../packages/shared/src/http/response.js';
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

export function createTikTokAdsCustomerConnectionHttpHandler(dependencies = {}) {
  const runtimeFactory = dependencies.createRuntime ?? createCustomerConnectionRuntime;
  const flowFactory = dependencies.createFlow ?? createFlow;

  return async function handleTikTokAdsConnection({ request, env, url }) {
    if (request.method === 'GET' && url.pathname === TIKTOK_ADS_CONNECTION_PATHS.connect) {
      const flow = flowFactory(runtimeFactory(env), env);
      const preview = await flow.preview(requireConnectionQuery(url, 'invitation'));
      return connectionConfirmationPage({
        connectorLabel: 'TikTok Ads',
        preview,
      });
    }
    if (request.method === 'POST' && url.pathname === TIKTOK_ADS_CONNECTION_PATHS.connect) {
      await requireConnectionConfirmation(request);
      const flow = flowFactory(runtimeFactory(env), env);
      const location = await flow.begin(requireConnectionQuery(url, 'invitation'));
      return new Response(null, {
        status: 303,
        headers: connectionSecurityHeaders({ location }),
      });
    }
    if (request.method === 'GET' && url.pathname === TIKTOK_ADS_CONNECTION_PATHS.callback) {
      const flow = flowFactory(runtimeFactory(env), env);
      const result = await flow.complete({
        state: requireConnectionQuery(url, 'state'),
        code: url.searchParams.get('auth_code') ?? url.searchParams.get('code') ?? undefined,
        oauthError: url.searchParams.get('error') ?? url.searchParams.get('error_code') ?? undefined,
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
  const oauthClient = new TikTokAdsOAuthClient(config);
  const adsClient = new TikTokAdsApiClient(config);
  return new TikTokAdsCustomerOAuthFlow({
    shared: runtime.service,
    oauthClient,
    adsClient,
    credentials: runtime.credentials,
    store: runtime.store,
    redirectUri: config.redirectUri,
    environment: runtime.config.environment,
    approvedAdvertiserId: config.approvedAdvertiserId,
  });
}
