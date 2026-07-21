import { loadCustomerRuntimeConfig } from './customer-profiles.js';
import { permanentError } from '../../shared/src/errors/runtime-error.js';

/** Restrict the current Meta schema task to the developer-owned DEV profile. */
export function assertMetaSchemaDevTarget(env) {
  const runtime = loadCustomerRuntimeConfig(env);
  if (runtime.environment !== 'development' || runtime.profileKey !== 'dev_ft_pumkin') {
    throw permanentError('Meta schema installer is currently authorized for developer-owned DEV only', {
      code: 'META_SCHEMA_DEV_TARGET_REQUIRED',
      details: {
        environment: runtime.environment,
        profileKey: runtime.profileKey,
        expectedEnvironment: 'development',
        expectedProfileKey: 'dev_ft_pumkin',
      },
    });
  }
  return runtime;
}
