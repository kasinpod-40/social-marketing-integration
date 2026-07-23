import { permanentError } from '../../shared/src/errors/runtime-error.js';
import { D1ReliabilityMirrorOutbox } from './d1-reliability-mirror-outbox.js';
import { D1StaleAwareReliabilityStore } from './d1-stale-aware-reliability-store.js';
import { DurableMirrorReliabilityStore } from './durable-mirror-reliability-store.js';

/**
 * สร้าง Reliability runtime สำหรับ Cloudflare Worker
 * บังคับ D1 binding เพื่อให้ Lease lock และ Durable mirror outbox ใช้งานข้าม invocation ได้จริง
 */
export function createCloudflareReliabilityRuntime(input = {}) {
  const db = input.env?.MKT_STATE_DB;
  if (typeof db?.prepare !== 'function') {
    throw permanentError('Missing Cloudflare D1 binding MKT_STATE_DB for reliability layer', {
      code: 'MKT_STATE_DB_REQUIRED',
      details: { binding: 'MKT_STATE_DB' },
    });
  }

  const d1Store = new D1StaleAwareReliabilityStore({ db });
  const mirrorOutbox = new D1ReliabilityMirrorOutbox({ db });
  const store = new DurableMirrorReliabilityStore({
    primary: d1Store,
    outbox: mirrorOutbox,
    queue: input.env?.MKT_SYNC_QUEUE,
    deliveryJobType: input.deliveryJobType,
    onScheduleError: input.onScheduleError,
  });

  return Object.freeze({
    store,
    lockManager: d1Store,
    d1Store,
    mirrorOutbox,
  });
}
