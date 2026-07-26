import { CONNECTOR_KEYS, getConnectorCatalogEntry } from '../../../packages/config/src/connector-catalog.js';
import { JOB_TYPES, getJobDefinition } from '../../../packages/application/src/jobs/job-catalog.js';
import { assertMetaEndToEndGates } from '../../../packages/config/src/meta-end-to-end-runtime-config.js';
import { permanentError } from '../../../packages/shared/src/errors/runtime-error.js';

const JOB_TO_CONNECTOR = Object.freeze({
  [JOB_TYPES.FACEBOOK_ORGANIC_SYNC]: CONNECTOR_KEYS.FACEBOOK,
  [JOB_TYPES.INSTAGRAM_ORGANIC_SYNC]: CONNECTOR_KEYS.INSTAGRAM,
});

/**
 * Additive Worker routing module. The shared entrypoint/job catalog remain untouched.
 * Integration Chat can register this router only after applying the protected-file patch
 * documented in docs/tasks/meta-end-to-end.md.
 */
export function createMetaEndToEndJobRouter(input = {}) {
  const handlers = requireHandlers(input.handlers);
  const runtimeConfig = requireObject(input.runtimeConfig, 'runtimeConfig');

  return Object.freeze({
    canRoute(job) {
      const type = optionalText(job?.type);
      return Boolean(type && Object.hasOwn(JOB_TO_CONNECTOR, type));
    },

    async route(job, context = {}) {
      const type = requireText(job?.type, 'job.type');
      const definition = getJobDefinition(type);
      const connectorKey = JOB_TO_CONNECTOR[type];
      if (!connectorKey || definition.connectorKey !== connectorKey) {
        throw permanentError(`Meta router cannot handle job type: ${type}`, {
          code: 'META_END_TO_END_JOB_UNSUPPORTED',
        });
      }
      return routeConnector({ connectorKey, job, context, handlers, runtimeConfig });
    },

    async routeConnector(connectorKey, job, context = {}) {
      return routeConnector({
        connectorKey: requireMetaConnector(connectorKey),
        job,
        context,
        handlers,
        runtimeConfig,
      });
    },
  });
}

async function routeConnector(input) {
  const connector = getConnectorCatalogEntry(input.connectorKey);
  const handler = input.handlers[input.connectorKey];
  if (typeof handler !== 'function') {
    throw permanentError(`Meta handler is missing for ${input.connectorKey}`, {
      code: 'META_END_TO_END_HANDLER_MISSING',
    });
  }
  assertMetaEndToEndGates(input.runtimeConfig, {
    sourceRead: true,
    d1Write: input.context?.dryRun !== true,
    larkWrite: input.context?.dryRun !== true && input.context?.d1Only !== true,
  });
  return handler({
    job: requireObject(input.job, 'job'),
    context: input.context,
    connector,
  });
}

function requireHandlers(value) {
  const handlers = requireObject(value, 'handlers');
  const result = {};
  for (const key of [CONNECTOR_KEYS.FACEBOOK, CONNECTOR_KEYS.INSTAGRAM, CONNECTOR_KEYS.META_ADS]) {
    if (handlers[key] !== undefined && typeof handlers[key] !== 'function') {
      throw new TypeError(`handlers.${key} must be a function`);
    }
    result[key] = handlers[key] ?? null;
  }
  return Object.freeze(result);
}

function requireMetaConnector(value) {
  const key = requireText(value, 'connectorKey');
  if (![CONNECTOR_KEYS.FACEBOOK, CONNECTOR_KEYS.INSTAGRAM, CONNECTOR_KEYS.META_ADS].includes(key)) {
    throw permanentError(`Unsupported Meta connector: ${key}`, {
      code: 'META_END_TO_END_CONNECTOR_UNSUPPORTED',
    });
  }
  return key;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${fieldName} is required`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function optionalText(value) {
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}
