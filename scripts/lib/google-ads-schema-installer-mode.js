import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';
import { resolveConfirmedApplyMode } from './confirmed-apply-mode.js';

const APPLY_COMMAND = 'CONFIRM_WRITE=YES CONFIRM_GOOGLE_ADS_SCHEMA=YES npm run setup:google-ads-schema:apply';

/** Apply ต้องมีทั้ง Generic write confirmation และ Confirmation เฉพาะ Google Ads Schema */
export function resolveGoogleAdsSchemaInstallerMode(input = {}) {
  const env = input.env ?? {};
  const mode = resolveConfirmedApplyMode({
    ...input,
    operationName: 'Google Ads schema apply',
    confirmationErrorCode: 'GOOGLE_ADS_SCHEMA_WRITE_CONFIRMATION_REQUIRED',
    applyCommand: APPLY_COMMAND,
  });
  const schemaConfirmed = env.CONFIRM_GOOGLE_ADS_SCHEMA === 'YES';
  if (mode.applyRequested && mode.confirmed && !schemaConfirmed) {
    throw permanentError('Google Ads schema apply requires CONFIRM_GOOGLE_ADS_SCHEMA=YES', {
      code: 'GOOGLE_ADS_SCHEMA_EXACT_CONFIRMATION_REQUIRED',
      details: { command: APPLY_COMMAND },
    });
  }
  return Object.freeze({
    ...mode,
    apply: mode.apply && schemaConfirmed,
    schemaConfirmed,
    ignoredAmbientSchemaConfirmation: !mode.applyRequested && schemaConfirmed,
  });
}
