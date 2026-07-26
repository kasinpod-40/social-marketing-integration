import { auditTikTokPostLarkPipeline } from '../../../packages/application/src/use-cases/audit-tiktok-post-lark-pipeline.js';
import { loadCustomerRuntimeConfig } from '../../../packages/config/src/customer-profiles.js';
import { readLarkTableIdsFromEnv } from '../../../packages/config/src/lark-table-config.js';
import { D1TikTokPostLarkAuditStore } from '../../../packages/connectors/src/tiktok/d1-tiktok-post-lark-audit-store.js';
import { sanitizeOperationalError } from '../../../packages/shared/src/errors/runtime-error.js';
import { json } from '../../../packages/shared/src/http/response.js';
import { timingSafeEqualText } from '../../../packages/shared/src/security/secure-token.js';
import { createInfrastructure } from './runtime-infrastructure.js';

export const TIKTOK_POST_LARK_AUDIT_PATH = '/operator/tiktok/post-lark-audit';

/** Guarded GET-only diagnostics route. It has no Queue, D1 write or Lark write dependency. */
export function createTikTokPostLarkAuditHttpHandler(dependencies = {}) {
  const infrastructureFactory = dependencies.createInfrastructure ?? createInfrastructure;
  const runtimeLoader = dependencies.loadRuntimeConfig ?? loadCustomerRuntimeConfig;
  const auditUseCase = dependencies.audit ?? auditTikTokPostLarkPipeline;
  const auditStoreFactory = dependencies.createAuditStore
    ?? ((env) => new D1TikTokPostLarkAuditStore({ db: env?.MKT_STATE_DB }));

  return async function handleTikTokPostLarkAudit(context) {
    const { request, env, url } = context;
    if (url.pathname !== TIKTOK_POST_LARK_AUDIT_PATH) return null;
    if (request.method !== 'GET') {
      return json({ ok: false, error: 'Method not allowed' }, {
        status: 405,
        headers: { allow: 'GET', 'cache-control': 'no-store' },
      });
    }

    try {
      if (!readBoolean(env?.MKT_TIKTOK_AUDIT_HTTP_ENABLED, false)) {
        return json({ ok: false, error: 'Route not found' }, {
          status: 404,
          headers: { 'cache-control': 'no-store' },
        });
      }
      await requireOperatorAuthorization(request, env?.MKT_CONNECTION_OPERATOR_TOKEN);
      const runtimeConfig = runtimeLoader(env);
      if (runtimeConfig.environment !== 'development'
        || runtimeConfig.profileKey !== 'integration_workspace') {
        const error = new Error('TikTok audit is restricted to the Integration Workspace');
        error.code = 'TIKTOK_POST_LARK_AUDIT_ENVIRONMENT_BLOCKED';
        throw error;
      }
      const connector = runtimeConfig.connectors?.tiktok;
      const tableIds = readLarkTableIdsFromEnv(env, [
        'rawTikTokCreatorVideos',
        'mktContent',
        'mktContentDaily',
      ]);
      const infrastructure = infrastructureFactory(env);
      const result = await auditUseCase({
        repository: infrastructure.repository,
        d1AuditStore: auditStoreFactory(env),
        customerKey: runtimeConfig.customerKey,
        accountKey: requireText(connector?.accountKey, 'tiktok.accountKey'),
        sourceHandle: requireText(connector?.sourceHandle, 'tiktok.sourceHandle'),
        pageSize: readPositiveInteger(env?.MKT_TIKTOK_SOURCE_PAGE_SIZE, 500),
        maxPages: readPositiveInteger(env?.MKT_TIKTOK_SOURCE_MAX_PAGES ?? env?.LARK_MAX_PAGES, 1_000),
        tables: tableIds,
      });
      return json({ ok: true, audit: result }, {
        status: 200,
        headers: {
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
        },
      });
    } catch (error) {
      const operational = sanitizeOperationalError(error);
      const status = operational.code === 'TIKTOK_POST_LARK_AUDIT_UNAUTHORIZED' ? 401 : 400;
      return json({
        ok: false,
        error: status === 401 ? 'Unauthorized' : 'TikTok audit failed',
        code: operational.code,
      }, {
        status,
        headers: {
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
        },
      });
    }
  };
}

async function requireOperatorAuthorization(request, expectedToken) {
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer[ \t]+(.+)$/iu.exec(authorization);
  const supplied = match?.[1]?.trim() ?? '';
  const valid = await timingSafeEqualText(supplied, requireText(expectedToken, 'operatorToken'));
  if (!match || !valid) {
    const error = new Error('TikTok audit operator authorization was rejected');
    error.code = 'TIKTOK_POST_LARK_AUDIT_UNAUTHORIZED';
    throw error;
  }
}

function readBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === false) return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  const error = new Error('MKT_TIKTOK_AUDIT_HTTP_ENABLED must be true or false');
  error.code = 'TIKTOK_POST_LARK_AUDIT_CONFIG_INVALID';
  throw error;
}

function readPositiveInteger(value, fallback) {
  const number = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    const error = new Error('TikTok audit bound must be a positive integer');
    error.code = 'TIKTOK_POST_LARK_AUDIT_CONFIG_INVALID';
    throw error;
  }
  return number;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    const error = new Error(`${fieldName} is required`);
    error.code = 'TIKTOK_POST_LARK_AUDIT_CONFIG_INVALID';
    throw error;
  }
  return value.trim();
}
