import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const scriptUrl = new URL(
  '../../scripts/youtube-lark-full-sync-uat-emergency-restore.mjs',
  import.meta.url,
);

test('emergency restore is confirmation-gated and can deploy only the reviewed safe config', async () => {
  const source = await readFile(scriptUrl, 'utf8');

  assert.match(
    source,
    /CONFIRM_YOUTUBE_LARK_UAT_EMERGENCY_RESTORE/u,
  );
  assert.match(source, /EMERGENCY_RESTORE_YOUTUBE_LARK_UAT/u);
  assert.match(
    source,
    /config\.safeSha256 !== remote\.data\.safeConfigSha256/u,
  );
  assert.match(
    source,
    /current !== activatedVersion/u,
  );
  assert.match(
    source,
    /await writePrivateJson\(attemptPath,[\s\S]*'wrangler', 'deploy'/u,
  );
  assert.match(source, /trueFlags\.length !== 0/u);
  assert.match(source, /ALREADY_SAFE_NO_DEPLOYMENT/u);
  assert.match(source, /EMERGENCY_RESTORE_ALL_FALSE_COMPLETED/u);
});

test('emergency restore never sends Queue messages or writes D1/Lark', async () => {
  const source = await readFile(scriptUrl, 'utf8');

  assert.doesNotMatch(source, /\/queues\/[^`]*\/messages/u);
  assert.doesNotMatch(source, /method:\s*'POST'/u);
  assert.doesNotMatch(source, /d1',\s*'execute'/u);
  assert.doesNotMatch(source, /migrations',\s*'apply'/u);
  assert.doesNotMatch(source, /createLark|searchRecords|batchCreate|batchUpdate/u);
  assert.match(source, /queueMessage: 'NOT_SENT'/u);
  assert.match(source, /d1Write: 'NONE'/u);
  assert.match(source, /larkRequest: 'NOT_RUN'/u);
  assert.match(source, /tokenPersisted: false/u);
});
