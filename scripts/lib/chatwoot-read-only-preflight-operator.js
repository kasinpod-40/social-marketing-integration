import { createHash } from 'node:crypto';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

export const CHATWOOT_PREFLIGHT_CONTRACT_VERSION = 'chatwoot-remote-read-only-preflight-v1';

export const CHATWOOT_PREFLIGHT_PHASES = Object.freeze(['plan', 'preflight']);

export const CHATWOOT_PREFLIGHT_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_CHATWOOT_REMOTE_READ_ONLY_PREFLIGHT',
  value: 'PREFLIGHT_CHATWOOT_REMOTE_READ_ONLY',
});

export const CHATWOOT_PREFLIGHT_REQUIRED_FALSE_FLAGS = Object.freeze([
  'MKT_CONNECTOR_CHATWOOT_ENABLED',
  'MKT_CHATWOOT_D1_WRITE_ENABLED',
  'MKT_CHATWOOT_LARK_WRITE_ENABLED',
  'MKT_CHATWOOT_REPORT_WRITE_ENABLED',
  'MKT_SCHEDULE_CHATWOOT_ENABLED',
  'MKT_CHATWOOT_WEBHOOK_ENABLED',
]);

export const CHATWOOT_PREFLIGHT_REQUIRED_SECRET_NAMES = Object.freeze([
  'CHATWOOT_API_ACCESS_TOKEN',
]);

export const CHATWOOT_PREFLIGHT_OPTIONAL_SECRET_NAMES = Object.freeze([
  'LARK_APP_ID',
  'LARK_APP_SECRET',
]);

export const CHATWOOT_PREFLIGHT_EXPECTED_CRONS = Object.freeze([
  '*/5 * * * *',
  '50 0,6,12,18 * * *',
]);

export const CHATWOOT_PREFLIGHT_APPLIED_MIGRATION = '0017_woocommerce_commerce.sql';
export const CHATWOOT_PREFLIGHT_PENDING_MIGRATION = '0018_chatwoot_analytics.sql';

const FULL_GIT_SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const VERSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MIGRATION_FILE = /\b\d{4}_[A-Za-z0-9_.-]+\.sql\b/gu;

export function parseChatwootPreflightArgs(args = []) {
  let phase = 'plan';
  let execute = false;
  for (const arg of args) {
    if (arg === '--execute') {
      execute = true;
      continue;
    }
    if (arg.startsWith('--phase=')) {
      phase = arg.slice('--phase='.length);
      continue;
    }
    throw preflightError(
      `Unknown Chatwoot preflight argument: ${arg}`,
      'CHATWOOT_PREFLIGHT_ARGUMENT_INVALID',
    );
  }
  if (!CHATWOOT_PREFLIGHT_PHASES.includes(phase)) {
    throw preflightError(
      `Unsupported Chatwoot preflight phase: ${phase}`,
      'CHATWOOT_PREFLIGHT_PHASE_INVALID',
    );
  }
  if (phase === 'plan' && execute) {
    throw preflightError(
      'Plan phase does not accept --execute',
      'CHATWOOT_PREFLIGHT_PLAN_EXECUTE_INVALID',
    );
  }
  return Object.freeze({ phase, execute });
}

