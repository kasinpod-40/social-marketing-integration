export const META_PAID_LARK_ACTIVE_D1_CONFIG_CONTRACT_VERSION =
  'meta_paid_lark_active_d1_config_v2';

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

  const versionIds = activeVersions.map((entry) => requireUuid(entry?.version_id, 'version_id'));
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
      { bindingName, distinctDatabaseIdCount: uniqueIds.length },
    );
  }
  return uniqueIds[0];
}

export function readD1BindingDescriptor(sourceText, bindingName = 'MKT_STATE_DB') {
  const source = requireText(sourceText, 'sourceText');
  const expectedBindingName = requireText(bindingName, 'bindingName');
  const matches = findBindingObjects(source, expectedBindingName);
  if (matches.length !== 1) {
    throw activeD1Error(
      'Source Wrangler config must contain exactly one requested D1 binding',
      'META_PAID_LARK_ACTIVE_D1_CONFIG_BINDING_INVALID',
      { bindingName: expectedBindingName, bindingObjectCount: matches.length },
    );
  }

  const objectText = matches[0];
  const databaseNamePattern = /(?:["']?)database_name(?:["']?)\s*:\s*(["'])([^"']+)\1/u;
  const databaseIdPattern = /(?:["']?)database_id(?:["']?)\s*:\s*(["'])([^"']+)\1/u;
  const databaseNameMatch = objectText.match(databaseNamePattern);
  if (!databaseNameMatch) {
    throw activeD1Error(
      'Requested D1 binding object has no database_name',
      'META_PAID_LARK_ACTIVE_D1_CONFIG_DATABASE_NAME_MISSING',
      { bindingName: expectedBindingName },
    );
  }

  const databaseIdMatch = objectText.match(databaseIdPattern);
  return Object.freeze({
    bindingName: expectedBindingName,
    databaseName: requireText(databaseNameMatch[2], 'database_name'),
    configuredDatabaseId: databaseIdMatch ? databaseIdMatch[2] : null,
  });
}

export function parseAccountD1Databases(d1ListJsonText) {
  const list = parseJson(d1ListJsonText, 'd1-list');
  if (!Array.isArray(list)) {
    throw activeD1Error(
      'Wrangler D1 list JSON must be an array',
      'META_PAID_LARK_ACCOUNT_D1_LIST_INVALID',
    );
  }

  return Object.freeze(list.map((entry, index) => Object.freeze({
    name: requireText(entry?.name, `d1-list[${index}].name`),
    uuid: requireUuid(entry?.uuid, `d1-list[${index}].uuid`),
  })));
}

export function resolveAccountD1Authority({
  sourceText,
  activeDatabaseId,
  d1ListJsonText,
  bindingName = 'MKT_STATE_DB',
}) {
  const activeId = requireUuid(activeDatabaseId, 'activeDatabaseId');
  const descriptor = readD1BindingDescriptor(sourceText, bindingName);
  const accountDatabases = parseAccountD1Databases(d1ListJsonText);
  const activeMatches = accountDatabases.filter((entry) => entry.uuid === activeId);

  if (activeMatches.length === 1) {
    return Object.freeze({
      authoritySource: 'active_worker_binding_present_in_account',
      bindingName: descriptor.bindingName,
      databaseName: activeMatches[0].name,
      databaseId: activeId,
      activeBindingDatabaseId: activeId,
      activeBindingPresentInAccount: true,
      configuredDatabaseId: descriptor.configuredDatabaseId,
    });
  }
  if (activeMatches.length > 1) {
    throw activeD1Error(
      'Wrangler D1 list returned duplicate rows for the active Worker D1 binding',
      'META_PAID_LARK_ACCOUNT_D1_ACTIVE_DUPLICATE',
      { activeDatabaseId: activeId, matchCount: activeMatches.length },
    );
  }

  const exactNameMatches = accountDatabases.filter(
    (entry) => entry.name === descriptor.databaseName,
  );
  if (exactNameMatches.length !== 1) {
    throw activeD1Error(
      'Active Worker D1 binding is absent from this account and exact database_name fallback is not unique',
      'META_PAID_LARK_ACCOUNT_D1_NAME_AUTHORITY_INVALID',
      {
        bindingName: descriptor.bindingName,
        databaseName: descriptor.databaseName,
        activeBindingDatabaseId: activeId,
        exactNameMatchCount: exactNameMatches.length,
      },
    );
  }

  return Object.freeze({
    authoritySource: 'exact_database_name_present_in_account',
    bindingName: descriptor.bindingName,
    databaseName: exactNameMatches[0].name,
    databaseId: exactNameMatches[0].uuid,
    activeBindingDatabaseId: activeId,
    activeBindingPresentInAccount: false,
    configuredDatabaseId: descriptor.configuredDatabaseId,
  });
}

export function materializeActiveD1Config(
  sourceText,
  databaseId,
  bindingName = 'MKT_STATE_DB',
) {
  const source = requireText(sourceText, 'sourceText');
  const id = requireUuid(databaseId, 'databaseId');
  const expectedBindingName = requireText(bindingName, 'bindingName');
  const matches = findBindingObjects(source, expectedBindingName);
  if (matches.length !== 1) {
    throw activeD1Error(
      'Source Wrangler config must contain exactly one requested D1 binding',
      'META_PAID_LARK_ACTIVE_D1_CONFIG_BINDING_INVALID',
      { bindingName: expectedBindingName, bindingObjectCount: matches.length },
    );
  }

  const databaseIdPattern = /((?:["']?)database_id(?:["']?)\s*:\s*)(["'])([^"']+)\2/u;
  if (!databaseIdPattern.test(matches[0])) {
    throw activeD1Error(
      'Requested D1 binding object has no database_id',
      'META_PAID_LARK_ACTIVE_D1_CONFIG_DATABASE_ID_MISSING',
      { bindingName: expectedBindingName },
    );
  }

  let replaced = false;
  const text = source.replace(/\{[^{}]*\}/gu, (objectText) => {
    if (objectText !== matches[0] || replaced) return objectText;
    replaced = true;
    return objectText.replace(
      databaseIdPattern,
      (_match, prefix, quote) => `${prefix}${quote}${id}${quote}`,
    );
  });

  if (!replaced) {
    throw activeD1Error(
      'Requested D1 binding could not be materialized',
      'META_PAID_LARK_ACTIVE_D1_CONFIG_BINDING_INVALID',
      { bindingName: expectedBindingName },
    );
  }

  return Object.freeze({
    contractVersion: META_PAID_LARK_ACTIVE_D1_CONFIG_CONTRACT_VERSION,
    bindingName: expectedBindingName,
    databaseId: id,
    text,
  });
}

function findBindingObjects(source, bindingName) {
  const bindingPattern = new RegExp(
    `(?:["']?)binding(?:["']?)\\s*:\\s*["']${escapeRegExp(bindingName)}["']`,
    'u',
  );
  return [...source.matchAll(/\{[^{}]*\}/gu)]
    .map((match) => match[0])
    .filter((objectText) => bindingPattern.test(objectText));
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
