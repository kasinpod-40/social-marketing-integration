import {
  realpath,
  stat,
} from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  resolve,
  sep,
} from 'node:path';

const MAIN_PROPERTY =
  /((?:["']?main["']?)\s*:\s*)(["'])([^"']+)\2/gu;

export async function materializeMetaK3WranglerEntrypoint(
  configText,
  input = {},
) {
  if (typeof configText !== 'string' || configText.trim() === '') {
    throw authorityError(
      'K3 Wrangler config text is required',
      'META_K3_WRANGLER_CONFIG_REQUIRED',
    );
  }

  const repositoryRoot = await realpath(requireText(
    input.repositoryRoot,
    'repositoryRoot',
  ));
  const sourceConfigPath = await realpath(requireText(
    input.sourceConfigPath,
    'sourceConfigPath',
  ));
  assertInsideRepository(sourceConfigPath, repositoryRoot, 'sourceConfigPath');

  const matches = [...configText.matchAll(MAIN_PROPERTY)];
  MAIN_PROPERTY.lastIndex = 0;
  if (matches.length !== 1) {
    throw authorityError(
      'K3 Wrangler config must contain exactly one main entrypoint',
      'META_K3_WRANGLER_ENTRYPOINT_INVALID',
      { mainPropertyCount: matches.length },
    );
  }

  const configuredMain = matches[0][3];
  const candidate = isAbsolute(configuredMain)
    ? configuredMain
    : resolve(dirname(sourceConfigPath), configuredMain);
  const canonicalEntrypoint = await realpath(candidate).catch(() => null);
  if (!canonicalEntrypoint) {
    throw authorityError(
      'K3 Wrangler entrypoint does not exist',
      'META_K3_WRANGLER_ENTRYPOINT_MISSING',
    );
  }
  assertInsideRepository(
    canonicalEntrypoint,
    repositoryRoot,
    'main',
  );
  const value = await stat(canonicalEntrypoint);
  if (!value.isFile()) {
    throw authorityError(
      'K3 Wrangler entrypoint must be a regular file',
      'META_K3_WRANGLER_ENTRYPOINT_INVALID',
    );
  }

  MAIN_PROPERTY.lastIndex = 0;
  const materializedText = configText.replace(
    MAIN_PROPERTY,
    `$1${JSON.stringify(canonicalEntrypoint)}`,
  );
  MAIN_PROPERTY.lastIndex = 0;

  const observed = [...materializedText.matchAll(MAIN_PROPERTY)];
  MAIN_PROPERTY.lastIndex = 0;
  if (observed.length !== 1 || observed[0][3] !== canonicalEntrypoint) {
    throw authorityError(
      'K3 Wrangler entrypoint materialization failed',
      'META_K3_WRANGLER_ENTRYPOINT_INVALID',
    );
  }

  return Object.freeze({
    configText: materializedText,
    entrypoint: canonicalEntrypoint,
    entrypointAnchoredToRepository: true,
  });
}

function assertInsideRepository(path, repositoryRoot, fieldName) {
  if (path !== repositoryRoot
    && !path.startsWith(`${repositoryRoot}${sep}`)) {
    throw authorityError(
      `${fieldName} must resolve inside the Repository`,
      'META_K3_WRANGLER_PATH_OUTSIDE_REPOSITORY',
      { fieldName },
    );
  }
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw authorityError(
      `${fieldName} is required`,
      'META_K3_WRANGLER_CONFIG_REQUIRED',
      { fieldName },
    );
  }
  return value.trim();
}

function authorityError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaK3WranglerConfigAuthorityError';
  error.code = code;
  error.details = details;
  return error;
}
