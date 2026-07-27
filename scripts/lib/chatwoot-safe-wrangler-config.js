import { createHash } from 'node:crypto';
import {
  CHATWOOT_REMOTE_REQUIRED_FALSE_FLAGS,
  validateChatwootRemoteWranglerConfig,
} from './chatwoot-remote-readiness-operator.js';

const WORKER_NAME = 'social-mkt-sync-worker';
const DATABASE_NAME = 'social-mkt-state-dev';
const MAIN_QUEUE_NAME = 'social-mkt-sync-jobs';
const DLQ_NAME = 'social-mkt-sync-dlq';
const D1_BINDING = 'MKT_STATE_DB';
const QUEUE_BINDING = 'MKT_SYNC_QUEUE';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const CHATWOOT_SAFE_WRANGLER_CONFIG_CONTRACT_VERSION =
  'chatwoot_safe_wrangler_config_v1';

export function buildChatwootSafeWranglerConfig(sourceText) {
  const source = parseJsoncObject(sourceText);
  requireExact(source.name, WORKER_NAME, 'name');
  requireExact(source.vars?.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(
    source.vars?.MKT_CUSTOMER_PROFILE,
    'integration_workspace',
    'MKT_CUSTOMER_PROFILE',
  );
  requireExact(
    source.vars?.MKT_CONNECTION_CUSTOMER_KEY,
    'chemistry_k',
    'MKT_CONNECTION_CUSTOMER_KEY',
  );

  const d1 = exactlyOne(
    source.d1_databases,
    (item) => item?.binding === D1_BINDING,
    'D1 binding MKT_STATE_DB',
  );
  requireExact(d1.database_name, DATABASE_NAME, 'database_name');
  const databaseId = requireUuid(d1.database_id, 'database_id');

  const producer = exactlyOne(
    source.queues?.producers,
    (item) => item?.binding === QUEUE_BINDING,
    'Queue producer MKT_SYNC_QUEUE',
  );
  requireExact(producer.queue, MAIN_QUEUE_NAME, 'producer.queue');

  const mainConsumer = exactlyOne(
    source.queues?.consumers,
    (item) => item?.queue === MAIN_QUEUE_NAME,
    'Main Queue consumer',
  );
  requireExact(mainConsumer.dead_letter_queue, DLQ_NAME, 'dead_letter_queue');
  requireExactInteger(mainConsumer.max_concurrency, 1, 'main.max_concurrency');
  requireExactInteger(mainConsumer.max_batch_size, 10, 'main.max_batch_size');
  requireExactInteger(mainConsumer.max_batch_timeout, 30, 'main.max_batch_timeout');
  requireExactInteger(mainConsumer.max_retries, 5, 'main.max_retries');

  const dlqConsumer = exactlyOne(
    source.queues?.consumers,
    (item) => item?.queue === DLQ_NAME,
    'DLQ consumer',
  );
  requireExactInteger(dlqConsumer.max_concurrency, 1, 'dlq.max_concurrency');
  requireExactInteger(dlqConsumer.max_batch_size, 10, 'dlq.max_batch_size');
  requireExactInteger(dlqConsumer.max_batch_timeout, 30, 'dlq.max_batch_timeout');
  requireExactInteger(dlqConsumer.max_retries, 10, 'dlq.max_retries');
  if (dlqConsumer.dead_letter_queue !== undefined) {
    throw configError(
      'Chatwoot safe config source must not chain the DLQ to another queue',
      'CHATWOOT_SAFE_CONFIG_TOPOLOGY_INVALID',
      { fieldName: 'dlq.dead_letter_queue' },
    );
  }

  const vars = {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
    MKT_MAIN_QUEUE_NAME: MAIN_QUEUE_NAME,
    MKT_DLQ_QUEUE_NAME: DLQ_NAME,
    ...Object.fromEntries(
      CHATWOOT_REMOTE_REQUIRED_FALSE_FLAGS.map((flag) => [flag, 'false']),
    ),
  };

  const safe = {
    $schema: optionalText(source.$schema)
      ?? './node_modules/wrangler/config-schema.json',
    name: WORKER_NAME,
    main: requireText(source.main, 'main'),
    compatibility_date: requireText(
      source.compatibility_date,
      'compatibility_date',
    ),
    ...(Array.isArray(source.compatibility_flags)
      ? { compatibility_flags: requireStringArray(
        source.compatibility_flags,
        'compatibility_flags',
      ) }
      : {}),
    ...(optionalText(source.account_id)
      ? { account_id: optionalText(source.account_id) }
      : {}),
    workers_dev: false,
    d1_databases: [{
      binding: D1_BINDING,
      database_name: DATABASE_NAME,
      database_id: databaseId,
      migrations_dir: optionalText(d1.migrations_dir) ?? './migrations',
    }],
    queues: {
      producers: [{
        binding: QUEUE_BINDING,
        queue: MAIN_QUEUE_NAME,
      }],
      consumers: [
        {
          queue: MAIN_QUEUE_NAME,
          max_concurrency: 1,
          max_batch_size: 10,
          max_batch_timeout: 30,
          max_retries: 5,
          dead_letter_queue: DLQ_NAME,
        },
        {
          queue: DLQ_NAME,
          max_concurrency: 1,
          max_batch_size: 10,
          max_batch_timeout: 30,
          max_retries: 10,
        },
      ],
    },
    vars,
  };

  const text = `${JSON.stringify(safe, null, 2)}\n`;
  validateChatwootRemoteWranglerConfig(text);

  return Object.freeze({
    contractVersion: CHATWOOT_SAFE_WRANGLER_CONFIG_CONTRACT_VERSION,
    text,
    sha256: sha256(text),
    workerName: WORKER_NAME,
    databaseName: DATABASE_NAME,
    databaseIdFingerprint: sha256(databaseId),
    mainQueueName: MAIN_QUEUE_NAME,
    dlqName: DLQ_NAME,
    falseFlagCount: CHATWOOT_REMOTE_REQUIRED_FALSE_FLAGS.length,
    sourceValuesCopied: Object.freeze([
      'account_id',
      'main',
      'compatibility_date',
      'compatibility_flags',
      'database_id',
      'migrations_dir',
    ]),
    secretValuesCopied: 0,
    providerValuesCopied: 0,
    scheduleValuesCopied: 0,
    routeValuesCopied: 0,
  });
}

export function parseJsoncObject(text) {
  const source = requireText(text, 'sourceText');
  let value;
  try {
    value = JSON.parse(removeTrailingCommas(stripJsonComments(source)));
  } catch (cause) {
    throw configError(
      'Chatwoot source Wrangler config is not valid JSONC',
      'CHATWOOT_SAFE_CONFIG_SOURCE_INVALID',
      { cause: cause?.message ?? 'JSON_PARSE_FAILED' },
    );
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw configError(
      'Chatwoot source Wrangler config must be an object',
      'CHATWOOT_SAFE_CONFIG_SOURCE_INVALID',
    );
  }
  return value;
}

function stripJsonComments(text) {
  let output = '';
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (lineComment) {
      if (char === '\n' || char === '\r') {
        lineComment = false;
        output += char;
      }
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      } else if (char === '\n' || char === '\r') {
        output += char;
      }
      continue;
    }
    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    output += char;
  }
  return output;
}

