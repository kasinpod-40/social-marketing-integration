import {
  LARK_EXECUTIVE_DESTINATION_KEY_HASH,
} from '../../../config/src/lark-notification-runtime-config.js';

export const LARK_REVIEWED_EXECUTIVE_CHAT_NAME = 'Social MKT Executive Reports';

const HASH = /^[a-f0-9]{64}$/u;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

/** Resolve the reviewed Executive chat by exact visible name and immutable chat-id hash. */
export async function resolveLarkNotificationReviewedDestination(input = {}) {
  const client = requireClient(input.client ?? input.repository?.client);
  const expectedDestinationKeyHash = input.expectedDestinationKeyHash
    ?? LARK_EXECUTIVE_DESTINATION_KEY_HASH;
  if (!HASH.test(expectedDestinationKeyHash)) {
    throw new TypeError('expectedDestinationKeyHash must be SHA-256 hex');
  }
  const expectedName = requireText(
    input.expectedName ?? LARK_REVIEWED_EXECUTIVE_CHAT_NAME,
    'expectedName',
  );

  const matches = [];
  const seenTokens = new Set();
  let pageToken = null;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ page_size: String(PAGE_SIZE) });
    if (pageToken) params.set('page_token', pageToken);
    const response = await client.requestBitableJson(
      `/open-apis/im/v1/chats?${params.toString()}`,
      { method: 'GET' },
    );
    const data = response?.data ?? {};
    const items = Array.isArray(data.items) ? data.items : [];
    for (const item of items) {
      if (String(item?.name ?? '').trim() !== expectedName) continue;
      const chatId = requireText(item?.chat_id, 'chat_id');
      matches.push(Object.freeze({ chatId, name: expectedName }));
    }

    if (data.has_more !== true) break;
    const nextToken = requireText(data.page_token, 'page_token');
    if (seenTokens.has(nextToken) || nextToken === pageToken) {
      throw destinationError(
        'Lark chat pagination did not advance',
        'LARK_NOTIFICATION_DESTINATION_RESOLUTION_INVALID',
      );
    }
    seenTokens.add(nextToken);
    pageToken = nextToken;
    if (page === MAX_PAGES) {
      throw destinationError(
        'Lark chat pagination exceeded the reviewed bound',
        'LARK_NOTIFICATION_DESTINATION_RESOLUTION_INVALID',
      );
    }
  }

  const unique = [...new Map(matches.map((item) => [item.chatId, item])).values()];
  if (unique.length !== 1) {
    throw destinationError(
      'Reviewed Executive Lark chat must resolve to exactly one visible group',
      'LARK_NOTIFICATION_DESTINATION_RESOLUTION_INVALID',
      { matchCount: unique.length },
    );
  }
  const observedDestinationKeyHash = await sha256Hex(unique[0].chatId);
  if (observedDestinationKeyHash !== expectedDestinationKeyHash) {
    throw destinationError(
      'Reviewed Executive Lark chat identity does not match the locked destination hash',
      'LARK_NOTIFICATION_DESTINATION_MISMATCH',
      { destinationRedacted: true },
    );
  }

  return Object.freeze({
    chatId: unique[0].chatId,
    name: expectedName,
    destinationKeyHash: observedDestinationKeyHash,
  });
}

function requireClient(client) {
  if (typeof client?.requestBitableJson !== 'function') {
    throw new TypeError('Lark reviewed destination requires client.requestBitableJson');
  }
  return client;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw destinationError(
      `${fieldName} is required`,
      'LARK_NOTIFICATION_DESTINATION_RESOLUTION_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}
async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle) {
    throw destinationError(
      'Web Crypto SHA-256 is required for reviewed destination validation',
      'LARK_NOTIFICATION_DESTINATION_RESOLUTION_INVALID',
    );
  }
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(String(value)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
function destinationError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkNotificationReviewedDestinationError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
