import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const RECOVERY_OUTPUT = 'chatwoot-controller-safe-baseline-resume';
const SHA = /^[0-9a-f]{40}$/u;

export async function assertChatwootSafeBaselineCurrentHeadClear({
  outputs,
  repositoryHead,
}) {
  const head = String(repositoryHead ?? '').trim().toLowerCase();
  if (!SHA.test(head)) {
    throw currentHeadError(
      'Chatwoot safe-baseline current Head is invalid',
      'CHATWOOT_SAFE_BASELINE_CURRENT_HEAD_INVALID',
    );
  }
  if (typeof outputs !== 'string' || outputs.trim() === '') {
    throw currentHeadError(
      'Chatwoot safe-baseline outputs path is invalid',
      'CHATWOOT_SAFE_BASELINE_CURRENT_HEAD_INVALID',
    );
  }

  const directory = join(outputs, RECOVERY_OUTPUT, head);
  let info;
  try {
    info = await lstat(directory);
  } catch (cause) {
    if (cause?.code === 'ENOENT') {
      return Object.freeze({ clear: true, entryCount: 0, directory });
    }
    throw cause;
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw currentHeadError(
      'Chatwoot safe-baseline current-head evidence path must be a real directory',
      'CHATWOOT_SAFE_BASELINE_CURRENT_HEAD_INVALID',
    );
  }

  const entries = await readdir(directory);
  if (entries.length > 0) {
    throw currentHeadError(
      'Chatwoot safe-baseline current-head evidence already exists; blind rerun is blocked',
      'CHATWOOT_SAFE_BASELINE_CURRENT_HEAD_PRESENT',
      { entryCount: entries.length },
    );
  }
  return Object.freeze({ clear: true, entryCount: 0, directory });
}

function currentHeadError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootSafeBaselineCurrentHeadError';
  error.code = code;
  error.details = details;
  return error;
}
