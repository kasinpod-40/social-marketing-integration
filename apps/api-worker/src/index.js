import { BUILD_VERSION } from '../../../packages/config/src/build-info.js';
import { json } from '../../../packages/shared/src/http/response.js';
import { loadCustomerRuntimeConfig } from '../../../packages/config/src/customer-profiles.js';
import { listConnectorReadiness } from '../../../packages/application/src/connectors/connector-registry.js';
import {
  sanitizeOperationalError,
  sanitizeOperationalValue,
} from '../../../packages/shared/src/errors/runtime-error.js';
import {
  createGoogleAdsManagerDeliveryHttpHandler,
  GOOGLE_ADS_MANAGER_DELIVERY_ROUTE,
} from './google-ads-manager-delivery-http.js';

/** Map Route แบบคงที่เพื่อไม่ต้องสร้าง Router dependency ใน MVP */
const googleAdsManagerDeliveryHandler = createGoogleAdsManagerDeliveryHttpHandler();
const ROUTES = new Map([
  ['GET /health', handleHealth],
  [
    `${GOOGLE_ADS_MANAGER_DELIVERY_ROUTE.method} ${GOOGLE_ADS_MANAGER_DELIVERY_ROUTE.path}`,
    googleAdsManagerDeliveryHandler,
  ],
]);
const KNOWN_PATH_METHODS = new Map([
  ['/health', Object.freeze(['GET'])],
  [
    GOOGLE_ADS_MANAGER_DELIVERY_ROUTE.path,
    Object.freeze([GOOGLE_ADS_MANAGER_DELIVERY_ROUTE.method]),
  ],
]);

/** Cloudflare API Worker สำหรับ Endpoint สาธารณะของระบบ */
export default {
  /** Route Request และแปลง Error เป็น JSON response ที่ไม่เปิดเผย Secret */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const routeKey = `${request.method} ${url.pathname}`;
    const handler = ROUTES.get(routeKey);

    if (!handler) {
      const methods = KNOWN_PATH_METHODS.get(url.pathname);
      if (methods) {
        return json({ ok: false, error: 'Method not allowed' }, {
          status: 405,
          headers: { allow: methods.join(', ') },
        });
      }
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

      return json(
        {
          ok: false,
          error: 'Unhandled API error',
        },
        { status: 500 },
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
