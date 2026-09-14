import { json } from '../../../packages/shared/src/http/response.js';
import {
  createCustomerWeeklyAiQualityPreviewHttpHandler,
  CUSTOMER_WEEKLY_AI_QUALITY_PREVIEW_PATH,
} from './customer-weekly-ai-quality-preview-http.js';

export function createCustomerWeeklyAiQualityPreviewWorker(dependencies = {}) {
  const handler = createCustomerWeeklyAiQualityPreviewHttpHandler(dependencies);
  return Object.freeze({
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (url.pathname === CUSTOMER_WEEKLY_AI_QUALITY_PREVIEW_PATH) {
        return handler({ request, env, ctx, url });
      }
      return json({ ok: false, code: 'ROUTE_NOT_FOUND' }, { status: 404 });
    },
    async queue(batch) { batch.retryAll(); },
    async scheduled() {},
  });
}

export default createCustomerWeeklyAiQualityPreviewWorker();
