const LARK_OPEN_API_BASE_URL = 'https://open.larksuite.com';
const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_BATCH_SIZE = 100;

/**
 * Minimal Lark Base client for server-side Workers usage.
 * The client is intentionally small: token fetch, paginated read, search by field, and batch create/update.
 */
export class LarkBitableClient {
  /**
   * @param {Object} config
   * @param {string} config.appId
   * @param {string} config.appSecret
   * @param {string} config.appToken Lark Base app token.
   * @param {typeof fetch} [config.fetchImpl]
   * @param {string} [config.baseUrl]
   */
  constructor(config) {
    this.appId = requireText(config?.appId, 'appId');
    this.appSecret = requireText(config?.appSecret, 'appSecret');
    this.appToken = requireText(config?.appToken, 'appToken');
    this.fetchImpl = config?.fetchImpl ?? fetch;
    this.baseUrl = config?.baseUrl ?? LARK_OPEN_API_BASE_URL;
  }

  async getTenantAccessToken() {
    const response = await this.requestJson('/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      body: {
        app_id: this.appId,
        app_secret: this.appSecret,
      },
      auth: false,
    });

    return requireText(response?.tenant_access_token, 'tenant_access_token');
  }

  async listRecords(input) {
    const tableId = requireText(input?.tableId, 'tableId');
    const pageSize = input?.pageSize ?? DEFAULT_PAGE_SIZE;
    const token = await this.getTenantAccessToken();
    const records = [];
    let pageToken = null;

    do {
      const params = new URLSearchParams({ page_size: String(pageSize) });
      if (pageToken) {
        params.set('page_token', pageToken);
      }

      const response = await this.requestJson(
        `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(tableId)}/records?${params.toString()}`,
        { method: 'GET', token },
      );

      const pageRecords = response?.data?.items ?? [];
      if (!Array.isArray(pageRecords)) {
        throw new Error(`Lark listRecords returned invalid items for table ${tableId}`);
      }

      records.push(...pageRecords.map(toRecordShape));
      pageToken = response?.data?.page_token ?? null;
    } while (pageToken);

    return records;
  }

  async searchRecordsByField(input) {
    const tableId = requireText(input?.tableId, 'tableId');
    const fieldName = requireText(input?.fieldName, 'fieldName');
    const fieldValue = requireText(input?.fieldValue, 'fieldValue');
    const token = await this.getTenantAccessToken();
    const response = await this.requestJson(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(tableId)}/records/search`,
      {
        method: 'POST',
        token,
        body: {
          page_size: 20,
          filter: {
            conjunction: 'and',
            conditions: [
              {
                field_name: fieldName,
                operator: 'is',
                value: [fieldValue],
              },
            ],
          },
        },
      },
    );

    const records = response?.data?.items ?? [];
    if (!Array.isArray(records)) {
      throw new Error(`Lark searchRecordsByField returned invalid items for table ${tableId}`);
    }

    return records.map(toRecordShape);
  }

  async batchCreateRecords(input) {
    const tableId = requireText(input?.tableId, 'tableId');
    const records = requireArray(input?.records, 'records');
    if (records.length === 0) {
      return { created: 0 };
    }

    const token = await this.getTenantAccessToken();
    let created = 0;

    for (const chunk of chunkArray(records, DEFAULT_BATCH_SIZE)) {
      const response = await this.requestJson(
        `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(tableId)}/records/batch_create`,
        {
          method: 'POST',
          token,
          body: {
            records: chunk.map((fields) => ({ fields })),
          },
        },
      );

      created += response?.data?.records?.length ?? chunk.length;
    }

    return { created };
  }

  async batchUpdateRecords(input) {
    const tableId = requireText(input?.tableId, 'tableId');
    const records = requireArray(input?.records, 'records');
    if (records.length === 0) {
      return { updated: 0 };
    }

    const token = await this.getTenantAccessToken();
    let updated = 0;

    for (const chunk of chunkArray(records, DEFAULT_BATCH_SIZE)) {
      const response = await this.requestJson(
        `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(tableId)}/records/batch_update`,
        {
          method: 'POST',
          token,
          body: {
            records: chunk.map((record) => ({
              record_id: requireText(record?.recordId, 'recordId'),
              fields: requireObject(record?.fields, 'fields'),
            })),
          },
        },
      );

      updated += response?.data?.records?.length ?? chunk.length;
    }

    return { updated };
  }

  async requestJson(path, options) {
    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
    if (options?.token) {
      headers.set('Authorization', `Bearer ${options.token}`);
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: options?.method ?? 'GET',
      headers,
      body: options?.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};

    if (!response.ok) {
      throw new Error(`Lark HTTP ${response.status}: ${payload?.msg ?? text}`);
    }

    if (payload?.code !== 0) {
      throw new Error(`Lark API error ${payload?.code}: ${payload?.msg ?? 'Unknown error'}`);
    }

    return payload;
  }
}

export function createLarkBitableClientFromEnv(env) {
  return new LarkBitableClient({
    appId: env?.LARK_APP_ID,
    appSecret: env?.LARK_APP_SECRET,
    appToken: env?.LARK_APP_TOKEN,
  });
}

function toRecordShape(record) {
  return Object.freeze({
    recordId: record?.record_id ?? record?.recordId ?? null,
    fields: Object.freeze(record?.fields ?? {}),
  });
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Lark Bitable client requires ${fieldName}`);
  }

  return value.trim();
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new TypeError(`Lark Bitable client requires array ${fieldName}`);
  }

  return value;
}

function requireObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Lark Bitable client requires object ${fieldName}`);
  }

  return value;
}
