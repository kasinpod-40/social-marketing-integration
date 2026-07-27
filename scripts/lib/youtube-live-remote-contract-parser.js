import {
  validateRemoteYouTubeDeploymentContract,
} from './youtube-dry-run-rollout-operator.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * Wrangler scopes `queues consumer list` by Queue name, so some live response shapes omit the
 * Queue name inside each returned consumer. Bind that omitted metadata to the reviewed command
 * context, while rejecting any explicit name that disagrees with that context.
 */
export function normalizeScopedWranglerQueueConsumers(value, input = {}) {
  const expectedQueueName = requireText(input.expectedQueueName, 'expectedQueueName');
  const items = unwrapQueueConsumers(value);
  const responseQueueName = optionalText(
    value?.queue_name ?? value?.queueName ?? value?.queue ?? value?.name,
  );
  if (responseQueueName && responseQueueName !== expectedQueueName) {
    throw parserError(
      'Scoped Queue response does not match the reviewed Queue command context',
      'YOUTUBE_DRY_RUN_REMOTE_QUEUE_CONTEXT_MISMATCH',
      { expectedQueueName, observedQueueName: responseQueueName },
    );
  }
  return Object.freeze(items.map((consumer, index) => {
    if (!consumer || typeof consumer !== 'object' || Array.isArray(consumer)) {
      throw parserError(
        'Scoped Queue consumer response contains a non-object item',
        'YOUTUBE_DRY_RUN_REMOTE_CONTRACT_INVALID',
        { expectedQueueName, index },
      );
    }
    const observedQueueName = optionalText(
      consumer.queue_name ?? consumer.queueName ?? consumer.queue ?? consumer.name,
    );
    if (observedQueueName && observedQueueName !== expectedQueueName) {
      throw parserError(
        'Queue consumer name disagrees with the reviewed Queue command context',
        'YOUTUBE_DRY_RUN_REMOTE_QUEUE_CONTEXT_MISMATCH',
        { expectedQueueName, observedQueueName, index },
      );
    }
    const settings = normalizeQueueConsumerSettings(consumer, {
      expectedQueueName,
      index,
    });
    return Object.freeze({
      ...consumer,
      queue_name: expectedQueueName,
      ...(settings ? { settings } : {}),
    });
  }));
}

/**
 * Cloudflare live version metadata may omit the human-readable D1 database name while retaining
 * the immutable database UUID. Treat UUID as authoritative, reject mismatch/missing UUID, and only
 * restore the reviewed display name after the identity check passes.
 */
