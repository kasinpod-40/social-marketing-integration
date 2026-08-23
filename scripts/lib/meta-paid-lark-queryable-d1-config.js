export const META_PAID_LARK_QUERYABLE_D1_CONFIG_CONTRACT_VERSION =
  'meta_paid_lark_queryable_d1_config_v1';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function materializeNameResolvedD1Config(
  sourceText,
  bindingName = 'MKT_STATE_DB',
) {
  const source = requireText(sourceText, 'sourceText');
  const expectedBindingName = requireText(bindingName, 'bindingName');
  const matches = findBindingObjects(source, expectedBindingName);
  if (matches.length !== 1) {
    throw queryableD1Error(
      'Source Wrangler config must contain exactly one requested D1 binding',
      'META_PAID_LARK_QUERYABLE_D1_CONFIG_BINDING_INVALID',
      { bindingName: expectedBindingName, bindingObjectCount: matches.length },
    );
  }

  const objectText = matches[0];
  const databaseNamePattern = /(?:["']?)database_name(?:["']?)\s*:\s*(["'])([^"']+)\1/u;
  const databaseIdProperty = '(?:["\']?)database_id(?:["\']?)\\s*:\\s*(["\'])[^"\']+\\1';
  const databaseNameMatch = objectText.match(databaseNamePattern);
  if (!databaseNameMatch) {
    throw queryableD1Error(
      'Requested D1 binding object must provide database_name for API name resolution',
      'META_PAID_LARK_QUERYABLE_D1_DATABASE_NAME_MISSING',
      { bindingName: expectedBindingName },
    );
  }

  const configuredIdMatch = objectText.match(
    /(?:["']?)database_id(?:["']?)\s*:\s*(["'])([^"']+)\1/u,
  );
  let rewrittenObject = objectText;
  if (configuredIdMatch) {
    const withTrailingComma = new RegExp(`\\s*${databaseIdProperty}\\s*,`, 'u');
    const withLeadingComma = new RegExp(`,\\s*${databaseIdProperty}\\s*`, 'u');
    if (withTrailingComma.test(rewrittenObject)) {
      rewrittenObject = rewrittenObject.replace(withTrailingComma, '');
    } else if (withLeadingComma.test(rewrittenObject)) {
      rewrittenObject = rewrittenObject.replace(withLeadingComma, '');
    } else {
      throw queryableD1Error(
        'Requested D1 database_id could not be removed safely',
        'META_PAID_LARK_QUERYABLE_D1_DATABASE_ID_REMOVE_FAILED',
        { bindingName: expectedBindingName },
      );
    }
  }

  if (/(?:["']?)database_id(?:["']?)\s*:/u.test(rewrittenObject)) {
    throw queryableD1Error(
      'Name-resolved D1 config still contains database_id',
      'META_PAID_LARK_QUERYABLE_D1_DATABASE_ID_PRESENT',
      { bindingName: expectedBindingName },
    );
  }

  let replaced = false;
  const text = source.replace(/\{[^{}]*\}/gu, (candidate) => {
    if (candidate !== objectText || replaced) return candidate;
    replaced = true;
    return rewrittenObject;
  });
  if (!replaced) {
    throw queryableD1Error(
      'Requested D1 binding could not be materialized',
      'META_PAID_LARK_QUERYABLE_D1_CONFIG_BINDING_INVALID',
      { bindingName: expectedBindingName },
    );
  }

  return Object.freeze({
    contractVersion: META_PAID_LARK_QUERYABLE_D1_CONFIG_CONTRACT_VERSION,
    bindingName: expectedBindingName,
    databaseName: requireText(databaseNameMatch[2], 'database_name'),
    configuredDatabaseId: configuredIdMatch?.[2] ?? null,
    text,
  });
}

export function parseResolvedD1Info(infoJsonText, expectedDatabaseName) {
  const info = parseJson(infoJsonText, 'd1-info');
  const expectedName = requireText(expectedDatabaseName, 'expectedDatabaseName');
  const name = requireText(info?.name, 'd1-info.name');
  if (name !== expectedName) {
    throw queryableD1Error(
      'Wrangler D1 name resolution returned a different database name',
      'META_PAID_LARK_QUERYABLE_D1_NAME_MISMATCH',
      { expectedDatabaseName: expectedName, resolvedDatabaseName: name },
    );
  }
  const databaseId = requireUuid(info?.uuid, 'd1-info.uuid');
  return Object.freeze({ databaseName: name, databaseId });
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
    throw queryableD1Error(
      `Could not parse ${label} JSON`,
      'META_PAID_LARK_QUERYABLE_D1_JSON_INVALID',
      { label },
    );
  }
}

function requireUuid(value, fieldName) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw queryableD1Error(
      `${fieldName} must be a UUID`,
      'META_PAID_LARK_QUERYABLE_D1_UUID_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw queryableD1Error(
      `${fieldName} is required`,
      'META_PAID_LARK_QUERYABLE_D1_INPUT_INVALID',
      { fieldName },
    );
  }
  return value;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function queryableD1Error(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaPaidLarkQueryableD1ConfigError';
  error.code = code;
  error.details = details;
  return error;
}
