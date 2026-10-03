import worker from './index.js';
import { createTikTokAdsLarkProjectionHttpHandler } from './tiktok-ads-lark-projection-http.js';

const handle = createTikTokAdsLarkProjectionHttpHandler();
export default {
  ...worker,
  async fetch(request, env, ctx) {
    return await handle({ request, env, url: new URL(request.url) }) ?? worker.fetch(request, env, ctx);
  },
};
