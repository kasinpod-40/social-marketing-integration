import { CONNECTOR_RUN_MODES } from '../../../packages/application/src/connectors/connector-registry.js';
import { JOB_TRIGGERS } from '../../../packages/application/src/jobs/job-catalog.js';
import { permanentError } from '../../../packages/shared/src/errors/runtime-error.js';
import { readBoolean } from './worker-runtime-support.js';

/** Resolve the dedicated customer Production-UAT lane without changing normal scheduled admission. */
export function resolveConnectorRunMode(input = {}) {
  if (input.trigger !== JOB_TRIGGERS.PRODUCTION_CONNECTOR_UAT) {
    return CONNECTOR_RUN_MODES.STANDARD;
  }

  if (input.runtimeConfig?.environment !== 'production'
    || input.runtimeConfig?.profileKey !== 'chemistry_k') {
    throw permanentError('Controlled connector Production UAT requires chemistry_k Production runtime', {
      code: 'MKT_PRODUCTION_CONNECTOR_UAT_ENV_INVALID',
      details: {
        environment: input.runtimeConfig?.environment ?? null,
        profileKey: input.runtimeConfig?.profileKey ?? null,
      },
    });
  }

  if (!readBoolean(input.env?.MKT_PRODUCTION_CONNECTOR_UAT_ENABLED, false)) {
    throw permanentError('Controlled connector Production UAT is disabled', {
      code: 'MKT_PRODUCTION_CONNECTOR_UAT_DISABLED',
      details: { connectorKey: input.connectorKey ?? null },
    });
  }

  const selectedConnector = normalizeConnectorSelector(
    input.env?.MKT_PRODUCTION_CONNECTOR_UAT_CONNECTOR,
  );
  if (!selectedConnector || selectedConnector !== input.connectorKey) {
    throw permanentError('Controlled connector Production UAT connector selector does not match the job', {
      code: 'MKT_PRODUCTION_CONNECTOR_UAT_CONNECTOR_MISMATCH',
      details: {
        connectorKey: input.connectorKey ?? null,
        selectedConnector: selectedConnector || null,
      },
    });
  }

  return CONNECTOR_RUN_MODES.CONTROLLED_PRODUCTION_UAT;
}

function normalizeConnectorSelector(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
