import worker from './index.js';
import {
  META_K2_EXACT_RECOVERY_PATH,
} from '../../../packages/config/src/meta-k2-exact-recovery-contract.js';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== META_K2_EXACT_RECOVERY_PATH) {
      return json(404, {
        ok: false,
        code: 'META_K2_PREVIEW_ROUTE_NOT_FOUND',
        queueMessageCount: 0,
        scheduleEnabled: false,
        production: false,
      });
    }
    return worker.fetch(request, env, context);
  },

  async queue(batch) {
    batch.retryAll();
  },

  async scheduled() {
    // Preview-only entrypoint: schedules are intentionally disabled.
  },
};
