import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('evidence launcher observes only ephemeral Wrangler output and delegates Live work', async () => {
  const source = await readFile(
    new URL(
      '../../scripts/woocommerce-worker-provider-diagnostics-command-failed-evidence.mjs',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(source, /CONFIRM_WOOCOMMERCE_WRANGLER_FAILURE_EVIDENCE/u);
  assert.match(source, /CAPTURE_REDACTED_WRANGLER_FAILURE_EVIDENCE/u);
  assert.match(source, /woocommerce-worker-provider-diagnostics-preview-window\.mjs/u);
  assert.match(source, /summarizeWooCommerceDiagnosticsWranglerEvidence/u);
  assert.match(source, /watch\(repositoryRoot/u);
  assert.match(source, /rawOutputPersisted:\s*false/u);
  assert.match(source, /remoteActionsAddedByEvidenceLauncher:\s*0/u);
  assert.doesNotMatch(source, /writeFile|appendFile|rename\(/u);
  assert.doesNotMatch(source, /wrangler['"],\s*['"]deploy|queues?['"],\s*['"]send|d1['"],\s*['"]execute|secret['"],\s*['"]put/u);
  assert.doesNotMatch(source, /authorization:\s*`Bearer|WOOCOMMERCE_CONSUMER_(?:KEY|SECRET)/u);
});
