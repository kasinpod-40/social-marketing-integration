import { BUILD_VERSION } from '../../../packages/config/src/build-info.js';
import { json } from '../../../packages/shared/src/http/response.js';
import { loadCustomerRuntimeConfig } from '../../../packages/config/src/customer-profiles.js';
import { listConnectorReadiness } from '../../../packages/application/src/connectors/connector-registry.js';
import {
  sanitizeOperationalError,
  sanitizeOperationalValue,
} from '../../../packages/shared/src/errors/runtime-error.js';
import { handleGoogleAdsSignedDelivery } from './google-ads-delivery-handler.js';

/** Map Route แบบคงที่เพื่อไม่ต้องสร้าง Router dependency ใน MVP */
const ROUTES = new Map([
  ['GET /health', handleHealth],
  ['POST /v1/google-ads/deliveries', handleGoogleAdsSignedDelivery],
]);

/** Cloudflare API Worker สำหรับ Endpoint สาธารณะของระบบ */
export default {
  /** Route Request และแปลง Error เป็น JSON response ที่ไม่เปิดเผย Secret */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const routeKey = `${request.method} ${url.pathname}`;
    const handler = ROUTES.get(routeKey);

    if (!handler) {
      return json({ ok: false, error: 'Route not found', path: url.pathname }, { status: 404 });
    }

    try {
      return await handler({ request, env, ctx, url });
    } catch (error) {
      const operationalError = sanitizeOperationalError(error);
      console.error(JSON.stringify(sanitizeOperationalValue({
        timestamp: new Date().toISOString(),
        scope: 'api_worker',
        route: routeKey,
        error: operationalError.message,
        code: operationalError.code,
      })));

      const status = httpStatusForError(error);
      return json(
        {
          ok: false,
          error: status >= 500 ? 'Unhandled API error' : 'Request rejected',
          ...(status < 500 && operationalError.code ? { code: operationalError.code } : {}),
        },
        { status },
      );
    }
  },
};

/**
 * Health check ตรวจ Runtime profile และสรุป Readiness ของ Connector โดยไม่เปิดเผย Secret/Account identity
 */
async function handleHealth({ env }) {
  const runtimeConfig = loadCustomerRuntimeConfig(env);
  const connectors = listConnectorReadiness(runtimeConfig).map((connector) => ({
    key: connector.key,
    implementationStatus: connector.implementationStatus,
    enabled: connector.enabled,
    runnable: connector.runnable,
  }));

  return json({
    ok: true,
    service: 'social-mkt-api-worker',
    environment: runtimeConfig.environment,
    timezone: env?.DEFAULT_TIMEZONE ?? 'Asia/Bangkok',
    version: BUILD_VERSION,
    connectors,
  });
}


function httpStatusForError(error) {
  if (error?.retryable === true) return 503;
  const code = String(error?.code ?? '');
  if (code === 'GOOGLE_ADS_DELIVERY_REPLAY_REJECTED'
    || code === 'GOOGLE_ADS_DELIVERY_IDEMPOTENCY_CONFLICT') return 409;
  if (code === 'GOOGLE_ADS_DELIVERY_SIGNATURE_INVALID'
    || code === 'GOOGLE_ADS_DELIVERY_KEY_REJECTED') return 401;
  if (code.startsWith('GOOGLE_ADS_DELIVERY_')) return 400;
  return 500;
}
