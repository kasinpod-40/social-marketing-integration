import { loadCustomerRuntimeConfig } from './customer-profiles.js';
import { permanentError } from '../../shared/src/errors/runtime-error.js';

/** ล็อก Shared-table Schema tools ให้ทำงานกับ Integration Workspace ที่ผู้พัฒนาเป็นเจ้าของเท่านั้น */
export function assertSharedTableSchemaDevTarget(env, options = {}) {
  const runtime = loadCustomerRuntimeConfig(env ?? {});
  if (runtime.environment !== 'development'
    || runtime.profileKey !== 'integration_workspace'
    || runtime.infrastructureOwner !== 'developer') {
    throw permanentError(
      `Shared-table schema ${options.operation ?? 'operation'} is authorized for the developer-owned Integration Workspace only`,
      {
        code: options.errorCode ?? 'SHARED_TABLE_SCHEMA_DEV_TARGET_REQUIRED',
        details: {
          environment: runtime.environment,
          profileKey: runtime.profileKey,
          infrastructureOwner: runtime.infrastructureOwner,
        },
      },
    );
  }
  return runtime;
}
