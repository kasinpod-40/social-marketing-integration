const ACCOUNT_ID = /^[0-9a-f]{32}$/iu;

/**
 * Read-only Queue inventory through the documented Cloudflare REST endpoint.
 * This avoids depending on Wrangler table output or removed CLI JSON flags.
 */
export async function listCloudflareQueuesViaApi(input = {}) {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (typeof fetchImpl !== 'function') {
    throw queueListError(
      'Cloudflare Queue inventory requires fetch',
      'CLOUDFLARE_QUEUE_LIST_FETCH_REQUIRED',
    );
  }
  const accountId = requireAccountId(input.accountId);
  const bearerToken = requireSecretText(input.bearerToken, 'bearerToken');
  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/queues`,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${bearerToken}` },
      signal: AbortSignal.timeout(Number(input.timeoutMs ?? 30_000)),
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true || !Array.isArray(body?.result)) {
    throw queueListError(
      'Cloudflare Queue inventory request failed',
      'CLOUDFLARE_QUEUE_LIST_FAILED',
      { status: Number(response.status ?? 0) },
    );
  }
  return Object.freeze({
    success: true,
    result: Object.freeze(body.result.map((item) => Object.freeze({ ...item }))),
  });
}

function requireAccountId(value) {
  const text = requireSecretText(value, 'accountId');
  if (!ACCOUNT_ID.test(text)) {
    throw queueListError(
      'Cloudflare account identity is invalid',
      'CLOUDFLARE_QUEUE_LIST_ACCOUNT_INVALID',
    );
  }
  return text;
}

function requireSecretText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw queueListError(
      `Cloudflare Queue inventory requires ${fieldName}`,
      'CLOUDFLARE_QUEUE_LIST_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return value.trim();
}

function queueListError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'CloudflareQueueListError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
