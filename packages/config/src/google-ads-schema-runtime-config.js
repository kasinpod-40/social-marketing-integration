import { loadCustomerRuntimeConfig } from './customer-profiles.js';
import { permanentError } from '../../shared/src/errors/runtime-error.js';

/** ล็อก Google Ads Schema tools ให้ทำงานกับ developer-owned DEV profile เท่านั้น */
export function assertGoogleAdsSchemaDevTarget(env, options = {}) {
  const runtime = loadCustomerRuntimeConfig(env ?? {});
  if (runtime.environment !== 'development' || runtime.profileKey !== 'dev_ft_pumkin') {
    throw permanentError(
      `Google Ads schema ${options.operation ?? 'operation'} is authorized for developer-owned DEV only`,
      {
        code: options.errorCode ?? 'GOOGLE_ADS_SCHEMA_DEV_TARGET_REQUIRED',
        details: { environment: runtime.environment, profileKey: runtime.profileKey },
      },
    );
  }
  return runtime;
}
