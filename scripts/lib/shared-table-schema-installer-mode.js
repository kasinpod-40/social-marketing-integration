import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';
import { resolveConfirmedApplyMode } from './confirmed-apply-mode.js';

/** Apply ต้องมีทั้ง generic write confirmation และ confirmation เฉพาะ Shared-table schema */
export function resolveSharedTableSchemaInstallerMode(input = {}) {
  const env = input.env ?? {};
  const mode = resolveConfirmedApplyMode({
    ...input,
    operationName: 'Shared-table schema apply',
    confirmationErrorCode: 'SHARED_TABLE_SCHEMA_WRITE_CONFIRMATION_REQUIRED',
    applyCommand: 'CONFIRM_WRITE=YES CONFIRM_SHARED_TABLE_SCHEMA=YES npm run setup:shared-table-schema:apply',
  });
  const schemaConfirmed = env.CONFIRM_SHARED_TABLE_SCHEMA === 'YES';
  if (mode.applyRequested && mode.confirmed && !schemaConfirmed) {
    throw permanentError('Shared-table schema apply requires CONFIRM_SHARED_TABLE_SCHEMA=YES', {
      code: 'SHARED_TABLE_SCHEMA_EXACT_CONFIRMATION_REQUIRED',
      details: {
        command: 'CONFIRM_WRITE=YES CONFIRM_SHARED_TABLE_SCHEMA=YES npm run setup:shared-table-schema:apply',
      },
    });
  }
  return Object.freeze({
    ...mode,
    apply: mode.apply && schemaConfirmed,
    schemaConfirmed,
    ignoredAmbientSchemaConfirmation: !mode.applyRequested && schemaConfirmed,
  });
}
