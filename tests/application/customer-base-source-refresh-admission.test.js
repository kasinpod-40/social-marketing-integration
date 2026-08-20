import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const operatorUrl = new URL('../../scripts/customer-base-controlled-apply.mjs', import.meta.url);

async function operatorSource() {
  return readFile(operatorUrl, 'utf8');
}

test('Source refresh admission does not require Target-only identity anchors', async () => {
  const source = await operatorSource();
  const start = source.indexOf('function refreshAuthorityMismatches(inspection)');
  const end = source.indexOf('\nfunction sameUniqueNameSet', start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const refreshAdmission = source.slice(start, end);
  assert.equal(refreshAdmission.includes('REQUIRED_PROTECTED_TABLE_NAMES'), false);
  assert.equal(refreshAdmission.includes('REFRESH_STRUCTURAL_COUNTS'), true);
  assert.equal(refreshAdmission.includes('BASELINE_COUNTS.records'), true);
});

test('latest Source clone-scope names remain exact but order-insensitive before Apply', async () => {
  const source = await operatorSource();

  assert.match(
    source,
    /!sameUniqueNameSet\(checkpoint\?\.expectedTableNames \?\? \[\], expectedTableNames\)/u,
  );
  assert.match(source, /CUSTOMER_BASE_CONTROLLED_APPLY_SOURCE_REFRESH_SCOPE_MISMATCH/u);
  assert.match(source, /expectedTableNames: checkpoint\.expectedTableNames/u);
  assert.match(source, /function sameUniqueNameSet\(left, right\)/u);
  assert.match(source, /checkpoint\?\.targetIdentityAnchorTableNames/u);
  assert.match(source, /CUSTOMER_BASE_CONTROLLED_APPLY_TARGET_ANCHOR_MISMATCH/u);
});
