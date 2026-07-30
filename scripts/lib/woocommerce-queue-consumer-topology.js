export function assertWooCommerceQueueConsumerTopology(
  consumers,
  queueName,
  expected,
) {
  const entries = requireArray(consumers, 'consumers');
  const expectedQueueName = requireText(queueName, 'queueName');
  const matches = entries.filter((entry) => queueIdentity(entry) === expectedQueueName);
  const entry = matches.length === 1
    ? matches[0]
    : (matches.length === 0 && entries.length === 1 ? entries[0] : null);

  if (!entry || matches.length > 1) {
    throw topologyError(
      `Queue consumer missing or ambiguous for ${expectedQueueName}`,
      {
        queueName: expectedQueueName,
        consumerCount: entries.length,
        exactMatchCount: matches.length,
      },
    );
  }

  const observed = normalizeWooCommerceQueueConsumer(entry);
  const required = normalizeExpectedTopology(expected);
  for (const [key, value] of Object.entries(required)) {
    if ((observed[key] ?? null) !== value) {
      throw topologyError(
        `Queue consumer drift: ${expectedQueueName}.${key}`,
        {
          queueName: expectedQueueName,
          field: key,
          observed: observed[key] ?? null,
          expected: value,
        },
      );
    }
  }

  return observed;
}

export function normalizeWooCommerceQueueConsumer(entry = {}) {
  const source = requireObject(entry, 'consumer');
  const settings = optionalObject(source.settings);
  const maxConcurrency = resolveIntegerAliases(
    'maxConcurrency',
    [source.max_concurrency, settings.max_concurrency],
  );
  const maxBatchSize = resolveIntegerAliases(
    'maxBatchSize',
    [
      source.batch_size,
      source.max_batch_size,
      settings.batch_size,
      settings.max_batch_size,
    ],
  );
  const maxRetries = resolveIntegerAliases(
    'maxRetries',
    [source.max_retries, settings.max_retries],
  );
  const maxWaitTimeMs = resolveIntegerAliases(
    'maxWaitTimeMs',
    [source.max_wait_time_ms, settings.max_wait_time_ms],
    { optional: true },
  );
  const legacyTimeoutSeconds = resolveIntegerAliases(
    'maxBatchTimeout',
    [source.max_batch_timeout, settings.max_batch_timeout],
    { optional: true },
  );

  if (maxWaitTimeMs !== null && maxWaitTimeMs % 1_000 !== 0) {
    throw topologyError(
      'Queue consumer max_wait_time_ms must resolve to whole seconds',
      { maxWaitTimeMs },
    );
  }
  const modernTimeoutSeconds = maxWaitTimeMs === null
    ? null
    : maxWaitTimeMs / 1_000;
  if (modernTimeoutSeconds !== null
    && legacyTimeoutSeconds !== null
    && modernTimeoutSeconds !== legacyTimeoutSeconds) {
    throw topologyError(
      'Queue consumer timeout aliases disagree',
      {
        modernTimeoutSeconds,
        legacyTimeoutSeconds,
      },
    );
  }
  const maxBatchTimeout = modernTimeoutSeconds ?? legacyTimeoutSeconds;
  if (maxBatchTimeout === null) {
    throw topologyError('Queue consumer timeout is missing');
  }

  const deadLetterQueue = resolveTextAliases(
    'deadLetterQueue',
    [source.dead_letter_queue, settings.dead_letter_queue],
  );

  return Object.freeze({
    maxConcurrency,
    maxBatchSize,
    maxBatchTimeout,
    maxRetries,
    deadLetterQueue,
  });
}

function normalizeExpectedTopology(expected = {}) {
  const value = requireObject(expected, 'expected');
  return Object.freeze({
    maxConcurrency: requiredNonNegativeInteger(value.maxConcurrency, 'maxConcurrency'),
    maxBatchSize: requiredNonNegativeInteger(value.maxBatchSize, 'maxBatchSize'),
    maxBatchTimeout: requiredNonNegativeInteger(value.maxBatchTimeout, 'maxBatchTimeout'),
    maxRetries: requiredNonNegativeInteger(value.maxRetries, 'maxRetries'),
    deadLetterQueue: optionalText(value.deadLetterQueue),
  });
}

function queueIdentity(entry = {}) {
  return optionalText(entry?.queue_name ?? entry?.queue ?? entry?.name);
}

function resolveIntegerAliases(fieldName, values, options = {}) {
  const present = values
    .filter((value) => value !== undefined && value !== null && value !== '')
    .map((value) => requiredNonNegativeInteger(value, fieldName));
  const unique = [...new Set(present)];
  if (unique.length > 1) {
    throw topologyError(`Queue consumer ${fieldName} aliases disagree`, {
      fieldName,
      distinctValueCount: unique.length,
    });
  }
  if (unique.length === 0) {
    if (options.optional === true) return null;
    throw topologyError(`Queue consumer ${fieldName} is missing`, { fieldName });
  }
  return unique[0];
}

function resolveTextAliases(fieldName, values) {
  const present = values
    .map((value) => optionalText(value))
    .filter((value) => value !== null);
  const unique = [...new Set(present)];
  if (unique.length > 1) {
    throw topologyError(`Queue consumer ${fieldName} aliases disagree`, {
      fieldName,
      distinctValueCount: unique.length,
    });
  }
  return unique[0] ?? null;
}

function requiredNonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw topologyError(`Queue consumer ${fieldName} must be a non-negative integer`, {
      fieldName,
    });
  }
  return number;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw topologyError(`Queue consumer ${fieldName} must be an array`, { fieldName });
  }
  return value;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw topologyError(`Queue consumer ${fieldName} must be an object`, { fieldName });
  }
  return value;
}

function requireText(value, fieldName) {
  const text = optionalText(value);
  if (!text) throw topologyError(`Queue consumer ${fieldName} is required`, { fieldName });
  return text;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function optionalObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function topologyError(message, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommerceQueueConsumerTopologyError';
  error.code = 'WOOCOMMERCE_FINAL_QUEUE_TOPOLOGY_INVALID';
  error.details = details;
  return error;
}
