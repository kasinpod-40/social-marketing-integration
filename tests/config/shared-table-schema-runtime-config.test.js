import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSharedTableSchemaDevTarget } from '../../packages/config/src/shared-table-schema-runtime-config.js';

test('allows only developer-owned DEV for Shared-table schema operations', () => {
  const runtime = assertSharedTableSchemaDevTarget({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'dev_ft_pumkin',
  });
  assert.equal(runtime.environment, 'development');
  assert.equal(runtime.profileKey, 'dev_ft_pumkin');

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
      MKT_CUSTOMER_PROFILE: 'uat_chemistry_k',
    }),
    (error) => error.code === 'SHARED_TABLE_SCHEMA_DEV_TARGET_REQUIRED',
  );
});
