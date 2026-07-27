import { JOB_TYPES } from '../../../packages/application/src/jobs/job-catalog.js';
import { readWooCommerceIncrementalWatermark } from '../../../packages/connectors/src/woocommerce/d1-woocommerce-incremental-watermark.js';
import { processJobWithYouTubeOrganicEndToEnd } from './youtube-organic-active-job-router.js';
import { processWooCommerceCommerceJob } from './woocommerce-job-router.js';

export function selectWooCommerceActiveRoute(input = {}) {
  return input.job?.body?.type === JOB_TYPES.WOOCOMMERCE_COMMERCE_SYNC ? 'woocommerce' : 'fallback';
}

export function createWooCommerceActiveJobRouter(input = {}) {
  const processWooCommerce = input.processWooCommerce ?? processWooCommerceCommerceJob;
  const processFallback = input.processFallback ?? processJobWithYouTubeOrganicEndToEnd;
  const readWatermark = input.readWatermark ?? readWooCommerceIncrementalWatermark;
  return async function processJobWithWooCommerceEndToEnd(jobInput) {
    if (selectWooCommerceActiveRoute(jobInput) !== 'woocommerce') return processFallback(jobInput);
    const body = jobInput.job?.body ?? {};
    if (body.trigger !== 'scheduled' || body.modifiedAfter !== undefined) {
      return processWooCommerce(jobInput);
    }
    const runtime = jobInput.getRuntimeConfig();
    const accountKey = runtime?.connectors?.woocommerce?.accountKey;
    const modifiedAfter = await readWatermark({ db: jobInput.env?.MKT_STATE_DB, accountKey });
    return processWooCommerce({
      ...jobInput,
      job: Object.freeze({
        ...jobInput.job,
        body: Object.freeze({ ...body, modifiedAfter }),
      }),
    });
  };
}

export const processJobWithWooCommerceEndToEnd = createWooCommerceActiveJobRouter();
