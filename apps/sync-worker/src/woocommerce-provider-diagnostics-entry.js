import { json } from '../../../packages/shared/src/http/response.js';
import { createWooCommerceProviderDiagnosticsHttpHandler } from './woocommerce-provider-diagnostics-http.js';

const diagnosticsHandler = createWooCommerceProviderDiagnosticsHttpHandler();

/**
 * Preview-version-only entrypoint. It intentionally exposes exactly one guarded GET route and
 * contains no Queue, Scheduled, D1, Lark, OAuth, Report or Business handler.
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
});
