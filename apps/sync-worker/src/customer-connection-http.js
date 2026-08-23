import { json } from '../../../packages/shared/src/http/response.js';
import {
  sanitizeOperationalError,
  sanitizeOperationalValue,
} from '../../../packages/shared/src/errors/runtime-error.js';
import { timingSafeEqualText } from '../../../packages/shared/src/security/secure-token.js';
import { createCustomerConnectionRuntime } from './customer-connection-runtime.js';
import {
  createGoogleAdsCustomerConnectionHttpHandler,
  GOOGLE_ADS_CONNECTION_PATHS,
} from './google-ads-customer-connection-http.js';
import {
  createMetaD1OnlyPartialStagingRecoveryHttpHandler,
  META_D1_ONLY_PARTIAL_STAGING_RECOVERY_PATH,
} from './meta-d1-only-partial-staging-recovery-http.js';
import {
  createTikTokPostLarkAuditHttpHandler,
  TIKTOK_POST_LARK_AUDIT_PATH,
} from './tiktok-post-lark-audit-http.js';
import {
  createWooCommerceProviderDiagnosticsHttpHandler,
  WOOCOMMERCE_PROVIDER_DIAGNOSTICS_PATH,
} from './woocommerce-provider-diagnostics-http.js';
import {
  createYouTubeCustomerConnectionHttpHandler,
  YOUTUBE_CONNECTION_PATHS,
} from './youtube-customer-connection-http.js';
import {
  createYouTubeCredentialRewrapHttpHandler,
  YOUTUBE_CREDENTIAL_REWRAP_PATH,
} from './youtube-credential-rewrap-http.js';
import {
  connectionRequestError,
  readBoundedConnectionJson,
  requireConnectionText,
} from './customer-connection-http-utils.js';

const INVITATION_PATH = '/operator/connection-invitations';
const KNOWN_METHODS = new Map([[INVITATION_PATH, Object.freeze(['POST'])]]);
KNOWN_METHODS.set(TIKTOK_POST_LARK_AUDIT_PATH, Object.freeze(['GET']));
KNOWN_METHODS.set(META_D1_ONLY_PARTIAL_STAGING_RECOVERY_PATH, Object.freeze(['POST']));
KNOWN_METHODS.set(WOOCOMMERCE_PROVIDER_DIAGNOSTICS_PATH, Object.freeze(['GET']));
KNOWN_METHODS.set(GOOGLE_ADS_CONNECTION_PATHS.connect, Object.freeze(['GET', 'POST']));
KNOWN_METHODS.set(GOOGLE_ADS_CONNECTION_PATHS.callback, Object.freeze(['GET']));
KNOWN_METHODS.set(YOUTUBE_CONNECTION_PATHS.connect, Object.freeze(['GET', 'POST']));
KNOWN_METHODS.set(YOUTUBE_CONNECTION_PATHS.callback, Object.freeze(['GET']));
KNOWN_METHODS.set(YOUTUBE_CONNECTION_PATHS.select, Object.freeze(['POST']));
KNOWN_METHODS.set(YOUTUBE_CREDENTIAL_REWRAP_PATH, Object.freeze(['POST']));

