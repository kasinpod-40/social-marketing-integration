import { json } from '../../../packages/shared/src/http/response.js';
import {
  createMktAdsCampaignSummaryRetentionPreviewHttpHandler,
  MKT_ADS_CAMPAIGN_SUMMARY_RETENTION_PREVIEW_PATH,
} from './mkt-ads-campaign-summary-retention-preview-http.js';
import {
  createOrganicReportingDateRepairPreviewHttpHandler,
  ORGANIC_REPORTING_DATE_REPAIR_PREVIEW_PATH,
} from './organic-reporting-date-repair-preview-http.js';

export function createMktAdsCampaignSummaryRetentionPreviewWorker(dependencies = {}) {
  const handler = createMktAdsCampaignSummaryRetentionPreviewHttpHandler(dependencies);
  const organicDateHandler = createOrganicReportingDateRepairPreviewHttpHandler(dependencies);
  return Object.freeze({
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (url.pathname === MKT_ADS_CAMPAIGN_SUMMARY_RETENTION_PREVIEW_PATH) {
        return handler({ request, env, ctx, url });
      }
      if (url.pathname === ORGANIC_REPORTING_DATE_REPAIR_PREVIEW_PATH) {
        return organicDateHandler({ request, env, ctx, url });
      }
      return json({ ok: false, code: 'ROUTE_NOT_FOUND' }, { status: 404 });
    },
    async queue(batch) { batch.retryAll(); },
    async scheduled() {},
  });
}

export default createMktAdsCampaignSummaryRetentionPreviewWorker();
