import {
  GoogleAdsCustomerOAuthFlow,
} from '../../../packages/application/src/connections/google-ads-customer-oauth-flow.js';
import { GoogleOAuthClient } from '../../../packages/connectors/src/google/google-oauth.client.js';
import { GoogleAdsApiClient } from '../../../packages/connectors/src/google-ads/google-ads-api.client.js';
import {
  createCustomerConnectionRuntime,
  loadGoogleAdsRuntimeConfig,
  loadGoogleOAuthRuntimeConfig,
} from './customer-connection-runtime.js';
import { json } from '../../../packages/shared/src/http/response.js';
import {
  connectionConfirmationPage,
  connectionSecurityHeaders,
  requireConnectionConfirmation,
  requireConnectionQuery,
} from './customer-connection-http-utils.js';

export const GOOGLE_ADS_CONNECTION_PATHS = Object.freeze({
  connect: '/connect/google-ads',
  callback: '/oauth/google-ads/callback',
});

/** HTTP adapter สำหรับ Google Ads consent/callback เท่านั้น; ไม่มี Queue/Lark side effect */
export function createGoogleAdsCustomerConnectionHttpHandler(dependencies = {}) {
  const runtimeFactory = dependencies.createRuntime ?? createCustomerConnectionRuntime;
  const flowFactory = dependencies.createFlow ?? createFlow;

  return async function handleGoogleAdsConnection({ request, env, url }) {
    if (request.method === 'GET' && url.pathname === GOOGLE_ADS_CONNECTION_PATHS.connect) {
      const flow = flowFactory(runtimeFactory(env), env);
      const preview = await flow.preview(requireConnectionQuery(url, 'invitation'));
      return connectionConfirmationPage({
        connectorLabel: 'Google Ads',
        preview,
      });
    }
    if (request.method === 'POST' && url.pathname === GOOGLE_ADS_CONNECTION_PATHS.connect) {
      await requireConnectionConfirmation(request);
      const flow = flowFactory(runtimeFactory(env), env);
      const location = await flow.begin(requireConnectionQuery(url, 'invitation'));
      return new Response(null, {
        status: 303,
        headers: connectionSecurityHeaders({ location }),
      });
    }
    if (request.method === 'GET' && url.pathname === GOOGLE_ADS_CONNECTION_PATHS.callback) {
      const flow = flowFactory(runtimeFactory(env), env);
      const result = await flow.complete({
        state: requireConnectionQuery(url, 'state'),
        code: url.searchParams.get('code') ?? undefined,
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
  const googleOAuth = loadGoogleOAuthRuntimeConfig(env);
  const googleAds = loadGoogleAdsRuntimeConfig(env);
  const oauthClient = new GoogleOAuthClient(googleOAuth);
  const adsClient = new GoogleAdsApiClient({
    developerToken: googleAds.developerToken,
    loginCustomerId: googleAds.managerCustomerId,
    targetCustomerId: googleAds.advertiserCustomerId,
    apiVersion: googleAds.apiVersion,
  });
  return new GoogleAdsCustomerOAuthFlow({
    shared: runtime.service,
    oauthClient,
    adsClient,
    credentials: runtime.credentials,
    store: runtime.store,
    redirectUri: runtime.config.redirectUris.google_ads,
    environment: runtime.config.environment,
    approvedManagerCustomerId: googleAds.managerCustomerId,
    approvedTargetCustomerId: googleAds.advertiserCustomerId,
  });
}