export function normalizeWranglerVersionD1Binding(value, input = {}) {
  const expectedBindingName = requireText(
    input.expectedBindingName ?? 'MKT_STATE_DB',
    'expectedBindingName',
  );
  const expectedDatabaseId = requireUuid(input.expectedDatabaseId, 'expectedDatabaseId');
  const expectedDatabaseName = requireText(input.expectedDatabaseName, 'expectedDatabaseName');
  const isArray = Array.isArray(value);
  const sourceItem = isArray ? value[0] : value;
  if (!sourceItem || typeof sourceItem !== 'object' || Array.isArray(sourceItem)) {
    throw parserError(
      'Wrangler version view must contain one version object',
      'YOUTUBE_DRY_RUN_REMOTE_CONTRACT_INVALID',
    );
  }
  if (isArray && value.length !== 1) {
    throw parserError(
      'Wrangler version view must contain exactly one version object',
      'YOUTUBE_DRY_RUN_REMOTE_CONTRACT_INVALID',
      { versionCount: value.length },
    );
  }

  const directBindings = Array.isArray(sourceItem.bindings) ? sourceItem.bindings : null;
  const resourceBindings = Array.isArray(sourceItem.resources?.bindings)
    ? sourceItem.resources.bindings
    : null;
  const bindings = directBindings ?? resourceBindings;
  if (!bindings) {
    throw parserError(
      'Wrangler version view lacks bindings',
      'YOUTUBE_DRY_RUN_REMOTE_CONTRACT_INVALID',
    );
  }

  const matches = bindings
    .map((binding, index) => ({ binding, index }))
    .filter(({ binding }) => (
      optionalText(binding?.name ?? binding?.binding) === expectedBindingName
      && normalizeBindingType(binding?.type) === 'd1'
    ));
  if (matches.length !== 1) {
    throw parserError(
      'Remote version must contain the exact reviewed D1 binding once',
      'YOUTUBE_DRY_RUN_REMOTE_D1_BINDING_INVALID',
      { expectedBindingName, matchCount: matches.length },
    );
  }

  const [{ binding, index }] = matches;
  const observedDatabaseId = optionalText(
    binding.database_id ?? binding.databaseId ?? binding.id,
  );
  if (!observedDatabaseId || !UUID.test(observedDatabaseId)) {
    throw parserError(
      'Remote D1 binding lacks a valid immutable database UUID',
      'YOUTUBE_DRY_RUN_REMOTE_D1_UUID_REQUIRED',
      { expectedBindingName },
    );
  }
  if (observedDatabaseId.toLowerCase() !== expectedDatabaseId.toLowerCase()) {
    throw parserError(
      'Remote D1 binding UUID differs from the reviewed database',
      'YOUTUBE_DRY_RUN_REMOTE_D1_UUID_MISMATCH',
      { expectedBindingName },
    );
  }

  const observedDatabaseName = optionalText(
    binding.database_name ?? binding.databaseName,
  );
  if (observedDatabaseName && observedDatabaseName !== expectedDatabaseName) {
    throw parserError(
      'Remote D1 binding name differs from the reviewed database name',
      'YOUTUBE_DRY_RUN_REMOTE_D1_NAME_MISMATCH',
      { expectedBindingName, expectedDatabaseName, observedDatabaseName },
    );
  }

  const normalizedBindings = bindings.map((item, bindingIndex) => (
    bindingIndex === index
      ? Object.freeze({
        ...item,
        database_id: expectedDatabaseId,
        database_name: expectedDatabaseName,
      })
      : item
  ));
  const normalizedItem = directBindings
    ? { ...sourceItem, bindings: normalizedBindings }
    : {
      ...sourceItem,
      resources: {
        ...sourceItem.resources,
        bindings: normalizedBindings,
      },
    };
  return isArray ? Object.freeze([Object.freeze(normalizedItem)]) : Object.freeze(normalizedItem);
}

/**
 * Compatibility adapter for sanitized live Wrangler responses. It normalizes only metadata already
 * proven by scoped command context or immutable D1 UUID, then delegates every flag, binding,
 * consumer, trigger, Secret-name, traffic and fingerprint decision to the reviewed validator.
 */
export function validateLiveRemoteYouTubeDeploymentContract(input = {}) {
  const contexts = input.queueConsumerContexts;
  if (!Array.isArray(contexts) || contexts.length === 0) {
    throw parserError(
      'Live Remote validation requires explicit Queue command contexts',
      'YOUTUBE_DRY_RUN_REMOTE_QUEUE_CONTEXT_REQUIRED',
    );
  }
  const queueConsumers = contexts.flatMap((context) => (
    normalizeScopedWranglerQueueConsumers(context?.response, {
      expectedQueueName: context?.expectedQueueName,
    })
  ));
  const versionsView = normalizeWranglerVersionD1Binding(input.versionsView, {
    expectedBindingName: input.expectedD1BindingName ?? 'MKT_STATE_DB',
    expectedDatabaseId: input.expectedDatabaseId,
    expectedDatabaseName: input.expectedDatabaseName,
  });
  const {
    queueConsumerContexts: _queueConsumerContexts,
    expectedD1BindingName: _expectedD1BindingName,
    expectedDatabaseId: _expectedDatabaseId,
    expectedDatabaseName: _expectedDatabaseName,
    ...validatorInput
  } = input;
  return validateRemoteYouTubeDeploymentContract({
    ...validatorInput,
    versionsView,
    queueConsumers,
  });
}

