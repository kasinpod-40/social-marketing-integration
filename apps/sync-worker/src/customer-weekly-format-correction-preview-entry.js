import { json } from '../../../packages/shared/src/http/response.js';
import {
  createCustomerWeeklyFormatCorrectionPreviewHttpHandler,
  CUSTOMER_WEEKLY_FORMAT_CORRECTION_PREVIEW_PATH,
} from './customer-weekly-format-correction-preview-http.js';

export function createCustomerWeeklyFormatCorrectionPreviewWorker(dependencies = {}) {
  const handler = createCustomerWeeklyFormatCorrectionPreviewHttpHandler(dependencies);
  return Object.freeze({
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (url.pathname === CUSTOMER_WEEKLY_FORMAT_CORRECTION_PREVIEW_PATH) {
        return handler({ request, env, ctx, url });
      }
      return json({ ok: false, code: 'ROUTE_NOT_FOUND' }, { status: 404 });
    },
    async queue(batch) { batch.retryAll(); },
    async scheduled() {},
  });
}

export default createCustomerWeeklyFormatCorrectionPreviewWorker();
