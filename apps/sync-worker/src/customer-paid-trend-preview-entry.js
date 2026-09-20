import { json } from '../../../packages/shared/src/http/response.js';
import {
  createCustomerPaidTrendPreviewHttpHandler,
  CUSTOMER_PAID_TREND_PREVIEW_PATH,
} from './customer-paid-trend-preview-http.js';

const handler = createCustomerPaidTrendPreviewHttpHandler();
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === CUSTOMER_PAID_TREND_PREVIEW_PATH) return handler({ request, env, ctx, url });
    return json({ ok: false, code: 'ROUTE_NOT_FOUND' }, { status: 404 });
  },
  async queue(batch) { batch.retryAll(); },
  async scheduled() {},
};
