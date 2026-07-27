import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';

export function rebaseGeneratedWranglerConfigPaths(configText, options = {}) {
  const sourceDirectory = resolveRequiredDirectory(
    options.sourceDirectory,
    'sourceDirectory',
  );
  const outputDirectory = resolveRequiredDirectory(
    options.outputDirectory,
    'outputDirectory',
  );

  let config;
  try {
    config = JSON.parse(requireText(configText, 'configText'));
  } catch (cause) {
    throw pathError(
      'Generated Wrangler config is not valid JSON',
      'CHATWOOT_SAFE_CONFIG_GENERATED_JSON_INVALID',
      { cause: cause?.message ?? 'JSON_PARSE_FAILED' },
    );
  }

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw pathError(
      'Generated Wrangler config must be an object',
      'CHATWOOT_SAFE_CONFIG_GENERATED_JSON_INVALID',
    );
  }

  const rebased = structuredClone(config);
  if (typeof rebased.$schema === 'string' && rebased.$schema.trim() !== '') {
    rebased.$schema = rebasePath(
      rebased.$schema,
      sourceDirectory,
      outputDirectory,
      '$schema',
    );
  }
  rebased.main = rebasePath(
    rebased.main,
    sourceDirectory,
    outputDirectory,
    'main',
  );

  if (!Array.isArray(rebased.d1_databases) || rebased.d1_databases.length !== 1) {
    throw pathError(
      'Generated Wrangler config requires exactly one D1 binding',
      'CHATWOOT_SAFE_CONFIG_GENERATED_PATH_INVALID',
      { fieldName: 'd1_databases' },
    );
  }
  rebased.d1_databases[0].migrations_dir = rebasePath(
    rebased.d1_databases[0].migrations_dir ?? './migrations',
    sourceDirectory,
    outputDirectory,
    'migrations_dir',
  );

  const text = `${JSON.stringify(rebased, null, 2)}\n`;
  return Object.freeze({
    text,
    sha256: createHash('sha256').update(text).digest('hex'),
    main: rebased.main,
    migrationsDirectory: rebased.d1_databases[0].migrations_dir,
    schemaPath: rebased.$schema ?? null,
  });
}

function rebasePath(value, sourceDirectory, outputDirectory, fieldName) {
  const configured = requireText(value, fieldName);
  const absolute = isAbsolute(configured)
    ? configured
    : resolve(sourceDirectory, configured);
  const candidate = relative(outputDirectory, absolute).replaceAll('\\', '/');
  if (candidate === '') {
    throw pathError(
      `Generated Wrangler ${fieldName} must not resolve to the config directory`,
      'CHATWOOT_SAFE_CONFIG_GENERATED_PATH_INVALID',
      { fieldName },
    );
  }
  if (isAbsolute(candidate)) return candidate;
  return candidate.startsWith('.') ? candidate : `./${candidate}`;
}

function resolveRequiredDirectory(value, fieldName) {
  return resolve(requireText(value, fieldName));
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw pathError(
      `${fieldName} is required`,
      'CHATWOOT_SAFE_CONFIG_GENERATED_PATH_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function pathError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootGeneratedWranglerPathError';
  error.code = code;
  error.details = details;
  return error;
}
