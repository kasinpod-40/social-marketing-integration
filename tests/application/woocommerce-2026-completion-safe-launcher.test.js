import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../../scripts/woocommerce-2026-completion-safe-launcher.mjs', import.meta.url),
  'utf8',
);

test('safe launcher uses a distinct ignored private Wrangler config', () => {
  assert.match(
    source,
    /PRIVATE_CONFIG_NAME\s*=\s*'\.mkt-woocommerce-2026-completion-wrangler\.jsonc'/u,
  );
  assert.match(source, /ensureLocalExclude\(cloneRoot/u);
  assert.match(source, /`\/\$\{PRIVATE_CONFIG_NAME\}`/u);
  assert.match(source, /snapshotPrivateFile\(\s*sourceConfigPath,\s*sealedConfig/u);
  assert.doesNotMatch(
    source,
    /const sealedConfig = join\(cloneRoot, 'wrangler\.sync\.jsonc'\)/u,
  );
});

test('safe launcher pins and canonicalizes an independent current-main clone', () => {
  assert.match(source, /buildReportRuntimeSealedCloneArgs/u);
  assert.match(source, /buildReportRuntimeSealedChildEnvironment/u);
  assert.match(source, /sanitizeReportRuntimeGitEnvironment/u);
  assert.match(source, /remote', 'set-url', 'origin', '\.'/u);
  assert.match(source, /rev-parse', 'origin\/main'/u);
  assert.match(source, /assertExactClone\(cloneRoot, pinnedHead/u);
  assert.match(source, /await rm\(sandboxRoot, \{ recursive: true, force: true \}\)/u);
});

test('safe launcher delegates only to the sealed completion child', () => {
  assert.match(
    source,
    /\['scripts\/woocommerce-2026-completion-one-command\.mjs', '--execute'\]/u,
  );
  assert.match(
    source,
    /MKT_WOOCOMMERCE_2026_COMPLETION_SEALED_MARKER/u,
  );
  assert.match(
    source,
    /MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG: sealedConfig/u,
  );
  assert.doesNotMatch(source, /wrangler.*deploy|queues\/.+\/messages/u);
});

test('safe launcher never logs private paths or credentials', () => {
  assert.match(source, /sanitize\(error\?\.details/u);
  assert.match(
    source,
    /token\|secret\|authorization\|cookie\|password/u,
  );
  assert.doesNotMatch(source, /console\.log\(.*devVars|console\.log\(.*sealedConfig/u);
});
