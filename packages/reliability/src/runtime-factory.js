import { D1ReliabilityStore } from './d1-reliability-store.js';
import { LarkReliabilityStore } from './lark-reliability-store.js';
import { CompositeReliabilityStore } from './composite-reliability-store.js';
import { permanentError } from '../../shared/src/errors/runtime-error.js';

/**
 * สร้าง Reliability runtime สำหรับ Cloudflare Worker
 * บังคับ D1 binding เพื่อให้ Lease lock ใช้งานข้าม invocation ได้จริง
 */
export function createCloudflareReliabilityRuntime(input = {}) {
  const db = input.env?.MKT_STATE_DB;
  if (typeof db?.prepare !== 'function') {
    throw permanentError('Missing Cloudflare D1 binding MKT_STATE_DB for reliability layer', {
      code: 'MKT_STATE_DB_REQUIRED',
      details: { binding: 'MKT_STATE_DB' },
    });
  }

  const d1Store = new D1ReliabilityStore({ db });
  const larkStore = new LarkReliabilityStore({
    repository: input.repository,
    syncEngine: input.syncEngine,
    tables: {
      syncLog: input.tables?.mktSyncLog,
      systemAlerts: input.tables?.mktSystemAlerts,
    },
  });

  const store = new CompositeReliabilityStore({
    primary: d1Store,
    mirrors: [larkStore],
    onStoreError: input.onStoreError,
  });

  return Object.freeze({
    store,
    lockManager: d1Store,
    d1Store,
    larkStore,
  });
}
