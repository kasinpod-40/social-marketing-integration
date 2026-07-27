export function normalizeCloudflareQueueConsumerPayload(value) {
  if (Array.isArray(value)) {
    return value.map((consumer, index) => normalizeConsumer(consumer, index));
  }
  if (!value || typeof value !== 'object') {
    throw contractError(
      'Cloudflare Queue consumer response must be an object or array',
      'CLOUDFLARE_QUEUE_CONSUMER_RESPONSE_INVALID',
    );
  }
  if (Array.isArray(value.result)) {
    return {
      ...value,
      result: value.result.map((consumer, index) => normalizeConsumer(consumer, index)),
    };
  }
  if (Array.isArray(value.consumers)) {
    return {
      ...value,
      consumers: value.consumers.map((consumer, index) => normalizeConsumer(consumer, index)),
    };
  }
  return normalizeConsumer(value, 0);
}

function normalizeConsumer(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw contractError(
      'Cloudflare Queue consumer entry must be an object',
      'CLOUDFLARE_QUEUE_CONSUMER_ENTRY_INVALID',
      { index },
    );
  }
  const rawSettings = value.settings;
  if (rawSettings !== undefined
    && (!rawSettings || typeof rawSettings !== 'object' || Array.isArray(rawSettings))) {
    throw contractError(
      'Cloudflare Queue consumer settings must be an object when present',
      'CLOUDFLARE_QUEUE_CONSUMER_SETTINGS_INVALID',
      { index },
    );
  }

  const settings = rawSettings ? { ...rawSettings } : {};
  const batchSize = readEquivalentInteger([
    settings.batch_size,
    settings.max_batch_size,
    value.batch_size,
    value.max_batch_size,
  ], 'batch_size', index);
  const maxConcurrency = readEquivalentInteger([
    settings.max_concurrency,
    value.max_concurrency,
  ], 'max_concurrency', index);
  const maxRetries = readEquivalentInteger([
    settings.max_retries,
    value.max_retries,
  ], 'max_retries', index);
  const timeoutSeconds = readEquivalentInteger([
    settings.max_batch_timeout,
    value.max_batch_timeout,
  ], 'max_batch_timeout', index);
  const timeoutMilliseconds = readEquivalentInteger([
    settings.max_wait_time_ms,
    value.max_wait_time_ms,
  ], 'max_wait_time_ms', index);

  let normalizedTimeoutSeconds = timeoutSeconds;
  if (timeoutMilliseconds !== null) {
    if (timeoutMilliseconds % 1000 !== 0) {
      throw contractError(
        'Cloudflare Queue max_wait_time_ms must resolve to whole seconds',
        'CLOUDFLARE_QUEUE_CONSUMER_TIMEOUT_INVALID',
        { index, maxWaitTimeMs: timeoutMilliseconds },
      );
    }
    const millisecondsAsSeconds = timeoutMilliseconds / 1000;
    if (normalizedTimeoutSeconds !== null
      && normalizedTimeoutSeconds !== millisecondsAsSeconds) {
      throw contractError(
        'Cloudflare Queue timeout fields disagree',
        'CLOUDFLARE_QUEUE_CONSUMER_FIELD_CONFLICT',
        {
          index,
          fieldName: 'max_batch_timeout',
          maxBatchTimeout: normalizedTimeoutSeconds,
          maxWaitTimeMs: timeoutMilliseconds,
        },
      );
    }
    normalizedTimeoutSeconds = millisecondsAsSeconds;
  }

  if (batchSize !== null) settings.max_batch_size = batchSize;
  if (normalizedTimeoutSeconds !== null) {
    settings.max_batch_timeout = normalizedTimeoutSeconds;
  }
  if (maxConcurrency !== null) settings.max_concurrency = maxConcurrency;
  if (maxRetries !== null) settings.max_retries = maxRetries;

  return {
    ...value,
    ...(Object.keys(settings).length > 0 ? { settings } : {}),
  };
}

function readEquivalentInteger(values, fieldName, index) {
  const present = values.filter((value) => value !== undefined && value !== null);
  if (present.length === 0) return null;
  const normalized = present.map((value) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
      throw contractError(
        `Cloudflare Queue ${fieldName} must be a non-negative integer`,
        'CLOUDFLARE_QUEUE_CONSUMER_FIELD_INVALID',
        { index, fieldName },
      );
    }
    return number;
  });
  if (new Set(normalized).size !== 1) {
    throw contractError(
      `Cloudflare Queue ${fieldName} appears with conflicting values`,
      'CLOUDFLARE_QUEUE_CONSUMER_FIELD_CONFLICT',
      { index, fieldName },
    );
  }
  return normalized[0];
}

function contractError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'CloudflareQueueConsumerContractError';
  error.code = code;
  error.details = details;
  return error;
}
