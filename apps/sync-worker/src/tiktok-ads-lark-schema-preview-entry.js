import worker from './index.js';
import { createTikTokAdsLarkSchemaHttpHandler } from './tiktok-ads-lark-schema-http.js';

const handle = createTikTokAdsLarkSchemaHttpHandler();
export default {
  ...worker,
  async fetch(request, env, ctx) {
    return await handle({ request, env, url: new URL(request.url) }) ?? worker.fetch(request, env, ctx);
  },
};
