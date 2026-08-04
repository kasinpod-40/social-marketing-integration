import assert from 'node:assert/strict';
import test from 'node:test';
import { LarkMessageClient } from '../../packages/connectors/src/lark/lark-message.client.js';

test('sends one text message with the reviewed Lark IM contract', async () => {
  const requests = [];
  const client = new LarkMessageClient({
    tokenProvider: async () => 'tenant-token',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ code: 0, data: { message_id: 'om_123' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const result = await client.sendTextToChat({ chatId: 'destination-id', text: 'รายงานทดสอบ' });
  assert.deepEqual(result, { messageId: 'om_123', confirmed: true });
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /receive_id_type=chat_id/u);
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.receive_id, 'destination-id');
  assert.equal(body.msg_type, 'text');
  assert.deepEqual(JSON.parse(body.content), { text: 'รายงานทดสอบ' });
});

test('does not retry an ambiguous message failure', async () => {
  let calls = 0;
  const client = new LarkMessageClient({
    tokenProvider: async () => 'tenant-token',
    fetchImpl: async () => {
      calls += 1;
      throw new Error('network timeout');
    },
  });
  await assert.rejects(
    () => client.sendTextToChat({ chatId: 'destination-id', text: 'รายงาน' }),
    (error) => error.code === 'LARK_NOTIFICATION_DELIVERY_OUTCOME_UNKNOWN',
  );
  assert.equal(calls, 1);
});

test('does not retry an unconfirmed Lark response', async () => {
  let calls = 0;
  const client = new LarkMessageClient({
    tokenProvider: async () => 'tenant-token',
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ code: 999, msg: 'unconfirmed' }), { status: 500 });
    },
  });
  await assert.rejects(
    () => client.sendTextToChat({ chatId: 'destination-id', text: 'รายงาน' }),
    (error) => error.code === 'LARK_NOTIFICATION_DELIVERY_OUTCOME_UNKNOWN',
  );
  assert.equal(calls, 1);
});
