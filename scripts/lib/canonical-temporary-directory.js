import { realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';

const TEMP_ENV_NAMES = Object.freeze(['TMPDIR', 'TMP', 'TEMP']);

export function canonicalizeTemporaryDirectoryEnvironment(
  env = process.env,
  options = {},
) {
  const requested = options.tmpDirectory ?? tmpdir();
  const canonical = (options.realpath ?? realpathSync.native)(requested);
  const inspected = (options.stat ?? statSync)(canonical);

  if (!inspected.isDirectory()) {
    throw temporaryDirectoryError(
      'Temporary directory target must be a directory',
      'CANONICAL_TEMP_DIRECTORY_INVALID',
    );
  }

  for (const name of TEMP_ENV_NAMES) env[name] = canonical;

  return Object.freeze({
    canonicalDirectory: canonical,
    environmentNames: TEMP_ENV_NAMES,
  });
}

function temporaryDirectoryError(message, code) {
  const error = new Error(message);
  error.name = 'CanonicalTemporaryDirectoryError';
  error.code = code;
  return error;
}
