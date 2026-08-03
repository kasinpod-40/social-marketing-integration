import { loadCustomerRuntimeConfig } from '../../../packages/config/src/customer-profiles.js';
import {
  META_K2_EXACT_RECOVERY_PATH,
} from '../../../packages/config/src/meta-k2-exact-recovery-contract.js';
import {
  createMetaD1OnlyPartialStagingRecoveryHttpHandler,
} from './meta-d1-only-partial-staging-recovery-http.js';
import { processJobWithMetaEndToEnd } from './meta-active-job-router.js';
import { createInfrastructure } from './runtime-infrastructure.js';

const TERMINAL_RECOVERY_MODE = 'RECOVER_EXACT_FAILED_META_OPERATION';

export function buildMetaK2SourceCompleteUseCaseEnv(env = {}) {
  return Object.freeze({
    ...env,
    MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY: 'false',
    MKT_META_D1_ONLY_TERMINAL_RECOVERY: TERMINAL_RECOVERY_MODE,
  });
}

export function createMetaK2SourceCompleteRecoveryPreviewWorker(dependencies = {}) {
  const processJob = dependencies.processJob ?? processJobWithMetaEndToEnd;
  const runtimeLoader = dependencies.loadRuntimeConfig ?? loadCustomerRuntimeConfig;
  const infrastructureFactory = dependencies.createInfrastructure ?? createInfrastructure;

  const route = createMetaD1OnlyPartialStagingRecoveryHttpHandler({
    readRuntimeVersionId: dependencies.readRuntimeVersionId,
    async processJob(input) {
      const useCaseEnv = buildMetaK2SourceCompleteUseCaseEnv(input.env);
      let runtimeConfig = null;
      let infrastructure = null;
      return processJob({
        ...input,
        env: useCaseEnv,
        getRuntimeConfig: () => {
          runtimeConfig ??= runtimeLoader(useCaseEnv);
          return runtimeConfig;
        },
        getInfrastructure: () => {
          infrastructure ??= infrastructureFactory(useCaseEnv);
          return infrastructure;
        },
      });
    },
  });

  return Object.freeze({
    async fetch(request, env) {
      const url = new URL(request.url);
      if (request.method !== 'POST' || url.pathname !== META_K2_EXACT_RECOVERY_PATH) {
        return json(404, {
          ok: false,
          code: 'META_K2_SOURCE_COMPLETE_PREVIEW_ROUTE_NOT_FOUND',
          queueMessageCount: 0,
          scheduleEnabled: false,
          production: false,
        });
      }
      return route({ request, env, url });
    },

    async queue(batch) {
      batch.retryAll();
    },

    async scheduled() {
      // Preview-only entrypoint: schedules are intentionally disabled.
    },
  });
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export default createMetaK2SourceCompleteRecoveryPreviewWorker();
