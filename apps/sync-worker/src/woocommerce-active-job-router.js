import { JOB_TYPES } from '../../../packages/application/src/jobs/job-catalog.js';
import { processJobWithYouTubeOrganicEndToEnd } from './youtube-organic-active-job-router.js';
import { processWooCommerceCommerceJob } from './woocommerce-job-router.js';

/** WooCommerce มี Dedicated route เดียวและไม่มี Legacy fallback เมื่อ Job type ตรงกัน. */
export function selectWooCommerceActiveRoute(input = {}) {
  return input.job?.body?.type === JOB_TYPES.WOOCOMMERCE_COMMERCE_SYNC
    ? 'woocommerce'
    : 'fallback';
}

/** Inject handler ได้เพื่อทดสอบว่า non-WooCommerce routing เดิมไม่เปลี่ยน. */
export function createWooCommerceActiveJobRouter(input = {}) {
  const processWooCommerce = input.processWooCommerce ?? processWooCommerceCommerceJob;
  const processFallback = input.processFallback ?? processJobWithYouTubeOrganicEndToEnd;

  return async function processJobWithWooCommerceEndToEnd(jobInput) {
    if (selectWooCommerceActiveRoute(jobInput) === 'woocommerce') {
      return processWooCommerce(jobInput);
    }
    return processFallback(jobInput);
  };
}

export const processJobWithWooCommerceEndToEnd = createWooCommerceActiveJobRouter();
