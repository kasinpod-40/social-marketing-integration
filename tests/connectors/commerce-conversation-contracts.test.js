import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mapWooCommerceOrderContract } from '../../packages/connectors/src/woocommerce/woocommerce-order-contract.js';
import { mapChatwootConversationContract } from '../../packages/connectors/src/chatwoot/chatwoot-conversation-contract.js';

test('sanitized WooCommerce fixture satisfies source contract without customer PII', async () => {
  const text = await readFile(new URL('../fixtures/woocommerce/orders-page-1.json', import.meta.url), 'utf8');
  for (const forbidden of ['consumer_key', 'consumer_secret', 'email', 'phone', 'billing', 'shipping']) {
    assert.equal(text.toLowerCase().includes(`"${forbidden}"`), false);
  }
  const [order] = JSON.parse(text);
  const mapped = mapWooCommerceOrderContract(order, { storeKey: 'dev_store' });
  assert.equal(mapped.orderKey, 'woocommerce:dev_store:41001');
  assert.equal(mapped.total, '1590.00');
  assert.equal(mapped.lineItems[0].variationId, null);
});

test('sanitized Chatwoot fixture maps operational fields without message/contact PII', async () => {
  const text = await readFile(new URL('../fixtures/chatwoot/conversations-page-1.json', import.meta.url), 'utf8');
  for (const forbidden of ['api_access_token', 'email', 'phone_number', 'contact_inbox', 'processed_message_content']) {
    assert.equal(text.toLowerCase().includes(`"${forbidden}"`), false);
  }
  const payload = JSON.parse(text).data.payload[0];
  const mapped = mapChatwootConversationContract(payload, { accountKey: 'dev_chat' });
  assert.equal(mapped.conversationKey, 'chatwoot:dev_chat:71001');
  assert.equal(mapped.status, 'resolved');
  assert.equal(mapped.messageCount, 0);
});
