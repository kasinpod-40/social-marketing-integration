import { processJobWithLarkNotification } from './lark-notification-active-job-router.js';
import { routeQueueBatch } from './queue-batch-router.js';
import { createInfrastructure, createOperationalStore } from './runtime-infrastructure.js';
import { produceScheduledJobs } from './scheduled-producer.js';
import { maybeRefreshInstagramToken } from './instagram-token-renewal.js';
import { createCustomerConnectionHttpHandler } from './customer-connection-http.js';

/** สร้าง Worker instance เพื่อให้ Worker-runtime tests inject use case ได้โดยไม่เปลี่ยน Production default */
export function createSyncWorker(dependencies = {}) {
  const processJobImpl = dependencies.processJob ?? processJobWithLarkNotification;
  const infrastructureFactory = dependencies.createInfrastructure ?? createInfrastructure;
  const operationalStoreFactory = dependencies.createOperationalStore ?? createOperationalStore;
  const httpHandler = dependencies.handleHttp
    ?? createCustomerConnectionHttpHandler(dependencies.httpDependencies);

  return Object.freeze({
    async fetch(request, env, ctx) {
      return httpHandler(request, env, ctx);
    },

    async scheduled(event, env) {
      const result = await produceScheduledJobs(event, env);
      await (dependencies.maybeRefreshInstagramToken ?? maybeRefreshInstagramToken)(event, env);
      return result;
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
