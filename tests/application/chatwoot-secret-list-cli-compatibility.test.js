import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const repositoryRoot = new URL('../../', import.meta.url);

test('Chatwoot preflight uses the supported Wrangler secret-list JSON format', async () => {
  const source = await readFile(
    new URL('scripts/chatwoot-remote-readiness-operator.mjs', repositoryRoot),
    'utf8',
  );

  assert.match(
    source,
    /'wrangler', 'secret', 'list',\s*'--config', target\.wranglerConfig,\s*'--format', 'json'/u,
  );
  assert.doesNotMatch(
    source,
    /'wrangler', 'secret', 'list',\s*'--config', target\.wranglerConfig,\s*'--json'/u,
  );
});
