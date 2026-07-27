import { JOB_TYPES } from '../../../packages/application/src/jobs/job-catalog.js';
import {
  readYouTubeEndToEndRuntimeConfig,
} from '../../../packages/config/src/youtube-organic-runtime-config.js';
import { processJobWithGoogleAdsUat } from './google-ads-active-job-router.js';
import { processYouTubeOrganicEndToEndJob } from './youtube-organic-job-router.js';

/**
 * เลือก Dedicated YouTube D1-first route เฉพาะเมื่อเปิด Gate ใหม่อย่างชัดเจน
 * ค่า Default false ต้องรักษา Active YouTube route เดิมเพื่อให้ Safe deploy ไม่เปลี่ยนพฤติกรรมเดิม
 */
export function selectYouTubeOrganicActiveRoute(input = {}) {
  if (input.job?.body?.type !== JOB_TYPES.YOUTUBE_ORGANIC_SYNC) return 'fallback';
  const config = readYouTubeEndToEndRuntimeConfig(input.env);
  return config.endToEndEnabled ? 'end_to_end' : 'fallback';
}

/** สร้าง Router แบบ Inject dependency ได้เพื่อทดสอบลำดับ Routing โดยไม่เรียก Provider หรือ Business write */
export function createYouTubeOrganicActiveJobRouter(input = {}) {
  const processEndToEnd = input.processEndToEnd ?? processYouTubeOrganicEndToEndJob;
  const processFallback = input.processFallback ?? processJobWithGoogleAdsUat;

  return async function processJobWithYouTubeOrganicEndToEnd(jobInput) {
    if (selectYouTubeOrganicActiveRoute(jobInput) === 'end_to_end') {
      return processEndToEnd(jobInput);
    }
    return processFallback(jobInput);
  };
}

export const processJobWithYouTubeOrganicEndToEnd = createYouTubeOrganicActiveJobRouter();