export function assertChatwootPreflightConfirmation(env = {}) {
  if (env?.[CHATWOOT_PREFLIGHT_CONFIRMATION.envName] !== CHATWOOT_PREFLIGHT_CONFIRMATION.value) {
    throw preflightError(
      `Chatwoot read-only preflight requires ${CHATWOOT_PREFLIGHT_CONFIRMATION.envName}=${CHATWOOT_PREFLIGHT_CONFIRMATION.value}`,
      'CHATWOOT_PREFLIGHT_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function loadChatwootPreflightTarget(env = {}) {
  const target = {
    environment: requireExact(env.MKT_ENV, 'development', 'MKT_ENV'),
    customerProfile: requireExact(
      env.MKT_CUSTOMER_PROFILE,
      'integration_workspace',
      'MKT_CUSTOMER_PROFILE',
    ),
    customerKey: requireExact(
      env.MKT_CONNECTION_CUSTOMER_KEY,
      'chemistry_k',
      'MKT_CONNECTION_CUSTOMER_KEY',
    ),
    accountKey: requireExact(
      env.MKT_CHATWOOT_PREFLIGHT_ACCOUNT_KEY,
      'chemistry_k',
      'MKT_CHATWOOT_PREFLIGHT_ACCOUNT_KEY',
    ),
    workerName: requireExact(
      env.MKT_CHATWOOT_PREFLIGHT_WORKER_NAME,
      'social-mkt-sync-worker',
      'MKT_CHATWOOT_PREFLIGHT_WORKER_NAME',
    ),
    databaseName: requireExact(
      env.MKT_CHATWOOT_PREFLIGHT_DATABASE_NAME,
      'social-mkt-state-dev',
      'MKT_CHATWOOT_PREFLIGHT_DATABASE_NAME',
    ),
    mainQueueName: requireExact(
      env.MKT_CHATWOOT_PREFLIGHT_MAIN_QUEUE,
      'social-mkt-sync-jobs',
      'MKT_CHATWOOT_PREFLIGHT_MAIN_QUEUE',
    ),
    dlqName: requireExact(
      env.MKT_CHATWOOT_PREFLIGHT_DLQ,
      'social-mkt-sync-dlq',
      'MKT_CHATWOOT_PREFLIGHT_DLQ',
    ),
    repositoryHead: requirePattern(
      env.MKT_CHATWOOT_PREFLIGHT_REPOSITORY_HEAD,
      'MKT_CHATWOOT_PREFLIGHT_REPOSITORY_HEAD',
      FULL_GIT_SHA,
    ),
    expectedActiveVersion: requirePattern(
      env.MKT_CHATWOOT_PREFLIGHT_EXPECTED_ACTIVE_VERSION,
      'MKT_CHATWOOT_PREFLIGHT_EXPECTED_ACTIVE_VERSION',
      VERSION_ID,
    ).toLowerCase(),
    configPath: requireText(
      env.MKT_CHATWOOT_PREFLIGHT_WRANGLER_CONFIG,
      'MKT_CHATWOOT_PREFLIGHT_WRANGLER_CONFIG',
    ),
    expectedBaseUrlSha256: requirePattern(
      env.MKT_CHATWOOT_PREFLIGHT_EXPECTED_BASE_URL_SHA256,
      'MKT_CHATWOOT_PREFLIGHT_EXPECTED_BASE_URL_SHA256',
      SHA256,
    ),
    expectedExternalAccountIdSha256: requirePattern(
      env.MKT_CHATWOOT_PREFLIGHT_EXPECTED_ACCOUNT_ID_SHA256,
      'MKT_CHATWOOT_PREFLIGHT_EXPECTED_ACCOUNT_ID_SHA256',
      SHA256,
    ),
  };
  return deepFreeze({
    ...target,
    targetFingerprint: sha256(stableStringify(target)),
  });
}

export function validateActiveDeployment(value, expectedVersion) {
  const deployment = Array.isArray(value) ? value[0] : value;
  const active = Array.isArray(deployment?.versions)
    ? deployment.versions.filter((item) => Number(item?.percentage) > 0)
    : [];
  if (active.length !== 1
    || Number(active[0]?.percentage) !== 100
    || String(active[0]?.version_id ?? '').toLowerCase() !== String(expectedVersion).toLowerCase()) {
    throw preflightError(
      'Active Worker version does not match the reviewed expected version at 100 percent traffic',
      'CHATWOOT_PREFLIGHT_ACTIVE_VERSION_MISMATCH',
    );
  }
  return Object.freeze({
    deploymentId: optionalText(deployment?.id),
    versionId: String(active[0].version_id).toLowerCase(),
    percentage: 100,
  });
}

export function extractRemotePlainTextVars(value) {
  const result = new Map();
  visit(value);
  return Object.freeze(Object.fromEntries([...result.entries()].sort(([left], [right]) => left.localeCompare(right))));

  function visit(node) {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (node.vars && typeof node.vars === 'object' && !Array.isArray(node.vars)) {
      for (const [name, raw] of Object.entries(node.vars)) {
        if (isScalar(raw)) result.set(name, String(raw));
      }
    }
    const name = typeof node.name === 'string' ? node.name : null;
    if (name) {
      for (const field of ['text', 'value', 'json']) {
        if (isScalar(node[field])) {
          result.set(name, String(node[field]));
          break;
        }
      }
    }
    Object.values(node).forEach(visit);
  }
}

export function validateChatwootRemoteConfig(remoteVars, target) {
  const source = remoteVars ?? {};
  const falseFlags = {};
  for (const flag of CHATWOOT_PREFLIGHT_REQUIRED_FALSE_FLAGS) {
    const value = source[flag];
    if (value !== false && String(value).trim().toLowerCase() !== 'false') {
      throw preflightError(
        `${flag} must be false in the active Worker version`,
        'CHATWOOT_PREFLIGHT_UNSAFE_FLAG',
        { flag },
      );
    }
    falseFlags[flag] = false;
  }
  const baseUrl = requireText(source.CHATWOOT_BASE_URL, 'remote.CHATWOOT_BASE_URL');
  const externalAccountId = requireText(source.CHATWOOT_ACCOUNT_ID, 'remote.CHATWOOT_ACCOUNT_ID');
  const baseUrlSha256 = sha256(baseUrl);
  const externalAccountIdSha256 = sha256(externalAccountId);
  if (baseUrlSha256 !== target.expectedBaseUrlSha256
    || externalAccountIdSha256 !== target.expectedExternalAccountIdSha256) {
    throw preflightError(
      'Remote Chatwoot identity does not match the approved fingerprints',
      'CHATWOOT_PREFLIGHT_IDENTITY_MISMATCH',
    );
  }
  return deepFreeze({
    falseFlags,
    flagFingerprint: sha256(stableStringify(falseFlags)),
    baseUrlSha256,
    externalAccountIdSha256,
  });
}

export function parseSecretNames(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  const list = Array.isArray(parsed) ? parsed : (parsed?.result ?? []);
  return Object.freeze([...new Set(list
    .map((item) => optionalText(item?.name))
    .filter(Boolean))].sort());
}

export function validateSecretNames(names) {
  const available = new Set(names ?? []);
  const missingRequired = CHATWOOT_PREFLIGHT_REQUIRED_SECRET_NAMES.filter((name) => !available.has(name));
  if (missingRequired.length > 0) {
    throw preflightError(
      `Required Chatwoot Worker Secret names are missing: ${missingRequired.join(', ')}`,
      'CHATWOOT_PREFLIGHT_REQUIRED_SECRET_MISSING',
      { missingRequired },
    );
  }
  return deepFreeze({
    requiredPresent: CHATWOOT_PREFLIGHT_REQUIRED_SECRET_NAMES.length,
    optionalPresent: CHATWOOT_PREFLIGHT_OPTIONAL_SECRET_NAMES.filter((name) => available.has(name)).length,
    secretNameCount: available.size,
    secretNameFingerprint: sha256(stableStringify([...available].sort())),
  });
}

export function parsePendingMigrations(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return Object.freeze([...new Set(text.match(MIGRATION_FILE) ?? [])].sort());
}

export function parseAppliedMigrations(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  const found = new Set();
  visit(parsed);
  return Object.freeze([...found].sort());

  function visit(node) {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const raw of Object.values(node)) {
      if (typeof raw === 'string' && /^\d{4}_[A-Za-z0-9_.-]+\.sql$/u.test(raw)) found.add(raw);
      else visit(raw);
    }
  }
}

export function validateMigrationLedger({ applied, pending }) {
  const appliedSet = new Set(applied ?? []);
  const pendingSet = new Set(pending ?? []);
  if (!appliedSet.has(CHATWOOT_PREFLIGHT_APPLIED_MIGRATION)) {
    throw preflightError(
      `Applied migration ledger is missing ${CHATWOOT_PREFLIGHT_APPLIED_MIGRATION}`,
      'CHATWOOT_PREFLIGHT_MIGRATION_0017_NOT_APPLIED',
    );
  }
  if (appliedSet.has(CHATWOOT_PREFLIGHT_PENDING_MIGRATION)) {
    throw preflightError(
      `${CHATWOOT_PREFLIGHT_PENDING_MIGRATION} is already applied; stop and reconcile the ledger`,
      'CHATWOOT_PREFLIGHT_MIGRATION_0018_ALREADY_APPLIED',
    );
  }
  if (!pendingSet.has(CHATWOOT_PREFLIGHT_PENDING_MIGRATION)) {
    throw preflightError(
      `Pending migration list does not contain ${CHATWOOT_PREFLIGHT_PENDING_MIGRATION}`,
      'CHATWOOT_PREFLIGHT_MIGRATION_0018_NOT_PENDING',
    );
  }
  const unexpectedPending = [...pendingSet].filter((name) => name !== CHATWOOT_PREFLIGHT_PENDING_MIGRATION);
  if (unexpectedPending.length > 0) {
    throw preflightError(
      `Unexpected pending migrations block Chatwoot rollout: ${unexpectedPending.join(', ')}`,
      'CHATWOOT_PREFLIGHT_UNEXPECTED_PENDING_MIGRATIONS',
      { unexpectedPending },
    );
  }
  return deepFreeze({
    appliedMigrationPresent: true,
    pendingMigration: CHATWOOT_PREFLIGHT_PENDING_MIGRATION,
    unexpectedPending: [],
  });
}

export function parseQueueConsumers(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  const list = Array.isArray(parsed) ? parsed : (parsed?.result ?? parsed?.consumers ?? []);
  return Object.freeze(list.map((item) => ({
    queueName: optionalText(item?.queue_name ?? item?.queue ?? item?.name),
    serviceName: optionalText(item?.service_name ?? item?.script_name ?? item?.script),
    deadLetterQueue: optionalText(item?.dead_letter_queue ?? item?.dead_letter_queue_name),
    maxRetries: numberOrNull(item?.settings?.max_retries ?? item?.max_retries),
  })));
}

export function validateQueueConsumers({ mainConsumers, dlqConsumers, target }) {
  const main = mainConsumers ?? [];
  const dlq = dlqConsumers ?? [];
  if (main.length < 1 || dlq.length < 1) {
    throw preflightError(
      'Main Queue and DLQ must each have at least one active consumer',
      'CHATWOOT_PREFLIGHT_QUEUE_CONSUMER_MISSING',
    );
  }
  const normalized = [...main, ...dlq].map((item) => ({
    queueName: item.queueName,
    serviceName: item.serviceName,
    deadLetterQueue: item.deadLetterQueue,
    maxRetries: item.maxRetries,
  }));
  const names = new Set(normalized.map((item) => item.queueName).filter(Boolean));
  if (names.size > 0 && (!names.has(target.mainQueueName) || !names.has(target.dlqName))) {
    throw preflightError(
      'Remote Queue consumer names do not match the protected Integration Workspace queues',
      'CHATWOOT_PREFLIGHT_QUEUE_IDENTITY_MISMATCH',
    );
  }
  return deepFreeze({
    mainConsumerCount: main.length,
    dlqConsumerCount: dlq.length,
    consumerFingerprint: sha256(stableStringify(normalized)),
  });
}

export function validateRemoteTriggerState({ scriptList, schedules, subdomain, target }) {
  const scripts = Array.isArray(scriptList) ? scriptList : (scriptList?.result ?? []);
  const worker = scripts.find((item) => item?.id === target.workerName || item?.name === target.workerName);
  if (!worker) {
    throw preflightError(
      'Protected Worker is missing from the Cloudflare account script list',
      'CHATWOOT_PREFLIGHT_WORKER_MISSING',
    );
  }
  const scheduleList = Array.isArray(schedules) ? schedules : (schedules?.result ?? []);
  const crons = scheduleList
    .map((item) => optionalText(item?.cron))
    .filter(Boolean)
    .sort();
  const expected = [...CHATWOOT_PREFLIGHT_EXPECTED_CRONS].sort();
  if (stableStringify(crons) !== stableStringify(expected)) {
    throw preflightError(
      'Remote Worker Cron schedules do not match the reviewed Integration Workspace contract',
      'CHATWOOT_PREFLIGHT_CRON_MISMATCH',
      { cronCount: crons.length },
    );
  }
  const workersDevEnabled = Boolean(subdomain?.result?.enabled ?? subdomain?.enabled);
  if (workersDevEnabled) {
    throw preflightError(
      'workers.dev must remain disabled for the protected Worker',
      'CHATWOOT_PREFLIGHT_WORKERS_DEV_ENABLED',
    );
  }
  return deepFreeze({
    workerPresent: true,
    cronCount: crons.length,
    cronFingerprint: sha256(stableStringify(crons)),
    workersDevEnabled: false,
  });
}

export function createChatwootPreflightEvidence(input = {}) {
  const evidence = {
    contractVersion: CHATWOOT_PREFLIGHT_CONTRACT_VERSION,
    phase: 'preflight',
    repositoryHead: requirePattern(input.repositoryHead, 'repositoryHead', FULL_GIT_SHA),
    targetFingerprint: requirePattern(input.targetFingerprint, 'targetFingerprint', SHA256),
    createdAt: requireText(input.createdAt ?? new Date().toISOString(), 'createdAt'),
    data: deepFreeze(input.data ?? {}),
  };
  return deepFreeze({
    ...evidence,
    evidenceSha256: sha256(stableStringify(evidence)),
  });
}

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}

function requireExact(value, expected, fieldName) {
  const text = requireText(value, fieldName);
  if (text !== expected) {
    throw preflightError(`${fieldName} must equal ${expected}`, 'CHATWOOT_PREFLIGHT_TARGET_INVALID', {
      fieldName,
    });
  }
  return text;
}

function requirePattern(value, fieldName, pattern) {
  const text = requireText(value, fieldName);
  if (!pattern.test(text)) {
    throw preflightError(`${fieldName} has an invalid format`, 'CHATWOOT_PREFLIGHT_TARGET_INVALID', {
      fieldName,
    });
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw preflightError(`${fieldName} is required`, 'CHATWOOT_PREFLIGHT_TARGET_INVALID', {
      fieldName,
    });
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isScalar(value) {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function preflightError(message, code, details = undefined) {
  return permanentError(message, { code, ...(details ? { details } : {}) });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
