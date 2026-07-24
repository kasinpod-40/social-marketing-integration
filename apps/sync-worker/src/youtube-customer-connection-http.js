import {
  YouTubeCustomerOAuthFlow,
} from '../../../packages/application/src/connections/youtube-customer-oauth-flow.js';
import { GoogleOAuthClient } from '../../../packages/connectors/src/google/google-oauth.client.js';
import { YouTubeApiClient } from '../../../packages/connectors/src/youtube/youtube-api.client.js';
import {
  createCustomerConnectionRuntime,
  loadGoogleOAuthRuntimeConfig,
} from './customer-connection-runtime.js';
import { json } from '../../../packages/shared/src/http/response.js';
import {
  connectionConfirmationPage,
  connectionSecurityHeaders,
  readBoundedConnectionJson,
  requireConnectionConfirmation,
  requireConnectionQuery,
  requireConnectionText,
} from './customer-connection-http-utils.js';

export const YOUTUBE_CONNECTION_PATHS = Object.freeze({
  connect: '/connect/youtube',
  callback: '/oauth/youtube/callback',
  select: '/oauth/youtube/select-channel',
});

/** HTTP adapter สำหรับ YouTube consent/callback/explicit channel selection */
export function createYouTubeCustomerConnectionHttpHandler(dependencies = {}) {
  const runtimeFactory = dependencies.createRuntime ?? createCustomerConnectionRuntime;
  const flowFactory = dependencies.createFlow ?? createFlow;

  return async function handleYouTubeConnection({ request, env, url }) {
    if (request.method === 'GET' && url.pathname === YOUTUBE_CONNECTION_PATHS.connect) {
      const preview = await flowFactory(runtimeFactory(env), env).preview(
        requireConnectionQuery(url, 'invitation'),
      );
      return connectionConfirmationPage({
        connectorLabel: 'YouTube',
        preview,
      });
    }
    if (request.method === 'POST' && url.pathname === YOUTUBE_CONNECTION_PATHS.connect) {
      await requireConnectionConfirmation(request);
      const location = await flowFactory(runtimeFactory(env), env).begin(
        requireConnectionQuery(url, 'invitation'),
      );
      return new Response(null, {
        status: 303,
        headers: connectionSecurityHeaders({ location }),
      });
    }
    if (request.method === 'GET' && url.pathname === YOUTUBE_CONNECTION_PATHS.callback) {
      const result = await flowFactory(runtimeFactory(env), env).complete({
        state: requireConnectionQuery(url, 'state'),
        code: url.searchParams.get('code') ?? undefined,
        oauthError: url.searchParams.get('error') ?? undefined,
      });
      return json({ ok: true, connection: result }, {
        status: 200,
        headers: connectionSecurityHeaders(),
      });
    }
    if (request.method === 'POST' && url.pathname === YOUTUBE_CONNECTION_PATHS.select) {
      const body = await readBoundedConnectionJson(request);
      const result = await flowFactory(runtimeFactory(env), env).select({
        selectionToken: requireConnectionText(body.selectionToken, 'selectionToken'),
        channelId: requireConnectionText(body.channelId, 'channelId'),
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
  const oauthClient = new GoogleOAuthClient(loadGoogleOAuthRuntimeConfig(env));
  return new YouTubeCustomerOAuthFlow({
    shared: runtime.service,
    oauthClient,
    youtubeClientFactory: (accessToken) => new YouTubeApiClient({ accessToken }),
    credentials: runtime.credentials,
    store: runtime.store,
    redirectUri: runtime.config.redirectUris.youtube,
    environment: runtime.config.environment,
    selectionSigningKey: runtime.config.selectionSigningKey,
  });
}
