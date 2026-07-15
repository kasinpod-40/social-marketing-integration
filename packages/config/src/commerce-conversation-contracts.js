export const COMMERCE_CONVERSATION_CONTRACT_VERSION = 'commerce-conversation-v1';

export const WOOCOMMERCE_SOURCE_CONTRACT = deepFreeze({
  api: 'wc/v3',
  auth: 'https_basic_auth_consumer_key_secret',
  pagination: 'link_header_or_x_wp_total_pages',
  entities: ['orders', 'products', 'customers'],
  fixturePolicy: 'no_customer_name_email_phone_address_or_credentials',
  stableKeys: {
    order: 'woocommerce:{store_key}:{order_id}',
    product: 'woocommerce:{store_key}:{product_id}',
    customer: 'woocommerce:{store_key}:{customer_id}',
  },
  nullSemantics: 'preserve_source_null_and_empty_separately_until_mapping_is_approved',
});

export const CHATWOOT_SOURCE_CONTRACT = deepFreeze({
  api: 'application_api_v1',
  auth: 'api_access_token_header',
  pagination: 'page_number_until_payload_empty_or_meta_total_exhausted',
  entities: ['conversations', 'contacts', 'inboxes', 'agents'],
  fixturePolicy: 'no_message_content_contact_name_email_phone_or_access_token',
  stableKeys: {
    conversation: 'chatwoot:{account_key}:{conversation_id}',
    contact: 'chatwoot:{account_key}:{contact_id}',
  },
  nullSemantics: 'preserve_null; missing response timestamps are not zero',
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
