const INSTAGRAM_GRAPH = 'https://graph.instagram.com';
const MIN_REFRESH_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

/** Refresh an Instagram Login grant and verify that Meta returned the expected account. */
export async function refreshInstagramToken(input = {}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? Date.now;
  const currentToken = required(input.currentToken);
  const expectedAccountId = required(input.expectedAccountId);

  // Meta requires the old token in this query. Never log the URL or provider body.
  const refreshUrl = new URL('/refresh_access_token', INSTAGRAM_GRAPH);
  refreshUrl.searchParams.set('grant_type', 'ig_refresh_token');
  refreshUrl.searchParams.set('access_token', currentToken);
  const refreshed = await requestJson(fetchImpl, refreshUrl, { method: 'GET' }, 'META_IG_REFRESH_FAILED');
  const token = required(refreshed?.access_token);
  const expiresIn = Number(refreshed?.expires_in);
  if (!Number.isSafeInteger(expiresIn) || expiresIn < MIN_REFRESH_LIFETIME_SECONDS) {
    throw renewalError('META_IG_REFRESH_RESPONSE_INVALID');
  }

  const identity = await requestJson(fetchImpl, new URL('/me?fields=user_id', INSTAGRAM_GRAPH), {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
  }, 'META_IG_REFRESH_IDENTITY_FAILED');
  if (String(identity?.user_id ?? identity?.id ?? '') !== expectedAccountId) {
    throw renewalError('META_IG_REFRESH_IDENTITY_MISMATCH');
  }
  return Object.freeze({ token, expiresAt: now() + expiresIn * 1_000 });
}

async function requestJson(fetchImpl, url, init, errorCode) {
  let response;
  try {
    response = await fetchImpl(url.toString(), { ...init, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw renewalError(errorCode);
  }
  if (!response?.ok) throw renewalError(errorCode);
  try {
    return await response.json();
  } catch {
    throw renewalError(errorCode);
  }
}

function required(value) {
  if (typeof value !== 'string' || value.trim() === '') throw renewalError('META_IG_RENEWAL_CONFIG_INVALID');
  return value.trim();
}

function renewalError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
