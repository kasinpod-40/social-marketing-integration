import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const OPERATOR_URL = new URL(
  '../../scripts/tiktok-durable-recovery-operator.mjs',
  import.meta.url,
);

test('Wrangler 4.110 migration apply uses supported non-interactive arguments', async () => {
  const source = await readFile(OPERATOR_URL, 'utf8');
  const start = source.indexOf("const apply = runCommand('npx', [");
  const end = source.indexOf("const after = runCommand('npx', [", start);

  assert.notEqual(start, -1, 'migration apply invocation must exist');
  assert.notEqual(end, -1, 'post-migration list invocation must exist');

  const invocation = source.slice(start, end);
  assert.match(
    invocation,
    /'wrangler', 'd1', 'migrations', 'apply', target\.databaseName/u,
  );
  assert.doesNotMatch(invocation, /--skip-confirmation/u);
  assert.match(invocation, /env:\s*\{ CI: 'true' \}/u);
  assert.match(
    source,
    /env:\s*\{ \.\.\.process\.env, \.\.\.\(options\.env \?\? \{\}\) \}/u,
  );
});
