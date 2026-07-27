const VERSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SEMANTIC_DECISION = /^[A-Z][A-Z0-9_]+$/u;
const CLOUDFLARE_D1_INTERNAL_ERROR_CODE = 7500;

export const YOUTUBE_REMOTE_READ_ONLY_DECISIONS = Object.freeze({
  PASS: 'PASS_READ_ONLY_PREFLIGHT',
  PENDING_CHATWOOT: 'BLOCKED_PENDING_MIGRATION_0018',
  WOOCOMMERCE_TRUTH_DRIFT: 'BLOCKED_MIGRATION_0017_REMOTE_TRUTH',
  OTHER_PENDING: 'BLOCKED_PENDING_MIGRATIONS',
});

export function parsePendingMigrationNames(value) {
  if (typeof value !== 'string') {
    throw preflightError(
      'Wrangler migration output must be text',
      'YOUTUBE_REMOTE_PREFLIGHT_MIGRATION_OUTPUT_INVALID',
    );
  }
  return Object.freeze([...new Set(
    [...value.matchAll(/\b\d{4}_[A-Za-z0-9_.-]+\.sql\b/gu)].map((match) => match[0]),
  )].sort());
}

export function parseSingleActiveDeployment(value) {
  const item = Array.isArray(value) ? value[0] : value;
  const versions = Array.isArray(item?.versions) ? item.versions : [];
  const active = versions.filter((version) => Number(version?.percentage) === 100);
  if (versions.length !== 1 || active.length !== 1) {
    throw preflightError(
      'Remote Worker must have exactly one active version at 100 percent traffic',
      'YOUTUBE_REMOTE_PREFLIGHT_ACTIVE_VERSION_INVALID',
      { versionCount: versions.length, activeCount: active.length },
    );
  }
  const versionId = text(active[0]?.version_id ?? active[0]?.versionId);
  if (!versionId || !VERSION_ID.test(versionId)) {
    throw preflightError(
      'Remote Worker active version ID is missing or malformed',
      'YOUTUBE_REMOTE_PREFLIGHT_ACTIVE_VERSION_INVALID',
    );
  }
  return Object.freeze({
    deploymentId: text(item?.id),
    versionId: versionId.toLowerCase(),
    traffic: 100,
  });
}

export function assertStableActiveDeployment(before, after) {
  const left = parseSingleActiveDeployment(before);
  const right = parseSingleActiveDeployment(after);
  if (left.versionId !== right.versionId) {
    throw preflightError(
      'Active Worker version changed during read-only inspection',
      'BLOCKED_ACTIVE_VERSION_CHANGED',
      { before: left.versionId, after: right.versionId },
    );
  }
  return Object.freeze({
    versionId: left.versionId,
    traffic: 100,
    stable: true,
  });
}

/**
 * Retry only the known transient Cloudflare D1 internal-read failure. Authentication, target,
 * config, migration, parser and every other command error remain single-attempt fail-closed.
 */
