export const META_PAID_LARK_ACTIVE_D1_CONFIG_CONTRACT_VERSION =
  'meta_paid_lark_active_d1_config_v1';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function parseActiveDeploymentVersionIds(deploymentJsonText) {
  const deployment = parseJson(deploymentJsonText, 'deployment');
  if (!Array.isArray(deployment?.versions) || deployment.versions.length === 0) {
    throw activeD1Error(
      'Active Worker deployment has no versions',
      'META_PAID_LARK_ACTIVE_D1_DEPLOYMENT_INVALID',
    );
  }

  const activeVersions = deployment.versions.filter((entry) => Number(entry?.percentage) > 0);
  if (activeVersions.length === 0) {
    throw activeD1Error(
      'Active Worker deployment has no traffic-bearing versions',
      'META_PAID_LARK_ACTIVE_D1_DEPLOYMENT_INVALID',
    );
  }

  const versionIds = activeVersions.map((entry) => {
    const versionId = requireUuid(entry?.version_id, 'version_id');
    return versionId;
  });
  return Object.freeze([...new Set(versionIds)]);
}

export function resolveSharedActiveD1BindingId(
  versionJsonTexts,
  bindingName = 'MKT_STATE_DB',
) {
  if (!Array.isArray(versionJsonTexts) || versionJsonTexts.length === 0) {
    throw activeD1Error(
      'Active Worker version details are required',
      'META_PAID_LARK_ACTIVE_D1_VERSION_DETAILS_MISSING',
    );
  }
  const expectedBindingName = requireText(bindingName, 'bindingName');
  const ids = versionJsonTexts.map((versionJsonText) => {
    const version = parseJson(versionJsonText, 'version');
    const bindings = version?.resources?.bindings;
    if (!Array.isArray(bindings)) {
      throw activeD1Error(
        'Active Worker version has no bindings array',
        'META_PAID_LARK_ACTIVE_D1_BINDINGS_INVALID',
      );
    }
    const matches = bindings.filter(
      (binding) => binding?.name === expectedBindingName && binding?.type === 'd1',
    );
    if (matches.length !== 1) {
      throw activeD1Error(
        'Active Worker version must expose exactly one requested D1 binding',
        'META_PAID_LARK_ACTIVE_D1_BINDING_INVALID',
        { bindingName: expectedBindingName, matchCount: matches.length },
      );
    }
    return requireUuid(matches[0]?.id, 'database_id');
  });

  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length !== 1) {
    throw activeD1Error(
      'Traffic-bearing Worker versions disagree on the requested D1 binding',
      'META_PAID_LARK_ACTIVE_D1_BINDING_AMBIGUOUS',
      { bindingName: expectedBindingName, distinctDatabaseIdCount: uniqueIds.length },
    );
  }
  return uniqueIds[0];
}

export function materializeActiveD1Config(
  sourceText,
  databaseId,
  bindingName = 'MKT_STATE_DB',
) {
  const source = requireText(sourceText, 'sourceText');
  const id = requireUuid(databaseId, 'databaseId');
  const expectedBindingName = requireText(bindingName, 'bindingName');
  const objectPattern = /\{[^{}]*\}/gu;
  const bindingPattern = new RegExp(
    `(?:["']?)binding(?:["']?)\\s*:\\s*["']${escapeRegExp(expectedBindingName)}["']`,
    'u',
  );
  const databaseIdPattern = /((?:["']?)database_id(?:["']?)\s*:\s*)(["'])([^"']+)\2/u;
  let bindingObjectCount = 0;
  let replacedDatabaseIdCount = 0;

  const text = source.replace(objectPattern, (objectText) => {
    if (!bindingPattern.test(objectText)) return objectText;
    bindingObjectCount += 1;
    if (!databaseIdPattern.test(objectText)) {
      throw activeD1Error(
        'Requested D1 binding object has no database_id',
        'META_PAID_LARK_ACTIVE_D1_CONFIG_DATABASE_ID_MISSING',
        { bindingName: expectedBindingName },
      );
    }
    replacedDatabaseIdCount += 1;
    return objectText.replace(
      databaseIdPattern,
      (_match, prefix, quote) => `${prefix}${quote}${id}${quote}`,
    );
  });

  if (bindingObjectCount !== 1 || replacedDatabaseIdCount !== 1) {
    throw activeD1Error(
      'Source Wrangler config must contain exactly one requested D1 binding',
      'META_PAID_LARK_ACTIVE_D1_CONFIG_BINDING_INVALID',
      {
        bindingName: expectedBindingName,
        bindingObjectCount,
        replacedDatabaseIdCount,
      },
    );
  }

  return Object.freeze({
    contractVersion: META_PAID_LARK_ACTIVE_D1_CONFIG_CONTRACT_VERSION,
    bindingName: expectedBindingName,
    databaseId: id,
    text,
  });
}

function parseJson(value, label) {
  const text = requireText(value, label);
  try {
    return JSON.parse(text);
  } catch {
    throw activeD1Error(
      `Could not parse ${label} JSON`,
      'META_PAID_LARK_ACTIVE_D1_JSON_INVALID',
      { label },
    );
  }
}

function requireUuid(value, fieldName) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw activeD1Error(
      `${fieldName} must be a UUID`,
      'META_PAID_LARK_ACTIVE_D1_UUID_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw activeD1Error(
      `${fieldName} is required`,
      'META_PAID_LARK_ACTIVE_D1_INPUT_INVALID',
      { fieldName },
    );
  }
  return value;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function activeD1Error(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaPaidLarkActiveD1ConfigError';
  error.code = code;
  error.details = details;
  return error;
}
