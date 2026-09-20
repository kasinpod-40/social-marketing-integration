import { json } from '../../../packages/shared/src/http/response.js';
import {
  createMktAdsCampaignSummaryRetentionPreviewHttpHandler,
  MKT_ADS_CAMPAIGN_SUMMARY_RETENTION_PREVIEW_PATH,
} from './mkt-ads-campaign-summary-retention-preview-http.js';
import {
  createOrganicReportingDateRepairPreviewHttpHandler,
  ORGANIC_REPORTING_DATE_REPAIR_PREVIEW_PATH,
} from './organic-reporting-date-repair-preview-http.js';
import {
  createCustomerOrganicHistoryPreviewHttpHandler,
  CUSTOMER_ORGANIC_HISTORY_PREVIEW_PATH,
} from './customer-organic-history-preview-http.js';
import {
  createCustomerOrganicAccountDailyPreviewHttpHandler,
  CUSTOMER_ORGANIC_ACCOUNT_DAILY_PREVIEW_PATH,
} from './customer-organic-account-daily-preview-http.js';
import {
  createCustomerSlowestFirstResponsePreviewHttpHandler,
  CUSTOMER_SLOWEST_FIRST_RESPONSE_PREVIEW_PATH,
} from './customer-slowest-first-response-preview-http.js';

export function createMktAdsCampaignSummaryRetentionPreviewWorker(dependencies = {}) {
  const handler = createMktAdsCampaignSummaryRetentionPreviewHttpHandler(dependencies);
  const organicDateHandler = createOrganicReportingDateRepairPreviewHttpHandler(dependencies);
  const organicHistoryHandler = createCustomerOrganicHistoryPreviewHttpHandler(dependencies);
  const organicAccountDailyHandler = createCustomerOrganicAccountDailyPreviewHttpHandler(dependencies);
  const slowestFirstResponseHandler = createCustomerSlowestFirstResponsePreviewHttpHandler(dependencies);
  return Object.freeze({
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (url.pathname === MKT_ADS_CAMPAIGN_SUMMARY_RETENTION_PREVIEW_PATH) {
        return handler({ request, env, ctx, url });
      }
      if (url.pathname === ORGANIC_REPORTING_DATE_REPAIR_PREVIEW_PATH) {
        return organicDateHandler({ request, env, ctx, url });
      }
      if (url.pathname === CUSTOMER_ORGANIC_HISTORY_PREVIEW_PATH) {
        return organicHistoryHandler({ request, env, ctx, url });
      }
      if (url.pathname === CUSTOMER_ORGANIC_ACCOUNT_DAILY_PREVIEW_PATH) {
        return organicAccountDailyHandler({ request, env, ctx, url });
      }
      if (url.pathname === CUSTOMER_SLOWEST_FIRST_RESPONSE_PREVIEW_PATH) {
        return slowestFirstResponseHandler({ request, env, ctx, url });
      }
      return json({ ok: false, code: 'ROUTE_NOT_FOUND' }, { status: 404 });
    },
    async queue(batch) { batch.retryAll(); },
    async scheduled() {},
  });
}

export default createMktAdsCampaignSummaryRetentionPreviewWorker();
