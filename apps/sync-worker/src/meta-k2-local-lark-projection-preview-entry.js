import { json } from '../../../packages/shared/src/http/response.js';
import {
  createMetaK2LocalLarkProjectionHttpHandler,
  META_K2_LOCAL_LARK_PROJECTION_PATH,
} from './meta-k2-local-lark-projection-http.js';

export function createMetaK2LocalLarkProjectionPreviewWorker(dependencies = {}) {
  const handler = createMetaK2LocalLarkProjectionHttpHandler(dependencies);
  return Object.freeze({
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (url.pathname !== META_K2_LOCAL_LARK_PROJECTION_PATH) {
        return json({ ok: false, error: 'Route not found' }, { status: 404 });
      }
      return handler({ request, env, ctx, url });
    },
    async queue(batch) { batch.retryAll(); },
    async scheduled() {},
  });
}

export default createMetaK2LocalLarkProjectionPreviewWorker();
