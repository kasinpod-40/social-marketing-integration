import {
  JOB_IMPLEMENTATION_STATUS,
  JOB_TRIGGERS,
  JOB_TYPES,
  getJobDefinition,
} from '../../../packages/application/src/jobs/job-catalog.js';
import { assertConnectorRunnable } from '../../../packages/application/src/connectors/connector-registry.js';
import { withQueueOperation } from '../../../packages/application/src/jobs/queue-operation.js';
import { processMetaEndToEndSync } from '../../../packages/application/src/use-cases/process-meta-end-to-end-sync.js';
import {
  META_END_TO_END_LARK_TABLES,
  loadMetaEndToEndRuntimeConfig,
} from '../../../packages/config/src/meta-end-to-end-runtime-config.js';
import { isReviewedConnectorRuntime } from '../../../packages/config/src/customer-profiles.js';
import { readLarkTableIdsFromEnv } from '../../../packages/config/src/lark-table-config.js';
import { createMetaTokenConnectionRuntime } from '../../../packages/connectors/src/meta/meta-token-connection-runtime.js';
import { normalizeMetaAdAccountId } from '../../../packages/connectors/src/meta/meta-business-source.helpers.js';
import { runReliableSync } from '../../../packages/reliability/src/reliable-sync-runner.js';
import { permanentError, transientError } from '../../../packages/shared/src/errors/runtime-error.js';
import { createMetaEndToEndJobRouter } from './meta-end-to-end-job-router.js';
import { processJobWithTikTokD1AwareReport } from './tiktok-d1-aware-report-job-router.js';
import {
  DEFAULT_LOCK_LEASE_MS,
  DEFAULT_LOCK_RENEW_INTERVAL_MS,
  logQueueResult,
  readAttempts,
  readBoolean,
  readPositiveInteger,
  requireJobText,
  sanitizeReliabilityEvent,
} from './worker-runtime-support.js';

const META_JOB_TYPES = new Set([
  JOB_TYPES.FACEBOOK_ORGANIC_SYNC,
  JOB_TYPES.INSTAGRAM_ORGANIC_SYNC,
  JOB_TYPES.META_ADS_SYNC,
]);
const META_ORGANIC_JOB_TYPES = new Set([
  JOB_TYPES.FACEBOOK_ORGANIC_SYNC,
  JOB_TYPES.INSTAGRAM_ORGANIC_SYNC,
]);
const CONTINUATION_STATUSES = new Set([
  'source_continuation',
  'd1_continuation',
  'lark_continuation',
]);

/** Integration Workspace route for reviewed Meta Organic and Meta Ads jobs. */
export async function processJobWithMetaEndToEnd(input = {}) {
  const type = input.job?.body?.type;
  if (!META_JOB_TYPES.has(type)) return processJobWithTikTokD1AwareReport(input);

  const runtimeConfig = loadMetaEndToEndRuntimeConfig(input.env);
  const router = createMetaEndToEndJobRouter({
    runtimeConfig,
    handlers: {
      facebook: () => processMetaJob(input, 'facebook', runtimeConfig),
      instagram: () => processMetaJob(input, 'instagram', runtimeConfig),
      meta_ads: () => processMetaJob(input, 'meta_ads', runtimeConfig),
    },
  });
  return router.route(input.job.body, {
    dryRun: input.job.body?.dryRun === true,
    d1Only: input.job.body?.d1Only === true,
  });
}

