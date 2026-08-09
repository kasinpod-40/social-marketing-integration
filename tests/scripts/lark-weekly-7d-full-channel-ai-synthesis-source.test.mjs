import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SOURCE = await readFile(
  new URL('../../scripts/lark-weekly-7d-full-channel-ai-synthesis.mjs', import.meta.url),
  'utf8',
);

test('full-channel AI terminal supports preview execute and poll-only recovery', () => {
  assert.match(SOURCE, /--preview/u);
  assert.match(SOURCE, /--execute/u);
  assert.match(SOURCE, /--recover/u);
  assert.match(SOURCE, /POLL_ONLY_RECOVERY/u);
});

test('full-channel AI terminal reuses exact V9 and aligned Report factual authority', () => {
  assert.match(SOURCE, /isExactAcceptedWeekly7dSource/u);
  assert.match(SOURCE, /collectLarkNativeAiWeekly7dControlledUatSource/u);
  assert.match(SOURCE, /assertLarkWeekly7dFullChannelSourceAlignment/u);
  assert.match(SOURCE, /buildLarkWeeklyExecutiveFactualReport/u);
  assert.match(SOURCE, /assertSourceUnchanged/u);
});

test('Native AI trigger is failure_code only and notification remains disabled', () => {
  assert.match(SOURCE, /fields:\s*\{ failure_code:\s*LARK_WEEKLY_7D_FULL_CHANNEL_AI_TRIGGER_MARKER \}/u);
  assert.match(SOURCE, /triggerWrittenFields:\s*triggerWriteCount \? \['failure_code'\] : \[\]/u);
  assert.match(SOURCE, /notificationCount:\s*0/u);
  assert.match(SOURCE, /notificationEligible:\s*false/u);
  assert.match(SOURCE, /sentToGroup:\s*false/u);
  assert.match(SOURCE, /scheduleEnabled:\s*false/u);
  assert.match(SOURCE, /production:\s*'BLOCKED'/u);
});

test('operator has no external GPT provider or Notification/Worker deployment path', () => {
  assert.doesNotMatch(SOURCE, /openai|chat\.completions|responses\.create|api\.openai/iu);
  assert.doesNotMatch(SOURCE, /wrangler['"],\s*['"]deploy/u);
  assert.doesNotMatch(SOURCE, /LARK_NOTIFICATION_SEND/u);
  assert.doesNotMatch(SOURCE, /queues\/[^\n]+\/messages/u);
});

test('blind retrigger is forbidden once trigger marker is retained', () => {
  assert.match(SOURCE, /blind retrigger is forbidden/u);
  assert.match(SOURCE, /recoveryRequired:\s*true/u);
  assert.match(SOURCE, /poll-existing-native-ai-without-retrigger/u);
});
