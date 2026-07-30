import { createHash } from 'node:crypto';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
  resolveWooCommerceQueueId,
} from './woocommerce-final-one-command.js';

const CLOUDFLARE_API_BASE_URL = 'https://api.cloudflare.com/client/v4';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;

export async function discoverWooCommerceQueueId(input = {}) {
  const accountId = resolveCloudflareAccountId({
    explicitAccountId: input.accountId,
  });
  const auth = resolveCloudflareBearerAuth({
    explicitApiToken: input.apiToken,
  });
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw queueDiscoveryError(
      'Cloudflare Queue discovery requires a fetch implementation',
      'WOOCOMMERCE_FINAL_QUEUE_API_FETCH_UNAVAILABLE',
    );
  }

  const timeoutMs = boundedTimeout(input.timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(
      `${CLOUDFLARE_API_BASE_URL}/accounts/${accountId}/queues`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        redirect: 'error',
        signal: controller.signal,
      },
    );
  } catch (cause) {
    throw queueDiscoveryError(
      'Cloudflare Queue inventory request failed',
      'WOOCOMMERCE_FINAL_QUEUE_API_REQUEST_FAILED',
      {
        errorName: cause?.name ?? 'Error',
        timedOut: controller.signal.aborted,
      },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response || typeof response.text !== 'function') {
    throw queueDiscoveryError(
      'Cloudflare Queue inventory returned an invalid response object',
      'WOOCOMMERCE_FINAL_QUEUE_API_RESPONSE_INVALID',
    );
  }

  const body = await response.text();
  const bodySha256 = sha256(body);
  if (response.redirected === true) {
    throw queueDiscoveryError(
      'Cloudflare Queue inventory unexpectedly redirected',
      'WOOCOMMERCE_FINAL_QUEUE_API_REDIRECTED',
      {
        status: response.status ?? null,
        bodySha256,
      },
    );
  }
  if (response.ok !== true) {
    throw queueDiscoveryError(
      'Cloudflare Queue inventory returned a non-success HTTP status',
      'WOOCOMMERCE_FINAL_QUEUE_API_HTTP_FAILED',
      {
        status: response.status ?? null,
        bodySha256,
      },
    );
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch (cause) {
    throw queueDiscoveryError(
      'Cloudflare Queue inventory returned invalid JSON',
      'WOOCOMMERCE_FINAL_QUEUE_API_JSON_INVALID',
      {
        bodySha256,
        errorName: cause?.name ?? 'SyntaxError',
      },
    );
  }

  const result = payload?.result;
  const errorCount = Array.isArray(payload?.errors) ? payload.errors.length : 0;
  if (payload?.success !== true || !Array.isArray(result)) {
    throw queueDiscoveryError(
      'Cloudflare Queue inventory contract was not successful',
      'WOOCOMMERCE_FINAL_QUEUE_API_CONTRACT_INVALID',
      {
        success: payload?.success === true,
        resultIsArray: Array.isArray(result),
        errorCount,
        bodySha256,
      },
    );
  }

  const totalPages = optionalPositiveInteger(payload?.result_info?.total_pages) ?? 1;
  if (totalPages !== 1) {
    throw queueDiscoveryError(
      'Cloudflare Queue inventory requires unsupported pagination',
      'WOOCOMMERCE_FINAL_QUEUE_API_PAGINATION_UNSUPPORTED',
      {
        totalPages,
        resultCount: result.length,
      },
    );
  }

  return resolveWooCommerceQueueId(payload, input.queueName);
}

function boundedTimeout(value) {
  if (value === undefined || value === null) return DEFAULT_TIMEOUT_MS;
  const timeoutMs = Number(value);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw queueDiscoveryError(
      'Cloudflare Queue discovery timeout is invalid',
      'WOOCOMMERCE_FINAL_QUEUE_API_TIMEOUT_INVALID',
      { maximumTimeoutMs: MAX_TIMEOUT_MS },
    );
  }
  return timeoutMs;
}

function optionalPositiveInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw queueDiscoveryError(
      'Cloudflare Queue inventory pagination metadata is invalid',
      'WOOCOMMERCE_FINAL_QUEUE_API_PAGINATION_INVALID',
    );
  }
  return number;
}

function sha256(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

function queueDiscoveryError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommerceFinalQueueDiscoveryError';
  error.code = code;
  error.details = details;
  return error;
}
