import { BUILD_VERSION } from '../../../packages/config/src/build-info.js';
import { json } from '../../../packages/shared/src/http/response.js';

/** Map Route แบบคงที่เพื่อไม่ต้องสร้าง Router dependency ใน MVP */
const ROUTES = new Map([
  ['GET /health', handleHealth],
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
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        scope: 'api_worker',
        route: routeKey,
        error: error instanceof Error ? error.message : String(error),
      }));

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

/** Health check แสดงเฉพาะ Environment และ Timezone ที่ไม่เป็นความลับ */
async function handleHealth({ env }) {
  return json({
    ok: true,
    service: 'social-mkt-api-worker',
    environment: env?.MKT_ENV ?? 'unknown',
    timezone: env?.DEFAULT_TIMEZONE ?? 'Asia/Bangkok',
    version: BUILD_VERSION,
  });
}
