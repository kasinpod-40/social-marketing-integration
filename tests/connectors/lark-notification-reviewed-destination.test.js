import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  LARK_REVIEWED_EXECUTIVE_CHAT_NAME,
  resolveLarkNotificationReviewedDestination,
} from '../../packages/connectors/src/lark/lark-notification-reviewed-destination.js';

const CHAT_ID = 'oc_reviewed_executive_chat';
const CHAT_HASH = createHash('sha256').update(CHAT_ID).digest('hex');

function clientWithPages(pages) {
  let index = 0;
  return {
    calls: [],
    async requestBitableJson(path, options) {
      this.calls.push({ path, options });
      return pages[index++] ?? pages.at(-1);
    },
  };
}

test('resolves the exact reviewed Executive chat through GET-only Lark IM pagination', async () => {
  const client = clientWithPages([
    {
      code: 0,
      data: {
        items: [{ chat_id: 'oc_other', name: 'Other Group' }],
        has_more: true,
        page_token: 'next-page',
      },
    },
    {
      code: 0,
      data: {
        items: [{ chat_id: CHAT_ID, name: LARK_REVIEWED_EXECUTIVE_CHAT_NAME }],
        has_more: false,
        page_token: '',
      },
    },
  ]);

  const destination = await resolveLarkNotificationReviewedDestination({
    client,
    expectedDestinationKeyHash: CHAT_HASH,
  });

  assert.equal(destination.chatId, CHAT_ID);
  assert.equal(destination.name, LARK_REVIEWED_EXECUTIVE_CHAT_NAME);
  assert.equal(destination.destinationKeyHash, CHAT_HASH);
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls.every((call) => call.options.method === 'GET'), true);
  assert.match(client.calls[0].path, /^\/open-apis\/im\/v1\/chats\?page_size=100$/u);
  assert.match(client.calls[1].path, /page_token=next-page/u);
});

test('fails closed when the exact chat name is ambiguous', async () => {
  const client = clientWithPages([{
    code: 0,
    data: {
      items: [
        { chat_id: CHAT_ID, name: LARK_REVIEWED_EXECUTIVE_CHAT_NAME },
        { chat_id: 'oc_duplicate', name: LARK_REVIEWED_EXECUTIVE_CHAT_NAME },
      ],
      has_more: false,
    },
  }]);

  await assert.rejects(
    () => resolveLarkNotificationReviewedDestination({
      client,
      expectedDestinationKeyHash: CHAT_HASH,
    }),
    (error) => error.code === 'LARK_NOTIFICATION_DESTINATION_RESOLUTION_INVALID'
      && error.details.matchCount === 2,
  );
});

test('fails closed when the exact-name chat does not match the reviewed hash', async () => {
  const client = clientWithPages([{
    code: 0,
    data: {
      items: [{ chat_id: 'oc_wrong', name: LARK_REVIEWED_EXECUTIVE_CHAT_NAME }],
      has_more: false,
    },
  }]);

  await assert.rejects(
    () => resolveLarkNotificationReviewedDestination({
      client,
      expectedDestinationKeyHash: CHAT_HASH,
    }),
    (error) => error.code === 'LARK_NOTIFICATION_DESTINATION_MISMATCH',
  );
});

test('fails closed when chat pagination repeats a token', async () => {
  const client = clientWithPages([
    { code: 0, data: { items: [], has_more: true, page_token: 'same' } },
    { code: 0, data: { items: [], has_more: true, page_token: 'same' } },
  ]);

  await assert.rejects(
    () => resolveLarkNotificationReviewedDestination({
      client,
      expectedDestinationKeyHash: CHAT_HASH,
    }),
    (error) => error.code === 'LARK_NOTIFICATION_DESTINATION_RESOLUTION_INVALID',
  );
});
