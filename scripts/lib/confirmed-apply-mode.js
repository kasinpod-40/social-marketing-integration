import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

/**
 * Preview command ต้องอ่านอย่างเดียวเสมอ แม้ Shell จะมี CONFIRM_WRITE=YES ค้างอยู่
 * Apply ต้องระบุทั้ง --apply และ CONFIRM_WRITE=YES เพื่อป้องกันการเขียนโดยไม่ตั้งใจ
 */
export function resolveConfirmedApplyMode(input = {}) {
  const argv = Array.isArray(input.argv) ? input.argv : [];
  const env = input.env ?? {};
  const applyRequested = argv.includes('--apply');
  const confirmed = env.CONFIRM_WRITE === 'YES';
  const confirmationErrorCode = input.confirmationErrorCode ?? 'WRITE_CONFIRMATION_REQUIRED';
  const applyCommand = input.applyCommand ?? 'CONFIRM_WRITE=YES <apply-command>';
  const operationName = input.operationName ?? 'Apply';

  if (applyRequested && !confirmed) {
    throw permanentError(`${operationName} requires CONFIRM_WRITE=YES`, {
      code: confirmationErrorCode,
      details: { command: applyCommand },
    });
  }

  return Object.freeze({
    apply: applyRequested && confirmed,
    applyRequested,
    confirmed,
    ignoredAmbientConfirmation: !applyRequested && confirmed,
  });
}
