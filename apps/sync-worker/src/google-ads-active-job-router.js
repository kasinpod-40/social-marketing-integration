import { JOB_TYPES } from '../../../packages/application/src/jobs/job-catalog.js';
import { redriveDeadLetterJob } from '../../../packages/application/src/use-cases/redrive-dead-letter-job.js';
import { D1GoogleAdsLiveRedriveStore } from '../../../packages/connectors/src/google-ads/d1-google-ads-live-redrive-store.js';
import { D1ReliabilityStore } from '../../../packages/reliability/src/d1-reliability-store.js';
import { permanentError } from '../../../packages/shared/src/errors/runtime-error.js';
import { processGoogleAdsManualUatJob } from './google-ads-job-router.js';
import { processJobWithTikTokPostLark } from './tiktok-post-lark-job-router.js';
import { readBoolean, requireJobText } from './worker-runtime-support.js';

/** Route protected Google Ads UAT and exact redrive before generic active-job enforcement. */
export async function processJobWithGoogleAdsUat(input) {
  const type = input.job?.body?.type;
  if (type === JOB_TYPES.GOOGLE_ADS_MANAGER_SIGNED_DELIVERY_PROCESS) {
    return processGoogleAdsManualUatJob(input);
  }
  if (type === JOB_TYPES.DEAD_LETTER_REDRIVE) {
    if (!readBoolean(input.env?.MKT_DLQ_REDRIVE_ENABLED, false)) {
      throw permanentError('Dead-letter redrive is disabled for this environment', {
        code: 'MKT_DLQ_REDRIVE_DISABLED',
      });
    }
    return redriveDeadLetterJob({
      store: new D1ReliabilityStore({ db: input.env?.MKT_STATE_DB }),
      createGoogleAdsRedriveStore: () => new D1GoogleAdsLiveRedriveStore({
        db: input.env?.MKT_STATE_DB,
      }),
      queue: requireQueue(input.env),
      dlqId: requireJobText(input.job.body?.dlqId, 'dlqId'),
    });
  }
  return processJobWithTikTokPostLark(input);
}

function requireQueue(env) {
  const queue = env?.MKT_SYNC_QUEUE;
  if (typeof queue?.send !== 'function') {
    throw permanentError('Dead-letter redrive Queue binding is unavailable', {
      code: 'MKT_SYNC_QUEUE_REQUIRED',
    });
  }
  return queue;
}
