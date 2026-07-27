import { YouTubeApiClient } from './youtube-api.client.js';
import { YouTubeOAuthTokenProvider } from './youtube-oauth-token-provider.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';
import { isPlaceholderConfigValue } from '../../../shared/src/config/placeholder-value.js';

/** สร้าง Public Data client และ Owner Analytics client จาก Secret environment แบบ fail-closed */
export function createYouTubeClientsFromEnv(env = {}, options = {}) {
  const apiKey = readCredential(env.YOUTUBE_API_KEY, 'YOUTUBE_API_KEY');
  if (options.publicApiKeyOnly === true && !apiKey) {
    throw permanentError('YouTube Worker dry-run requires YOUTUBE_API_KEY for public GET-only access', {
      code: 'YOUTUBE_DRY_RUN_API_KEY_REQUIRED',
      details: { fieldName: 'YOUTUBE_API_KEY' },
    });
  }
  if (options.publicApiKeyOnly === true) {
    const requestMetrics = { publicRequests: 0 };
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new TypeError('YouTube public-only client requires fetch');
    }
    return Object.freeze({
      publicClient: new YouTubeApiClient({
        fetchImpl: (...args) => {
          requestMetrics.publicRequests += 1;
          return fetchImpl(...args);
        },
        timeoutMs: readPositiveInteger(env.YOUTUBE_API_TIMEOUT_MS, 30_000),
        maxPages: readPositiveInteger(env.YOUTUBE_MAX_PAGES, 100),
        apiKey,
        accessToken: null,
        accessTokenProvider: null,
      }),
      ownerClient: null,
      oauthConfigured: false,
      requestMetrics,
    });
  }
  const staticAccessToken = readCredential(env.YOUTUBE_OAUTH_ACCESS_TOKEN, 'YOUTUBE_OAUTH_ACCESS_TOKEN');
  const refreshConfig = readRefreshConfig(env);
  const tokenProvider = refreshConfig
    ? new YouTubeOAuthTokenProvider({ ...refreshConfig, fetchImpl: options.fetchImpl })
    : null;

  if (!apiKey && !staticAccessToken && !tokenProvider) {
    throw permanentError('YouTube DEV access requires YOUTUBE_API_KEY or OAuth credentials', {
      code: 'YOUTUBE_CREDENTIALS_REQUIRED',
    });
  }

  const common = {
    fetchImpl: options.fetchImpl,
    timeoutMs: readPositiveInteger(env.YOUTUBE_API_TIMEOUT_MS, 30_000),
    maxPages: readPositiveInteger(env.YOUTUBE_MAX_PAGES, 100),
  };
  const publicClient = new YouTubeApiClient({
    ...common,
    apiKey,
    accessToken: apiKey ? null : staticAccessToken,
    accessTokenProvider: apiKey ? null : tokenProvider,
  });
  const ownerClient = staticAccessToken || tokenProvider
    ? new YouTubeApiClient({
      ...common,
      apiKey,
      accessToken: staticAccessToken,
      accessTokenProvider: tokenProvider,
    })
    : null;

  return Object.freeze({ publicClient, ownerClient, oauthConfigured: ownerClient !== null });
}

function readRefreshConfig(env) {
  const clientId = readCredential(env.YOUTUBE_OAUTH_CLIENT_ID, 'YOUTUBE_OAUTH_CLIENT_ID');
  const clientSecret = readCredential(env.YOUTUBE_OAUTH_CLIENT_SECRET, 'YOUTUBE_OAUTH_CLIENT_SECRET');
  const refreshToken = readCredential(env.YOUTUBE_OAUTH_REFRESH_TOKEN, 'YOUTUBE_OAUTH_REFRESH_TOKEN');
  const populated = [clientId, clientSecret, refreshToken].filter(Boolean).length;
  if (populated === 0) return null;
  if (populated !== 3) {
    throw permanentError('YouTube OAuth refresh configuration is incomplete', {
      code: 'YOUTUBE_OAUTH_CONFIG_INVALID',
      details: {
        missing: [
          !clientId && 'YOUTUBE_OAUTH_CLIENT_ID',
          !clientSecret && 'YOUTUBE_OAUTH_CLIENT_SECRET',
          !refreshToken && 'YOUTUBE_OAUTH_REFRESH_TOKEN',
        ].filter(Boolean),
      },
    });
  }
  return { clientId, clientSecret, refreshToken };
}


function readCredential(value, fieldName) {
  const text = optionalText(value);
  if (!text) return null;
  if (isPlaceholderConfigValue(text)) {
    throw permanentError(`YouTube credential ${fieldName} is still a placeholder`, {
      code: 'YOUTUBE_CREDENTIAL_PLACEHOLDER',
      details: { fieldName },
    });
  }
  return text;
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new TypeError('YouTube environment values must be strings');
  return value.trim() || null;
}

function readPositiveInteger(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError('YouTube numeric environment value must be positive');
  return number;
}
