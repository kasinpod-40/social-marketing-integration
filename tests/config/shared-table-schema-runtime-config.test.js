import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSharedTableSchemaDevTarget } from '../../packages/config/src/shared-table-schema-runtime-config.js';

test('allows only developer-owned Integration Workspace for Shared-table schema operations', () => {
  const runtime = assertSharedTableSchemaDevTarget({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
  });
  assert.equal(runtime.environment, 'development');
  assert.equal(runtime.profileKey, 'integration_workspace');

  assert.throws(
    () => assertSharedTableSchemaDevTarget({
      MKT_ENV: 'production',
      MKT_CUSTOMER_PROFILE: 'chemistry_k',
    }, { operation: 'apply', errorCode: 'SHARED_TABLE_APPLY_DEV_TARGET_REQUIRED' }),
    (error) => error.code === 'SHARED_TABLE_APPLY_DEV_TARGET_REQUIRED',
  );
  assert.throws(
    () => assertSharedTableSchemaDevTarget({
      MKT_ENV: 'development',
      MKT_CUSTOMER_PROFILE: 'chemistry_k',
    }),
    (error) => error.code === 'MKT_RUNTIME_CONFIG_INVALID',
  );
});
