import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createStableFingerprint } from '../../packages/shared/src/hash/stable-fingerprint.js';
import { canonicalizeMetaK2ProjectionRows } from '../../scripts/lib/meta-k2-local-lark-projection-wire.js';

const FINALIZER = new URL('../../scripts/meta-k2-customer-local-finalizer.mjs', import.meta.url);

test('Customer K2 local finalizer uses local preflight CPU and confirmed bounded D1 commands', async () => {
  const source = await readFile(FINALIZER, 'utf8');

  assert.match(source, /preflightRowsPerInvocation:\s*1_000/u);
  assert.match(source, /const results = await this\.executeStableKeyCommand\(sql\)/u);
  assert.match(source, /statements\.map\(\(statement\) => statement\.render\(\)\)/u);
  assert.doesNotMatch(source, /executeFile\(|'--file'/u);
  assert.match(source, /Replaying every statement is intentional/u);
  assert.match(source, /error\?\.code !== 'META_K2_LOCAL_D1_JSON_INVALID'/u);
  assert.match(source, /Never retry SQL, auth or other classified failures/u);
});

test('Customer K2 local finalizer aligns projection manifest and explicitly gates confirmed D1 reuse', async () => {
  const source = await readFile(FINALIZER, 'utf8');

  assert.match(source, /D1_REUSE_CONFIRMATION = 'REUSE_CONFIRMED_EXACT_CUSTOMER_META_K2_D1'/u);
  assert.match(source, /historyStore instanceof ConfirmedD1HistoryStore/u);
  assert.match(source, /Two reviewed local executions already completed every deterministic stable-key D1 batch/u);
  assert.match(source, /operations\.map\(\(\) => Object\.freeze\(\{ status: 'skipped' \}\)\)/u);
  assert.match(source, /registers the[\s\S]*exact 25-row Lark child plans/u);
  assert.match(source, /start \+= LIMITS\.larkRowsPerInvocation/u);
  assert.match(source, /planningOnly: true/u);
  assert.match(source, /larkTablesPerInvocation:\s*1/u);
});

test('canonicalizes projection rows before both wire transport and digest', async () => {
  const source = [{ key: 'a', observed_at: new Date('2026-09-01T00:00:00.000Z'), omitted: undefined }];
  const rows = canonicalizeMetaK2ProjectionRows(source);
  const wireRows = JSON.parse(JSON.stringify(rows));

  assert.deepEqual(rows, [{ key: 'a', observed_at: '2026-09-01T00:00:00.000Z' }]);
  assert.equal(
    await createStableFingerprint({ rows }),
    await createStableFingerprint({ rows: wireRows }),
  );
});
