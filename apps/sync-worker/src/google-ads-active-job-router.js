import { JOB_TYPES } from '../../../packages/application/src/jobs/job-catalog.js';
import { processGoogleAdsManualUatJob } from './google-ads-job-router.js';
import { processJobWithHistoryBootstrap } from './history-bootstrap-job-router.js';

/** Route the single uat_pending Google Ads job before generic active-job enforcement. */
export async function processJobWithGoogleAdsUat(input) {
  if (input.job?.body?.type === JOB_TYPES.GOOGLE_ADS_MANAGER_SIGNED_DELIVERY_PROCESS) {
    return processGoogleAdsManualUatJob(input);
  }
  return processJobWithHistoryBootstrap(input);
}
