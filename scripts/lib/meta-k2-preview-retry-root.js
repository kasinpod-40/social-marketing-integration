import {
  lstat,
  readdir,
  rename,
  stat,
} from 'node:fs/promises';
import { join } from 'node:path';

import {
  META_K2_POST_ACTIVATION_FAILURE_FILES,
  META_K2_PREACTIVATION_FAILURE_FILES,
} from './meta-k2-partial-staging-reviewed-launcher.js';

export const META_K2_WRANGLER_TRANSIENT_DIRECTORY = '.wrangler';

export function classifyMetaK2RetryRootEntries(entries = []) {
  if (!Array.isArray(entries)) {
    throw retryRootError(
      'Meta K2 retry root entries must be an array',
      'META_K2_PREVIEW_RETRY_ROOT_INVALID',
    );
  }

  const normalized = entries.map((entry) => normalizeEntry(entry));
  const names = normalized.map((entry) => entry.name);
  if (new Set(names).size !== names.length) {
    throw retryRootError(
      'Meta K2 retry root contains duplicate entry names',
      'META_K2_PREVIEW_RETRY_ROOT_INVALID',
      { entryNames: [...names].sort() },
    );
  }

  const invalidEntries = normalized.filter((entry) => (
    entry.type !== 'file'
    && !(entry.name === META_K2_WRANGLER_TRANSIENT_DIRECTORY
      && entry.type === 'directory')
  ));
  if (invalidEntries.length > 0) {
    throw retryRootError(
      'Meta K2 retry root contains an unsupported non-file entry',
      'META_K2_PREVIEW_RETRY_ROOT_INVALID',
      {
        entries: invalidEntries
          .map((entry) => ({ name: entry.name, type: entry.type }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      },
    );
  }

  const fileNames = normalized
    .filter((entry) => entry.type === 'file')
    .map((entry) => entry.name)
    .sort();
  const transientToolingDirectories = normalized
    .filter((entry) => entry.type === 'directory')
    .map((entry) => entry.name)
    .sort();

  let retryFootprint;
  if (sameNames(fileNames, META_K2_PREACTIVATION_FAILURE_FILES)) {
    retryFootprint = 'preactivation_no_mutation';
  } else if (sameNames(fileNames, META_K2_POST_ACTIVATION_FAILURE_FILES)) {
    retryFootprint = 'postactivation_no_business_after_verified_restore';
  } else {
    throw retryRootError(
      'Meta K2 retry root files are not an exact reviewed failure footprint',
      'META_K2_PREVIEW_RETRY_ROOT_INVALID',
      { fileNames },
    );
  }

  return Object.freeze({
    accepted: true,
    retryFootprint,
    fileNames: Object.freeze(fileNames),
    transientToolingDirectories: Object.freeze(transientToolingDirectories),
    transientToolingDirectoryCount: transientToolingDirectories.length,
  });
}

export async function retainMetaK2WranglerTransientDirectory(input = {}) {
  const recoveryRoot = requireText(input.recoveryRoot, 'recoveryRoot');
  const now = typeof input.now === 'function' ? input.now : Date.now;
  const rootStat = await lstat(recoveryRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw retryRootError(
      'Meta K2 retry root must be a real directory',
      'META_K2_PREVIEW_RETRY_ROOT_INVALID',
    );
  }

  const dirents = await readdir(recoveryRoot, { withFileTypes: true });
  const classification = classifyMetaK2RetryRootEntries(dirents.map((entry) => ({
    name: entry.name,
    type: direntType(entry),
  })));
  if (classification.transientToolingDirectoryCount === 0) {
    return Object.freeze({
      retained: false,
      ...classification,
      retainedPath: null,
    });
  }

  const sourcePath = join(recoveryRoot, META_K2_WRANGLER_TRANSIENT_DIRECTORY);
  const sourceStat = await lstat(sourcePath);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw retryRootError(
      'Meta K2 Wrangler transient entry must be a real directory',
      'META_K2_PREVIEW_RETRY_ROOT_INVALID',
    );
  }

  const timestamp = Number(now());
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw retryRootError(
      'Meta K2 retry retention timestamp is invalid',
      'META_K2_PREVIEW_RETRY_ROOT_INVALID',
    );
  }
  const retainedPath = `${recoveryRoot}-wrangler-transient-${timestamp}`;
  try {
    await stat(retainedPath);
    throw retryRootError(
      'Meta K2 Wrangler transient retention path already exists',
      'META_K2_PREVIEW_RETRY_ROOT_INVALID',
    );
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  await rename(sourcePath, retainedPath);
  return Object.freeze({
    retained: true,
    ...classification,
    retainedPath,
  });
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw retryRootError(
      'Meta K2 retry root entry must be an object',
      'META_K2_PREVIEW_RETRY_ROOT_INVALID',
    );
  }
  const name = requireText(entry.name, 'entry.name');
  if (name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw retryRootError(
      'Meta K2 retry root entry name is invalid',
      'META_K2_PREVIEW_RETRY_ROOT_INVALID',
      { entryName: name },
    );
  }
  const type = requireText(entry.type, 'entry.type');
  return Object.freeze({ name, type });
}

function direntType(entry) {
  if (entry.isFile()) return 'file';
  if (entry.isDirectory()) return 'directory';
  if (entry.isSymbolicLink()) return 'symlink';
  return 'other';
}

function sameNames(observed, expected) {
  return JSON.stringify([...observed].sort()) === JSON.stringify([...expected].sort());
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw retryRootError(
      `${fieldName} is required`,
      'META_K2_PREVIEW_RETRY_ROOT_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function retryRootError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaK2PreviewRetryRootError';
  error.code = code;
  error.details = details;
  return error;
}