async function processMetaJob(input, connectorKey, metaConfig) {
  const definition = getJobDefinition(input.job.body.type);
  assertMetaJobDefinition(definition, connectorKey, input.job.body);
  const customerRuntime = input.getRuntimeConfig();
  const connectorConfig = assertMetaManualUatRuntime(customerRuntime, connectorKey, input.env);
  const operation = requireStableOperation(input.operation);
  const dateRange = readDateRange(input.job.body);
  const infrastructure = input.getInfrastructure();
  const sourceRuntime = createMetaTokenConnectionRuntime({
    ...input.env,
    META_PAGE_SIZE: String(metaConfig.limits.sourcePageSize),
    META_MAX_PAGES: String(metaConfig.limits.sourceMaxPages),
  });
  const source = resolveMetaSourceRuntime(sourceRuntime, connectorKey, input.job.body);
  const larkEnabled = metaConfig.flags.larkWrite === true
    && input.job.body?.dryRun !== true
    && input.job.body?.d1Only !== true;
  const requestedLarkTableKeys = larkEnabled
    ? resolveMetaLarkTableKeys(connectorKey, input.job.body)
    : null;
  const effectiveLarkTableKeys = requestedLarkTableKeys ?? tableKeysFor(connectorKey);
  const readTableIds = larkEnabled
    ? readLarkTableIdsFromEnv(input.env, effectiveLarkTableKeys)
    : Object.freeze({});
  const tableIds = larkEnabled
    ? Object.freeze({
      ...readTableIds,
      __metaLarkTableKeys: requestedLarkTableKeys,
    })
    : readTableIds;
  const reliability = infrastructure.getReliability();
  const operationScope = source.sourceAccountKey ?? connectorKey;
  const deterministicSyncRunId = `meta:${connectorKey}:${operationScope}:${operation.operationId}`;
  const scheduled = input.job.body.trigger === JOB_TRIGGERS.META_ORGANIC_SCHEDULED;
  const reliabilitySyncType = connectorKey === 'meta_ads'
    ? `${scheduled ? 'scheduled' : 'manual'}_end_to_end_${operationScope}`
    : scheduled
      ? 'scheduled_end_to_end'
      : 'manual_end_to_end';

  const result = await runReliableSync({
    syncRunId: deterministicSyncRunId,
    store: reliability.store,
    lockManager: reliability.lockManager,
    customerProfile: customerRuntime.profileKey,
    accountKey: connectorConfig.accountKey,
    platform: connectorKey,
    source: 'meta_graph_api',
    syncType: reliabilitySyncType,
    retryCount: Math.max(0, Number(input.mainQueueAttempts ?? readAttempts(input.message)) - 1),
    leaseMs: readPositiveInteger(input.env?.MKT_SYNC_LOCK_LEASE_MS, DEFAULT_LOCK_LEASE_MS),
    renewIntervalMs: readPositiveInteger(
      input.env?.MKT_SYNC_LOCK_RENEW_INTERVAL_MS,
      DEFAULT_LOCK_RENEW_INTERVAL_MS,
    ),
    alertOnRetryableFailure: false,
    onReliabilityError: (event) => logQueueResult({
      ok: false,
      scope: 'meta_reliability',
      ...sanitizeReliabilityEvent(event),
    }),
    execute: ({ syncRunId, lockKey, assertLockActive }) => processMetaEndToEndSync({
      connectorKey,
      jobType: definition.type,
      operation,
      syncRunId,
      cursorKey: lockKey,
      assertLockActive,
      adapter: source.adapter,
      sourceAccountId: source.sourceAccountId,
      accountKey: connectorConfig.accountKey,
      customerProfile: customerRuntime.profileKey,
      customerKey: customerRuntime.customerKey,
      sourceTimezone: input.env?.DEFAULT_TIMEZONE ?? 'Asia/Bangkok',
      dateRange,
      sourceReadOnly: input.job.body?.dryRun === true,
      d1WriteEnabled: metaConfig.flags.d1Write === true && input.job.body?.dryRun !== true,
      larkWriteEnabled: larkEnabled,
      resumableWorkStore: infrastructure.getResumableWorkStore(),
      historyStore: metaConfig.flags.d1Write === true
        ? infrastructure.getMarketingHistoryStore()
        : null,
      organicHistoryGateway: metaConfig.flags.d1Write === true && connectorKey !== 'meta_ads'
        ? infrastructure.getOrganicHistoryGateway()
        : null,
      repository: larkEnabled ? infrastructure.repository : null,
      syncEngine: larkEnabled ? infrastructure.syncEngine : null,
      tables: tableIds,
      limits: metaConfig.limits,
    }),
  });

  if (CONTINUATION_STATUSES.has(result.status)) {
    await enqueueMetaContinuation({ input, operation, connectorKey, result });
  }
  await infrastructure.getResumableWorkStore().cleanupExpiredWork({ limit: 25 });
  return result;
}

/**
 * Compatibility export retained for existing UAT callers.
 * ชื่อ export เดิมคงไว้เพื่อไม่ทำลาย Operator เก่า แต่ทั้งสาม Connectorใช้ Active contract เดียวกัน.
 */
