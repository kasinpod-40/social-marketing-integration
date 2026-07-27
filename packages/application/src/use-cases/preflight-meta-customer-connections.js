import {
  META_REQUIRED_PERMISSIONS,
  META_TOKEN_CONNECTION_KEYS,
  META_TOKEN_CONNECTION_STATUSES,
} from '../../../config/src/meta-token-connection-config.js';

const CONNECTOR_DEFINITIONS = Object.freeze([
  Object.freeze({
    key: META_TOKEN_CONNECTION_KEYS.FACEBOOK_ORGANIC,
    adapterField: 'facebook',
    mappingField: 'facebookPageId',
    adapterMappingField: 'expectedPageId',
    permissionValidation: 'permissions_edge',
  }),
  Object.freeze({
    key: META_TOKEN_CONNECTION_KEYS.INSTAGRAM_ORGANIC,
    adapterField: 'instagram',
    mappingField: 'instagramAccountId',
    adapterMappingField: 'expectedAccountId',
    permissionValidation: 'identity_endpoint',
  }),
  Object.freeze({
    key: META_TOKEN_CONNECTION_KEYS.META_ADS,
    adapterField: 'metaAds',
    mappingField: 'metaAdAccountIds',
    adapterMappingField: 'expectedAdAccountIds',
    permissionValidation: 'permissions_edge',
  }),
]);

/** รัน Meta connection preflight แยกช่องทาง; Failure ช่องหนึ่งไม่ซ่อนผลอีกช่อง */
export async function preflightMetaCustomerConnections(runtime = {}) {
  const mappings = runtime.mappings ?? {};
  const results = await Promise.all(CONNECTOR_DEFINITIONS.map(async (definition) => {
    const adapter = runtime[definition.adapterField] ?? null;
    if (!adapter) return notConfiguredResult(definition);

    try {
      const facts = await adapter.preflight({
        [definition.adapterMappingField]: mappings[definition.mappingField],
      });
      return buildSuccessfulResult(definition, facts);
    } catch (error) {
      return buildProviderFailureResult(definition, error);
    }
  }));
  const configuredResults = results.filter((result) => result.configured);

  return deepFreeze({
    ok: configuredResults.length > 0
      && configuredResults.every(
        (result) => result.status === META_TOKEN_CONNECTION_STATUSES.IDENTITY_VALIDATED,
      ),
    businessWrites: 0,
    connectors: results,
  });
}

function notConfiguredResult(definition) {
  return buildBaseResult(definition, {
    configured: false,
    status: META_TOKEN_CONNECTION_STATUSES.NOT_CONFIGURED,
  });
}

function buildSuccessfulResult(definition, facts) {
  const requiredPermissions = META_REQUIRED_PERMISSIONS[definition.key];
  const granted = new Set(Array.isArray(facts?.grantedPermissions) ? facts.grantedPermissions : []);
  const missingPermissions = requiredPermissions.filter((permission) => !granted.has(permission));
  let status = META_TOKEN_CONNECTION_STATUSES.IDENTITY_VALIDATED;

  if (missingPermissions.length > 0) {
    status = META_TOKEN_CONNECTION_STATUSES.SCOPE_INSUFFICIENT;
  } else if (facts?.candidateCount === 0) {
    status = META_TOKEN_CONNECTION_STATUSES.IDENTITY_UNAVAILABLE;
  } else if (facts?.mappingConfigured !== true) {
    status = META_TOKEN_CONNECTION_STATUSES.IDENTITY_MAPPING_REQUIRED;
  } else if (facts?.identityMatched !== true) {
    status = META_TOKEN_CONNECTION_STATUSES.IDENTITY_MISMATCH;
  }

  return buildBaseResult(definition, {
    configured: true,
    status,
    candidateCount: safeCount(facts?.candidateCount),
    mappingConfigured: facts?.mappingConfigured === true,
    identityMatched: facts?.identityMatched === true,
    permissions: {
      validation: definition.permissionValidation,
      required: requiredPermissions,
      missing: missingPermissions,
    },
    metadata: buildSafeMetadata(definition.key, facts),
  });
}

function buildProviderFailureResult(definition, error) {
  const graphCode = Number.isFinite(Number(error?.details?.graphCode))
    ? Number(error.details.graphCode)
    : null;
  const providerReason = typeof error?.details?.providerReason === 'string'
    ? error.details.providerReason
    : null;
  let status = META_TOKEN_CONNECTION_STATUSES.PROVIDER_ERROR;

  if (graphCode === 190) {
    status = META_TOKEN_CONNECTION_STATUSES.TOKEN_INVALID;
  } else if (graphCode === 200 && providerReason === 'api_access_blocked') {
    status = META_TOKEN_CONNECTION_STATUSES.PROVIDER_BLOCKED;
  } else if (error?.retryable === true) {
    status = META_TOKEN_CONNECTION_STATUSES.PROVIDER_UNAVAILABLE;
  }

  return buildBaseResult(definition, {
    configured: true,
    status,
    providerError: {
      code: typeof error?.code === 'string' ? error.code : 'UNEXPECTED_ERROR',
      graphCode,
      retryable: error?.retryable === true,
    },
  });
}

function buildBaseResult(definition, overrides) {
  return {
    connectorKey: definition.key,
    configured: overrides.configured,
    status: overrides.status,
    candidateCount: overrides.candidateCount ?? 0,
    mappingConfigured: overrides.mappingConfigured ?? false,
    identityMatched: overrides.identityMatched ?? false,
    permissions: overrides.permissions ?? {
      validation: definition.permissionValidation,
      required: META_REQUIRED_PERMISSIONS[definition.key],
      missing: [],
    },
    metadata: overrides.metadata ?? {},
    providerError: overrides.providerError ?? null,
  };
}

function buildSafeMetadata(connectorKey, facts) {
  if (connectorKey === META_TOKEN_CONNECTION_KEYS.FACEBOOK_ORGANIC) {
    return {
      linkedInstagramCount: safeCount(facts?.linkedInstagramCount),
    };
  }
  if (connectorKey === META_TOKEN_CONNECTION_KEYS.INSTAGRAM_ORGANIC) {
    return {
      accountType: safeAccountType(facts?.accountType),
    };
  }
  return {
    activeCandidateCount: safeCount(facts?.activeCandidateCount),
    expectedAccountCount: safeCount(facts?.expectedAccountCount),
    matchedAccountCount: safeCount(facts?.matchedAccountCount),
    missingAccountCount: safeCount(facts?.missingAccountCount),
  };
}

function safeCount(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function safeAccountType(value) {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return ['BUSINESS', 'MEDIA_CREATOR'].includes(normalized) ? normalized : null;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
