import { processJobWithLarkNotification } from './lark-notification-active-job-router.js';
import { routeQueueBatch } from './queue-batch-router.js';
import { createInfrastructure, createOperationalStore } from './runtime-infrastructure.js';
import { produceScheduledJobs } from './scheduled-producer.js';
import { maybeRefreshInstagramToken } from './instagram-token-renewal.js';
import { createCustomerConnectionHttpHandler } from './customer-connection-http.js';
import { hydrateRuntimeEnvFromD1 } from './runtime-config-hydration.js';

/** สร้าง Worker instance เพื่อให้ Worker-runtime tests inject use case ได้โดยไม่เปลี่ยน Production default */
export function createSyncWorker(dependencies = {}) {
  const processJobImpl = dependencies.processJob ?? processJobWithLarkNotification;
  const infrastructureFactory = dependencies.createInfrastructure ?? createInfrastructure;
  const operationalStoreFactory = dependencies.createOperationalStore ?? createOperationalStore;
  const httpHandler = dependencies.handleHttp
    ?? createCustomerConnectionHttpHandler(dependencies.httpDependencies);
  const hydrateRuntimeEnv = dependencies.hydrateRuntimeEnv ?? hydrateRuntimeEnvFromD1;

  return Object.freeze({
    async fetch(request, env, ctx) {
      const runtimeEnv = await hydrateRuntimeEnv(env);
      return httpHandler(request, runtimeEnv, ctx);
    },

    async scheduled(event, env) {
      const runtimeEnv = await hydrateRuntimeEnv(env);
      const result = await produceScheduledJobs(event, runtimeEnv);
      await (dependencies.maybeRefreshInstagramToken ?? maybeRefreshInstagramToken)(event, runtimeEnv);
      return result;
    },

    async queue(batch, env) {
      const runtimeEnv = await hydrateRuntimeEnv(env);
      return routeQueueBatch(batch, runtimeEnv, {
        processJob: processJobImpl,
        createInfrastructure: infrastructureFactory,
        createOperationalStore: operationalStoreFactory,
      });
    },
  });
}
