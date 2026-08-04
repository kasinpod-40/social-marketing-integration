import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const DEFAULT_BASE_URL = 'https://open.larksuite.com';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TEXT_BYTES = 24_000;

/**
 * Minimal Lark IM transport for one reviewed group text message.
 *
 * Message POST is deliberately attempted once. Any error after dispatch is classified as
 * outcome-unknown by the caller, which blocks automatic resend and preserves exact-send safety.
 */
export class LarkMessageClient {
  constructor(input = {}) {
    if (typeof input.tokenProvider !== 'function') {
      throw new TypeError('LarkMessageClient requires tokenProvider');
    }
    const fetchImpl = input.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (typeof fetchImpl !== 'function') throw new TypeError('LarkMessageClient requires fetch');
    this.tokenProvider = input.tokenProvider;
    this.fetchImpl = (...args) => fetchImpl(...args);
    this.baseUrl = normalizeBaseUrl(input.baseUrl ?? DEFAULT_BASE_URL);
    this.timeoutMs = positiveInteger(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs');
  }

  async sendTextToChat(input = {}) {
    const chatId = requireText(input.chatId, 'chatId');
    const text = requireText(input.text, 'text');
    const bytes = new TextEncoder().encode(text).byteLength;
    if (bytes > MAX_TEXT_BYTES) {
      throw permanentError('Lark message text exceeds the reviewed bound', {
        code: 'LARK_NOTIFICATION_MESSAGE_TOO_LARGE',
        details: { bytes, maximumBytes: MAX_TEXT_BYTES },
      });
    }

    // Token is resolved before the message request is dispatched.
    const token = requireText(await this.tokenProvider(), 'tenantAccessToken');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(
        `${this.baseUrl}/open-apis/im/v1/messages?receive_id_type=chat_id`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({
            receive_id: chatId,
            msg_type: 'text',
            content: JSON.stringify({ text }),
          }),
          signal: controller.signal,
        },
      );
    } catch (cause) {
      throw outcomeUnknown('Lark message request did not return a confirmed response', cause);
    } finally {
      clearTimeout(timeout);
    }

    let body;
    try {
      body = await response.json();
    } catch (cause) {
      throw outcomeUnknown('Lark message response was not valid JSON', cause, response.status);
    }
    if (!response.ok || Number(body?.code ?? -1) !== 0) {
      throw outcomeUnknown('Lark did not confirm message delivery', null, response.status, body?.code);
    }
    const messageId = requireText(body?.data?.message_id, 'message_id');
    return Object.freeze({ messageId, confirmed: true });
  }
}

function outcomeUnknown(message, cause, status = null, larkCode = null) {
  return permanentError(message, {
    code: 'LARK_NOTIFICATION_DELIVERY_OUTCOME_UNKNOWN',
    cause,
    details: {
      status: Number.isInteger(status) ? status : null,
      larkCode: Number.isInteger(Number(larkCode)) ? Number(larkCode) : null,
      destinationRedacted: true,
    },
  });
}
function normalizeBaseUrl(value) {
  const text = requireText(value, 'baseUrl').replace(/\/+$/u, '');
  const url = new URL(text);
  if (url.protocol !== 'https:') throw new TypeError('LarkMessageClient baseUrl must use HTTPS');
  return url.toString().replace(/\/+$/u, '');
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be positive integer`);
  return number;
}
