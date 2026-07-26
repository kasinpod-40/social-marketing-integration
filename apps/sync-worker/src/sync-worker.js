import { processJobWithGoogleAdsUat } from './google-ads-active-job-router.js';
import { routeQueueBatch } from './queue-batch-router.js';
import { createInfrastructure, createOperationalStore } from './runtime-infrastructure.js';
import { produceScheduledJobs } from './scheduled-producer.js';
import { createCustomerConnectionHttpHandler } from './customer-connection-http.js';

/** สร้าง Worker instance เพื่อให้ Worker-runtime tests inject use case ได้โดยไม่เปลี่ยน Production default */
export function createSyncWorker(dependencies = {}) {
  const processJobImpl = dependencies.processJob ?? processJobWithGoogleAdsUat;
  const infrastructureFactory = dependencies.createInfrastructure ?? createInfrastructure;
  const operationalStoreFactory = dependencies.createOperationalStore ?? createOperationalStore;
  const httpHandler = dependencies.handleHttp
    ?? createCustomerConnectionHttpHandler(dependencies.httpDependencies);

  return Object.freeze({
    async fetch(request, env, ctx) {
      return httpHandler(request, env, ctx);
    },

    async scheduled(event, env) {
      return produceScheduledJobs(event, env);
    },

    async queue(batch, env) {
      return routeQueueBatch(batch, env, {
        processJob: processJobImpl,
        createInfrastructure: infrastructureFactory,
        createOperationalStore: operationalStoreFactory,
      });
    },
  });
}
