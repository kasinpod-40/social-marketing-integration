import worker from './index.js';
import { createTikTokAdsLarkProjectionHttpHandler } from './tiktok-ads-lark-projection-http.js';
import { createTikTokAdsCampaignMetadataHttpHandler } from './tiktok-ads-campaign-metadata-http.js';

const handle = createTikTokAdsLarkProjectionHttpHandler();
const metadata = createTikTokAdsCampaignMetadataHttpHandler();
export default {
  ...worker,
  async fetch(request, env, ctx) {
    const input = { request, env, url: new URL(request.url) };
    return await metadata(input) ?? await handle(input) ?? worker.fetch(request, env, ctx);
  },
};
