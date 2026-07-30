import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const launcherUrl = new URL(
  '../../scripts/woocommerce-final-completed-state-closeout-launcher.mjs',
  import.meta.url,
);

test('completed-state public launcher delegates through the closeout Queue CLI adapter', async () => {
  const source = await readFile(launcherUrl, 'utf8');
  assert.match(source, /woocommerce-final-completed-state-closeout\.mjs/u);
  assert.match(source, /woocommerce-final-completed-state-npx-proxy\.mjs/u);
  assert.match(source, /MKT_WOOCOMMERCE_FINAL_REAL_NPX/u);
  assert.match(source, /MKT_WOOCOMMERCE_FINAL_NODE/u);
  assert.match(source, /MKT_WOOCOMMERCE_FINAL_NPX_PROXY/u);
  assert.match(source, /PATH:\s*`\$\{proxyDirectory\}/u);
  assert.match(source, /settings\.batch_size/u);
  assert.match(source, /settings\.max_wait_time_ms/u);
  assert.match(source, /settings\.dead_letter_queue/u);
  assert.match(source, /every other npx command passes/u);
});

test('completed-state launcher binds private evidence to exact Repository Head', async () => {
  const source = await readFile(launcherUrl, 'utf8');
  assert.match(source, /resolveRepositoryHead\(\)/u);
  assert.match(source, /git', \['rev-parse', 'HEAD'\]/u);
  assert.match(source, /\^\[0-9a-f\]\{40\}\$/u);
  assert.match(source, /join\(evidenceBase, repositoryHead\)/u);
  assert.match(source, /MKT_WOOCOMMERCE_COMPLETED_STATE_EVIDENCE_DIR:\s*evidenceDirectory/u);
});

test('completed-state launcher never contains Remote execution logic itself', async () => {
  const source = await readFile(launcherUrl, 'utf8');
  assert.doesNotMatch(source, /api\.cloudflare\.com/u);
  assert.doesNotMatch(source, /queues\/.+\/messages/u);
  assert.doesNotMatch(source, /wrangler[^\n]+deploy/u);
  assert.doesNotMatch(source, /d1[^\n]+execute/u);
  assert.doesNotMatch(source, /createLarkBitableClientFromEnv/u);
  assert.match(source, /stdio:\s*'inherit'/u);
  assert.match(source, /production:\s*'BLOCKED'/u);
});