function normalizeQueueConsumerSettings(consumer, input = {}) {
  const rawSettings = consumer?.settings;
  if (rawSettings !== undefined
    && (!rawSettings || typeof rawSettings !== 'object' || Array.isArray(rawSettings))) {
    throw parserError(
      'Scoped Queue consumer settings must be an object when present',
      'YOUTUBE_DRY_RUN_REMOTE_CONTRACT_INVALID',
      { expectedQueueName: input.expectedQueueName, index: input.index },
    );
  }
  const settings = rawSettings ? { ...rawSettings } : {};
  const seconds = readEquivalentQueueInteger([
    settings.max_batch_timeout,
    consumer?.max_batch_timeout,
  ], 'max_batch_timeout', input);
  const milliseconds = readEquivalentQueueInteger([
    settings.max_wait_time_ms,
    consumer?.max_wait_time_ms,
  ], 'max_wait_time_ms', input);

  let normalizedSeconds = seconds;
  if (milliseconds !== null) {
    if (milliseconds % 1000 !== 0) {
      throw parserError(
        'Remote Queue max_wait_time_ms must resolve to whole seconds',
        'YOUTUBE_DRY_RUN_REMOTE_QUEUE_TIMEOUT_INVALID',
        {
          expectedQueueName: input.expectedQueueName,
          index: input.index,
          maxWaitTimeMs: milliseconds,
        },
      );
    }
    const millisecondsAsSeconds = milliseconds / 1000;
    if (normalizedSeconds !== null && normalizedSeconds !== millisecondsAsSeconds) {
      throw parserError(
        'Remote Queue timeout fields disagree',
        'YOUTUBE_DRY_RUN_REMOTE_QUEUE_TIMEOUT_MISMATCH',
        {
          expectedQueueName: input.expectedQueueName,
          index: input.index,
          maxBatchTimeout: normalizedSeconds,
          maxWaitTimeMs: milliseconds,
        },
      );
    }
    normalizedSeconds = millisecondsAsSeconds;
  }
  if (normalizedSeconds !== null) {
    settings.max_batch_timeout = normalizedSeconds;
  }
  return Object.keys(settings).length > 0 ? Object.freeze(settings) : null;
}

function readEquivalentQueueInteger(values, fieldName, input = {}) {
  const present = values.filter((value) => value !== undefined && value !== null);
  if (present.length === 0) return null;
  const normalized = present.map((value) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
      throw parserError(
        `Remote Queue ${fieldName} must be a non-negative integer`,
        'YOUTUBE_DRY_RUN_REMOTE_QUEUE_TIMEOUT_INVALID',
        { expectedQueueName: input.expectedQueueName, index: input.index, fieldName },
      );
    }
    return number;
  });
  if (new Set(normalized).size !== 1) {
    throw parserError(
      `Remote Queue ${fieldName} appears with conflicting values`,
      'YOUTUBE_DRY_RUN_REMOTE_QUEUE_TIMEOUT_MISMATCH',
      { expectedQueueName: input.expectedQueueName, index: input.index, fieldName },
    );
  }
  return normalized[0];
}

function unwrapQueueConsumers(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.result)) return value.result;
  if (Array.isArray(value?.consumers)) return value.consumers;
  if (Array.isArray(value?.result?.consumers)) return value.result.consumers;
  throw parserError(
    'Wrangler Queue consumer response lacks a consumer array',
    'YOUTUBE_DRY_RUN_REMOTE_CONTRACT_INVALID',
  );
}

function normalizeBindingType(value) {
  const type = optionalText(value)?.toLowerCase().replaceAll('-', '_');
  if (['d1', 'd1_database', 'd1_namespace'].includes(type)) return 'd1';
  return type;
}

function requireUuid(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!UUID.test(text)) {
    throw parserError(
      `Live Remote parser requires a valid ${fieldName}`,
      'YOUTUBE_DRY_RUN_REMOTE_D1_UUID_REQUIRED',
      { fieldName },
    );
  }
  return text.toLowerCase();
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw parserError(
      `Live Remote parser requires ${fieldName}`,
      'YOUTUBE_DRY_RUN_REMOTE_CONTRACT_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parserError(message, code, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = Object.freeze({ ...details });
  return error;
}
