import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

/**
 * Preview command ต้องอ่านอย่างเดียวเสมอ แม้ Shell จะมี CONFIRM_WRITE=YES ค้างอยู่
 * Apply ต้องระบุทั้ง --apply และ CONFIRM_WRITE=YES เพื่อป้องกันการเขียนโดยไม่ตั้งใจ
 */
export function resolveReportSchemaInstallerMode(input = {}) {
  const argv = Array.isArray(input.argv) ? input.argv : [];
  const env = input.env ?? {};
  const applyRequested = argv.includes('--apply');
  const confirmed = env.CONFIRM_WRITE === 'YES';

  if (applyRequested && !confirmed) {
    throw permanentError('Report schema apply requires CONFIRM_WRITE=YES', {
      code: 'REPORT_SCHEMA_WRITE_CONFIRMATION_REQUIRED',
      details: {
        command: 'CONFIRM_WRITE=YES npm run setup:report-schema:apply',
      },
    });
  }

  return Object.freeze({
    apply: applyRequested && confirmed,
    applyRequested,
    confirmed,
    ignoredAmbientConfirmation: !applyRequested && confirmed,
  });
}
