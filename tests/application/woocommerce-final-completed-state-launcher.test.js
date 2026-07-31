import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const launcherUrl = new URL(
  '../../scripts/woocommerce-final-completed-state-closeout-launcher.mjs',
  import.meta.url,
);

test('completed-state public launcher invokes the guarded operator', async () => {
  const source = await readFile(launcherUrl, 'utf8');
  assert.match(source, /woocommerce-final-completed-state-closeout\.mjs/u);
  assert.match(source, /MKT_WOOCOMMERCE_COMPLETED_STATE_PUBLIC_LAUNCHER:\s*'1'/u);
  assert.match(source, /stdio:\s*'inherit'/u);
  assert.match(source, /production:\s*'BLOCKED'/u);
});

test('completed-state launcher binds private evidence to exact Repository Head', async () => {
  const source = await readFile(launcherUrl, 'utf8');
  assert.match(source, /resolveRepositoryHead\(\)/u);
  assert.match(source, /spawnSync\('git', \['rev-parse', 'HEAD'\]/u);
  assert.match(source, /\^\[0-9a-f\]\{40\}\$/u);
  assert.match(source, /join\(evidenceBase, repositoryHead\)/u);
  assert.match(source, /MKT_WOOCOMMERCE_COMPLETED_STATE_EVIDENCE_DIR:\s*evidenceDirectory/u);
});

test('completed-state launcher contains no Remote or compatibility execution logic', async () => {
  const source = await readFile(launcherUrl, 'utf8');
  assert.doesNotMatch(source, /api\.cloudflare\.com/u);
  assert.doesNotMatch(source, /queues\/.+\/messages/u);
  assert.doesNotMatch(source, /wrangler/u);
  assert.doesNotMatch(source, /npx/u);
  assert.doesNotMatch(source, /MKT_WOOCOMMERCE_FINAL_NPX_PROXY/u);
  assert.doesNotMatch(source, /PATH:\s*/u);
  assert.doesNotMatch(source, /createLarkBitableClientFromEnv/u);
});
