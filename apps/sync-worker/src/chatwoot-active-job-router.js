import { JOB_TYPES } from '../../../packages/application/src/jobs/job-catalog.js';
import { processJobWithWooCommerceEndToEnd } from './woocommerce-active-job-router.js';
import { processChatwootAnalyticsJob } from './chatwoot-job-router.js';

/** Chatwoot has one dedicated route and no legacy fallback when its Job type matches. */
export function selectChatwootActiveRoute(input = {}) {
  return input.job?.body?.type === JOB_TYPES.CHATWOOT_CONVERSATIONS_SYNC
    ? 'chatwoot'
    : 'fallback';
}

export function createChatwootActiveJobRouter(input = {}) {
  const processChatwoot = input.processChatwoot ?? processChatwootAnalyticsJob;
  const processFallback = input.processFallback ?? processJobWithWooCommerceEndToEnd;

  return async function processJobWithChatwootEndToEnd(jobInput) {
    if (selectChatwootActiveRoute(jobInput) === 'chatwoot') {
      return processChatwoot(jobInput);
    }
    return processFallback(jobInput);
  };
}

export const processJobWithChatwootEndToEnd = createChatwootActiveJobRouter();
