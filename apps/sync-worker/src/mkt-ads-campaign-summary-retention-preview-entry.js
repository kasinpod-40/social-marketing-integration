import { json } from '../../../packages/shared/src/http/response.js';
import {
  createMktAdsCampaignSummaryRetentionPreviewHttpHandler,
  MKT_ADS_CAMPAIGN_SUMMARY_RETENTION_PREVIEW_PATH,
} from './mkt-ads-campaign-summary-retention-preview-http.js';

export function createMktAdsCampaignSummaryRetentionPreviewWorker(dependencies = {}) {
  const handler = createMktAdsCampaignSummaryRetentionPreviewHttpHandler(dependencies);
  return Object.freeze({
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (url.pathname !== MKT_ADS_CAMPAIGN_SUMMARY_RETENTION_PREVIEW_PATH) {
        return json({ ok: false, code: 'ROUTE_NOT_FOUND' }, { status: 404 });
      }
      return handler({ request, env, ctx, url });
    },
    async queue(batch) { batch.retryAll(); },
    async scheduled() {},
  });
}

export default createMktAdsCampaignSummaryRetentionPreviewWorker();