export function assertMetaManualUatRuntime(runtimeConfig, connectorKey, env = {}) {
  if (!isReviewedConnectorRuntime(runtimeConfig)) {
    throw permanentError('Meta runtime requires the reviewed Integration or customer Production ownership tuple', {
      code: 'META_MANUAL_UAT_TARGET_INVALID',
    });
  }
  const connector = assertConnectorRunnable(runtimeConfig, connectorKey);
  if (!connector
    || connector.accountKey !== 'chemistry_k'
    || connector.enabled !== true) {
    throw permanentError('Meta connector is disabled or outside the allowed Integration runtime', {
      code: 'META_MANUAL_UAT_CONNECTOR_INVALID',
      details: { connectorKey },
    });
  }
  if (!readBoolean(env?.MKT_META_SOURCE_READ_ENABLED, false)) {
    throw permanentError('Meta source-read gate is disabled', {
      code: 'META_END_TO_END_GATES_DISABLED',
      details: { missingFlags: ['MKT_META_SOURCE_READ_ENABLED'] },
    });
  }
  return connector;
}

function assertMetaJobDefinition(definition, connectorKey, body) {
  if (definition?.connectorKey !== connectorKey) {
    throw permanentError('Meta Queue job connector binding is invalid', {
      code: 'META_END_TO_END_JOB_UNSUPPORTED',
      details: { type: definition?.type ?? null, connectorKey },
    });
  }

  if (definition?.implementationStatus !== JOB_IMPLEMENTATION_STATUS.ACTIVE
    || definition?.manualOnly === true
    || !definition?.allowedTriggers?.includes(body?.trigger)
    || (connectorKey !== 'meta_ads' && !META_ORGANIC_JOB_TYPES.has(definition?.type))) {
    throw permanentError('Meta Queue job trigger is not activated', {
      code: 'META_END_TO_END_JOB_UNSUPPORTED',
      details: { type: definition?.type ?? null, connectorKey, trigger: body?.trigger ?? null },
    });
  }
  if (body?.trigger === JOB_TRIGGERS.META_ORGANIC_SCHEDULED
    && (body?.dryRun === true || body?.d1Only === true)) {
    throw permanentError('Scheduled Meta job cannot reduce into dry-run or D1-only mode', {
      code: 'META_END_TO_END_JOB_INVALID',
    });
  }

  if (body?.dryRun === true && body?.d1Only === true) {
    throw permanentError('Meta dry-run and d1Only cannot be combined', {
      code: 'META_END_TO_END_JOB_INVALID',
    });
  }
  if (body?.larkTableKeys !== undefined && body?.larkTableKeys !== null
    && (body?.trigger !== JOB_TRIGGERS.META_MANUAL_UAT
      || body?.dryRun === true
      || body?.d1Only === true)) {
    throw permanentError('Meta Lark table scope is allowed only for manual Lark execution', {
      code: 'META_END_TO_END_LARK_TABLE_SCOPE_INVALID',
      details: { connectorKey, trigger: body?.trigger ?? null },
    });
  }
}

export function resolveMetaSourceRuntime(runtime, connectorKey, body = {}) {
  const adapter = runtime?.sources?.[connectorKey];
  if (!adapter) {
    throw permanentError('Meta source credential or exact identity mapping is unavailable', {
      code: 'META_CONNECTION_CONFIG_INVALID',
      details: { connectorKey },
    });
  }
  if (connectorKey === 'meta_ads') {
    const sourceAccountKey = normalizeMetaSourceAccountKey(
      requireJobText(body?.sourceAccountKey, 'sourceAccountKey'),
    );
    const accounts = Array.isArray(runtime?.mappings?.metaAdAccounts)
      ? runtime.mappings.metaAdAccounts
      : [];
    const selected = accounts.find((entry) => entry?.key === sourceAccountKey);
    if (!selected?.accountId) {
      throw permanentError('Meta Ads source account is not configured for this Runtime', {
        code: 'META_AD_ACCOUNT_MAPPING_NOT_CONFIGURED',
        details: { configuredAccountCount: accounts.length },
      });
    }
    return Object.freeze({
      adapter,
      sourceAccountKey,
      sourceAccountId: normalizeMetaAdAccountId(selected.accountId),
    });
  }

  const mapping = connectorKey === 'facebook'
    ? runtime?.mappings?.facebookPageId
    : runtime?.mappings?.instagramAccountId;
  if (!mapping) {
    throw permanentError('Meta source credential or exact identity mapping is unavailable', {
      code: 'META_CONNECTION_CONFIG_INVALID',
      details: { connectorKey },
    });
  }
  return Object.freeze({
    adapter,
    sourceAccountKey: null,
    sourceAccountId: requireJobText(mapping, `${connectorKey}.sourceAccountId`),
  });
}

