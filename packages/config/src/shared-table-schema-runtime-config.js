import { loadCustomerRuntimeConfig } from './customer-profiles.js';
import { permanentError } from '../../shared/src/errors/runtime-error.js';

/** ล็อก Shared-table Schema tools ให้ทำงานกับ developer-owned DEV profile เท่านั้น */
export function assertSharedTableSchemaDevTarget(env, options = {}) {
  const runtime = loadCustomerRuntimeConfig(env ?? {});
  if (runtime.environment !== 'development' || runtime.profileKey !== 'dev_ft_pumkin') {
    throw permanentError(
      `Shared-table schema ${options.operation ?? 'operation'} is authorized for developer-owned DEV only`,
      {
        code: options.errorCode ?? 'SHARED_TABLE_SCHEMA_DEV_TARGET_REQUIRED',
        details: { environment: runtime.environment, profileKey: runtime.profileKey },
      },
    );
  }
  return runtime;
}
