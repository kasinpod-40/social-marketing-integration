import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const sessionScript = new URL(
  '../../scripts/youtube-lark-full-sync-uat-session.mjs',
  import.meta.url,
);

test('session wrapper plan runs without Cloudflare authentication', () => {
  const result = spawnSync(process.execPath, [sessionScript.pathname], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.planOnly, true);
  assert.equal(output.remoteActionsPerformed, false);
});

test('session wrapper resolves targets read-only and never persists or prints the bearer token', async () => {
  const source = await readFile(sessionScript, 'utf8');

  assert.match(source, /await readFile\('wrangler\.sync\.jsonc', 'utf8'\)/u);
  assert.match(source, /\/queues\?page=\$\{page\}&per_page=100/u);
  assert.match(source, /headers: \{ authorization: `Bearer \$\{token\}` \}/u);
  assert.match(source, /MKT_YOUTUBE_LARK_UAT_QUEUE_ID: session\.queueId/u);
  assert.match(source, /resolveCustomerYouTubeConnection/u);
  assert.match(source, /connector_key = '\$\{connectorKey\}'/u);
  assert.match(source, /credential_reference_present/u);
  assert.match(source, /customerConnectionValidated: true/u);
  assert.match(source, /CLOUDFLARE_API_TOKEN: auth\.token/u);
  assert.match(source, /writeFile\(temporary,[\s\S]*mode: 0o600/u);
  assert.match(source, /tokenPrinted: false/u);
  assert.match(source, /`--phase=\$\{parsed\.phase\}`,[\s\S]*'--execute'/u);

  const sessionObject = source.slice(
    source.indexOf('const session = Object.freeze({'),
    source.indexOf('validateSession(session);'),
  );
  assert.doesNotMatch(sessionObject, /apiToken|CLOUDFLARE_API_TOKEN/u);
  assert.doesNotMatch(source, /method:\s*'POST'[\s\S]*\/queues\?page/u);
});
