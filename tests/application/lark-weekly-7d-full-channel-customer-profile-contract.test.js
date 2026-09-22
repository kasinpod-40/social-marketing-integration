import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const OPERATOR_PATH = new URL(
  '../../scripts/lark-weekly-7d-full-channel-notification.mjs',
  import.meta.url,
);

test('weekly correction operator binds every customer-profile gate to Chemistry K authority', async () => {
  const source = await readFile(OPERATOR_PATH, 'utf8');

  assert.match(
    source,
    /exact\(env\.MKT_CUSTOMER_PROFILE, 'chemistry_k', 'MKT_CUSTOMER_PROFILE'\)/u,
  );
  assert.doesNotMatch(
    source,
    /exact\(env\.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE'\)/u,
  );
  assert.match(
    source,
    /collectLarkNativeAiWeekly7dControlledUatSource\(\{[\s\S]*?customerProfile: env\.MKT_CUSTOMER_PROFILE,[\s\S]*?targetPeriodEnd:/u,
  );
  assert.match(
    source,
    /customerProfile: context\.env\.MKT_CUSTOMER_PROFILE,/u,
  );
  assert.match(
    source,
    /request\.snapshot\.customerProfile !== context\.env\.MKT_CUSTOMER_PROFILE/u,
  );
  assert.doesNotMatch(source, /customerProfile: 'integration_workspace'/u);
  assert.doesNotMatch(source, /request\.snapshot\.customerProfile !== 'integration_workspace'/u);
});
