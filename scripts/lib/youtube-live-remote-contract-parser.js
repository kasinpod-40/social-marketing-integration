import {
  normalizeCloudflareQueueConsumerPayload,
} from './cloudflare-queue-consumer-contract.js';
import {
  YOUTUBE_DRY_RUN_REQUIRED_SECRET_NAMES,
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
  const normalizedPayload = normalizeQueueConsumerPayload(value);
  const items = unwrapQueueConsumers(normalizedPayload);
  const responseQueueName = optionalText(
    normalizedPayload?.queue_name
      ?? normalizedPayload?.queueName
      ?? normalizedPayload?.queue
      ?? normalizedPayload?.name,
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
    const settings = consumer.settings;
    if (settings !== undefined
      && (!settings || typeof settings !== 'object' || Array.isArray(settings))) {
      throw parserError(
        'Scoped Queue consumer settings must be an object when present',
        'YOUTUBE_DRY_RUN_REMOTE_CONTRACT_INVALID',
        { expectedQueueName, index },
      );
    }
    return Object.freeze({
      ...consumer,
      queue_name: expectedQueueName,
      ...(settings ? { settings: Object.freeze({ ...settings }) } : {}),
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
  const { isArray, sourceItem, directBindings, bindings } = readVersionBindings(value);

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
  return replaceVersionBindings({
    isArray,
    sourceItem,
    directBindings,
    bindings: normalizedBindings,
  });
}

/**
 * Wrangler live version metadata may omit plaintext bindings whose effective value is false.
 * Materialize only the reviewed expected-false names for fingerprinting. Explicit values remain
 * authoritative and are validated; no true value is rewritten or downgraded.
 */
export function normalizeWranglerVersionReviewedFalseFlags(value, input = {}) {
  if (!Array.isArray(input.expectedFalseFlagNames)
    || input.expectedFalseFlagNames.length === 0) {
    throw parserError(
      'Live Remote validation requires reviewed expected-false flag names',
      'YOUTUBE_DRY_RUN_REMOTE_EXPECTED_FALSE_FLAGS_REQUIRED',
    );
  }
  const expectedNames = [...new Set(input.expectedFalseFlagNames.map((name) => (
    requireText(name, 'expectedFalseFlagName')
  )))].sort();
  const expectedSet = new Set(expectedNames);
  const { isArray, sourceItem, directBindings, bindings } = readVersionBindings(value);
  const matchesByName = new Map(expectedNames.map((name) => [name, []]));

  for (const binding of bindings) {
    if (normalizeBindingType(binding?.type) !== 'plain_text') continue;
    const name = optionalText(binding?.name ?? binding?.binding);
    if (!name || !expectedSet.has(name)) continue;
    matchesByName.get(name).push(binding);
  }

  for (const [name, matches] of matchesByName) {
    if (matches.length > 1) {
      throw parserError(
        'Remote version contains a duplicate reviewed flag binding',
        'YOUTUBE_DRY_RUN_REMOTE_FLAG_BINDING_DUPLICATE',
        { name, matchCount: matches.length },
      );
    }
    if (matches.length === 1) {
      requireRemoteBoolean(matches[0]?.text ?? matches[0]?.value, name);
    }
  }

  const missingNames = expectedNames.filter((name) => matchesByName.get(name).length === 0);
  const normalizedBindings = [
    ...bindings,
    ...missingNames.map((name) => Object.freeze({
      type: 'plain_text',
      name,
      text: 'false',
    })),
  ];

  return Object.freeze({
    versionsView: replaceVersionBindings({
      isArray,
      sourceItem,
      directBindings,
      bindings: normalizedBindings,
    }),
    expectedFalseFlagCount: expectedNames.length,
    materializedFalseFlagCount: missingNames.length,
  });
}

/**
 * The Worker is shared by multiple connectors. Require the complete YouTube Secret-name subset,
 * reject any exposed Secret value, and remove unrelated connector Secret names only from the
 * YouTube fingerprint input. The original Remote response is never persisted.
 */
export function normalizeWranglerVersionRequiredSecrets(value, input = {}) {
  const requiredNames = [...(
    input.requiredSecretNames ?? YOUTUBE_DRY_RUN_REQUIRED_SECRET_NAMES
  )].map((name) => requireText(name, 'requiredSecretName')).sort();
  const requiredSet = new Set(requiredNames);
  const { isArray, sourceItem, directBindings, bindings } = readVersionBindings(value);
  const observedNames = [];

  for (const binding of bindings) {
    if (normalizeBindingType(binding?.type) !== 'secret_text') continue;
    const name = optionalText(binding?.name ?? binding?.binding);
    if (!name) continue;
    if (binding?.text !== undefined || binding?.value !== undefined) {
      throw parserError(
        'Remote version output exposed a Secret value',
        'YOUTUBE_DRY_RUN_REMOTE_SECRET_VALUE_EXPOSED',
      );
    }
    observedNames.push(name);
  }

  const observedSet = new Set(observedNames);
  if (observedSet.size !== observedNames.length) {
    throw parserError(
      'Remote Worker contains a duplicate Secret binding name',
      'YOUTUBE_DRY_RUN_REMOTE_SECRET_BINDING_DUPLICATE',
    );
  }
  const missing = requiredNames.filter((name) => !observedSet.has(name));
  if (missing.length > 0) {
    throw parserError(
      'Remote Worker is missing one or more required YouTube Secret bindings',
      'YOUTUBE_DRY_RUN_REMOTE_REQUIRED_SECRET_MISSING',
      { missing },
    );
  }

  const scopedBindings = bindings.filter((binding) => {
    if (normalizeBindingType(binding?.type) !== 'secret_text') return true;
    const name = optionalText(binding?.name ?? binding?.binding);
    return name ? requiredSet.has(name) : false;
  });

  return Object.freeze({
    versionsView: replaceVersionBindings({
      isArray,
      sourceItem,
      directBindings,
      bindings: scopedBindings,
    }),
    requiredSecretNameCount: requiredNames.length,
    observedSecretNameCount: observedSet.size,
    additionalSecretNameCount: [...observedSet]
      .filter((name) => !requiredSet.has(name))
      .length,
  });
}

/**
 * Compatibility adapter for sanitized live Wrangler responses. It normalizes only metadata already
 * proven by scoped command context, immutable D1 UUID, reviewed false defaults or the required
 * YouTube Secret-name subset, then delegates every flag, binding, consumer, trigger, traffic and
 * fingerprint decision to the reviewed validator.
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
  const d1Normalized = normalizeWranglerVersionD1Binding(input.versionsView, {
    expectedBindingName: input.expectedD1BindingName ?? 'MKT_STATE_DB',
    expectedDatabaseId: input.expectedDatabaseId,
    expectedDatabaseName: input.expectedDatabaseName,
  });
  const flagScope = normalizeWranglerVersionReviewedFalseFlags(d1Normalized, {
    expectedFalseFlagNames: input.expectedFalseFlagNames,
  });
  const secretScope = normalizeWranglerVersionRequiredSecrets(flagScope.versionsView, {
    requiredSecretNames: input.requiredSecretNames,
  });
  const {
    queueConsumerContexts: _queueConsumerContexts,
    expectedD1BindingName: _expectedD1BindingName,
    expectedDatabaseId: _expectedDatabaseId,
    expectedDatabaseName: _expectedDatabaseName,
    expectedFalseFlagNames: _expectedFalseFlagNames,
    requiredSecretNames: _requiredSecretNames,
    ...validatorInput
  } = input;
  const validated = validateRemoteYouTubeDeploymentContract({
    ...validatorInput,
    versionsView: secretScope.versionsView,
    queueConsumers,
  });
  return Object.freeze({
    ...validated,
    observedSecretNameCount: secretScope.observedSecretNameCount,
    additionalSecretNameCount: secretScope.additionalSecretNameCount,
    expectedFalseFlagCount: flagScope.expectedFalseFlagCount,
    materializedFalseFlagCount: flagScope.materializedFalseFlagCount,
  });
}

function normalizeQueueConsumerPayload(value) {
  if (Array.isArray(value?.result?.consumers)) {
    return {
      ...value,
      result: {
        ...value.result,
        consumers: normalizeCloudflareQueueConsumerPayload(value.result.consumers),
      },
    };
  }
  return normalizeCloudflareQueueConsumerPayload(value);
}

function readVersionBindings(value) {
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
  return { isArray, sourceItem, directBindings, bindings };
}

function replaceVersionBindings(input) {
  const normalizedItem = input.directBindings
    ? { ...input.sourceItem, bindings: input.bindings }
    : {
      ...input.sourceItem,
      resources: {
        ...input.sourceItem.resources,
        bindings: input.bindings,
      },
    };
  return input.isArray
    ? Object.freeze([Object.freeze(normalizedItem)])
    : Object.freeze(normalizedItem);
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

function requireRemoteBoolean(value, name) {
  if (value === true || value === false) return value;
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw parserError(
    'Remote reviewed flag must be an explicit Boolean value',
    'YOUTUBE_DRY_RUN_REMOTE_FLAG_VALUE_INVALID',
    { name },
  );
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