/** Explicit HTTP boundary; guarded diagnostics and Connector handlers are composed independently. */
export function createCustomerConnectionHttpHandler(dependencies = {}) {
  const runtimeFactory = dependencies.createRuntime ?? createCustomerConnectionRuntime;
  const connectorHandler = dependencies.handleConnectorRequest
    ?? composeConnectorHandlers([
      createTikTokPostLarkAuditHttpHandler(dependencies.tiktokAuditDependencies),
      createMetaD1OnlyPartialStagingRecoveryHttpHandler(
        dependencies.metaPartialStagingRecoveryDependencies,
      ),
      createWooCommerceProviderDiagnosticsHttpHandler(
        dependencies.woocommerceProviderDiagnosticsDependencies,
      ),
      createYouTubeCredentialRewrapHttpHandler(
        dependencies.youtubeCredentialRewrapDependencies,
      ),
      createGoogleAdsCustomerConnectionHttpHandler({ createRuntime: runtimeFactory }),
      createYouTubeCustomerConnectionHttpHandler({ createRuntime: runtimeFactory }),
    ]);

  return async function handleCustomerConnectionHttp(request, env, ctx) {
    const url = new URL(request.url);
    const knownMethods = KNOWN_METHODS.get(url.pathname);
    if (knownMethods && !knownMethods.includes(request.method)) {
      return json(
        { ok: false, error: 'Method not allowed' },
        { status: 405, headers: { allow: knownMethods.join(', ') } },
      );
    }

    try {
      if (request.method === 'POST' && url.pathname === INVITATION_PATH) {
        const runtime = runtimeFactory(env);
        await requireOperatorAuthorization(request, runtime.config.operatorToken);
        const body = await readBoundedConnectionJson(request);
        const connectorKey = requireConnectionText(body.connectorKey, 'connectorKey');
        const customerKey = requireConnectionText(body.customerKey, 'customerKey');
        if (customerKey !== runtime.config.customerKey) {
          throw connectionRequestError('CONNECTION_REQUEST_CUSTOMERKEY_MISMATCH');
        }
        const result = await runtime.service.createInvitation({
          connectorKey,
          customerKey,
          environment: runtime.config.environment,
          publicOrigin: runtime.config.publicOrigin,
          redirectUri: runtime.config.redirectUris[connectorKey],
          ttlMs: body.ttlMs,
          maxAttempts: body.maxAttempts,
        });
        return json({ ok: true, invitation: result }, {
          status: 201,
          headers: {
            'cache-control': 'no-store',
            'referrer-policy': 'no-referrer',
          },
        });
      }

      if (connectorHandler) {
        const response = await connectorHandler({ request, env, ctx, url });
        if (response instanceof Response) return response;
      }
      return json({ ok: false, error: 'Route not found' }, { status: 404 });
    } catch (error) {
      const operational = sanitizeOperationalError(error);
      console.error(JSON.stringify(sanitizeOperationalValue({
        timestamp: new Date().toISOString(),
        scope: 'customer_connection_http',
        route: `${request.method} ${url.pathname}`,
        code: operational.code,
        error: operational.message,
      })));
      const status = statusForError(operational.code);
      return json({
        ok: false,
        error: status === 401 ? 'Unauthorized' : 'Connection request failed',
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

function composeConnectorHandlers(handlers) {
  return async (context) => {
    for (const handler of handlers) {
      const response = await handler(context);
      if (response instanceof Response) return response;
    }
    return null;
  };
}

async function requireOperatorAuthorization(request, expectedToken) {
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer[ \t]+(.+)$/iu.exec(authorization);
  const supplied = match?.[1]?.trim() ?? '';
  const valid = await timingSafeEqualText(supplied, expectedToken);
  if (!match || !valid) {
    const error = new Error('Operator authorization was rejected');
    error.code = 'CONNECTION_OPERATOR_UNAUTHORIZED';
    throw error;
  }
}

function statusForError(code) {
  if (code === 'CONNECTION_OPERATOR_UNAUTHORIZED') return 401;
  if (code?.endsWith('_TOO_LARGE')) return 413;
  if (code?.endsWith('_ATTEMPTS_EXHAUSTED')) return 429;
  if (code?.endsWith('_ATTEMPT_ACTIVE') || code?.endsWith('_ATTEMPT_INACTIVE')) return 409;
  if (code?.endsWith('_REPLAYED')) return 409;
  if (code?.endsWith('_EXPIRED')) return 410;
  if (
    code?.includes('_INVALID')
    || code?.includes('_MISMATCH')
    || code?.includes('_UNSUPPORTED')
  ) return 400;
  return 500;
}