export async function readYouTubeD1MigrationListWithRetry(input = {}) {
  const run = requireFunction(input.run, 'run');
  const sleep = input.sleep === undefined
    ? sleepMilliseconds
    : requireFunction(input.sleep, 'sleep');
  const maxAttempts = boundedInteger(input.maxAttempts ?? 3, 'maxAttempts', 1, 5);
  const baseDelayMs = boundedInteger(input.baseDelayMs ?? 1_000, 'baseDelayMs', 0, 30_000);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const migrationText = await run({ attempt });
      if (typeof migrationText !== 'string') {
        throw preflightError(
          'Wrangler migration output must be text',
          'YOUTUBE_REMOTE_PREFLIGHT_MIGRATION_OUTPUT_INVALID',
        );
      }
      return Object.freeze({
        text: migrationText,
        attempts: attempt,
        transientRetries: attempt - 1,
      });
    } catch (cause) {
      if (!isRetryableCloudflareD1MigrationReadError(cause)) {
        if (typeof cause?.code === 'string' && SEMANTIC_DECISION.test(cause.code)) throw cause;
        throw preflightError(
          'Cloudflare D1 migration-list read failed',
          'YOUTUBE_REMOTE_PREFLIGHT_D1_MIGRATION_READ_FAILED',
          { attempts: attempt, retryable: false },
        );
      }
      if (attempt >= maxAttempts) {
        throw preflightError(
          'Cloudflare D1 migration-list read exhausted bounded transient retries',
          'YOUTUBE_REMOTE_PREFLIGHT_D1_MIGRATION_READ_TRANSIENT_EXHAUSTED',
          {
            attempts: attempt,
            transientRetries: attempt - 1,
            cloudflareCode: CLOUDFLARE_D1_INTERNAL_ERROR_CODE,
          },
        );
      }
      await sleep(baseDelayMs * attempt);
    }
  }

  throw preflightError(
    'Cloudflare D1 migration-list retry state is invalid',
    'YOUTUBE_REMOTE_PREFLIGHT_D1_MIGRATION_READ_FAILED',
  );
}

export function isRetryableCloudflareD1MigrationReadError(error) {
  const output = stripAnsi([
    error?.message,
    error?.stderr,
    error?.stdout,
    error?.cause?.message,
    error?.cause?.stderr,
  ].filter((value) => value !== undefined && value !== null).join('\n'));
  return /\binternal error\b/iu.test(output)
    && /(?:\[code:\s*7500\]|\bcode\s*[:=]\s*7500\b)/iu.test(output);
}

export function normalizeYouTubeRemotePreflightDecision(value, fallback = 'BLOCKED_REMOTE_CONTRACT') {
  const decision = typeof value === 'string' ? value.trim() : '';
  return SEMANTIC_DECISION.test(decision) ? decision : fallback;
}

export function classifyYouTubeRemoteReadOnlyPreflight(input = {}) {
  const pendingMigrations = Object.freeze([
    ...new Set(Array.isArray(input.pendingMigrations) ? input.pendingMigrations : []),
  ].sort());
  let decision = YOUTUBE_REMOTE_READ_ONLY_DECISIONS.PASS;
  if (pendingMigrations.includes('0017_woocommerce_commerce.sql')) {
    decision = YOUTUBE_REMOTE_READ_ONLY_DECISIONS.WOOCOMMERCE_TRUTH_DRIFT;
  } else if (
    pendingMigrations.length === 1
    && pendingMigrations[0] === '0018_chatwoot_analytics.sql'
  ) {
    decision = YOUTUBE_REMOTE_READ_ONLY_DECISIONS.PENDING_CHATWOOT;
  } else if (pendingMigrations.length > 0) {
    decision = YOUTUBE_REMOTE_READ_ONLY_DECISIONS.OTHER_PENDING;
  }
  return Object.freeze({
    decision,
    pendingMigrations,
    migration0017: pendingMigrations.includes('0017_woocommerce_commerce.sql')
      ? 'PENDING_UNEXPECTED_DO_NOT_RERUN'
      : 'NOT_PENDING',
    migration0018: pendingMigrations.includes('0018_chatwoot_analytics.sql')
      ? 'PENDING'
      : 'NOT_PENDING',
  });
}

function stripAnsi(value) {
  return String(value ?? '').replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '');
}

function boundedInteger(value, fieldName, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw preflightError(
      `${fieldName} must be an integer from ${minimum} to ${maximum}`,
      'YOUTUBE_REMOTE_PREFLIGHT_RETRY_CONFIG_INVALID',
      { fieldName },
    );
  }
  return number;
}

function requireFunction(value, fieldName) {
  if (typeof value !== 'function') {
    throw preflightError(
      `${fieldName} must be a function`,
      'YOUTUBE_REMOTE_PREFLIGHT_RETRY_CONFIG_INVALID',
      { fieldName },
    );
  }
  return value;
}

function sleepMilliseconds(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function preflightError(message, code, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = Object.freeze({ ...details });
  return error;
}
