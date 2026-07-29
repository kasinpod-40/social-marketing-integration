import { chmod, lstat, realpath, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

export const LOCAL_SECRET_OWNER_ONLY_MODE = 0o600;

export async function inspectLocalSecretFile(secretPath, options = {}) {
  const platform = options.platform ?? process.platform;
  const expectedBasename = options.expectedBasename ?? basename(secretPath);
  const requestedPath = resolve(secretPath);

  let entry;
  try {
    entry = await lstat(requestedPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return Object.freeze({
        exists: false,
        symbolicLink: false,
        ownerOnly: true,
        mode: null,
        resolvedPath: null,
        device: null,
        inode: null,
      });
    }
    throw error;
  }

  const symbolicLink = entry.isSymbolicLink();
  let resolvedPath = requestedPath;
  if (symbolicLink) {
    try {
      resolvedPath = await realpath(requestedPath);
    } catch {
      throw localSecretFailure(
        'Local secret symbolic link is broken or cannot be resolved',
        'LOCAL_SECRET_FILE_SYMLINK_INVALID',
      );
    }
    if (basename(resolvedPath) !== expectedBasename) {
      throw localSecretFailure(
        'Local secret symbolic link target must retain the expected filename',
        'LOCAL_SECRET_FILE_SYMLINK_TARGET_INVALID',
      );
    }
  }

  let target;
  try {
    target = symbolicLink ? await stat(requestedPath) : entry;
  } catch {
    throw localSecretFailure(
      'Local secret target cannot be read',
      'LOCAL_SECRET_FILE_TARGET_INVALID',
    );
  }

  if (!target.isFile()) {
    throw localSecretFailure(
      'Local secret target must be a regular file',
      'LOCAL_SECRET_FILE_TARGET_INVALID',
    );
  }

  if (platform !== 'win32'
    && typeof process.getuid === 'function'
    && Number.isInteger(target.uid)
    && target.uid !== process.getuid()) {
    throw localSecretFailure(
      'Local secret target must be owned by the current user',
      'LOCAL_SECRET_FILE_OWNER_INVALID',
    );
  }

  const permissionBits = platform === 'win32' ? null : target.mode & 0o777;
  return Object.freeze({
    exists: true,
    symbolicLink,
    ownerOnly: platform === 'win32' || (permissionBits & 0o077) === 0,
    mode: platform === 'win32' ? 'platform-managed' : formatMode(permissionBits),
    resolvedPath,
    device: target.dev,
    inode: target.ino,
  });
}

export async function secureLocalSecretFile(secretPath, options = {}) {
  const platform = options.platform ?? process.platform;
  const before = await inspectLocalSecretFile(secretPath, options);
  if (!before.exists || platform === 'win32') return before;

  await chmod(before.resolvedPath, LOCAL_SECRET_OWNER_ONLY_MODE);

  const after = await inspectLocalSecretFile(secretPath, options);
  if (!after.exists
    || after.resolvedPath !== before.resolvedPath
    || after.device !== before.device
    || after.inode !== before.inode) {
    throw localSecretFailure(
      'Local secret target changed while permissions were being secured',
      'LOCAL_SECRET_FILE_TARGET_CHANGED',
    );
  }
  if (!after.ownerOnly) {
    throw localSecretFailure(
      'Unable to restrict local secret permissions to owner-only access',
      'LOCAL_SECRET_FILE_PERMISSION_FAILED',
    );
  }

  return after;
}

function formatMode(mode) {
  return (mode & 0o777).toString(8).padStart(4, '0');
}

function localSecretFailure(message, code) {
  const error = new Error(message);
  error.name = 'LocalSecretFilePolicyError';
  error.code = code;
  return error;
}
