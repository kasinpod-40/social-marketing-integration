import worker from './index.js';
import { createTikTokAdsMasterSyncHttpHandler } from './tiktok-ads-master-sync-http.js';
import { createTikTokAdsLarkSchemaHttpHandler } from './tiktok-ads-lark-schema-http.js';
import { createTikTokAdsLarkProjectionHttpHandler } from './tiktok-ads-lark-projection-http.js';
import { createTikTokAdsCampaignMetadataHttpHandler } from './tiktok-ads-campaign-metadata-http.js';

const masters = createTikTokAdsMasterSyncHttpHandler();
const schema = createTikTokAdsLarkSchemaHttpHandler();
const handle = createTikTokAdsLarkProjectionHttpHandler();
const metadata = createTikTokAdsCampaignMetadataHttpHandler();
export default {
  ...worker,
  async fetch(request, env, ctx) {
    const input = { request, env, url: new URL(request.url) };
    return await schema(input) ?? await masters(input) ?? await metadata(input) ?? await handle(input) ?? worker.fetch(request, env, ctx);
  },
};
