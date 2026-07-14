import { resolveConfirmedApplyMode } from './confirmed-apply-mode.js';

/** Wrapper คง API เดิมของ Schema installer แต่ใช้ Safety guard กลางร่วมกับ Installer อื่น */
export function resolveReportSchemaInstallerMode(input = {}) {
  return resolveConfirmedApplyMode({
    ...input,
    operationName: 'Report schema apply',
    confirmationErrorCode: 'REPORT_SCHEMA_WRITE_CONFIRMATION_REQUIRED',
    applyCommand: 'CONFIRM_WRITE=YES npm run setup:report-schema:apply',
  });
}
