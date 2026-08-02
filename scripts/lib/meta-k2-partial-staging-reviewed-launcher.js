import {
  META_K2_EXACT_RECOVERY_PATH,
} from '../../packages/config/src/meta-k2-exact-recovery-contract.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

/** Resolve the exact recovery route from an explicit URL or the existing customer public origin. */
export function resolveMetaK2ExactRecoveryUrl(input = {}) {
  const value = input.explicitUrl
    ? new URL(requireText(input.explicitUrl, 'MKT_META_K2_EXACT_RECOVERY_URL'))
    : new URL(
      META_K2_EXACT_RECOVERY_PATH,
      requireHttpsOrigin(input.publicOrigin, 'MKT_CONNECTION_PUBLIC_ORIGIN'),
    );
  if (value.protocol !== 'https:'
    || value.pathname !== META_K2_EXACT_RECOVERY_PATH
    || value.search !== ''
    || value.hash !== '') {
    throw launcherError(
      'Meta K2 exact recovery URL must use HTTPS and the reviewed recovery path',
      'META_K2_REVIEWED_LAUNCHER_RECOVERY_URL_INVALID',
    );
  }
  return value.toString();
}

function requireHttpsOrigin(value, fieldName) {
  const url = new URL(requireText(value, fieldName));
  if (url.protocol !== 'https:'
    || url.pathname !== '/'
    || url.search !== ''
    || url.hash !== '') {
    throw launcherError(
      `${fieldName} must be an HTTPS origin`,
      'META_K2_REVIEWED_LAUNCHER_PUBLIC_ORIGIN_INVALID',
      { fieldName },
    );
  }
  return url;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw launcherError(
      `${fieldName} is required`,
      'META_K2_REVIEWED_LAUNCHER_INPUT_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function launcherError(message, code, details = {}) {
  return permanentError(message, { code, details });
}
