import { JOB_TYPES } from '../../../packages/application/src/jobs/job-catalog.js';
import { createOrganicContentOwnershipRoutingRepository } from '../../../packages/application/src/policies/organic-content-field-ownership.js';
import { D1OrganicHistoryGateway } from '../../../packages/connectors/src/d1-organic-history-gateway.js';
import { D1MarketingHistoryStore } from '../../../packages/connectors/src/d1-marketing-history-store.js';
import { D1ChatwootAnalyticsStore } from '../../../packages/connectors/src/chatwoot/d1-chatwoot-analytics-store.js';
import { D1GoogleAdsManagerDeliveryStore } from '../../../packages/connectors/src/google-ads/d1-google-ads-manager-delivery-store.js';
import { D1GoogleAdsLiveAdmissionStore } from '../../../packages/connectors/src/google-ads/d1-google-ads-live-admission-store.js';
import { D1WooCommerceCommerceStore } from '../../../packages/connectors/src/woocommerce/d1-woocommerce-commerce-store.js';
import { D1WooCommerceReportSource } from '../../../packages/connectors/src/woocommerce/d1-woocommerce-report-source.js';
import { createLarkBitableClientFromEnv } from '../../../packages/connectors/src/lark/lark-bitable.client.js';
import { LarkRecordRepository } from '../../../packages/connectors/src/lark/lark-record-repository.js';
import { D1ReliabilityMirrorOutbox } from '../../../packages/reliability/src/d1-reliability-mirror-outbox.js';
import { D1ReliabilityStore } from '../../../packages/reliability/src/d1-reliability-store.js';
import { DurableMirrorReliabilityStore } from '../../../packages/reliability/src/durable-mirror-reliability-store.js';
import { LarkReliabilityStore } from '../../../packages/reliability/src/lark-reliability-store.js';
import { createCloudflareReliabilityRuntime } from '../../../packages/reliability/src/runtime-factory.js';
import { D1IncrementalStateStore } from '../../../packages/sync-engine/src/d1-incremental-state-store.js';
import { D1ResumableWorkStore } from '../../../packages/sync-engine/src/d1-resumable-work-store.js';
import { TableSyncEngine } from '../../../packages/sync-engine/src/table-sync-engine.js';
import { logQueueResult } from './worker-runtime-support.js';

/** สร้าง Infrastructure หนึ่งชุดต่อ Queue event และสร้าง Dependency เฉพาะ Route ที่เรียกใช้ */
export function createInfrastructure(env) {
  let client = null;
  let repository = null;
  let syncEngine = null;
  let reliability = null;
  let incrementalStateStore = null;
  let resumableWorkStore = null;
  let organicHistoryGateway = null;
  let marketingHistoryStore = null;
  let chatwootAnalyticsStore = null;
  let googleAdsDeliveryStore = null;
  let googleAdsAdmissionStore = null;
  let wooCommerceStore = null;
  let wooCommerceReportSource = null;
  let mirrorOutbox = null;
  const larkReliabilityStores = new Map();

  const getSyncEngine = () => {
    syncEngine ??= new TableSyncEngine();
    return syncEngine;
  };
  const getRepository = () => {
    client ??= createLarkBitableClientFromEnv(env);
    if (!repository) {
      const baseRepository = new LarkRecordRepository({ client });
      repository = createOrganicContentOwnershipRoutingRepository({
        repository: baseRepository,
        mktContentTableId: env?.LARK_TABLE_MKT_CONTENT,
      });
    }
    return repository;
  };

  return Object.freeze({
    get repository() { return getRepository(); },
    get syncEngine() { return getSyncEngine(); },
    getIncrementalStateStore() {
      incrementalStateStore ??= new D1IncrementalStateStore({ db: env?.MKT_STATE_DB });
      return incrementalStateStore;
    },
    getResumableWorkStore() {
      resumableWorkStore ??= new D1ResumableWorkStore({ db: env?.MKT_STATE_DB });
      return resumableWorkStore;
    },
    getOrganicHistoryGateway() {
      organicHistoryGateway ??= new D1OrganicHistoryGateway({ db: env?.MKT_STATE_DB });
      return organicHistoryGateway;
    },
    getMarketingHistoryStore() {
      marketingHistoryStore ??= new D1MarketingHistoryStore({ db: env?.MKT_STATE_DB });
      return marketingHistoryStore;
    },
    getChatwootAnalyticsStore() {
      chatwootAnalyticsStore ??= new D1ChatwootAnalyticsStore({ db: env?.MKT_STATE_DB });
      return chatwootAnalyticsStore;
    },
    getGoogleAdsDeliveryStore() {
      googleAdsDeliveryStore ??= new D1GoogleAdsManagerDeliveryStore({ db: env?.MKT_STATE_DB });
      return googleAdsDeliveryStore;
    },
    getGoogleAdsAdmissionStore() {
      googleAdsAdmissionStore ??= new D1GoogleAdsLiveAdmissionStore({ db: env?.MKT_STATE_DB });
      return googleAdsAdmissionStore;
    },
    getWooCommerceCommerceStore() {
      wooCommerceStore ??= new D1WooCommerceCommerceStore({ db: env?.MKT_STATE_DB });
      return wooCommerceStore;
    },
    getWooCommerceReportSource() {
      wooCommerceReportSource ??= new D1WooCommerceReportSource({ db: env?.MKT_STATE_DB });
      return wooCommerceReportSource;
    },
    getReliability() {
      reliability ??= createCloudflareReliabilityRuntime({
        env,
        deliveryJobType: JOB_TYPES.RELIABILITY_MIRROR_DELIVER,
        onScheduleError: logMirrorSignalError,
      });
      return reliability;
    },
    getReliabilityMirrorOutbox() {
      mirrorOutbox ??= new D1ReliabilityMirrorOutbox({ db: env?.MKT_STATE_DB });
      return mirrorOutbox;
    },
    getLarkReliabilityStore(tableIds) {
      const key = `${tableIds?.mktSyncLog ?? ''}:${tableIds?.mktSystemAlerts ?? ''}`;
      if (!larkReliabilityStores.has(key)) {
        larkReliabilityStores.set(key, new LarkReliabilityStore({
          repository: getRepository(),
          syncEngine: getSyncEngine(),
          tables: {
            syncLog: tableIds?.mktSyncLog,
            systemAlerts: tableIds?.mktSystemAlerts,
          },
        }));
      }
      return larkReliabilityStores.get(key);
    },
  });
}

/** D1 เป็น Primary; Lark delivery ถูก Persist ลง Durable outbox ก่อนส่ง Generic Queue signal */
export function createOperationalStore(env) {
  const d1Store = new D1ReliabilityStore({ db: env?.MKT_STATE_DB });
  const outbox = new D1ReliabilityMirrorOutbox({ db: env?.MKT_STATE_DB });
  return new DurableMirrorReliabilityStore({
    primary: d1Store,
    outbox,
    queue: env?.MKT_SYNC_QUEUE,
    deliveryJobType: JOB_TYPES.RELIABILITY_MIRROR_DELIVER,
    onScheduleError: logMirrorSignalError,
  });
}

function logMirrorSignalError(event) {
  logQueueResult({
    ok: false,
    scope: 'reliability_mirror_signal',
    stage: event?.stage ?? null,
    code: event?.code ?? 'RELIABILITY_MIRROR_QUEUE_SEND_FAILED',
    error: event?.error instanceof Error ? event.error.message : String(event?.error ?? ''),
  });
}
