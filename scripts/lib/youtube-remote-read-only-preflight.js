const VERSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function preflightError(message, code, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = Object.freeze({ ...details });
  return error;
}