function normalizeMetaSourceAccountKey(value) {
  const text = requireJobText(value, 'sourceAccountKey').toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(text)) {
    throw permanentError('Meta Ads sourceAccountKey is invalid', {
      code: 'META_AD_ACCOUNT_KEY_INVALID',
    });
  }
  return text;
}

async function enqueueMetaContinuation({ input, operation, connectorKey, result }) {
  const queue = input.env?.MKT_SYNC_QUEUE;
  if (typeof queue?.send !== 'function') {
    throw transientError('Meta continuation Queue binding is unavailable', {
      code: 'META_CONTINUATION_QUEUE_UNAVAILABLE',
    });
  }
  const body = withQueueOperation({
    ...input.job.body,
    schemaVersion: input.job.schemaVersion ?? input.job.body.schemaVersion ?? 1,
    trigger: input.job.body.trigger,
    continuation: true,
    continuationStatus: result.status,
    continuationPhase: result.continuationPhase ?? null,
    connectorKey,
  }, operation);
  await queue.send(body);
}

function resolveMetaLarkTableKeys(connectorKey, body = {}) {
  if (body?.larkTableKeys === undefined || body?.larkTableKeys === null) return null;
  if (body?.trigger !== JOB_TRIGGERS.META_MANUAL_UAT
    || body?.dryRun === true
    || body?.d1Only === true
    || !Array.isArray(body.larkTableKeys)
    || body.larkTableKeys.length === 0) {
    throw permanentError('Meta Lark table scope is invalid', {
      code: 'META_END_TO_END_LARK_TABLE_SCOPE_INVALID',
      details: { connectorKey },
    });
  }
  const tableKeys = body.larkTableKeys.map((value, index) => requireJobText(
    value,
    `larkTableKeys[${index}]`,
  ));
  const unique = new Set(tableKeys);
  const allowed = new Set(tableKeysFor(connectorKey));
  const invalidKeys = tableKeys.filter((tableKey) => !allowed.has(tableKey));
  if (unique.size !== tableKeys.length || invalidKeys.length > 0) {
    throw permanentError('Meta Lark table scope contains duplicate or unavailable contracts', {
      code: 'META_END_TO_END_LARK_TABLE_SCOPE_INVALID',
      details: {
        connectorKey,
        invalidKeys: Object.freeze([...new Set(invalidKeys)].sort()),
        duplicateTableKeys: unique.size !== tableKeys.length,
      },
    });
  }
  return Object.freeze([...tableKeys]);
}

function tableKeysFor(connectorKey) {
  const prefixes = connectorKey === 'meta_ads'
    ? ['canonical.ads']
    : ['canonical.accounts', 'canonical.accountDaily', 'canonical.content'];
  return Object.freeze(META_END_TO_END_LARK_TABLES
    .filter((entry) => prefixes.some((prefix) => entry.path.startsWith(prefix)))
    .map((entry) => entry.tableKey));
}

function readDateRange(body) {
  const since = body?.periodStart;
  const until = body?.periodEnd;
  if (!since || !until) {
    throw permanentError('Meta end-to-end requires periodStart and periodEnd', {
      code: 'META_END_TO_END_DATE_RANGE_REQUIRED',
    });
  }
  return Object.freeze({
    since: requireDate(since, 'periodStart'),
    until: requireDate(until, 'periodEnd'),
  });
}

function requireStableOperation(value) {
  if (!value?.stable
    || typeof value.operationId !== 'string'
    || typeof value.workKey !== 'string'
    || !Number.isSafeInteger(value.generation)
    || !Number.isSafeInteger(value.originalRequestedAt)) {
    throw permanentError('Meta end-to-end requires stable Queue operation metadata', {
      code: 'META_END_TO_END_QUEUE_OPERATION_REQUIRED',
    });
  }
  return value;
}

function requireDate(value, fieldName) {
  const text = requireJobText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw permanentError(`${fieldName} must be YYYY-MM-DD`, {
      code: 'META_END_TO_END_DATE_RANGE_INVALID',
    });
  }
  return text;
}
