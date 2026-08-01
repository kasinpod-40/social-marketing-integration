import {
  chmod,
  cp,
  lstat,
  readdir,
  stat,
} from 'node:fs/promises';
import { join } from 'node:path';

const REQUIRED_FILES = Object.freeze([
  'session.json',
  'read-only-preflight.json',
  'active-deployment.json',
  'initial-send.attempt.json',
]);

export async function materializeChatwootControllerEvidenceDirectory({
  sourceDirectory,
  destinationRoot,
  directoryName,
}) {
  const name = requireDirectoryName(directoryName);
  await assertRealDirectory(sourceDirectory, 'sourceDirectory');
  await assertRealDirectory(destinationRoot, 'destinationRoot');

  const destination = join(destinationRoot, name);
  const existing = await lstat(destination).catch((cause) => {
    if (cause?.code === 'ENOENT') return null;
    throw cause;
  });
  if (existing) {
    throw isolationError(
      'Chatwoot isolated evidence destination already exists',
      'CHATWOOT_CONTROLLER_EVIDENCE_ISOLATION_DESTINATION_PRESENT',
    );
  }

  await cp(sourceDirectory, destination, {
    recursive: true,
    force: false,
    errorOnExist: true,
    dereference: true,
    preserveTimestamps: true,
  });
  await chmod(destination, 0o700);
  await assertRealDirectory(destination, 'destination');

  const visibleEntry = (await readdir(destinationRoot, { withFileTypes: true }))
    .find((entry) => entry.name === name);
  if (!visibleEntry?.isDirectory()) {
    throw isolationError(
      'Chatwoot isolated evidence is not visible as a real directory',
      'CHATWOOT_CONTROLLER_EVIDENCE_ISOLATION_DIRECTORY_INVALID',
    );
  }

  for (const fileName of REQUIRED_FILES) {
    const path = join(destination, fileName);
    const link = await lstat(path).catch(() => null);
    const info = await stat(path).catch(() => null);
    if (!link || link.isSymbolicLink() || !info?.isFile()) {
      throw isolationError(
        'Chatwoot isolated evidence is missing a required regular file',
        'CHATWOOT_CONTROLLER_EVIDENCE_ISOLATION_FILE_INVALID',
        { fileName },
      );
    }
  }

  return Object.freeze({
    directory: destination,
    directoryName: name,
    realDirectory: true,
    retainedEvidenceMutation: false,
  });
}

async function assertRealDirectory(path, field) {
  const link = await lstat(path).catch(() => null);
  const info = await stat(path).catch(() => null);
  if (!link || link.isSymbolicLink() || !info?.isDirectory()) {
    throw isolationError(
      `${field} must be a real directory`,
      'CHATWOOT_CONTROLLER_EVIDENCE_ISOLATION_DIRECTORY_INVALID',
      { field },
    );
  }
}

function requireDirectoryName(value) {
  const text = String(value ?? '').trim();
  if (text === '' || text === '.' || text === '..' || /[\\/]/u.test(text)) {
    throw isolationError(
      'Chatwoot isolated evidence directory name is invalid',
      'CHATWOOT_CONTROLLER_EVIDENCE_ISOLATION_DIRECTORY_INVALID',
    );
  }
  return text;
}

function isolationError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootControllerEvidenceIsolationError';
  error.code = code;
  error.details = details;
  return error;
}
