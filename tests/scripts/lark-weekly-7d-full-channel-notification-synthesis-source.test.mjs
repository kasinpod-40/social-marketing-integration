import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SOURCE = await readFile(
  new URL('../../scripts/lark-weekly-7d-full-channel-notification.mjs', import.meta.url),
  'utf8',
);

test('notification terminal requires exact generated full-channel synthesis before preview or send', () => {
  assert.match(SOURCE, /load-exact-generated-full-channel-ai-synthesis/u);
  assert.match(SOURCE, /buildLarkWeekly7dFullChannelAiSynthesis/u);
  assert.match(SOURCE, /assertLarkWeekly7dFullChannelAiGenerated/u);
  assert.match(SOURCE, /LARK_WEEKLY_7D_FULL_CHANNEL_SYNTHESIS_MISSING/u);
  assert.match(SOURCE, /synthesisQualityGatePassed/u);
});

test('notification terminal preserves both V9 and synthesis authority during delivery', () => {
  assert.match(SOURCE, /assertAuthoritiesUnchanged/u);
  assert.match(SOURCE, /sourceV9MutationCount:\s*0/u);
  assert.match(SOURCE, /synthesisMutationCount:\s*0/u);
  assert.match(SOURCE, /synthesisStateSha256/u);
});
