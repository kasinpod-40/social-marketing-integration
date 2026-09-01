import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FINALIZER = new URL('../../scripts/meta-k2-customer-local-finalizer.mjs', import.meta.url);

test('Customer K2 local finalizer uses local preflight CPU and confirmed bounded D1 commands', async () => {
  const source = await readFile(FINALIZER, 'utf8');

  assert.match(source, /preflightRowsPerInvocation:\s*1_000/u);
  assert.match(source, /const results = await this\.executeCommand\(sql\)/u);
  assert.match(source, /statements\.map\(\(statement\) => statement\.render\(\)\)/u);
  assert.doesNotMatch(source, /executeFile\(|'--file'/u);
  assert.match(source, /Replaying every statement is intentional/u);
});
