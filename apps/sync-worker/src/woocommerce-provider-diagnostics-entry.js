import { json } from '../../../packages/shared/src/http/response.js';
import { createWooCommerceProviderDiagnosticsHttpHandler } from './woocommerce-provider-diagnostics-http.js';

const diagnosticsHandler = createWooCommerceProviderDiagnosticsHttpHandler();

/**
 * Preview-version-only entrypoint. It exposes one guarded GET route plus a fail-closed Queue
 * sentinel required when Cloudflare validates a Version for a Worker registered as a consumer.
 */
export default Object.freeze({
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await diagnosticsHandler({ request, env, ctx, url });
    if (response instanceof Response) return response;
    return json({ ok: false, error: 'Route not found' }, {
      status: 404,
      headers: {
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      },
    });
  },

  async queue(batch) {
    batch.retryAll();
  },
});