function removeTrailingCommas(text) {
  let output = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === ',') {
      let cursor = index + 1;
      while (/\s/u.test(text[cursor] ?? '')) cursor += 1;
      if (text[cursor] === '}' || text[cursor] === ']') continue;
    }
    output += char;
  }
  return output;
}

function exactlyOne(values, predicate, label) {
  const list = Array.isArray(values) ? values.filter(predicate) : [];
  if (list.length !== 1) {
    throw configError(
      `Chatwoot safe config requires exactly one ${label}`,
      'CHATWOOT_SAFE_CONFIG_TOPOLOGY_INVALID',
      { label, count: list.length },
    );
  }
  return list[0];
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw configError(
      `Chatwoot safe config source must set ${fieldName}=${expected}`,
      'CHATWOOT_SAFE_CONFIG_TARGET_INVALID',
      { fieldName, expected },
    );
  }
  return value;
}

function requireExactInteger(value, expected, fieldName) {
  if (!Number.isSafeInteger(value) || value !== expected) {
    throw configError(
      `Chatwoot safe config source must set ${fieldName}=${expected}`,
      'CHATWOOT_SAFE_CONFIG_TOPOLOGY_INVALID',
      { fieldName, expected },
    );
  }
  return value;
}

function requireUuid(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!UUID.test(text)) {
    throw configError(
      `Chatwoot safe config source requires a valid ${fieldName}`,
      'CHATWOOT_SAFE_CONFIG_TARGET_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw configError(
      `${fieldName} is required`,
      'CHATWOOT_SAFE_CONFIG_VALUE_REQUIRED',
      { fieldName },
    );
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : null;
}

function requireStringArray(value, fieldName) {
  if (!Array.isArray(value) || value.some((item) => (
    typeof item !== 'string' || item.trim() === ''
  ))) {
    throw configError(
      `${fieldName} must be an array of non-empty strings`,
      'CHATWOOT_SAFE_CONFIG_SOURCE_INVALID',
      { fieldName },
    );
  }
  return value.map((item) => item.trim());
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function configError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootSafeWranglerConfigError';
  error.code = code;
  error.details = details;
  return error;
}
